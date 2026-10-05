/**
 * Rewriting what is already written, in a voice imported after it was written.
 *
 * Importing a voice used to reach new prose only. That is the wrong half: a
 * person pastes three pages of an author they admire because they want *their
 * own draft* to read like that, and being told it will apply to chapter
 * fourteen onwards is not the feature they asked for.
 *
 * This is deliberately not the reviser. The reviser fixes faults an audit
 * found and is free to change what happens on the page to do it. This changes
 * only how it is said. The distinction is the whole safety story of the
 * feature, so it is stated three times over — in the system prompt, in the
 * user prompt, and in the check below that refuses a result which threw half
 * the draft away.
 */

import { distance, fingerprint, gaps } from "../agents/style-fingerprint.js";
import { exemplarBlock, exemplarsFor, type Exemplar } from "./exemplars.js";
import type { StyleProfileV2 } from "../models/style-profile.js";

/** How far a rewrite may drift in length before it is treated as a loss. */
const SHRANK_TOO_FAR = 0.55;
const GREW_TOO_FAR = 1.9;

/**
 * Close enough to the voice that a second pass would be spending tokens on
 * noise. Chosen against the distances two chapters by one author score.
 */
const RETRY_ABOVE = 0.35;

export interface RestyleResult {
  readonly text: string;
  /** How far from the voice it was before, and after. Absent with no target. */
  readonly before?: number;
  readonly after?: number;
  readonly chunks: number;
}

export class RestyleRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestyleRefused";
  }
}

/**
 * The voice, without the craft rules underneath it.
 *
 * `style_guide.md` is the extracted voice followed by the full writing
 * methodology, which runs to thousands of words and is already in force
 * everywhere. Sending it again with every chapter would pay for it once per
 * chapter and bury the two paragraphs that actually describe the author.
 */
