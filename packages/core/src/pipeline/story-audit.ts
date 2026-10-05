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
import { designSkillBrief } from "../skills/design-skills.js";
import { runWorkerAgent } from "../agent/worker-agent.js";
import { parseJson } from "../publications/parse-json.js";
import type { PipelineRunner } from "./runner.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import { anachronismFindings } from "./anachronism.js";
import { detectCrossChapterRepetition } from "../agents/post-write-validator.js";
import { distance, fingerprint, gaps } from "../agents/style-fingerprint.js";
import type { StyleProfileV2 } from "../models/style-profile.js";
import type { Lexicon } from "./setting.js";

/**
 * Far enough from the target voice to be worth saying so.
 *
 * Two chapters by one author sit well under this; a chapter that has reverted
 * to model house style sits above it. A warning, never blocking: drifting is
 * something a writer is allowed to do on purpose.
 */
const DRIFTED_ABOVE = 0.45;
import { safeChildPath } from "../utils/path-safety.js";
import {
  activeDimensions, customDimensionPrompt, isSuppressed, noAuditPack, type ResolvedAuditPack,
} from "./audit-pack.js";
import type { ReviewDimension } from "./publication-review.js";
import {
  locate, normalizeSeverity, type Finding, type FindingSeverity, type RawFinding,
} from "./findings.js";

export interface StoryFinding {
  /** The heading it is about, or "" for a finding about the whole piece. */
  readonly section: string;
  /**
   * `blocking` for a contradiction of something already established, which is
   * the one severity that stands in the way of an approval; `note` for
   * something worth knowing.
   *
   * This used to be `warning | info`, which could not say "this one is wrong,
   * not merely worth looking at" — so a chapter that contradicted its own
   * canon was reported at the same weight as a repeated transition word.
   */
  readonly severity: FindingSeverity;
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
  /**
   * The exact words the finding is about, copied out of the text.
   *
   * Without it the only thing a screen can do is print the complaint, and the
   * only thing a person can do is re-read the chapter looking for the sentence
   * the machine meant. Rule-pass findings measure a whole section and have
   * none; those stay unlocated rather than being given a wrong span.
   */
  readonly quote?: string;
  /** What the checker proposes should stand in the quote's place. */
  readonly fix?: string;
  /** A queue row's worth of words. Derived from the description when absent. */
  readonly title?: string;
}

