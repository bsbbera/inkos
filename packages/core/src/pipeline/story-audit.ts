/**
 * The quality pass a finished short, script or storyboard was going without.
 *
 * A novel chapter is audited by the continuity agent and de-slopped before
 * anyone reads it. A magazine issue has publication_audit and
 * publication_deslop. A short story had neither: the short-fiction runner
 * reviews its own draft once, mid-run, and after that the file on disk is
 * final and there is no way to ask for either check again. Scripts and
 * storyboards had nothing at all.
 *
 * The chapter auditor does not transfer, for the same reason it did not
 * transfer to publications: its dimensions are continuity ones — subplot
 * boards, hook ledgers, chapter memos — and they need book state that a
 * standalone markdown file does not have. What transfers is everything that
 * judges the prose and the story as written, which is what runs here.
 *
 * Both passes work on a file, not on a project. That is what a finished
 * artifact is: `dramas/x/script.md`, `shorts/y/final/story.md`. It means the
 * checks are reachable for anything the production pipelines write, including
 * work they wrote before this existed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { runWorkerAgent } from "../agent/worker-agent.js";
import { parseJson } from "../publications/parse-json.js";
import type { PipelineRunner } from "./runner.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import { detectCrossChapterRepetition } from "../agents/post-write-validator.js";
import { safeChildPath } from "../utils/path-safety.js";
import type { ReviewDimension } from "./publication-review.js";

export interface StoryFinding {
  /** The heading it is about, or "" for a finding about the whole piece. */
  readonly section: string;
  readonly severity: "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface StoryAudit {
  readonly at: string;
  /** Project-relative path of the artifact that was read. */
  readonly path: string;
  readonly findings: ReadonlyArray<StoryFinding>;
  /** Revise-then-re-audit rounds. 0 means findings were only reported. */
  readonly rounds: number;
}

/**
 * What a finished piece of narrative is judged on.
 *
 * Ordered by what costs most to get wrong, so a truncated model response loses
 * the least. These are deliberately answerable from the text alone — the
 * continuity dimensions that need a book's state live in agents/continuity.ts
 * and stay there.
 */
export const STORY_DIMENSIONS: ReadonlyArray<ReviewDimension> = [
  { n: 1, name: "Promise kept", ask: "Does the ending pay off what the opening promised, or does it resolve a different story?" },
  { n: 2, name: "Scene, not summary", ask: "Are the load-bearing beats played out on the page, or compressed into narration?" },
  { n: 3, name: "Causality", ask: "Does each turn follow from the last, or do events merely happen in order?" },
  { n: 4, name: "Stakes", ask: "Is it clear what the protagonist loses by failing, and does that cost stay real?" },
  { n: 5, name: "Character motivation", ask: "Does every significant choice follow from what that character wants and fears?" },
  { n: 6, name: "Character consistency", ask: "Does anyone act against their established nature without the text earning it?" },
  { n: 7, name: "Information boundary", ask: "Does any character use information they were never given?" },
  { n: 8, name: "Antagonist competence", ask: "Does the opposition act from its own interest, or exist to lose?" },
  { n: 9, name: "Dialogue differentiation", ask: "Could the speaker be identified from the line alone, or does everyone talk alike?" },
  { n: 10, name: "Dialogue function", ask: "Does dialogue do more than transfer information the reader needs?" },
  { n: 11, name: "Emotion externalised", ask: "Is feeling carried by action and body, or named outright?" },
  { n: 12, name: "Concrete detail", ask: "Is there something specific to hold, or is the writing set in a generic place?" },
  { n: 13, name: "Sensory grounding", ask: "Does more than one sense do any work?" },
  { n: 14, name: "Chapter openings", ask: "Do the sections open differently, or reach for the same door each time?" },
  { n: 15, name: "Chapter endings", ask: "Does each section end on a reason to continue, or simply stop?" },
  { n: 16, name: "Pacing", ask: "Does pressure build and release, or hold one level throughout?" },
  { n: 17, name: "Setup and payoff", ask: "Is anything planted and never used, or paid off without being planted?" },
  { n: 18, name: "Internal consistency", ask: "Do names, numbers, times, places and established facts hold throughout?" },
  { n: 19, name: "Voice", ask: "Is this a particular narrative voice, or a generic one?" },
  { n: 20, name: "Register drift", ask: "Does the prose slip into a different register than it started in?" },
  { n: 21, name: "Abstraction", ask: "Does it explain in the general where the concrete was available?" },
  { n: 22, name: "Cliché imagery", ask: "Does it reach for the image every story on this subject reaches for?" },
  { n: 23, name: "Sentence rhythm", ask: "Do the sentences vary in length and shape, or march?" },
  { n: 24, name: "Simile density", ask: "Is figurative language doing work, or standing in for a precise verb?" },
  { n: 25, name: "Filler", ask: "Which passages carry nothing and could be cut with nothing lost?" },
  { n: 26, name: "Over-explanation", ask: "Does it interpret for the reader what the scene already showed?" },
  { n: 27, name: "Repetition of function", ask: "Do two sections do the same job in the story?" },
  { n: 28, name: "Report vocabulary", ask: "Does analytical language — core motivation, strategic advantage — appear in the prose?" },
  { n: 29, name: "AI tells", ask: "Does it lean on delve, tapestry, testament, intricate, pivotal, or the 'it wasn't X; it was Y' shape?" },
  { n: 30, name: "Sensitivity", ask: "Is anything careless about the people, cultures or events it depicts?" },
];

