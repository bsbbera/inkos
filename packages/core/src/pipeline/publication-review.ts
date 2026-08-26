/**
 * The half of the quality pass that needs a reader, not a regex.
 *
 * `publication-audit.ts` is the rule-based half: it counts words, measures
 * paragraph variance, spots hedge density and cross-page repetition. Six
 * dimensions, no model, no cost. Everything it can catch is a shape.
 *
 * The chapter pipeline does not stop there — `ContinuityAuditor` puts a model
 * in front of thirty-seven dimensions and asks it to read. Publications had no
 * equivalent, so the entire class of problem that only shows up on reading
 * (a page that does not answer its section's question, a number nobody
 * sourced, a deck that promises what the body never delivers) went unchecked.
 *
 * The chapter dimensions do not transfer — a page has no hooks, no POV and no
 * character arc. The mechanism does. This is the same mechanism with the
 * dimensions a magazine page actually has: thirty-one judged by the model,
 * plus the six the rule pass already owns, and the two halves are reported as
 * one audit.
 *
 * Findings are advisory, exactly as they are for the rule pass. What is new is
 * that they no longer only pile up: `buildRevisePrompt` turns them back into a
 * rewrite, so an audit that finds eighteen problems can fix them instead of
 * filing them.
 */

import type { PublicationDefinition } from "../publications/types.js";
import type { PublicationFinding } from "./publication-audit.js";
import type { PublicationIssue, PublicationPage, PublicationSection } from "./publication-runner.js";

export interface ReviewDimension {
  readonly n: number;
  readonly name: string;
  /** What the model is actually asked to look for. */
  readonly ask: string;
}

/**
 * What a magazine page is judged on.
 *
 * Ordered by what costs most to get wrong: a page that misses its brief is a
 * page to rewrite, a clumsy sentence is a page to edit. The model is told to
 * report in this order too, so a truncated response loses the least.
 */
export const PUBLICATION_DIMENSIONS: ReadonlyArray<ReviewDimension> = [
  { n: 1, name: "Thesis adherence", ask: "Does the page serve the issue's thesis, or is it a good page about something else?" },
  { n: 2, name: "Premise delivery", ask: "Does it deliver the premise the plan gave it?" },
  { n: 3, name: "Section question", ask: "Does it advance the question its section asks?" },
  { n: 4, name: "Opening", ask: "Does the first sentence earn the second, or is it a throat-clear?" },
  { n: 5, name: "Ending", ask: "Does the page land, or does it merely stop when the word budget ran out?" },
  { n: 6, name: "Claim support", ask: "Is every factual claim traceable to the research given, or to a listed source?" },
  { n: 7, name: "Unsourced specificity", ask: "Are there numbers, dates, names or quotes that appear nowhere in the research?" },
  { n: 8, name: "Overclaiming", ask: "Is anything the research hedged stated here as settled?" },
  { n: 9, name: "Attribution", ask: "Is anything attributed to the wrong person, body or era?" },
  { n: 10, name: "Uncertainty honesty", ask: "Where the page is genuinely unsure, does it say so rather than smoothing over it?" },
  { n: 11, name: "Reading level", ask: "Does it match the audience register this publication is written for?" },
  { n: 12, name: "Jargon", ask: "Is any term used before it is earned or explained?" },
  { n: 13, name: "Abstraction", ask: "Does it explain in the general where the concrete was available?" },
  { n: 14, name: "Concrete anchor", ask: "Is there at least one person, place, object or number a reader can hold?" },
  { n: 15, name: "Explanatory chain", ask: "Does the explanation skip a step a reader needs to follow it?" },
  { n: 16, name: "Analogy integrity", ask: "Does any analogy teach something false in the course of making it easy?" },
  { n: 17, name: "Voice", ask: "Is this the issue's voice, or a generic one?" },
  { n: 18, name: "Register match", ask: "Does the prose belong in the printed register this section is set in?" },
  { n: 19, name: "Deck agreement", ask: "Does the deck promise what the body delivers?" },
  { n: 20, name: "Title honesty", ask: "Does the title describe the page, without baiting?" },
  { n: 21, name: "Pull quote provenance", ask: "Is the pull quote in the body, or at least true to it?" },
  { n: 22, name: "Furniture accuracy", ask: "Is every sidebar, caption and box factually right on its own?" },
  { n: 23, name: "Furniture redundancy", ask: "Does the furniture repeat the body instead of adding to it?" },
  { n: 24, name: "Visual brief fit", ask: "Does the image brief depict what this page is actually about?" },
  { n: 25, name: "Visual brief feasibility", ask: "Is the brief a describable picture, or an abstraction no one can draw?" },
  { n: 26, name: "Neighbour continuity", ask: "Does it read as this page of this issue, rather than a standalone article?" },
  { n: 27, name: "Cross-page contradiction", ask: "Does it contradict anything established on another page?" },
  { n: 28, name: "Cliché imagery", ask: "Does it reach for the image every piece on this subject reaches for?" },
  { n: 29, name: "Sentence rhythm", ask: "Do the sentences vary in length and shape, or march?" },
  { n: 30, name: "Filler", ask: "Which sentences carry no information and could be cut with nothing lost?" },
  { n: 31, name: "Sensitivity", ask: "Is anything careless about the people, cultures or events it describes?" },
];