export interface StoryAudit {
  readonly at: string;
  /** Project-relative path of the artifact that was read. */
  readonly path: string;
  readonly findings: ReadonlyArray<StoryFinding>;
  /** Revise-then-re-audit rounds. 0 means findings were only reported. */
  readonly rounds: number;
  /**
   * The same findings, each carrying an id and — where its quote was found —
   * a character span into the file as it stands at the end of the run.
   *
   * Kept beside `findings` rather than replacing it because a finding's span
   * is only true of one revision of one file, while the complaint itself is
   * what a report or a tool result wants.
   */
  readonly located: ReadonlyArray<Finding>;
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
 * Machine instructions that live at the end of a page, and must survive a pass
 * that rewrites prose.
 *
 * A publication page ends with one or more `--- *visual brief N:* ...` blocks,
 * and that is what the art stage reads to render the picture. The audit had no
 * idea they were different from prose: the whole file went into the revise
 * prompt and came back as prose, so a de-AI pass on a magazine page silently
 * deleted the only description of the image that page is supposed to carry.
 * Nothing downstream could tell a brief had ever been there — the page simply
 * became one that had never asked for art.
 *
 * Split off before the model sees the text, re-attached to whatever it returns.
 * Anchored on `*visual brief` rather than on the rule above it, because a bare
 * `---` is ordinary punctuation in prose and cutting there would truncate the
 * writing instead of protecting it.
 */
const BRIEF_TAIL = /\s*---\s*\*visual brief[\s\S]*$/;

export function splitMachineTail(markdown: string): { prose: string; tail: string } {
  const at = markdown.search(BRIEF_TAIL);
  return at === -1
    ? { prose: markdown, tail: "" }
    : { prose: markdown.slice(0, at), tail: markdown.slice(at) };
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
export function ruleFindings(
  sections: ReadonlyArray<StorySection>,
  language: "zh" | "en",
  world?: { readonly lexicon?: Lexicon | null; readonly fidelity?: string },
  voice?: { readonly target?: StyleProfileV2; readonly name?: string },
  pack?: ResolvedAuditPack,
): StoryFinding[] {
  const findings: StoryFinding[] = [];

  /*
   * Has the prose drifted out of the voice it is supposed to be in?
   *
   * A restyle was a one-time operation: applied once, never checked again,
   * and a long book written after it drifts back to house style chapter by
   * chapter with nothing noticing. Measuring it here makes the voice a
   * property the audit holds, and costs nothing to check (05 §5).
   */
  if (voice?.target) {
    const whole = sections.map((s) => s.body).join("\n\n");
    const far = distance(voice.target, fingerprint(whole, language));
    if (far > DRIFTED_ABOVE) {
      const missed = gaps(voice.target, fingerprint(whole, language));
      findings.push({
        section: "",
        severity: "warning",
        category: "style-drift/voice",
        description: voice.name
          ? `This reads ${far.toFixed(2)} away from ${voice.name}'s voice. ${missed.join("; ")}`
          : `This reads ${far.toFixed(2)} away from the voice it is in. ${missed.join("; ")}`,
        suggestion: "Restyle this section, or accept that it has moved.",
      });
    }
  }
  for (const section of sections) {
    // What the researched world says cannot be here. Exact, so unlike the
    // other rule checks it can quote the sentence and be pointed at (22 §4).
    findings.push(...anachronismFindings({
      text: section.body,
      lexicon: world?.lexicon ?? null,
      ...(world?.fidelity ? { fidelity: world.fidelity } : {}),
      section: section.heading,
    }));
    const tells = analyzeAITells(section.body, language, pack ? {
      hedgeWords: pack.hedgeWords,
      markers: pack.markers,
      ...(pack.paragraphMaxChars ? { paragraphMaxChars: pack.paragraphMaxChars } : {}),
    } : undefined);
    for (const issue of tells.issues) {
      findings.push({
        section: section.heading,
        severity: normalizeSeverity(issue.severity),
        category: `ai-tell/${issue.category}`,
        description: section.heading ? `${section.heading}: ${issue.description}` : issue.description,
        suggestion: issue.suggestion,
      });
    }

    const others = sections.filter((s) => s !== section).map((s) => s.body).join("\n\n");
    for (const violation of detectCrossChapterRepetition(section.body, others, language)) {
      findings.push({
        section: section.heading,
        // A rule pass measures a whole section, so `error` here means "this
        // reads as machine-made", not "this contradicts the book". Nothing a
        // rule can see on its own is allowed to block an approval.
        severity: violation.severity === "error" ? "warning" : "note",
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
  pack?: ResolvedAuditPack,
): string {
  // The pack decides which of the thirty run and what else this work wants
  // looked at; with no pack the list is exactly the thirty (19 §E4).
  const active = activeDimensions(STORY_DIMENSIONS.map((d) => d.n), pack ?? noAuditPack());
  const dims = STORY_DIMENSIONS.filter((d) => active.has(d.n));
  const extra = pack ? customDimensionPrompt(pack) : "";
  return [
    `You are auditing section ${index + 1} of ${total} of a finished piece of narrative.`,
    "Report only what is wrong. Do not praise, do not summarise, do not rewrite.",
    "",
    "Judge it on these dimensions:",
    dims.map((d) => `${d.n}. ${d.name} — ${d.ask}`).join("\n"),
    ...(extra ? ["", extra] : []),
    ...(pack?.rules.length
      ? ["", "This work has also learned these rules; hold it to them:",
         ...pack.rules.map((r) => `- ${r}`)]
      : []),
    "",
    "A dimension with nothing wrong produces no finding. Be specific enough to act",
    "on: \"the third paragraph names the feeling instead of showing it\" is usable,",
    "\"the prose is weak\" is not.",
    "",
    // The quote is what makes a finding usable rather than merely true. Without
    // it a screen can only print the complaint and a reader has to hunt the
    // chapter for the sentence the machine meant. It has to be an exact copy: a
    // paraphrase cannot be found in the file, so the finding arrives with no
    // location, no highlight, and no fix anything can apply.
    "QUOTE: copy the offending words out of the text exactly, character for",
    "character, so they can be found again. One sentence or clause — long enough",
    "to be unique, short enough to point at the problem. Omit `quote` only for a",
    "finding about the section as a whole.",
    "",
    "FIX: when you can say what those exact words should be instead, give the",
    "replacement — the words alone, no commentary, ready to stand where the quote",
    "stands. Omit `fix` when the problem needs a decision rather than a swap.",
    "",
    `The prose is in ${language === "zh" ? "Chinese" : "English"}; judge it in that language's terms.`,
    "",
    `SECTION HEADING: ${section.heading || "(untitled)"}`,
    "",
    section.body.slice(0, MAX_SECTION_CHARS),
    "",
    "Respond with JSON only:",
    '{"findings":[{"dimension":7,"severity":"warning","title":"The limp changed legs",'
      + '"quote":"favoured his right leg","fix":"favoured his left leg",'
      + '"description":"...","suggestion":"..."}]}',
    'severity is "blocking" when the text contradicts something the piece has already',
    'established — a fact, a name, a number, a rule the work set itself — "warning"',
    'for something that should change, and "note" for something worth knowing.',
    "Only a blocking finding stops the piece being approved, so use it for",
    "contradictions and not for taste.",
    "title is at most eight words naming the problem, not restating the rule.",
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
    const quote = String(f.quote ?? "").trim();
    const fix = String(f.fix ?? "").trim();
    const title = String(f.title ?? "").trim();
    findings.push({
      section,
      severity: normalizeSeverity(f.severity),
      // Unknown dimension numbers still carry their finding: a real problem
      // reported under the wrong number is worth more than a dropped one.
      category: dimension ? `dim${dimension.n}/${dimension.name}` : "dim0/unclassified",
      description: section ? `${section}: ${description}` : description,
      suggestion: String(f.suggestion ?? "").trim() || "Fix as described.",
      ...(quote ? { quote } : {}),
      // A fix with nothing to replace is not a fix: it has no span to stand in.
      // Dropping it keeps an "accept this" control off a finding that could
      // only ever fail to apply.
      ...(quote && fix ? { fix } : {}),
      ...(title ? { title } : {}),
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
 * Rewrite the words one finding is about, and nothing round them.
 *
 * The auditor's own `fix` is written blind, in the middle of judging forty
 * other things, and reads like it. This hands the same span to the writer with
 * what writing needs — the paragraphs either side, the work's voice, the
 * editor's note — and asks back for the replacement alone, so the rest of the
 * page cannot move.
 */
export interface RewritableFinding {
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly suggestion: string;
  readonly fix?: string;
}

/**
 * How much of the file one rewrite is allowed to replace.
 *
 * `beat` is the paragraph plus the one either side: a pacing or a
 * scene-not-summary finding cannot be answered inside a single paragraph, and
 * widening the span is cheaper than regenerating the chapter (19 §5b).
 */
export type RewriteScope = "quote" | "paragraph" | "beat";

export interface FindingRewriteInput {
  readonly finding: RewritableFinding;
  /**
   * Everything else flagged in the same paragraph, so one call answers all of
   * them. Fourteen findings over four paragraphs become four calls and one
   * write, and the rest of the page never moves.
   */
  readonly also?: ReadonlyArray<RewritableFinding>;
  readonly scope: RewriteScope;
  /** The words being replaced: the quote, or its whole paragraph. */
  readonly span: string;
  readonly paragraph: string;
  readonly before: string;
  readonly after: string;
  readonly language: "zh" | "en";
  readonly note?: string;
  /** The work's style guide, when it has one. */
  readonly voice?: string;
}

const findingBlock = (f: RewritableFinding): string[] => [
  `[${f.category}] ${f.title}`,
  f.description,
  `What to do: ${f.suggestion}`,
  ...(f.fix ? [`The checker proposed "${f.fix}". Do better than that if it is flat.`] : []),
];

export function buildFindingRewritePrompt(input: FindingRewriteInput): string {
  const { finding } = input;
  const also = input.also ?? [];
  return [
    input.scope === "quote"
      ? "Rewrite only the MARKED WORDS so the finding below no longer applies. What you return stands exactly where they stand, inside the paragraph shown, so it must join the words either side of them."
      : input.scope === "beat"
        ? "Rewrite the PASSAGE below so the findings no longer apply. What you return replaces those paragraphs and nothing outside them, so it must join the text either side."
        : "Rewrite only the PARAGRAPH so the finding below no longer applies. What you return replaces that whole paragraph.",
    "Keep the viewpoint, the tense and what happens. Keep every name and every line of",
    "dialogue unless the finding is about it. Add no new facts. Stay within a third of",
    "the original length either way.",
    `Write in ${input.language === "zh" ? "Chinese" : "English"}.`,
    "",
    also.length ? "FINDINGS — answer every one of them:" : "FINDING:",
    ...findingBlock(finding),
    ...also.flatMap((f) => ["", ...findingBlock(f)]),
    ...(input.note?.trim() ? ["", `EDITOR'S NOTE: ${input.note.trim()}`] : []),
    ...(input.voice?.trim() ? ["", "THE WORK'S VOICE — keep to it:", input.voice.trim().slice(0, 3000)] : []),
    "",
    "PARAGRAPH BEFORE:",
    input.before.slice(-2000) || "(none)",
    "",
    input.scope === "beat" ? "PASSAGE:" : "PARAGRAPH:",
    input.scope === "beat" ? input.span : input.paragraph,
    "",
    "PARAGRAPH AFTER:",
    input.after.slice(0, 2000) || "(none)",
    ...(input.scope === "quote" ? ["", "MARKED WORDS:", input.span] : []),
    "",
    "Respond with JSON only:",
    '{"text":"the replacement words and nothing else"}',
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
    // A design or art stage is answered under the skill that owns it, for
    // every production type. Other stages get nothing extra.
    const skill = await designSkillBrief(tag);
    const response = await runWorkerAgent(ctx.client, ctx.model, [
      {
        role: "system",
        content: `${skill ? `${skill}

` : ""}This is the "${tag}" stage. `
          + "Your reply is the JSON asked for and nothing else.",
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
  /**
   * The researched world this artifact belongs to, when it has one.
   *
   * Passed in rather than looked up here: this function takes a file path, not
   * a production, and the caller is the half that knows which work the file
   * came from (22 §4).
   */
  readonly world?: { readonly lexicon?: Lexicon | null; readonly fidelity?: string };
  /** The voice this artifact is meant to be in, to measure drift against. */
  readonly voice?: { readonly target?: StyleProfileV2; readonly name?: string };
  /** Rewrite what is found, then audit again. Default true for audit. */
  readonly revise?: boolean;
  /** Only rewrite findings about the prose sounding machine-made. */
  readonly slopOnly?: boolean;
  readonly onProgress?: (message: string) => void;
  /**
   * The document as it stands, each time a rewritten section lands in it.
   *
   * A revise pass took minutes and showed a spinner, and the panel beside it
   * went on displaying the text the pass was in the middle of replacing. There
   * is no token stream to forward — `ask` returns one section's body at a time —
   * but a section is a real unit of progress and this is what the screen wants.
   */
  readonly onText?: (markdown: string) => void;
  /**
   * The heading of each section as its rewrite lands.
   *
   * `onText` carries the whole document, which is what the editor needs and
   * exactly the wrong thing to show progress with: two whole-document swaps
   * several minutes apart look like a reload, not like work arriving. The
   * heading is the unit a person can watch tick past.
   */
  readonly onSection?: (heading: string) => void;
  /**
   * The resolved audit pack for this work: which dimensions run, what else to
   * look for, which word lists moved, and how many rewrite rounds are allowed.
   * Absent means the builtin thirty and two rounds, exactly as before (19 §1).
   */
  readonly pack?: ResolvedAuditPack;
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
  // The brief is not prose and must not be rewritten, reworded, or dropped.
  const { prose: originalProse, tail } = splitMachineTail(original);
  const language = languageOf(originalProse);
  const revise = options.revise !== false;

  let markdown = originalProse;
  let findings: StoryFinding[] = [];
  let rounds = 0;
  let backedUp = false;

  for (let round = 0; ; round += 1) {
    signal?.throwIfAborted();
    const sections = splitSections(markdown);
    if (sections.length === 0) {
      return { at: new Date().toISOString(), path: options.path, findings: [], rounds: 0, located: [] };
    }

    onProgress?.(round === 0
      ? `Auditing ${sections.length} sections…`
      : `Re-auditing after round ${round}…`);

    findings = ruleFindings(sections, language, options.world, options.voice, options.pack);
    for (const [index, section] of sections.entries()) {
      signal?.throwIfAborted();
      const out = await ask(
        buildStoryAuditPrompt(section, index, sections.length, language, options.pack),
        `story-audit-${index + 1}`,
      );
      findings.push(...parseStoryFindings(out, section.heading));
    }

    // "Never flag this again" is a promise, so it is kept at the last moment
    // before anything is reported — a rule check and a model both go through it.
    const silenced = options.pack;
    if (silenced) findings = findings.filter((f) => !isSuppressed(silenced, f.category));

    /*
     * A note is worth knowing and not worth a rewrite; everything above one is.
     *
     * This read `severity === "warning"` when warning was the top severity.
     * Now that a contradiction of the book's own canon can be reported as
     * blocking, the same test would have quietly excluded the most serious
     * findings from the revise pass — the only ones nobody would want skipped.
     */
    const actionable = findings.filter((f) =>
      f.severity !== "note" && (!options.slopOnly || isStorySlopFinding(f)));
    const allowed = options.pack?.maxIterations ?? MAX_ROUNDS;
    if (!revise || round >= allowed || actionable.length === 0) break;

    // Keep the original once, before anything is changed.
    if (!backedUp) {
      await writeFile(absolute.replace(/(\.[^.]+)$/, ".pre-audit$1"), original, "utf-8");
      backedUp = true;
    }

    onProgress?.(`Rewriting ${new Set(actionable.map((f) => f.section)).size} sections…`);
    markdown = await reviseSections(
      markdown, sections, actionable, ask, language, signal,
      options.onText ? (partial: string) => options.onText!(partial + tail) : undefined,
      options.onSection,
    );
    await writeFile(absolute, markdown + tail, "utf-8");
    rounds = round + 1;
  }

  /*
   * Locate against the text as it now stands, not as it was read.
   *
   * A revise round rewrote whole sections, so an offset taken before it would
   * point into prose that no longer exists. Findings from the last round are
   * about the current file, and the ones a rule pass measured across a whole
   * section carry no quote and stay unlocated rather than being given a span
   * they never had.
   */
  const current = revise && rounds > 0 ? markdown : originalProse;
  const at = new Date().toISOString();
  const located = findings.map((f) => locate(toRaw(f, options.path), current, at));

  return { at, path: options.path, findings, rounds, located };
}

/** A story finding in the shape the shared findings store takes. */
function toRaw(f: StoryFinding, path: string): RawFinding {
  return {
    path,
    section: f.section,
    severity: f.severity,
    category: f.category,
    description: f.description,
    suggestion: f.suggestion,
    ...(f.quote ? { quote: f.quote } : {}),
    ...(f.fix ? { fix: f.fix } : {}),
    ...(f.title ? { title: f.title } : {}),
  };
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
  onText?: (markdown: string) => void,
  onSection?: (heading: string) => void,
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
    onText?.(out);
    onSection?.(heading);
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

/**
 * Rewrite one file to do what an editor asked, without auditing it first.
 *
 * The magazine had this and nothing else did: a note about a page became a
 * finding and went through the same revise pass the checks use, so "the
 * opening is limp" was a rewrite rather than a comment nobody reads. Every
 * other kind of writing could only be rewritten by running a full audit and
 * hoping it happened to object to the same thing.
 *
 * The note is carried as one finding per section, because a note about a file
 * is a note about all of it and `reviseSections` works section by section. A
 * caller that means one section says so in `sections`.
 */
export interface StoryReviseOptions {
  readonly projectRoot: string;
  readonly path: string;
  readonly ask: StoryAskFn;
  /** What the editor said is wrong. */
  readonly note: string;
  /** Limit the rewrite to these headings. Empty or absent means all of them. */
  readonly sections?: readonly string[];
  readonly onProgress?: (message: string) => void;
  readonly onText?: (markdown: string) => void;
  readonly onSection?: (heading: string) => void;
  readonly signal?: AbortSignal;
}

export interface StoryRevised {
  readonly path: string;
  readonly at: string;
  /** How many sections the pass was asked to rewrite. */
  readonly sections: number;
  /** Whether the file on disk actually changed. */
  readonly changed: boolean;
}

export async function reviseStoryFile(options: StoryReviseOptions): Promise<StoryRevised> {
  const note = options.note.trim();
  if (!note) throw new Error("a note is required");

  const absolute = safeChildPath(options.projectRoot, options.path);
  const original = await readFile(absolute, "utf-8");
  // The brief is not prose and must not be rewritten, reworded, or dropped.
  const { prose, tail } = splitMachineTail(original);
  const language = languageOf(prose);
  const sections = splitSections(prose);
  if (sections.length === 0) {
    return { path: options.path, at: new Date().toISOString(), sections: 0, changed: false };
  }

  const wanted = options.sections?.length
    ? sections.filter((s) => options.sections!.includes(s.heading))
    : sections;
  if (wanted.length === 0) {
    return { path: options.path, at: new Date().toISOString(), sections: 0, changed: false };
  }

  const findings: StoryFinding[] = wanted.map((s) => ({
    section: s.heading,
    severity: "warning",
    category: "feedback/editor",
    description: note,
    suggestion: "Do what the editor asked, and change nothing else.",
  }));

  options.onProgress?.(`Rewriting ${wanted.length} section${wanted.length === 1 ? "" : "s"}…`);

  // Keep the original before anything is changed, the same way an audit does,
  // so the same Restore button on the same screen puts it back.
  await writeFile(absolute.replace(/(\.[^.]+)$/, ".pre-audit$1"), original, "utf-8");

  const revised = await reviseSections(
    prose, sections, findings, options.ask, language, options.signal,
    options.onText ? (partial: string) => options.onText!(partial + tail) : undefined,
    options.onSection,
  );

  const changed = revised !== prose;
  if (changed) await writeFile(absolute, revised + tail, "utf-8");
  return { path: options.path, at: new Date().toISOString(), sections: wanted.length, changed };
}