/** Dimensions whose findings are what "de-AI-ification" means for a story. */
export const STORY_SLOP_DIMENSIONS: ReadonlySet<number> = new Set([19, 21, 22, 23, 24, 25, 26, 28, 29]);

/** Rule-pass categories that are also AI tells, matched by prefix. */
const SLOP_CATEGORY_PREFIXES = ["ai-tell/", "repetition/"];

/** Whether a finding is about the prose sounding machine-made. */
export function isStorySlopFinding(finding: StoryFinding): boolean {
  if (SLOP_CATEGORY_PREFIXES.some((p) => finding.category.startsWith(p))) return true;
  const dim = /^dim(\d+)\//.exec(finding.category);
  return dim ? STORY_SLOP_DIMENSIONS.has(Number(dim[1])) : false;
}

export interface StorySection {
  readonly heading: string;
  readonly body: string;
}

/**
 * A markdown artifact, split the way its author wrote it.
 *
 * Chapters, scenes and shots are all just headings, so the split is on
 * headings rather than on anything pipeline-specific — which is what lets one
 * audit read a short, a script and a storyboard.
 */
export function splitSections(markdown: string): StorySection[] {
  const lines = markdown.split(/\r?\n/);
  const out: StorySection[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body || heading) out.push({ heading, body });
    buf = [];
  };
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      // A level-1 heading is the title of the piece, not a section of it, and
      // not body text either — left in the buffer it became a section of its
      // own holding nothing but the title.
      if (m[1].length >= 2) {
        flush();
        heading = m[2].trim();
      }
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.filter((s) => s.body.length > 0);
}

/** English unless the prose is visibly not: the rule checks are language-specific. */
export function languageOf(text: string): "zh" | "en" {
  const sample = text.slice(0, 4000);
  if (!sample) return "en";
  const han = (sample.match(/[一-鿿]/g) ?? []).length;
  return han > sample.length * 0.15 ? "zh" : "en";
}

/* -------------------------------------------------------------- rule pass */

/**
 * The checks that need no model: paragraph uniformity, hedge density,
 * formulaic transitions, list-shaped prose, and phrases one section shares
 * with the rest of the piece.
 */
export function ruleFindings(sections: ReadonlyArray<StorySection>, language: "zh" | "en"): StoryFinding[] {
  const findings: StoryFinding[] = [];
  for (const section of sections) {
    for (const issue of analyzeAITells(section.body, language).issues) {
      findings.push({
        section: section.heading,
        severity: issue.severity,
        category: `ai-tell/${issue.category}`,
        description: section.heading ? `${section.heading}: ${issue.description}` : issue.description,
        suggestion: issue.suggestion,
      });
    }

    const others = sections.filter((s) => s !== section).map((s) => s.body).join("\n\n");
    for (const violation of detectCrossChapterRepetition(section.body, others, language)) {
      findings.push({
        section: section.heading,
        severity: violation.severity === "error" ? "warning" : "info",
        category: `repetition/${violation.rule}`,
        description: section.heading ? `${section.heading}: ${violation.description}` : violation.description,
        suggestion: violation.suggestion,
      });
    }
  }
  return findings;
}

/* ------------------------------------------------------------- model pass */

/** Parsed JSON from the model, exactly as the publication pass takes it. */
export type StoryAskFn = (prompt: string, tag: string) => Promise<Record<string, unknown>>;

const MAX_SECTION_CHARS = 12_000;

