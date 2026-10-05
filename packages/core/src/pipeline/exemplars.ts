/**
 * Passages from the sample, kept so a rewrite can be shown the voice instead
 * of told about it.
 *
 * This is the single biggest fidelity lever and the library stored none of it
 * (05 §1). A description of a voice is lossy twice over: the analyzer turns
 * five pages into eight adjectives, and the rewriter expands those adjectives
 * back out in its own house style. Handing the model two paragraphs the author
 * actually wrote skips both losses.
 *
 * Which passages: the ones most typical of the sample, plus one at each
 * extreme — the most dialogue-heavy and the most descriptive — because a
 * rewrite of a conversation needs a conversation to copy, and a rewrite of a
 * landscape does not.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { distance, fingerprint } from "../agents/style-fingerprint.js";

export interface Exemplar {
  readonly id: string;
  /** `typical`, `dialogue` or `description` — what this one is here to show. */
  readonly kind: "typical" | "dialogue" | "description";
  readonly text: string;
}

const MIN_WORDS = 90;
const MAX_WORDS = 260;

const wordsIn = (text: string, isZh: boolean): number =>
  isZh ? text.replace(/\s+/g, "").length : (text.match(/[A-Za-z0-9']+/g) ?? []).length;

/**
 * Cut the sample into candidate passages on paragraph boundaries.
 *
 * Paragraphs run short, so neighbours are joined until the piece is long
 * enough to measure — a 30-word paragraph has no stable fingerprint, and
 * handing the model one teaches it nothing.
 */
function passagesOf(text: string, isZh: boolean): ReadonlyArray<string> {
  const paragraphs = String(text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buffer: string[] = [];
  let size = 0;
  const max = isZh ? MAX_WORDS * 2 : MAX_WORDS;
  const min = isZh ? MIN_WORDS * 2 : MIN_WORDS;
  for (const paragraph of paragraphs) {
    const n = wordsIn(paragraph, isZh);
    if (size + n > max && size >= min) {
      out.push(buffer.join("\n\n"));
      buffer = [];
      size = 0;
    }
    buffer.push(paragraph);
    size += n;
  }
  if (size >= min) out.push(buffer.join("\n\n"));
  return out;
}

/**
 * Choose the passages to keep. Typical ones first, then the two extremes.
 *
 * "Typical" is the passage closest to the whole sample's own fingerprint,
 * which is a better definition than "the first 200 words": an opening is
 * usually the least representative thing an author writes.
 */
export function chooseExemplars(text: string, language: "zh" | "en", limit = 5): ReadonlyArray<Exemplar> {
  const isZh = language === "zh";
  const passages = passagesOf(text, isZh);
  if (!passages.length) return [];

  const whole = fingerprint(text, language);
  const scored = passages.map((body, i) => {
    const own = fingerprint(body, language);
    return { body, i, far: distance(whole, own), dialogue: own.dialogueRatio, sensory: own.sensoryDensity };
  });

  const chosen: Exemplar[] = [];
  const taken = new Set<number>();
  const take = (row: (typeof scored)[number] | undefined, kind: Exemplar["kind"]) => {
    if (!row || taken.has(row.i)) return;
    taken.add(row.i);
    chosen.push({ id: `${kind}-${row.i + 1}`, kind, text: row.body });
  };

  // The extremes first: they are the ones a specific chunk will ask for, and
  // if the budget is small it is better to lose a third "typical".
  const dialogue = [...scored].sort((a, b) => b.dialogue - a.dialogue)[0];
  if (dialogue && dialogue.dialogue > 0.1) take(dialogue, "dialogue");
  const descriptive = [...scored].sort((a, b) => a.dialogue - b.dialogue || b.sensory - a.sensory)[0];
  take(descriptive, "description");
  for (const row of [...scored].sort((a, b) => a.far - b.far)) {
    if (chosen.length >= limit) break;
    take(row, "typical");
  }
  return chosen.slice(0, limit);
}

/** `styles/<id>/samples/*.md`, written when a voice is saved. */
export async function writeExemplars(dir: string, exemplars: ReadonlyArray<Exemplar>): Promise<number> {
  const samples = join(dir, "samples");
  await rm(samples, { recursive: true, force: true });
  if (!exemplars.length) return 0;
  await mkdir(samples, { recursive: true });
  for (const [i, exemplar] of exemplars.entries()) {
    await writeFile(
      join(samples, `${String(i + 1).padStart(2, "0")}-${exemplar.kind}.md`),
      `${exemplar.text}\n`, "utf-8",
    );
  }
  return exemplars.length;
}

export async function readExemplars(dir: string): Promise<ReadonlyArray<Exemplar>> {
  const samples = join(dir, "samples");
  if (!existsSync(samples)) return [];
  const files = (await readdir(samples)).filter((f) => f.endsWith(".md")).sort();
  const out: Exemplar[] = [];
  for (const file of files) {
    const kind = /-(dialogue|description)\.md$/.exec(file)?.[1] as Exemplar["kind"] | undefined;
    out.push({
      id: file.replace(/\.md$/, ""),
      kind: kind ?? "typical",
      text: await readFile(join(samples, file), "utf-8"),
    });
  }
  return out;
}

/**
 * The two or three exemplars this particular chunk should be shown.
 *
 * A dialogue-heavy chunk gets the dialogue exemplar; a descriptive one gets
 * the descriptive exemplar; both get a typical passage to hold the voice's
 * centre. Showing all five would spend the context and blur the instruction.
 */
export function exemplarsFor(
  all: ReadonlyArray<Exemplar>,
  chunk: string,
  language: "zh" | "en",
  limit = 2,
): ReadonlyArray<Exemplar> {
  if (!all.length) return [];
  const own = fingerprint(chunk, language);
  const wants = own.dialogueRatio > 0.18 ? "dialogue" : "description";
  const matched = all.find((e) => e.kind === wants);
  const typical = all.filter((e) => e.kind === "typical");
  const picked = [matched, ...typical].filter(Boolean) as Exemplar[];
  return (picked.length ? picked : [...all]).slice(0, limit);
}

/**
 * The voice's own passages for a work, found from its style mark.
 *
 * The work holds a copy of the guide and a mark naming the library entry; the
 * passages live in the library, because they are the author's prose rather
 * than anything the work generated. Returns "" for a work with no voice,
 * which is the common case and must cost nothing.
 */
export async function voiceSamplesFor(
  projectRoot: string, workDir: string, language: "zh" | "en", limit = 2,
): Promise<string> {
  let id = "";
  try {
    const mark = JSON.parse(await readFile(join(workDir, "style.json"), "utf-8")) as { id?: string };
    id = String(mark?.id ?? "");
  } catch { return ""; }
  if (!id) return "";
  const all = await readExemplars(join(projectRoot, "styles", id));
  return all.length ? exemplarBlock(all.slice(0, limit), language) : "";
}

/** The exemplars as a prompt block. Quoted, never summarised. */
export function exemplarBlock(exemplars: ReadonlyArray<Exemplar>, language: "zh" | "en"): string {
  if (!exemplars.length) return "";
  const head = language === "en"
    ? "## The voice, in its own words\n\nThese are real passages by this writer. Match their rhythm, punctuation and habits — do not copy their content."
    : "## 这个声音的真实片段\n\n以下是该作者的原文。模仿其节奏、标点与习惯，不要照搬内容。";
  return [head, ...exemplars.map((e) => `---\n\n${e.text.trim()}`)].join("\n\n");
}