/** Dimensions whose findings are what "de-AI-ification" means for prose. */
export const SLOP_DIMENSIONS: ReadonlySet<number> = new Set([13, 17, 28, 29, 30]);

/** Rule-pass categories that are also AI tells, matched by prefix. */
const SLOP_CATEGORY_PREFIXES = ["ai-tell/", "repetition/"];

/** Whether a finding is about the prose sounding machine-made. */
export function isSlopFinding(finding: PublicationFinding): boolean {
  if (SLOP_CATEGORY_PREFIXES.some((p) => finding.category.startsWith(p))) return true;
  const dim = /^dim(\d+)\//.exec(finding.category);
  return dim ? SLOP_DIMENSIONS.has(Number(dim[1])) : false;
}

const brief = (page: PublicationPage) =>
  [
    `p${page.n} "${page.title}" — ${page.type}, density ${page.density}, pillar ${page.pillar}`,
    `PLANNED PREMISE: ${page.premise}`,
    page.deck ? `DECK: ${page.deck}` : "",
    page.pullQuote ? `PULL QUOTE: "${page.pullQuote}"` : "",
    (page.furniture ?? []).length
      ? `FURNITURE:\n${(page.furniture ?? []).map((f) => `- ${f.kind}: ${f.text}`).join("\n")}`
      : "",
    page.brief?.prompt ? `IMAGE BRIEF: ${page.brief.prompt}` : "",
    page.sources?.length ? `SOURCES CITED: ${page.sources.join("; ")}` : "",
    "",
    "BODY:",
    page.body ?? "",
  ].filter(Boolean).join("\n");

/**
 * The rest of the issue, as far as this page needs to know it.
 *
 * Two hundred characters of every page is fine at twelve pages and useless at
 * forty — the model reads a wall of opening fragments and dimension 27
 * (cross-page contradiction) degrades into guessing. `recalled` is the index's
 * answer to which pages bear on this one; without it the old behaviour stands,
 * so a caller with no memory still gets a working audit.
 */
const neighbourText = (
  issue: PublicationIssue,
  page: PublicationPage,
  recalled?: ReadonlyArray<{ n: number; title: string; opening: string }>,
) => {
  if (recalled?.length) {
    return recalled.map((p) => `p${p.n} "${p.title}": ${p.opening}…`).join("\n");
  }
  return issue.pages
    .filter((p) => p.n !== page.n && p.body)
    .map((p) => `p${p.n} "${p.title}": ${String(p.body).slice(0, 200).replace(/\s+/g, " ")}…`)
    .join("\n") || "none written yet";
};

/**
 * One page, thirty-one dimensions, JSON back.
 *
 * Per page rather than per issue on purpose: a forty-page issue in one prompt
 * gets a model that skims, and the findings come back evenly spread and
 * uniformly shallow — which is the failure mode that makes an audit look like
 * it ran when it did not.
 */