export function buildStoryAuditPrompt(
  section: StorySection,
  index: number,
  total: number,
  language: "zh" | "en",
): string {
  return [
    `You are auditing section ${index + 1} of ${total} of a finished piece of narrative.`,
    "Report only what is wrong. Do not praise, do not summarise, do not rewrite.",
    "",
    "Judge it on these dimensions:",
    STORY_DIMENSIONS.map((d) => `${d.n}. ${d.name} — ${d.ask}`).join("\n"),
    "",
    "A dimension with nothing wrong produces no finding. Quote the offending text",
    "so the writer can find it. Be specific enough to act on: \"the third paragraph",
    "names the feeling instead of showing it\" is usable, \"the prose is weak\" is not.",
    "",
    `The prose is in ${language === "zh" ? "Chinese" : "English"}; judge it in that language's terms.`,
    "",
    `SECTION HEADING: ${section.heading || "(untitled)"}`,
    "",
    section.body.slice(0, MAX_SECTION_CHARS),
    "",
    "Respond with JSON only:",
    '{"findings":[{"dimension":7,"severity":"warning","description":"...","suggestion":"..."}]}',
    'severity is "warning" for something that should change and "info" for something worth knowing.',
  ].join("\n");
}

export function parseStoryFindings(out: Record<string, unknown>, section: string): StoryFinding[] {
  const raw = Array.isArray(out.findings) ? out.findings : [];
  const findings: StoryFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const n = Number(f.dimension);
    const dimension = STORY_DIMENSIONS.find((d) => d.n === n);
    const description = String(f.description ?? "").trim();
    if (!description) continue;
    findings.push({
      section,
      severity: f.severity === "info" ? "info" : "warning",
      // Unknown dimension numbers still carry their finding: a real problem
      // reported under the wrong number is worth more than a dropped one.
      category: dimension ? `dim${dimension.n}/${dimension.name}` : "dim0/unclassified",
      description: section ? `${section}: ${description}` : description,
      suggestion: String(f.suggestion ?? "").trim() || "Fix as described.",
    });
  }
  return findings;
}

export function buildStoryRevisePrompt(
  section: StorySection,
  findings: ReadonlyArray<StoryFinding>,
  language: "zh" | "en",
): string {
  return [
    "Rewrite this section to fix the findings below, and change nothing else.",
    "Keep the plot facts, the viewpoint, the character voice, the pacing function",
    "and every strong original line. A finding you disagree with is left alone;",
    "say so rather than rewriting around it.",
    "",
    `Write in ${language === "zh" ? "Chinese" : "English"}.`,
    "",
    "FINDINGS:",
    findings.map((f) => `- [${f.category}] ${f.description} → ${f.suggestion}`).join("\n"),
    "",
    `SECTION HEADING: ${section.heading || "(untitled)"}`,
    "",
    "CURRENT TEXT:",
    section.body,
    "",
    "Respond with JSON only:",
    '{"body":"the rewritten section, markdown, without the heading line"}',
  ].join("\n");
}

/**
 * The model call these passes make, with no tools.
 *
 * An audit stage judges text and returns JSON; it has nothing to look up and
 * nothing to render, so runWorkerAgent — which builds its Agent with an empty
 * tool table — is exactly the right shape. The publication passes go through
 * runAgentSession because their stages genuinely do call tools; a story audit
 * given the same table would only be given the chance to wander into a
 * production tool mid-check.
 */
export function createStoryAsk(pipeline: PipelineRunner, signal?: AbortSignal): StoryAskFn {
  return async (prompt: string, tag: string): Promise<Record<string, unknown>> => {
    signal?.throwIfAborted();
    const ctx = pipeline.createAgentContext("story-audit");
    const response = await runWorkerAgent(ctx.client, ctx.model, [
      {
        role: "system",
        content: `This is the "${tag}" stage. Your reply is the JSON asked for and nothing else.`,
      },
      { role: "user", content: prompt },
    ], { signal });
    try {
      return parseJson(response.content);
    } catch (error) {
      // The raw text matters: a stage that failed to produce JSON has usually
      // said why, and swallowing it leaves only "invalid JSON".
      throw new Error(`${tag}: ${(error as Error).message}
${response.content.slice(0, 500)}`);
    }
  };
}

/* ---------------------------------------------------------------- the run */

export interface StoryAuditOptions {
  readonly projectRoot: string;
  /** Project-relative path of the markdown artifact. */
  readonly path: string;
  readonly ask: StoryAskFn;
  /** Rewrite what is found, then audit again. Default true for audit. */
  readonly revise?: boolean;
  /** Only rewrite findings about the prose sounding machine-made. */
  readonly slopOnly?: boolean;
  readonly onProgress?: (message: string) => void;
  readonly signal?: AbortSignal;
}

const MAX_ROUNDS = 2;