export function voiceOnly(styleGuide: string): string {
  const marker = styleGuide.search(/^---\s*$\n+^#\s+(Writing Methodology|写作方法论)/m);
  return (marker < 0 ? styleGuide : styleGuide.slice(0, marker)).trim();
}


/*
 * Which files of a work are the work.
 *
 * The audit walks every markdown file a production owns, which is right for
 * auditing and wrong here: for one short story that list is twenty-three
 * files, and it includes the outline, two review reports, a sales blurb, a
 * cover prompt, `full.md` (the same fourteen chapters again, concatenated) and
 * `style_guide.md` — the voice itself. Rewriting a sales blurb in Ursula Le
 * Guin's prose is not a feature, and rewriting the chapters twice because one
 * copy is glued together costs twice as much to produce a contradiction.
 *
 * `refFromPath` cannot answer this: a short's unit is the whole work, so it
 * maps every path under the work to unit 1, outline and review alike.
 *
 * So the rule is the one a person would give: the chapters, spreads, scenes or
 * panels of the newest edition. Working papers are not the story.
 */

/** Directories whose contents are the units of a work. */
const UNIT_DIRS = new Set(["chapters", "spreads", "scenes", "panels"]);

function inUnitDir(path: string): boolean {
  const parts = path.split("/");
  return parts.slice(0, -1).some((segment) => UNIT_DIRS.has(segment.toLowerCase()));
}

/**
 * The edition a path belongs to: `final`, or `drafts/<version>`, or nothing.
 *
 * A short keeps `final/chapters/` beside `drafts/v001/chapters/` and
 * `drafts/v001-partial/chapters/`. All three are the same story at different
 * ages, and rewriting all three is three times the cost for one result.
 */
function editionOf(path: string): string {
  const parts = path.split("/");
  const final = parts.findIndex((p) => p.toLowerCase() === "final");
  if (final >= 0) return "final";
  const drafts = parts.findIndex((p) => p.toLowerCase() === "drafts");
  if (drafts >= 0 && parts[drafts + 1]) return `drafts/${parts[drafts + 1]}`;
  return "";
}

/**
 * Narrow a work's files down to the prose a restyle should touch.
 *
 * Deterministic and pure so the screen can show the same list the job will
 * rewrite - nobody should discover which files were overwritten afterwards.
 */
export function restyleTargets(paths: ReadonlyArray<string>): ReadonlyArray<string> {
  const units = paths.filter(inUnitDir);
  if (units.length === 0) return [];

  const editions = new Set(units.map(editionOf));
  // `final` wins outright; otherwise the highest-sorting draft, which is the
  // newest under v001/v002 naming.
  const keep = editions.has("final")
    ? "final"
    : [...editions].filter(Boolean).sort().pop() ?? "";

  return units.filter((path) => editionOf(path) === keep).sort();
}

export async function restyleProse(input: {
  readonly text: string;
  readonly styleGuide: string;
  readonly language: "zh" | "en";
  readonly chat: (system: string, user: string) => Promise<string>;
  /** Real passages by the author, shown rather than described (05 §2c). */
  readonly exemplars?: ReadonlyArray<Exemplar>;
  /** The voice's own measurements, to check the rewrite against (05 §3). */
  readonly target?: StyleProfileV2;
  /** Period words the rewrite must not replace with modern ones (22 §4). */
  readonly prefer?: ReadonlyArray<string>;
  /** Told what actually happened, per chunk. */
  readonly onProgress?: (message: string) => void;
}): Promise<RestyleResult> {
  const original = input.text.trim();
  if (!original) throw new RestyleRefused("There is nothing written here to restyle.");

  const voice = voiceOnly(input.styleGuide);
  if (!voice) throw new RestyleRefused("This work has no imported voice to restyle it into.");

  const before = input.target ? distance(input.target, fingerprint(original, input.language)) : null;
  const chunks = chunkProse(original, input.language);
  const pieces: string[] = [];

  for (const [i, chunk] of chunks.entries()) {
    if (chunks.length > 1) input.onProgress?.(`Restyling part ${i + 1} of ${chunks.length}…`);
    pieces.push(await restyleChunk({ ...input, voice, chunk, index: i, of: chunks.length }));
  }

  const rewritten = formatProse(pieces.join("\n\n"));
  if (!rewritten) throw new RestyleRefused("The model returned nothing.");

  /*
   * A restyle that halves the chapter has not restyled it, it has summarised
   * it — the single most likely way this goes wrong, and silently destructive
   * because the original is only one keystroke behind a backup nobody thought
   * to check. Refusing leaves the file untouched.
   */
  const ratio = rewritten.length / original.length;
  if (ratio < SHRANK_TOO_FAR) {
    throw new RestyleRefused(
      `The rewrite came back ${Math.round((1 - ratio) * 100)}% shorter, which means text was dropped rather than restyled. Left as it was.`,
    );
  }
  if (ratio > GREW_TOO_FAR) {
    throw new RestyleRefused(
      `The rewrite came back ${Math.round(ratio * 100)}% of the original length, which means it added rather than restyled. Left as it was.`,
    );
  }

  /*
   * Every line of dialogue that went in has to come back.
   *
   * The length guard catches a summary of the whole chapter; it does not catch
   * a rewrite that keeps the prose and quietly drops three exchanges, which is
   * the same destruction at a scale nobody notices until a later chapter
   * refers to something that is no longer on the page.
   */
  const kept = quotedLinesKept(original, rewritten, input.language);
  if (kept !== null && kept < 0.9) {
    throw new RestyleRefused(
      `The rewrite dropped ${Math.round((1 - kept) * 100)}% of the spoken lines. Left as it was.`,
    );
  }

  const after = input.target ? distance(input.target, fingerprint(rewritten, input.language)) : null;
  return {
    text: rewritten,
    ...(before === null ? {} : { before }),
    ...(after === null ? {} : { after }),
    chunks: chunks.length,
  };
}

/** One chunk, with one targeted retry when the voice did not land (05 §3). */
async function restyleChunk(input: {
  readonly voice: string;
  readonly chunk: string;
  readonly index: number;
  readonly of: number;
  readonly language: "zh" | "en";
  readonly chat: (system: string, user: string) => Promise<string>;
  readonly exemplars?: ReadonlyArray<Exemplar>;
  readonly target?: StyleProfileV2;
  readonly prefer?: ReadonlyArray<string>;
  readonly onProgress?: (message: string) => void;
}): Promise<string> {
  const isEn = input.language === "en";
  const shown = input.exemplars?.length
    ? exemplarBlock(exemplarsFor(input.exemplars, input.chunk, input.language), input.language)
    : "";
  const keepWords = input.prefer?.length
    ? (isEn
        ? `\n\n## Keep these words\n\nThis story's world uses: ${input.prefer.join(", ")}. Do not replace them with modern equivalents.`
        : `\n\n## 保留这些词\n\n本作世界使用：${input.prefer.join("、")}。不要替换成现代通用词。`)
    : "";
  const place = input.of > 1
    ? (isEn
        ? `\n\n(This is part ${input.index + 1} of ${input.of}. Rewrite only what is given; do not summarise, open or close the piece.)`
        : `\n\n（这是第 ${input.index + 1}/${input.of} 部分。只改写给出的内容，不要总结、不要另起开头或结尾。）`)
    : "";

  const ask = async (extra: string): Promise<string> => {
    const reply = await input.chat(
      isEn ? EN_SYSTEM : ZH_SYSTEM,
      isEn
        ? `## The voice to write in\n\n${input.voice}${shown ? `\n\n${shown}` : ""}${keepWords}${extra}${place}\n\n## The text to rewrite\n\n${input.chunk}`
        : `## 目标文风\n\n${input.voice}${shown ? `\n\n${shown}` : ""}${keepWords}${extra}${place}\n\n## 待改写的正文\n\n${input.chunk}`,
    );
    return formatProse(unfence(reply));
  };

  const first = await ask("");
  if (!input.target || !first) return first;

  const got = fingerprint(first, input.language);
  const missed = gaps(input.target, got);
  if (distance(input.target, got) <= RETRY_ABOVE || !missed.length) return first;

  // One retry, and only with the measured gaps in hand. "More like the voice"
  // is what produced the first attempt; naming the three numbers that are
  // wrong is a different instruction.
  input.onProgress?.(`Part ${input.index + 1} missed the voice — retrying on ${missed.length} measured gaps.`);
  const second = await ask(isEn
    ? `\n\n## What the last attempt got wrong\n\n${missed.map((g) => `- ${g}`).join("\n")}`
    : `\n\n## 上一稿的偏差\n\n${missed.map((g) => `- ${g}`).join("\n")}`);
  if (!second) return first;
  // Keep whichever actually landed closer: a retry is an attempt, not an
  // improvement by definition.
  return distance(input.target, fingerprint(second, input.language))
    < distance(input.target, got) ? second : first;
}

/**
 * Cut prose into restyle-sized pieces on heading or paragraph boundaries.
 *
 * A whole chapter in one call is where voice goes to die: the model holds the
 * instruction for two pages and then reverts to its own house style, and the
 * length guard cannot see that because the word count is fine.
 */
export function chunkProse(text: string, language: "zh" | "en", size = 1200): ReadonlyArray<string> {
  const isZh = language === "zh";
  const budget = isZh ? size * 1.6 : size;
  const blocks = String(text ?? "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const measure = (s: string) => (isZh ? s.replace(/\s+/g, "").length : (s.match(/[A-Za-z0-9']+/g) ?? []).length);

  const out: string[] = [];
  let buffer: string[] = [];
  let size_ = 0;
  for (const block of blocks) {
    const n = measure(block);
    // A heading starts a new piece: it is the author's own boundary.
    const isHeading = /^#{1,6}\s/.test(block);
    if (buffer.length && (isHeading || size_ + n > budget)) {
      out.push(buffer.join("\n\n"));
      buffer = [];
      size_ = 0;
    }
    buffer.push(block);
    size_ += n;
  }
  if (buffer.length) out.push(buffer.join("\n\n"));
  return out.length ? out : [String(text ?? "")];
}

/**
 * What share of the spoken lines survived.
 *
 * Matched loosely — a restyle is allowed to reword a line — so what is counted
 * is that a comparable number of exchanges came back, not that any particular
 * sentence is identical. `null` when there was no dialogue to check.
 */
export function quotedLinesKept(before: string, after: string, language: "zh" | "en"): number | null {
  const pattern = language === "en" ? /[“"]([^”"]{2,400})[”"]/g : /[「“]([^」”]{2,400})[」”]/g;
  const count = (text: string) => (text.match(pattern) ?? []).length;
  const had = count(before);
  if (had < 2) return null;
  return Math.min(1, count(after) / had);
}

/**
 * Put the paragraphs back on separate lines.
 *
 * The whole file is replaced by whatever the model returns, and models return
 * prose with one newline between paragraphs rather than two. Markdown reads a
 * single newline as a line break inside the same paragraph, so a restyled
 * chapter rendered as one wall of text - the audit screen's reading panel
 * showed the difference immediately, and the reviser never had the problem
 * because it replaces one section inside a document whose shape survives.
 *
 * Only when there is no blank line anywhere. A rewrite that came back
 * correctly formatted is left exactly as it is, and this cannot then split a
 * paragraph that was deliberately wrapped across lines - that text has blank
 * lines between its paragraphs and never reaches the branch.
 */
export function formatProse(text: string): string {
  const trimmed = text.replace(/[ \t]+$/gm, "").trim();
  if (/\n[ \t]*\n/.test(trimmed)) return trimmed;
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Models like to wrap a whole document in a fence. Take it back off. */
function unfence(reply: string): string {
  const fenced = reply.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/);
  return fenced?.[1] ?? reply;
}

const EN_SYSTEM = `You rewrite prose into another writer's voice. You do not rewrite the story.

Keep, exactly:
- Every event, in the order it happens.
- Every fact: names, places, numbers, times, objects, relationships.
- What every line of dialogue means, and who says it.
- Every heading, scene break, and section marker, unchanged and in place.
- Markdown paragraphing: one blank line between paragraphs, and a blank line under every heading.
- Roughly the same length. This is a rewrite, not a summary and not an expansion.

Change:
- Sentence construction, rhythm and length.
- Word choice, imagery, and figures of speech.
- How emotion is carried, how description is paced, how scenes are entered and left.

If the voice you are given would suit a different plot, that is not your problem to solve. The plot stays.

Output the rewritten text and nothing else. No preamble, no notes on what you changed, no code fence.`;

const ZH_SYSTEM = `你的任务是把正文改写成另一位作者的文风，而不是改写故事。

必须保持不变：
- 所有事件及其发生顺序。
- 所有事实：人名、地名、数字、时间、物件、人物关系。
- 每句对白的含义，以及说话人是谁。
- 所有标题、场景分隔符、章节标记，位置和内容都不变。
- Markdown 段落格式：段落之间空一行，标题下面也空一行。
- 大致相同的篇幅。这是改写，不是缩写，也不是扩写。

可以改变：
- 句子结构、节奏和长短。
- 用词、意象和修辞。
- 情绪的承载方式、描写的密度、场景的进入与退出方式。

如果目标文风更适合另一个故事，那不是你要解决的问题。故事本身不动。

只输出改写后的正文，不要前言，不要说明改了什么，不要代码块包裹。`;
