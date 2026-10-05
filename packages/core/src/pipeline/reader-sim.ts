/**
 * Where a reader would stop (19 §5c, the "boredom map").
 *
 * Every check in the audit asks whether the text is *right*. None asks whether
 * anybody would keep reading it, which is the question a person holding the
 * book actually answers. Two or three simulated readers read the unit in
 * order, once, and say after each paragraph how much they still want to go on.
 * The cold paragraphs come back as `note` findings — never blocking, filed as
 * `reader/<persona>` so the taste engine can learn which reader the user trusts
 * — and every one of them can be handed to "Rewrite it".
 */
import { locate, type Finding } from "./findings.js";
import { languageOf, type StoryAskFn } from "./story-audit.js";

export interface ReaderPersona {
  readonly id: string;
  readonly label: string;
  readonly brief: string;
  /** Asks questions out loud — the storybook's listener. */
  readonly asks?: boolean;
}

export const READER_PERSONAS: ReadonlyArray<ReaderPersona> = [
  {
    id: "patient",
    label: "Patient reader",
    brief: "reads this kind of book every week and gives a slow opening a fair chance, but notices padding and repetition at once",
  },
  {
    id: "casual",
    label: "Casual reader",
    brief: "reads on a phone between other things and stops the moment nothing is happening, or the prose explains what it already showed",
  },
];

export const CHILD_PERSONA: ReaderPersona = {
  id: "child",
  label: "Seven-year-old listener",
  brief: "hears this read aloud at bedtime; drifts at long description, perks up at action, sounds and surprises",
  asks: true,
};

export function personasFor(type: string): ReadonlyArray<ReaderPersona> {
  return type === "storybook" ? [...READER_PERSONAS, CHILD_PERSONA] : READER_PERSONAS;
}

export interface ReaderPoint {
  readonly para: number;
  /** 1 gripped, 0.5 reading on out of duty, below `COLD` drifting. */
  readonly attention: number;
  readonly reason: string;
  readonly wouldStopHere: boolean;
  readonly question?: string;
}

export interface ReaderMap {
  readonly persona: string;
  readonly label: string;
  readonly points: ReadonlyArray<ReaderPoint>;
}

/** Below this a paragraph is cold: a finding, and a mark on the page. */
export const COLD = 0.35;

const MAX_CHARS = 24_000;

/** Paragraphs numbered the way findings count them: blank-line blocks from 0. */
export function paragraphsOf(markdown: string): Array<{ readonly para: number; readonly text: string }> {
  return markdown.split(/\n\s*\n/).map((text, para) => ({ para, text: text.trim() }));
}

export function buildReaderPrompt(persona: ReaderPersona, markdown: string, language: "zh" | "en"): string {
  const lines: string[] = [];
  let used = 0;
  for (const p of paragraphsOf(markdown)) {
    if (!p.text || /^#{1,6}\s/.test(p.text)) continue;
    if (used + p.text.length > MAX_CHARS) break;
    used += p.text.length;
    lines.push(`[${p.para}] ${p.text}`);
  }
  return [
    `You are a ${persona.label.toLowerCase()}: you ${persona.brief}.`,
    "Read the numbered paragraphs below in order, once, the way that reader would — not as an editor.",
    "After each one, say how much you still want to read on at that moment.",
    "",
    "For EVERY numbered paragraph return:",
    "- para: its number",
    "- attention: 0 to 1 (1 gripped, 0.5 reading on out of duty, under 0.35 drifting)",
    "- reason: at most twelve words, in your own voice",
    "- wouldStopHere: true only where you would put it down",
    ...(persona.asks ? ["- question: what you would ask out loud here, or leave it out"] : []),
    "",
    `The text is in ${language === "zh" ? "Chinese" : "English"}. Answer in English.`,
    "",
    ...lines,
    "",
    "Respond with JSON only:",
    `{"paragraphs":[{"para":0,"attention":0.8,"reason":"...","wouldStopHere":false${persona.asks ? ',"question":"..."' : ""}}]}`,
  ].join("\n");
}

export function parseReaderMap(persona: ReaderPersona, out: Record<string, unknown>): ReaderMap {
  const raw = Array.isArray(out.paragraphs) ? out.paragraphs : [];
  const seen = new Set<number>();
  const points: ReaderPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const para = Number(r.para);
    if (!Number.isInteger(para) || para < 0 || seen.has(para)) continue;
    seen.add(para);
    const attention = Number(r.attention);
    const question = String(r.question ?? "").trim();
    points.push({
      para,
      attention: Number.isFinite(attention) ? Math.min(1, Math.max(0, attention)) : 0.5,
      reason: String(r.reason ?? "").trim(),
      wouldStopHere: r.wouldStopHere === true,
      ...(persona.asks && question ? { question } : {}),
    });
  }
  return { persona: persona.id, label: persona.label, points: points.sort((a, b) => a.para - b.para) };
}

/** The cold paragraphs as findings, quoting each one's first sentence. */
export function readerFindings(
  path: string,
  markdown: string,
  maps: ReadonlyArray<ReaderMap>,
  at = new Date().toISOString(),
): Finding[] {
  const paras = paragraphsOf(markdown);
  const out: Finding[] = [];
  for (const map of maps) {
    for (const p of map.points) {
      if (p.attention >= COLD && !p.wouldStopHere) continue;
      const text = paras[p.para]?.text ?? "";
      if (!text || /^#{1,6}\s/.test(text)) continue;
      const quote = (/^[\s\S]*?[.!?。！？](?=\s|$)/.exec(text)?.[0] ?? text).slice(0, 240);
      out.push(locate({
        path,
        severity: "note",
        category: `reader/${map.persona}`,
        quote,
        title: p.wouldStopHere ? `${map.label} would stop here` : `${map.label} drifts here`,
        description: p.reason || "Attention falls in this passage.",
        suggestion: "Tighten or sharpen this passage so the reader stays with it.",
      }, markdown, at));
    }
  }
  return out;
}

export async function runReaderMap(input: {
  readonly markdown: string;
  readonly type: string;
  readonly ask: StoryAskFn;
  readonly onProgress?: (message: string) => void;
  readonly signal?: AbortSignal;
}): Promise<ReaderMap[]> {
  const language = languageOf(input.markdown);
  const maps: ReaderMap[] = [];
  for (const persona of personasFor(input.type)) {
    input.signal?.throwIfAborted();
    input.onProgress?.(`${persona.label} is reading…`);
    const out = await input.ask(buildReaderPrompt(persona, input.markdown, language), `reader-${persona.id}`);
    maps.push(parseReaderMap(persona, out));
  }
  return maps;
}