/**
 * Read the artifact, check it, and — unless asked only to report — rewrite
 * what was found and check the result.
 *
 * The rewrite is bounded at two rounds, the same as the publication pass: a
 * third round has never yet produced a piece the second one did not, and an
 * unbounded loop against a model that keeps finding something is how a run
 * spends an afternoon on a page nobody asked it to touch.
 *
 * The file before the first rewrite is kept beside it. A pass that improves
 * most of a story and spoils one paragraph is not worth losing the original
 * over, and "it rewrote my file" is not a thing to discover afterwards.
 */
export async function runStoryAudit(options: StoryAuditOptions): Promise<StoryAudit> {
  const { projectRoot, ask, onProgress, signal } = options;
  const absolute = safeChildPath(projectRoot, options.path);
  const original = await readFile(absolute, "utf-8");
  const language = languageOf(original);
  const revise = options.revise !== false;

  let markdown = original;
  let findings: StoryFinding[] = [];
  let rounds = 0;
  let backedUp = false;

  for (let round = 0; ; round += 1) {
    signal?.throwIfAborted();
    const sections = splitSections(markdown);
    if (sections.length === 0) {
      return { at: new Date().toISOString(), path: options.path, findings: [], rounds: 0 };
    }

    onProgress?.(round === 0
      ? `Auditing ${sections.length} sections…`
      : `Re-auditing after round ${round}…`);

    findings = ruleFindings(sections, language);
    for (const [index, section] of sections.entries()) {
      signal?.throwIfAborted();
      const out = await ask(
        buildStoryAuditPrompt(section, index, sections.length, language),
        `story-audit-${index + 1}`,
      );
      findings.push(...parseStoryFindings(out, section.heading));
    }

    const actionable = findings.filter((f) =>
      f.severity === "warning" && (!options.slopOnly || isStorySlopFinding(f)));
    if (!revise || round >= MAX_ROUNDS || actionable.length === 0) break;

    // Keep the original once, before anything is changed.
    if (!backedUp) {
      await writeFile(absolute.replace(/(\.[^.]+)$/, ".pre-audit$1"), original, "utf-8");
      backedUp = true;
    }

    onProgress?.(`Rewriting ${new Set(actionable.map((f) => f.section)).size} sections…`);
    markdown = await reviseSections(markdown, sections, actionable, ask, language, signal);
    await writeFile(absolute, markdown, "utf-8");
    rounds = round + 1;
  }

  return { at: new Date().toISOString(), path: options.path, findings, rounds };
}

/** The same loop, with only the machine-made findings acted on. */
export function runStoryDeslop(options: StoryAuditOptions): Promise<StoryAudit> {
  return runStoryAudit({ ...options, revise: true, slopOnly: true });
}

/**
 * Rewrite the faulted sections in place inside the document.
 *
 * Matched by heading rather than by offset: a section that grew or shrank in
 * an earlier round would otherwise put every later replacement one paragraph
 * out. A section whose heading no longer appears is left alone rather than
 * guessed at.
 */
async function reviseSections(
  markdown: string,
  sections: ReadonlyArray<StorySection>,
  findings: ReadonlyArray<StoryFinding>,
  ask: StoryAskFn,
  language: "zh" | "en",
  signal?: AbortSignal,
): Promise<string> {
  let out = markdown;
  const bySection = new Map<string, StoryFinding[]>();
  for (const f of findings) {
    bySection.set(f.section, [...(bySection.get(f.section) ?? []), f]);
  }

  for (const [heading, sectionFindings] of bySection) {
    signal?.throwIfAborted();
    const section = sections.find((s) => s.heading === heading);
    if (!section) continue;

    const result = await ask(
      buildStoryRevisePrompt(section, sectionFindings, language),
      `story-revise-${heading || "untitled"}`,
    );
    const body = String(result.body ?? "").trim();
    // An empty rewrite means the model declined or failed. Keeping the
    // original is right; deleting the section because a call went wrong is not.
    if (!body) continue;
    if (!out.includes(section.body)) continue;
    out = out.replace(section.body, body);
  }
  return out;
}

/** The audit as something to read, for a tool result or a UI panel. */
export function storyAuditReport(audit: StoryAudit): string {
  const warnings = audit.findings.filter((f) => f.severity === "warning").length;
  const head = audit.findings.length === 0
    ? "The audit found nothing to fix."
    : `${audit.findings.length} findings (${warnings} warnings)`
      + `${audit.rounds ? ` after ${audit.rounds} revise round${audit.rounds > 1 ? "s" : ""}` : ""}.`;
  return [
    head,
    ...audit.findings.slice(0, 40).map((f) => `- [${f.category}] ${f.description} → ${f.suggestion}`),
    audit.findings.length > 40 ? `…and ${audit.findings.length - 40} more.` : "",
  ].filter(Boolean).join("\n");
}
