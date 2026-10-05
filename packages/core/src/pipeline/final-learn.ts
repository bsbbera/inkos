/**
 * What the person's own final says about the drafts (04 §6).
 *
 * The finished book on someone's desk is the highest-signal feedback this app
 * will ever get, and it arrived nowhere: the edits made after the pipeline
 * finished were invisible to it. These are the pure halves of "Learn from
 * final" — which sentences changed, how the voice moved, which printed pages
 * differ from the build — so the Studio job only has to read files and file
 * the answers.
 */
import { analyzeStyle } from "../agents/style-analyzer.js";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, " ").trim();
const wordsOf = (s: string) => new Set(norm(s).split(" ").filter(Boolean));

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function sentencesOf(text: string): string[] {
  return text
    .replace(/^#+\s.*$/gm, "")
    .split(/(?<=[.!?…。！？])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 3);
}

export interface SentenceDiff {
  /** A draft sentence and the final sentence it became. */
  readonly edits: ReadonlyArray<{ readonly before: string; readonly after: string }>;
  /** In the draft, gone from the final. */
  readonly removed: ReadonlyArray<string>;
  /** Written into the final, with no draft sentence it came from. */
  readonly added: ReadonlyArray<string>;
  readonly kept: number;
}

/**
 * Sentence-level diff, by content rather than position: a moved paragraph is
 * not an edit. A final sentence with no exact twin is paired with the draft
 * sentence it shares most words with (over 40 %), else counted as new.
 * ponytail: O(new × gone) pairing; fine for a book's edits, not for a rewrite
 * of every sentence in a long novel — a real LCS goes here if that happens.
 */
export function diffSentences(before: string, after: string): SentenceDiff {
  const draft = sentencesOf(before);
  const final = sentencesOf(after);
  const inFinal = new Set(final.map(norm));
  const inDraft = new Set(draft.map(norm));
  const gone = draft.filter((s) => !inFinal.has(norm(s)));
  const fresh = final.filter((s) => !inDraft.has(norm(s)));
  const goneWords = gone.map(wordsOf);
  const used = new Set<number>();
  const edits: Array<{ before: string; after: string }> = [];
  const added: string[] = [];
  for (const s of fresh) {
    const w = wordsOf(s);
    let best = -1;
    let score = 0.4;
    for (let i = 0; i < gone.length; i += 1) {
      if (used.has(i)) continue;
      const j = jaccard(w, goneWords[i]!);
      if (j > score) {
        score = j;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      edits.push({ before: gone[best]!, after: s });
    } else {
      added.push(s);
    }
  }
  return { edits, removed: gone.filter((_, i) => !used.has(i)), added, kept: final.length - fresh.length };
}

export function languageOfText(text: string): "zh" | "en" {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  return cjk > text.length * 0.2 ? "zh" : "en";
}

export interface Drift {
  readonly feature: "avgSentenceLength" | "avgParagraphLength" | "vocabularyDiversity";
  readonly before: number;
  readonly after: number;
  /** Relative change, final against drafts. */
  readonly change: number;
}

/** How the voice moved between the drafts and the final — only moves of 20 % or more. */
export function styleDrift(before: string, after: string): Drift[] {
  const lang = languageOfText(after || before);
  const a = analyzeStyle(before, "drafts", lang);
  const b = analyzeStyle(after, "final", lang);
  const out: Drift[] = [];
  for (const feature of ["avgSentenceLength", "avgParagraphLength", "vocabularyDiversity"] as const) {
    const x = a[feature];
    const y = b[feature];
    if (!x || !y) continue;
    const change = (y - x) / x;
    if (Math.abs(change) >= 0.2) out.push({ feature, before: x, after: y, change });
  }
  return out;
}

/** Each drift as a rule someone could accept: one sentence, checkable. */
export function driftProposals(drift: ReadonlyArray<Drift>): Array<{ text: string; kind: "number" | "sentence" }> {
  const r = (n: number) => Math.round(n * 10) / 10;
  return drift.map((d) => {
    if (d.feature === "avgSentenceLength") {
      return { kind: "number" as const, text: `Keep sentences near ${r(d.after)} words — your final averages ${r(d.after)}, the drafts ${r(d.before)}.` };
    }
    if (d.feature === "avgParagraphLength") {
      return { kind: "number" as const, text: `Keep paragraphs near ${r(d.after)} words — your final averages ${r(d.after)}, the drafts ${r(d.before)}.` };
    }
    return {
      kind: "sentence" as const,
      text: `Use a ${d.change > 0 ? "wider" : "plainer"} vocabulary — word variety ${r(d.after)} in your final against ${r(d.before)} in the drafts.`,
    };
  });
}

/** The text of each page of a PDF. */
export async function pdfPagesText(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return Array.isArray(text) ? text : [String(text)];
}

/** Pages of the final whose words differ from the build's same page. */
export function pageChanges(
  built: ReadonlyArray<string>,
  final: ReadonlyArray<string>,
): Array<{ readonly page: number; readonly similarity: number }> {
  const out: Array<{ page: number; similarity: number }> = [];
  for (let i = 0; i < Math.max(built.length, final.length); i += 1) {
    const similarity = jaccard(wordsOf(built[i] ?? ""), wordsOf(final[i] ?? ""));
    if (similarity < 0.85) out.push({ page: i + 1, similarity: Math.round(similarity * 100) / 100 });
  }
  return out;
}
