/*
 * Just enough markdown to read a manuscript as a page, not as source.
 *
 * The reader marks findings by character offset into the raw file, so the
 * text is never rewritten: a block is classified by how it starts, and the
 * markdown syntax inside it (`# `, `> `, `**`, `*`) becomes hidden runs. Every
 * offset still points at the same character it did in the file.
 */

export type BlockKind = "p" | "h" | "quote" | "rule" | "brief";

/** A stretch of one block, drawn one way. */
export interface Run {
  readonly from: number;
  readonly to: number;
  readonly hidden: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface Block {
  readonly kind: BlockKind;
  /** A rule written on the block's first line, with no blank line after it. */
  readonly ruleBefore?: boolean;
  readonly from: number;
  readonly to: number;
  readonly runs: ReadonlyArray<Run>;
}

const HEADING = /^#{1,6}[ \t]+/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const RULE_LINE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*\n/;
// The pipeline writes art directions into the page as "*visual brief 1 (hero):*".
const BRIEF = /^\s*[*_]{0,2}\s*\[?visual brief/i;

/** Markers that open and close emphasis, paired; an unpaired one stays literal. */
function emphasis(text: string, from: number, to: number): Array<{ at: number; len: 1 | 2 }> {
  const found: Array<{ at: number; len: 1 | 2 }> = [];
  const re = /\*\*|\*/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    const at = m.index;
    const len = m[0].length as 1 | 2;
    if (at + len > to) break;
    const before = text[at - 1] ?? " ";
    const after = text[at + len] ?? " ";
    // A star with space on both sides is a star ("5 * 3"), and one opening a
    // line before a space is a bullet; neither is emphasis.
    if (/\s/.test(before) && /\s/.test(after)) continue;
    if (len === 1 && (at === from || before === "\n") && after === " ") continue;
    found.push({ at, len });
  }
  for (const len of [1, 2] as const) {
    const ofLen = found.filter((t) => t.len === len);
    if (ofLen.length % 2) found.splice(found.indexOf(ofLen[ofLen.length - 1]!), 1);
  }
  return found;
}

function classify(text: string, from: number, to: number): { kind: BlockKind; hide: Array<[number, number]> } {
  const raw = text.slice(from, to);
  if (RULE.test(raw)) return { kind: "rule", hide: [[from, to]] };
  const h = HEADING.exec(raw);
  if (h) return { kind: "h", hide: [[from, from + h[0].length]] };
  if (raw.startsWith(">")) {
    const hide: Array<[number, number]> = [];
    for (const m of raw.matchAll(/(^|\n)(>[ \t]?)/g)) {
      const at = from + m.index + m[1]!.length;
      hide.push([at, at + m[2]!.length]);
    }
    return { kind: "quote", hide };
  }
  return { kind: BRIEF.test(raw) ? "brief" : "p", hide: [] };
}

/** Split a block into runs at every hidden marker and emphasis change. */
function runsOf(text: string, from: number, to: number, hide: Array<[number, number]>): Run[] {
  const marks = emphasis(text, from, to);
  const cuts = new Set<number>([from, to]);
  for (const [a, b] of hide) { cuts.add(a); cuts.add(b); }
  for (const m of marks) { cuts.add(m.at); cuts.add(m.at + m.len); }
  const points = [...cuts].filter((c) => c >= from && c <= to).sort((a, b) => a - b);

  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const marker = marks.find((m) => m.at === a && m.at + m.len === b);
    if (marker) {
      if (marker.len === 2) bold = !bold; else italic = !italic;
      runs.push({ from: a, to: b, hidden: true, bold, italic });
      continue;
    }
    const hidden = hide.some(([x, y]) => a >= x && b <= y);
    runs.push({ from: a, to: b, hidden, bold, italic });
  }
  return runs;
}

/** The blocks of a manuscript, separated by blank lines, as the findings count them. */
export function manuscriptBlocks(text: string): Block[] {
  const spans: Array<[number, number]> = [];
  let from = 0;
  for (const m of text.matchAll(/\n\s*\n/g)) {
    spans.push([from, m.index]);
    from = m.index + m[0].length;
  }
  spans.push([from, text.length]);
  return spans.map(([a, b]) => {
    // "---" straight above the next paragraph is still a rule; the block is
    // what follows it. The block keeps its full span, so it is still the same
    // paragraph number the findings and the reader map count.
    const rule = RULE_LINE.exec(text.slice(a, b));
    const start = rule ? a + rule[0].length : a;
    const { kind, hide } = classify(text, start, b);
    if (rule) hide.unshift([a, start]);
    return { kind, from: a, to: b, runs: runsOf(text, a, b, hide), ...(rule ? { ruleBefore: true } : {}) };
  });
}