export function buildAuditPrompt(
  issue: PublicationIssue,
  page: PublicationPage,
  definition: PublicationDefinition,
  section: PublicationSection | undefined,
  recalled?: ReadonlyArray<{ n: number; title: string; opening: string }>,
): string {
  const band = definition.densities[page.density];
  return [
    `You are the editor auditing one page of "${issue.title}", a ${definition.label}.`,
    `ISSUE THESIS: ${issue.thesis}`,
    section ? `THIS SECTION ASKS: ${section.question}` : "",
    band ? `WORD BUDGET FOR THIS DENSITY: ${band[0]}-${band[1]}` : "",
    "",
    "RESEARCH THE PAGE WAS WRITTEN FROM:",
    JSON.stringify(issue.research ?? {}).slice(0, 6000),
    "",
    "OTHER PAGES IN THIS ISSUE:",
    neighbourText(issue, page, recalled),
    "",
    "THE PAGE UNDER AUDIT:",
    brief(page),
    "",
    "Audit it against these dimensions, in order:",
    PUBLICATION_DIMENSIONS.map((d) => `${d.n}. ${d.name} — ${d.ask}`).join("\n"),
    "",
    "Report only real problems. A dimension with nothing wrong produces no finding;",
    'do not invent one to look thorough, and do not report "could be stronger" as a',
    "problem. Quote the offending text so an editor can find it.",
    "",
    'Severity is "warning" for something that should be fixed before print, "info"',
    "for something worth an editor's eye.",
    "",
    "Reply with JSON only:",
    '{"findings":[{"dimension":7,"severity":"warning","description":"...","suggestion":"..."}]}',
  ].filter(Boolean).join("\n");
}

/** Turn what the model returned into findings, discarding anything malformed. */
export function parseAuditFindings(
  out: Record<string, unknown>,
  page: number,
): PublicationFinding[] {
  const raw = Array.isArray(out.findings) ? out.findings : [];
  const findings: PublicationFinding[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const description = String(f.description ?? "").trim();
    if (!description) continue;

    const n = Number(f.dimension);
    const dim = PUBLICATION_DIMENSIONS.find((d) => d.n === n);
    findings.push({
      page,
      // Anything the model calls critical is still a warning here: this audit
      // never blocks, and inventing a third severity would imply it might.
      severity: String(f.severity) === "info" ? "info" : "warning",
      category: dim ? `dim${dim.n}/${dim.name}` : "dim/unlabelled",
      description: `p${page}: ${description}`,
      suggestion: String(f.suggestion ?? "").trim() || "Fix as described.",
    });
  }
  return findings;
}

/**
 * The findings, turned back into a page.
 *
 * The rewrite is bounded to the page: no new reporting, no new claims, and the
 * word band held. A revise pass that is allowed to research is a writer stage
 * wearing a different name, and it re-introduces exactly the unsourced
 * specifics dimension 7 exists to catch.
 */
export function buildRevisePrompt(
  issue: PublicationIssue,
  page: PublicationPage,
  definition: PublicationDefinition,
  findings: ReadonlyArray<PublicationFinding>,
): string {
  const band = definition.densities[page.density] ?? definition.densities[definition.defaultDensity];
  return [
    `Revise one page of "${issue.title}". The audit found these problems with it:`,
    "",
    findings.map((f, i) => `${i + 1}. [${f.category}] ${f.description}\n   → ${f.suggestion}`).join("\n"),
    "",
    "THE PAGE AS IT STANDS:",
    brief(page),
    "",
    "Fix every problem listed. Rules:",
    `- Stay inside ${band[0]}-${band[1]} words of body.`,
    "- Use only facts already in this page or in the research it was written from.",
    "  Do not add a number, date, name or quote that is not already there.",
    "- Keep the page's subject and its place in the issue. This is a revision, not",
    "  a new page.",
    "- Keep everything the page already delivers: every element of its premise,",
    "  every named person, every furniture block. Return the furniture in full,",
    "  including the blocks you did not change. Drop something only when a",
    "  finding above says to drop it — a shorter page is not a fixed one.",
    "- If a finding is wrong, leave that part alone and say so in `rejected`.",
    "",
    "Reply with JSON only, the whole page, not a diff:",
    '{"title":"...","deck":"...","body":"...","pull_quote":"...",',
    ' "furniture":[{"kind":"...","text":"..."}],"image_prompt":"...",',
    ' "rejected":["finding 3: the date is in the research, see ..."]}',
  ].join("\n");
}
