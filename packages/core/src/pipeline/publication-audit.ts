/**
 * The quality pass a publication was going without.
 *
 * A chapter goes through an auditor, a de-AI check, and a length governor
 * before anyone reads it. A magazine page went straight from the model to the
 * page, which is the wrong asymmetry: prose is prose, and a reader does not
 * care which pipeline produced the sentence they are bored by.
 *
 * The novel auditor itself does not transfer — its dimensions are continuity
 * ones (character memory, hook payoff, outline adherence) and a page has no
 * hooks and no characters to remember. What does transfer is everything that
 * judges the prose rather than the story, so that is what runs here, reusing
 * the same functions the chapter pipeline uses rather than growing a second
 * opinion about what a tired sentence looks like.
 *
 * Findings are reported, never enforced. That follows the length governor
 * upstream: a page outside its band is saved with a warning attached, because
 * silently rewriting an editor's page is worse than telling them about it.
 */
import { analyzeAITells } from "../agents/ai-tells.js";
import { detectCrossChapterRepetition } from "../agents/post-write-validator.js";
import type { PublicationDefinition } from "../publications/types.js";
import type { PublicationPage } from "./publication-runner.js";

export interface PublicationFinding {
  /** The page it is about, or 0 for a finding about the issue as a whole. */
  readonly page: number;
  readonly severity: "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface PublicationAudit {
  readonly at: string;
  readonly findings: ReadonlyArray<PublicationFinding>;
}

/** English unless the copy is visibly not: the checks are language-specific. */
function languageOf(pages: ReadonlyArray<PublicationPage>): "zh" | "en" {
  const sample = pages.map((p) => p.body ?? "").join("").slice(0, 4000);
  if (!sample) return "en";
  const han = (sample.match(/[一-鿿]/g) ?? []).length;
  return han > sample.length * 0.15 ? "zh" : "en";
}

/**
 * Words on a page, counted the way the density budget means it.
 *
 * `page.words` is what the writer stage recorded, but a page edited by hand
 * afterwards still carries the old count, so the body wins when there is one.
 */
function wordsOf(page: PublicationPage, language: "zh" | "en"): number {
  const body = page.body;
  if (!body) return page.words ?? 0;
  return language === "zh"
    ? (body.match(/[一-鿿]/g) ?? []).length
    : body.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Length governance, borrowed in spirit from the chapter governor: the budget
 * is a band, a miss is a warning, and nothing is cut to make the number fit.
 */
function lengthFindings(
  page: PublicationPage,
  definition: PublicationDefinition,
  language: "zh" | "en",
): PublicationFinding[] {
  const band = definition.densities[page.density];
  if (!band) return [];
  const [min, max] = band;
  const words = wordsOf(page, language);
  // A page with no body yet is the writer stage's business, not the auditor's.
  if (!page.body) return [];

  if (words < min) {
    return [{
      page: page.n,
      severity: "warning",
      category: "length",
      description: `p${page.n} runs ${words} words against a ${page.density} budget of ${min}-${max}.`,
      suggestion: "Give the page more to say, or move it to a lighter density.",
    }];
  }
  if (words > max) {
    return [{
      page: page.n,
      severity: "warning",
      category: "length",
      description: `p${page.n} runs ${words} words against a ${page.density} budget of ${min}-${max}.`,
      suggestion: "Cut to the band, or move the page to a heavier density — it will not fit the grid as it stands.",
    }];
  }
  return [];
}

/**
 * Every check that judges the prose, over every written page.
 *
 * Pure: no files, no model, no clock. The runner owns persistence and the
 * timestamp, so this can be checked directly.
 */
export function auditPages(
  pages: ReadonlyArray<PublicationPage>,
  definition: PublicationDefinition,
): ReadonlyArray<PublicationFinding> {
  const written = pages.filter((p) => p.body && p.body.trim());
  if (written.length === 0) return [];

  const language = languageOf(written);
  const findings: PublicationFinding[] = [];

  for (const page of written) {
    const body = page.body as string;

    findings.push(...lengthFindings(page, definition, language));

    // Structural AI tells: uniform paragraphs, hedge density, formulaic
    // transitions, list-shaped prose. Rule-based, so it costs nothing to run.
    for (const issue of analyzeAITells(body, language).issues) {
      findings.push({
        page: page.n,
        severity: issue.severity,
        category: `ai-tell/${issue.category}`,
        description: `p${page.n}: ${issue.description}`,
        suggestion: issue.suggestion,
      });
    }

    // Repetition against the rest of the issue. This matters more here than it
    // does across chapters: sixteen pages on one subject repeat themselves in a
    // way sixteen chapters of a story do not, and the reader sees every page.
    const others = written.filter((p) => p.n !== page.n).map((p) => p.body).join("\n\n");
    for (const violation of detectCrossChapterRepetition(body, others, language)) {
      findings.push({
        page: page.n,
        severity: violation.severity === "error" ? "warning" : "info",
        category: `repetition/${violation.rule}`,
        description: `p${page.n}: ${violation.description}`,
        suggestion: violation.suggestion,
      });
    }
  }

  return findings;
}

/** A one-line summary for the stage event and the tracker. */
export function summarize(findings: ReadonlyArray<PublicationFinding>): string {
  if (findings.length === 0) return "no findings";
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const pages = new Set(findings.map((f) => f.page)).size;
  return `${findings.length} findings (${warnings} warnings) across ${pages} pages`;
}
