/*
 * The layout engine (Phase 8, analysis/26-design-engine.md): the model
 * chooses, code computes.
 *
 * The folio test set the model writing block coordinates, and that is where
 * type landed on type and words fell off their frames: a model is good at
 * "the feature pattern, mirrored, big picture" and bad at geometry. So a page
 * names a pattern and this file does the arithmetic:
 *
 *   grid system  → cells across, baselines down (and the page's real margins)
 *   pattern      → blocks on those cells, as fractions of the page's depth
 *   solver       → the pattern whose body holds the copy, or an honest note
 *   resolved     → each block's slot and its box in millimetres, for the shim
 *
 * Five systems: columns (even, for reading), modular (fields, for data),
 * thirds, golden (φ: .382 / .618) and canon (Van de Graaf's text block).
 */
import type { DesignSpec, PageLayout } from "./publication-design.js";
import type { PageBlock } from "./page-blocks.js";
import { sizeOf } from "./page-blocks.js";

export const PAGE_W = 210, PAGE_H = 297;
const PT = 25.4 / 72;
const PHI = 0.382;

export type System = "columns" | "modular" | "thirds" | "golden" | "canon";
export interface Cell { readonly x: number; readonly w: number }
export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export interface Geometry {
  readonly system: System;
  readonly baseline: number;
  readonly gutter: number;
  /** Head and foot of the live area, mm from the top of the page. */
  readonly top: number;
  readonly foot: number;
  /** Baselines between them. */
  readonly rows: number;
  /** Cells across, in logical order; canon's note cell is always last. */
  readonly cells: { readonly recto: readonly Cell[]; readonly verso: readonly Cell[] };
  /** The system's horizontal lines, as fractions of the depth. */
  readonly guides: readonly number[];
}

const even = (x0: number, w: number, n: number, g: number): Cell[] =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + i * ((w - (n - 1) * g) / n + g), w: (w - (n - 1) * g) / n }));

/** The geometry a spec's grid system makes of an A4 page. */
export function geometryOf(spec: Pick<DesignSpec, "grid"> | null | undefined): Geometry {
  const g = spec?.grid;
  const pos = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  const system = (["columns", "modular", "thirds", "golden", "canon"] as const).find((s) => s === g?.system) ?? "columns";
  const m = pos(g?.marginMm, 14), gut = pos(g?.gutterMm, 4), base = pos(g?.baselineMm, 4.7625);
  const live = PAGE_W - 2 * m;
  let top = m, foot = PAGE_H - m - 10, recto: Cell[], verso: Cell[] | null = null, guides: number[] = [];
  switch (system) {
    case "modular":
      recto = even(m, live, 6, gut); guides = [1, 2, 3, 4, 5, 6, 7].map((k) => k / 8); break;
    case "thirds":
      recto = even(m, live, 3, gut); guides = [1 / 3, 2 / 3]; break;
    case "golden": {
      // .382 · .236 · .382 of the measure: A+B is the golden major, B+C too.
      const a = live * PHI;
      recto = [{ x: m, w: a - gut / 2 }, { x: m + a + gut / 2, w: live - 2 * a - gut }, { x: m + live - a + gut / 2, w: a - gut / 2 }];
      guides = [PHI, 1 - PHI];
      break;
    }
    case "canon": {
      // Van de Graaf on A4: inner 1/9, outer 2/9 of the width; head 1/9, foot 2/9 of the height.
      const inner = PAGE_W / 9, outer = 2 * PAGE_W / 9, block = PAGE_W - inner - outer;
      top = PAGE_H / 9; foot = PAGE_H - 2 * PAGE_H / 9;
      const note = (x: number) => ({ x, w: outer - gut - 10 });
      recto = [...even(inner, block, 2, gut), note(inner + block + gut)];
      verso = [...even(outer, block, 2, gut), note(10)];
      break;
    }
    default:
      recto = even(m, live, Math.round(pos(g?.columns, 12)), gut);
  }
  const rows = Math.floor((foot - top) / base);
  return { system, baseline: base, gutter: gut, top, foot: top + rows * base, rows, cells: { recto, verso: verso ?? recto }, guides };
}

const cellsOf = (geo: Geometry, n: number) => (n % 2 ? geo.cells.recto : geo.cells.verso);

/** A slot's box on page n, run to the trim on the sides a bleeding slot touches. */
export function boxOf(geo: Geometry, n: number, s: { col: number; span: number; row: number; rows: number; bleed?: boolean }): Box {
  const cells = cellsOf(geo, n).slice(s.col - 1, s.col - 1 + s.span);
  let x = Math.min(...cells.map((c) => c.x)), r = Math.max(...cells.map((c) => c.x + c.w));
  let y = geo.top + s.row * geo.baseline, b = y + s.rows * geo.baseline;
  if (s.bleed) {
    const all = cellsOf(geo, n);
    if (Math.abs(x - Math.min(...all.map((c) => c.x))) < 0.5) x = 0;
    if (Math.abs(r - Math.max(...all.map((c) => c.x + c.w))) < 0.5) r = PAGE_W;
    if (s.row === 0) y = 0;
    if (s.row + s.rows >= geo.rows) b = PAGE_H;
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return { x: round(x), y: round(y), w: round(r - x), h: round(b - y) };
}

/** Every vertical line of the page's cells, for the score's alignment check. */
export const edgesOf = (geo: Geometry, n: number): number[] =>
  [...new Set(cellsOf(geo, n).flatMap((c) => [c.x, c.x + c.w]).map((v) => Math.round(v * 10) / 10))].sort((a, b) => a - b);

/* ------------------------------------------------------------------ patterns */

/** What a page is for, which decides the patterns it may wear. */
export type Role = "cover" | "back" | "opener" | "feature" | "figure" | "timeline" | "closing";

/** [kind, col, span, from, to, extra]: cells across, fractions of the depth down. */
type Spec = [string, number, number, number, number, Partial<PageBlock & { bleed: boolean }>?];

export interface Pattern {
  readonly id: string;
  readonly system: System;
  readonly roles: readonly Role[];
  /** One line for the art director. */
  readonly says: string;
  readonly blocks: readonly Spec[];
}

const B = { bleed: true } as const;
const P = (id: string, system: System, roles: Role[], says: string, blocks: Spec[]): Pattern => ({ id, system, roles, says, blocks });

export const PATTERNS: readonly Pattern[] = [
  // ---- columns (12): even, for reading
  P("c-cover", "columns", ["cover"], "full-bleed art, masthead across the head, title low-left", [
    ["picture", 1, 12, 0, 1, B], ["wordmark", 1, 9, 0, .07], ["title", 1, 9, .54, .67], ["deck", 1, 7, .68, .77], ["body", 1, 7, .8, 1]]),
  P("c-cover-split", "columns", ["cover"], "art in the upper right, type stacked in a left band", [
    ["picture", 5, 8, 0, .74, B], ["title", 1, 4, .05, .3], ["deck", 1, 4, .31, .45], ["body", 1, 4, .48, .74], ["wordmark", 1, 12, .79, .9]]),
  P("c-opener", "columns", ["opener", "closing"], "art over the top half, head and a two-column body below", [
    ["picture", 1, 12, 0, .52, B], ["kicker", 1, 6, .55, .57], ["title", 1, 9, .58, .7], ["deck", 1, 7, .71, .78], ["body", 1, 12, .8, 1, { columns: 2 }]]),
  P("c-feature-rail", "columns", ["feature"], "two-column text on the left, a tall art rail and a panel on the right", [
    ["kicker", 1, 8, .03, .05], ["title", 1, 8, .06, .18], ["deck", 1, 7, .19, .27], ["body", 1, 8, .29, 1, { columns: 2 }], ["dropcap", 1, 1, .29, .33, { lines: 3 }],
    ["picture", 9, 4, 0, .58, B], ["panel", 9, 4, .62, 1]]),
  P("c-feature-band", "columns", ["feature", "timeline"], "a wide art band on top, text below with a pull and a panel beside it", [
    ["picture", 1, 12, 0, .34, B], ["kicker", 1, 4, .37, .39], ["title", 1, 8, .4, .5], ["deck", 1, 7, .51, .58], ["body", 1, 8, .6, 1, { columns: 2 }],
    ["pull", 9, 4, .6, .74], ["panel", 9, 4, .77, 1]]),
  P("c-feature-dense", "columns", ["feature", "timeline"], "for long copy: a thin art band, then two columns across the full measure", [
    ["picture", 1, 12, 0, .14, B], ["kicker", 1, 6, .16, .18], ["title", 1, 9, .19, .26], ["deck", 1, 8, .27, .32],
    ["body", 1, 12, .34, 1, { columns: 2 }], ["dropcap", 1, 1, .34, .38, { lines: 3 }]]),
  P("c-figure", "columns", ["figure", "closing"], "a giant number top-left, art across the middle, text and panel below", [
    ["figure", 1, 7, .03, .27], ["kicker", 8, 5, .03, .05], ["title", 8, 5, .06, .19], ["deck", 8, 5, .2, .3],
    ["picture", 1, 12, .33, .58, B], ["body", 1, 8, .61, 1, { columns: 2 }], ["panel", 9, 4, .61, 1]]),
  P("c-back", "columns", ["back"], "full-bleed art, the issue closing in a right-hand block", [
    ["picture", 1, 12, 0, 1, B], ["wordmark", 7, 6, .03, .08], ["title", 6, 7, .62, .74], ["deck", 6, 7, .75, .82], ["body", 7, 6, .84, .98]]),

  // ---- modular (6 × 8 fields): for data and many small parts
  P("m-cover", "modular", ["cover"], "full-bleed art, title on the fifth field line", [
    ["picture", 1, 6, 0, 1, B], ["wordmark", 1, 6, .01, .09], ["title", 1, 4, .5, .625], ["deck", 1, 4, .64, .74], ["body", 1, 4, .77, 1]]),
  P("m-opener", "modular", ["opener"], "five fields of art, head and two columns in the last three", [
    ["picture", 1, 6, 0, .625, B], ["kicker", 1, 2, .64, .66], ["title", 1, 4, .66, .76], ["deck", 1, 4, .77, .84], ["body", 1, 6, .86, 1, { columns: 2 }]]),
  P("m-feature", "modular", ["feature"], "text in four modules, art and a panel stacked in the outer two", [
    ["kicker", 1, 4, .03, .05], ["title", 1, 4, .06, .18], ["deck", 1, 4, .19, .25], ["body", 1, 4, .27, 1, { columns: 2 }],
    ["picture", 5, 2, 0, .5, B], ["panel", 5, 2, .52, .75], ["pull", 5, 2, .77, 1]]),
  P("m-feature-dense", "modular", ["feature", "timeline"], "for long copy: a thin art strip, then two full-width columns", [
    ["kicker", 1, 3, .03, .05], ["title", 1, 6, .06, .14], ["deck", 1, 5, .15, .2], ["picture", 1, 6, .21, .32, B],
    ["body", 1, 6, .34, 1, { columns: 2 }], ["dropcap", 1, 1, .34, .38, { lines: 3 }]]),
  P("m-figure", "modular", ["figure"], "number and head in the first two fields, an art band, body and panel below", [
    ["figure", 1, 3, .03, .24], ["title", 4, 3, .03, .16], ["deck", 4, 3, .17, .24], ["picture", 1, 6, .25, .5, B],
    ["body", 1, 4, .52, 1, { columns: 2 }], ["panel", 5, 2, .52, 1]]),
  P("m-timeline", "modular", ["timeline", "feature"], "an art band of two fields, a panel column of facts beside the body", [
    ["picture", 1, 6, 0, .25, B], ["kicker", 1, 3, .27, .29], ["title", 1, 4, .3, .4], ["deck", 1, 4, .41, .48], ["body", 1, 4, .5, 1, { columns: 2 }],
    ["panel", 5, 2, .27, .6], ["figure", 5, 2, .63, .76]]),
  P("m-closing", "modular", ["closing"], "half art, then the answer with a number and a panel", [
    ["picture", 1, 6, 0, .5, B], ["kicker", 1, 3, .52, .54], ["title", 1, 4, .55, .65], ["deck", 1, 4, .66, .73], ["body", 1, 3, .75, 1],
    ["figure", 4, 3, .75, .86], ["panel", 4, 3, .87, 1]]),
  P("m-back", "modular", ["back"], "full-bleed art, closing words on the right three fields", [
    ["picture", 1, 6, 0, 1, B], ["wordmark", 4, 3, .03, .08], ["title", 3, 4, .625, .75], ["deck", 3, 4, .76, .84], ["body", 4, 3, .86, 1]]),

  // ---- thirds: calm and balanced, type on the third lines
  P("t-cover", "thirds", ["cover"], "full-bleed art, the title on the lower third line", [
    ["picture", 1, 3, 0, 1, B], ["wordmark", 1, 3, .01, .09], ["title", 1, 2, .55, .667], ["deck", 1, 2, .68, .77], ["body", 1, 2, .8, 1]]),
  P("t-opener", "thirds", ["opener", "closing"], "two thirds of art above, head and text in the last third", [
    ["picture", 1, 3, 0, .667, B], ["kicker", 1, 1, .69, .71], ["title", 1, 2, .72, .82], ["deck", 1, 2, .83, .9], ["body", 3, 1, .69, 1]]),
  P("t-feature", "thirds", ["feature"], "text in two thirds, the outer third a full-height art column with a panel", [
    ["kicker", 1, 2, .03, .05], ["title", 1, 2, .06, .18], ["deck", 1, 2, .19, .28], ["body", 1, 2, .333, 1, { columns: 2 }],
    ["picture", 3, 1, 0, 1, B], ["panel", 3, 1, .7, .96]]),
  P("t-feature-dense", "thirds", ["feature", "timeline"], "for long copy: two columns over two thirds, art and panel in the outer third", [
    ["kicker", 1, 2, .03, .05], ["title", 1, 3, .06, .13], ["deck", 1, 2, .14, .2], ["body", 1, 2, .22, 1, { columns: 2 }],
    ["picture", 3, 1, .14, .4], ["panel", 3, 1, .43, 1]]),
  P("t-figure", "thirds", ["figure", "timeline"], "a number in the first third, art across the middle third, text below", [
    ["figure", 1, 1, .03, .3], ["title", 2, 2, .03, .17], ["deck", 2, 2, .18, .3], ["picture", 1, 3, .333, .667, B],
    ["body", 1, 2, .69, 1, { columns: 2 }], ["panel", 3, 1, .69, 1]]),
  P("t-closing", "thirds", ["closing", "feature"], "art over the outer two thirds, a narrow head column, text below", [
    ["picture", 2, 2, 0, .667, B], ["kicker", 1, 1, .03, .05], ["title", 1, 1, .06, .3], ["deck", 1, 1, .31, .46],
    ["body", 1, 2, .69, 1, { columns: 2 }], ["figure", 3, 1, .69, .83], ["panel", 3, 1, .84, 1]]),
  P("t-back", "thirds", ["back"], "full-bleed art, closing words in the outer two thirds", [
    ["picture", 1, 3, 0, 1, B], ["wordmark", 3, 1, .03, .08], ["title", 2, 2, .667, .78], ["deck", 2, 2, .79, .86], ["body", 3, 1, .87, 1]]),

  // ---- golden (.382 / .618): classical tension
  P("g-cover", "golden", ["cover"], "full-bleed art, title on the golden line", [
    ["picture", 1, 3, 0, 1, B], ["wordmark", 1, 3, .01, .09], ["title", 1, 2, .5, .618], ["deck", 1, 2, .64, .74], ["body", 1, 2, .77, 1]]),
  P("g-opener", "golden", ["opener"], "a golden rectangle of art top-left, head in the minor column, text below", [
    ["picture", 1, 2, 0, .618, B], ["kicker", 3, 1, .04, .06], ["title", 3, 1, .07, .3], ["deck", 3, 1, .31, .46], ["body", 1, 3, .65, 1, { columns: 2 }]]),
  P("g-feature", "golden", ["feature"], "text on the golden major, art and panel on the minor", [
    ["kicker", 1, 2, .03, .05], ["title", 1, 2, .06, .18], ["deck", 1, 2, .19, .28], ["body", 1, 2, .3, 1], ["dropcap", 1, 1, .3, .34, { lines: 3 }],
    ["picture", 3, 1, 0, .618, B], ["pull", 3, 1, .64, .78], ["panel", 3, 1, .8, 1]]),
  P("g-feature-dense", "golden", ["feature", "timeline"], "for long copy: art in the minor corner, two columns across the full measure", [
    ["kicker", 1, 2, .03, .05], ["title", 1, 2, .06, .16], ["deck", 1, 2, .17, .26], ["picture", 3, 1, 0, .27, B],
    ["body", 1, 3, .3, 1, { columns: 2 }], ["dropcap", 1, 1, .3, .34, { lines: 3 }]]),
  P("g-figure", "golden", ["figure"], "a number in the minor column, a golden band of art, text below", [
    ["figure", 1, 1, .03, .25], ["title", 2, 2, .03, .16], ["deck", 2, 2, .17, .27], ["picture", 1, 3, .3, .618, B],
    ["body", 1, 2, .64, 1], ["panel", 3, 1, .64, 1]]),
  P("g-timeline", "golden", ["timeline", "feature"], "art across the minor part of the depth, text on the major", [
    ["picture", 1, 3, 0, .382, B], ["kicker", 1, 2, .4, .42], ["title", 1, 2, .43, .53], ["deck", 1, 2, .54, .6], ["body", 1, 2, .618, 1],
    ["panel", 3, 1, .4, 1]]),
  P("g-closing", "golden", ["closing"], "art on the major of the head, a narrow head column, the answer below", [
    ["picture", 2, 2, 0, .618, B], ["kicker", 1, 1, .03, .05], ["title", 1, 1, .06, .32], ["deck", 1, 1, .33, .5],
    ["body", 1, 2, .64, 1], ["figure", 3, 1, .64, .8], ["panel", 3, 1, .82, 1]]),
  P("g-back", "golden", ["back"], "full-bleed art, closing words from the golden line", [
    ["picture", 1, 3, 0, 1, B], ["wordmark", 2, 2, .03, .08], ["title", 2, 2, .618, .74], ["deck", 2, 2, .75, .82], ["body", 3, 1, .84, 1]]),

  // ---- canon: a book's text block, notes in the outer margin
  P("k-cover", "canon", ["cover"], "full-bleed art, title set in the text block", [
    ["picture", 1, 3, 0, 1, B], ["wordmark", 1, 2, 0, .08], ["title", 1, 2, .48, .62], ["deck", 1, 2, .64, .74], ["body", 1, 2, .77, 1]]),
  P("k-feature", "canon", ["feature", "timeline"], "a picture inside the text block, two columns, notes in the margin", [
    ["kicker", 1, 2, .04, .06], ["title", 1, 2, .07, .17], ["deck", 1, 2, .18, .25], ["picture", 1, 2, .27, .52],
    ["body", 1, 2, .55, 1, { columns: 2 }], ["panel", 3, 1, .26, .62], ["pull", 3, 1, .66, .95]]),
  P("k-feature-dense", "canon", ["feature", "timeline"], "for long copy: the whole text block in two columns, notes and pull in the margin", [
    ["kicker", 1, 2, .04, .06], ["title", 1, 2, .07, .15], ["deck", 1, 2, .16, .22], ["body", 1, 2, .24, 1, { columns: 2 }],
    ["picture", 3, 1, 0, .22], ["panel", 3, 1, .24, .6], ["pull", 3, 1, .64, .95]]),
  P("k-figure", "canon", ["figure", "closing", "opener"], "a number heading the block, text below, notes in the margin", [
    ["figure", 1, 2, .04, .22], ["kicker", 1, 2, .24, .26], ["title", 1, 2, .27, .38], ["deck", 1, 2, .39, .47],
    ["body", 1, 2, .5, 1, { columns: 2 }], ["picture", 3, 1, 0, .45], ["panel", 3, 1, .5, 1]]),
  P("k-back", "canon", ["back"], "full-bleed art, closing words in the text block", [
    ["picture", 1, 3, 0, 1, B], ["wordmark", 1, 2, 0, .07], ["title", 1, 2, .6, .75], ["deck", 1, 2, .76, .86], ["body", 1, 1, .88, 1]]),
];

/** A page's role, from its type and place in the issue. */
export function roleOf(page: { n: number; type: string }, last: number): Role {
  if (page.type === "cover") return page.n === last && page.n > 1 ? "back" : "cover";
  if (page.n === 1) return "cover";
  if (["plate", "statement", "photo-spread", "contents"].includes(page.type)) return "opener";
  if (["numbers", "data", "infographic", "diagram", "map", "comparison"].includes(page.type)) return "figure";
  if (["timeline", "how-it-works"].includes(page.type)) return "timeline";
  if (["in-your-hands", "where-else"].includes(page.type)) return "closing";
  return "feature";
}

/** The patterns a page may wear under a system, best match first. */
export function patternsFor(system: System, role: Role): Pattern[] {
  const own = PATTERNS.filter((p) => p.system === system);
  const exact = own.filter((p) => p.roles.includes(role));
  if (exact.length) return exact;
  // A role the system has no pattern for borrows the nearest: feature for prose, cover for art.
  const near: Role = role === "back" ? "cover" : role === "cover" ? "back" : "feature";
  return own.filter((p) => p.roles.includes(near));
}

/** The catalogue, for the art director: one line per pattern of the systems a house allows. */
export function patternCatalogue(systems: readonly string[]): string {
  return PATTERNS.filter((p) => systems.includes(p.system))
    .map((p) => `${p.id} [${p.system}; ${p.roles.join("/")}]: ${p.says}`).join("\n");
}

/* -------------------------------------------------------------------- solver */

type Slot = { col: number; span: number; row: number; rows: number; bleed?: boolean };
const slotOf = (b: PageBlock) => b.slot as Slot;
const sideBySide = (a: Slot, b: Slot) => a.col < b.col + b.span && b.col < a.col + a.span;

/**
 * Settle a resolved page against its real copy (the folio rebuild showed both):
 *
 * - the deck is sized to its slot, and when even 8.5 pt will not fit, the
 *   body below it moves down rather than the deck running into it;
 * - short copy gives its slack to the picture: the head group moves down and
 *   a top art band grows, so the space reads as picture, not as a hole at the
 *   foot of the columns.
 *
 * Returns the body's new capacity, or null when the body did not move.
 */
function settle(blocks: PageBlock[], page: PageContent, geo: Geometry, spec: Pick<DesignSpec, "grid" | "type">, notes: string[]): number | null {
  const move = (b: PageBlock, slot: Slot) => {
    (b as { slot: Slot }).slot = slot;
    (b as { box: Box }).box = boxOf(geo, page.n, slot);
  };
  const body = blocks.find((b) => b.kind === "body");
  const deck = blocks.find((b) => b.kind === "deck");
  if (deck && page.deck) {
    const top = sizeOf({ kind: "deck" }, spec.type?.scale) ?? 12;
    const box = (deck as { box: Box }).box;
    const need = (size: number) => Math.ceil(page.deck!.length * size * PT * 0.5 / (box.w - 4)) * size * PT * 1.3 + 1;
    let size = top;
    while (size > 8.5 && need(size) > box.h) size -= 0.5;
    if (size < top) (deck as { size?: number }).size = size;
    const over = Math.ceil((need(size) - box.h) / geo.baseline);
    if (over > 0) {
      const d = slotOf(deck);
      move(deck, { ...d, rows: d.rows + over });
      for (const b of blocks) {
        const s = slotOf(b);
        if (b === deck || b.kind === "drawn" || b.kind === "runhead" || s.row < d.row + d.rows || !sideBySide(s, d)) continue;
        move(b, { ...s, row: s.row + over, rows: Math.max(1, s.rows - (b === body || b.kind === "dropcap" ? over : 0)) });
      }
    }
  }
  if (!body || !page.words) return body ? bodyCapacity((body as { box: Box }).box, body.columns, spec) : null;
  const cap = bodyCapacity((body as { box: Box }).box, body.columns, spec);
  const art = blocks.find((b) => b.kind === "drawn" && slotOf(b).row === 0 && slotOf(b).row + slotOf(b).rows <= slotOf(body).row && sideBySide(slotOf(b), slotOf(body)));
  if (!art || cap <= page.words * 1.25) return cap;
  // The rows the copy does not need, at most a third of the body.
  const b0 = slotOf(body);
  const slack = Math.min(Math.floor(b0.rows / 3), Math.floor(b0.rows * (1 - page.words * 1.15 / cap)));
  if (slack < 2) return cap;
  const a0 = slotOf(art), artEnd = a0.row + a0.rows;
  for (const b of blocks) {
    const s = slotOf(b);
    if (b === art || b.kind === "runhead") continue;
    // Everything under the art moves down together; what reaches the foot gives up rows.
    if (s.row >= artEnd) move(b, { ...s, row: s.row + slack, rows: Math.max(1, Math.min(s.rows, geo.rows - s.row - slack)) });
  }
  move(art, { ...a0, rows: a0.rows + slack });
  notes.push(`gave ${slack} spare lines to the art`);
  return bodyCapacity((body as { box: Box }).box, body.columns, spec);
}

/** The largest size, at most `top` and stepping down by 0.5 pt, at which a title fits its box. */
export function titleSize(title: string, box: Box, top: number): number {
  const words = title.split(/\s+/).filter(Boolean);
  for (let s = top; s > 9; s -= 0.5) {
    // A display face sets about 0.45-0.5 em a character (Bell MT measured 0.41 on Birds p6);
    // 0.55 planned "A girl and a peahen" in two lines, it set in one, and left a 20 mm hole.
    // ponytail: one width for every face; a wide face (Cooper Black) is shrunk to fit by the builder.
    const perLine = box.w / (s * PT * 0.5);
    let lines = 1, used = 0;
    for (const w of words) {
      if (used && used + 1 + w.length > perLine) { lines++; used = w.length; } else used += (used ? 1 : 0) + w.length;
    }
    if (lines * s * PT * 1.05 <= box.h) return s;
  }
  return 9;
}

/** What a page holds, for the solver: which blocks have content, and how long the body is. */
export interface PageContent {
  readonly n: number;
  readonly type: string;
  readonly words: number;
  readonly hasDeck: boolean;
  readonly hasPull: boolean;
  readonly hasFigure: boolean;
  readonly hasNotes: boolean;
  readonly title?: string;
  readonly deck?: string;
}

/** How many words a body block holds, from its box and the type scale. */
export function bodyCapacity(box: Box, columns: number | undefined, spec: Pick<DesignSpec, "type" | "grid">): number {
  const pt = sizeOf({ kind: "body" }, spec.type?.scale) ?? 9.5;
  const gut = spec.grid?.gutterMm ?? 4;
  const cols = columns ?? (box.w > 120 ? 2 : 1);
  const colW = (box.w - (cols - 1) * gut) / cols;
  const lines = Math.floor(box.h / (pt * 1.42 * PT));
  // Half an em per character on average: conservative for wide text faces (Sitka, Georgia).
  const perLine = colW / (pt * PT * 0.5);
  return Math.floor(lines * cols * perLine / 6.1);
}

export interface Resolved {
  readonly pattern: string;
  readonly blocks: PageBlock[];
  readonly capacity: number;
  readonly notes: string[];
}

/**
 * Turn a pattern into the page's blocks.
 *
 * Blocks with nothing to carry are left out (no pull quote, no pull block),
 * a picture becomes drawn art from the section's generators until pictures
 * exist (Phase 11), and every block carries its box so the shim draws what
 * was computed here rather than doing the arithmetic again.
 */
export function resolvePattern(
  pattern: Pattern,
  page: PageContent,
  spec: Pick<DesignSpec, "grid" | "type">,
  opts: { mirror?: boolean; art?: string; seed?: number; kicker?: string; panel?: string } = {},
): Resolved {
  const geo = geometryOf(spec);
  const n = geo.cells.recto.length;
  const notes: string[] = [];
  const blocks: PageBlock[] = [];
  let capacity = 0;
  const has = (k: string) => ({
    deck: page.hasDeck, pull: page.hasPull, figure: page.hasFigure, panel: page.hasNotes || page.hasFigure, dropcap: page.words > 120,
  } as Record<string, boolean>)[k] ?? true;
  // A canon spread mirrors itself; any other system mirrors only when asked.
  const flip = !!opts.mirror && geo.system !== "canon";
  for (const [kind, col0, span, from, to, extra] of pattern.blocks) {
    if (!has(kind)) continue;
    const col = flip ? n - (col0 + span - 1) + 1 : col0;
    const row = Math.round(from * geo.rows), rows = Math.max(1, Math.round(to * geo.rows) - row);
    const slot = { col, span, row, rows, ...(extra?.bleed ? { bleed: true } : {}) };
    const box = boxOf(geo, page.n, slot);
    const { bleed: _b, ...rest } = extra ?? {};
    const block: PageBlock & { box: Box } = {
      ...rest,
      kind: kind === "picture" ? "drawn" : kind,
      slot,
      box,
      ...(kind === "picture" ? { drawn: (opts.art ?? "contours") as PageBlock["drawn"], seed: opts.seed ?? page.n * 7 + 3 } : {}),
      ...(kind === "kicker" && opts.kicker ? { text: opts.kicker } : {}),
      ...(kind === "panel" && opts.panel ? { text: opts.panel } : {}),
    };
    if (kind === "body") capacity = bodyCapacity(box, extra?.columns, spec);
    // The title is sized to its slot here: Affinity's own overflow check let a
    // two-line title run down over the deck on the folio rebuild.
    if (kind === "title" && page.title) {
      const top = sizeOf({ kind: "title" }, spec.type?.scale) ?? 28;
      const size = titleSize(page.title, box, top);
      if (size < top) (block as { size?: number }).size = size;
    }
    blocks.push(block);
  }
  // The running head, on every page but the covers: the house's line, the same everywhere.
  // A cover pattern carries the masthead instead, whatever page wears it.
  const coverLike = pattern.roles.some((r) => r === "cover" || r === "back") || pattern.blocks.some((b) => b[0] === "wordmark");
  if (!coverLike && page.type !== "cover" && page.type !== "plate") {
    const slot = { col: 1, span: Math.min(n, geo.system === "canon" ? 2 : n), row: 0, rows: 1 };
    if (!blocks.some((b) => b.kind === "runhead")) blocks.unshift({ kind: "runhead", slot, box: boxOf(geo, page.n, slot) } as PageBlock);
  }
  // The runhead takes row 0; type that starts there moves down a line.
  for (const b of blocks) {
    const s = b.slot as { col: number; span: number; row: number; rows: number; bleed?: boolean };
    if (b.kind !== "runhead" && b.kind !== "drawn" && b.kind !== "wordmark" && s.row === 0 && blocks.some((r) => r.kind === "runhead")) {
      (b as { slot: unknown }).slot = { ...s, row: 1, rows: Math.max(1, s.rows - 1) };
      (b as { box: Box }).box = boxOf(geo, page.n, (b as { slot: typeof s }).slot);
    }
  }
  capacity = settle(blocks, page, geo, spec, notes) ?? capacity;
  if (page.words && capacity && page.words > capacity) notes.push(`${pattern.id} holds about ${capacity} words; the page has ${page.words}`);
  return { pattern: pattern.id, blocks, capacity, notes };
}

/**
 * The pattern a page wears: the one asked for when its body holds the copy,
 * else the roomiest of its role under the same system, else the asked one
 * with a note saying how much copy is over. Never a silent overflow.
 */
export function choosePattern(
  asked: string | undefined,
  page: PageContent,
  spec: Pick<DesignSpec, "grid" | "type">,
  last: number,
  opts: { mirror?: boolean; art?: string; seed?: number; kicker?: string; panel?: string; avoid?: string } = {},
): Resolved {
  const system = geometryOf(spec).system;
  const role = roleOf(page, last);
  const fits = (r: Resolved) => !page.words || r.capacity === 0 || r.capacity >= page.words * 1.1;
  // How full the body runs: under 60 % leaves a hole at the foot of the columns.
  const fill = (r: Resolved) => (r.capacity ? page.words / r.capacity : 1);
  // A pattern built around a figure leaves its cells empty on a page with none.
  const usable = (p: Pattern) => page.hasFigure || !p.blocks.some((b) => b[0] === "figure");
  const fresh = (p: Pattern) => p.id !== opts.avoid;
  const want = PATTERNS.find((p) => p.id === asked && p.system === system);
  const pool = patternsFor(system, role).filter(usable);
  const first = want && usable(want) ? want : pool.find(fresh) ?? pool[0] ?? PATTERNS.find((p) => p.system === system)!;
  const tried = resolvePattern(first, page, spec, opts);
  const said = want === first ? [] : [`${asked ?? "no pattern"} did not suit this page; used ${first.id}`];
  if (fits(tried) && fill(tried) >= 0.6 && fresh(first)) return { ...tried, notes: said };
  const others = pool.filter((p) => p.id !== first.id).map((p) => resolvePattern(p, page, spec, opts));
  const better = others.filter((r) => fits(r) && r.pattern !== opts.avoid).sort((a, b) => fill(b) - fill(a))[0];
  if (better && (!fits(tried) || fill(better) > fill(tried) || !fresh(first))) {
    const why = fits(tried) ? `ran ${Math.round(fill(tried) * 100)} % full` : `held ${tried.capacity} of ${page.words} words`;
    return { ...better, notes: [`${first.id} ${why}; ${better.pattern} fits them`] };
  }
  if (fits(tried)) return { ...tried, notes: said };
  const most = [tried, ...others].sort((a, b) => b.capacity - a.capacity)[0]!;
  return { ...most, notes: [`no ${system} ${role} pattern holds ${page.words} words (best ${most.capacity}): cut the copy or let the score mend it`] };
}

/** Words in a body, the way the shim pours it. */
export const wordsOf = (body: string | null | undefined): number =>
  (body ?? "").replace(/[#*_>`]/g, " ").split(/\s+/).filter(Boolean).length;

/**
 * Lay every page that names a pattern (or names none, once a house is in
 * force): the spec comes back with blocks computed, and the notes say what
 * the solver changed.
 */
export function resolveLayouts(
  spec: DesignSpec,
  pages: ReadonlyArray<{ n: number; type: string; title?: string | null; body?: string | null; deck?: string | null; pullQuote?: string | null; furniture?: ReadonlyArray<{ kind: string }> }>,
  artFor: (n: number) => readonly string[],
): { spec: DesignSpec; notes: string[] } {
  const last = Math.max(...pages.map((p) => p.n));
  const notes: string[] = [];
  const out: Record<string, PageLayout> = { ...spec.pages };
  // Neighbouring pages never wear the same pattern.
  let previous: string | undefined;
  for (const page of [...pages].sort((a, b) => a.n - b.n)) {
    const layout = spec.pages?.[String(page.n)] as (PageLayout & { pattern?: string; mirror?: boolean; art?: string; seed?: number; kicker?: string; panelTitle?: string }) | undefined;
    const furniture = page.furniture ?? [];
    const content: PageContent = {
      n: page.n, type: page.type, words: wordsOf(page.body),
      hasDeck: !!page.deck, hasPull: !!page.pullQuote,
      hasFigure: furniture.some((f) => f.kind === "pull-number"),
      hasNotes: furniture.some((f) => f.kind === "sidefact" || f.kind === "did-you-know"),
      ...(page.title ? { title: page.title } : {}),
      ...(page.deck ? { deck: page.deck } : {}),
    };
    const art = artFor(page.n);
    const chosen = layout?.art && art.includes(layout.art) ? layout.art : art[page.n % Math.max(1, art.length)] ?? "contours";
    const r = choosePattern(layout?.pattern, content, spec, last, {
      avoid: previous,
      mirror: layout?.mirror ?? page.n % 2 === 0, art: chosen, seed: layout?.seed,
      ...(layout?.kicker ? { kicker: layout.kicker } : {}), ...(layout?.panelTitle ? { panel: layout.panelTitle } : {}),
    });
    notes.push(...r.notes.map((x) => `p${page.n}: ${x}`));
    previous = r.pattern;
    out[String(page.n)] = {
      ...(layout ?? { imageSlot: "none" as const }),
      layout: layout?.layout || r.pattern,
      pattern: r.pattern,
      blocks: r.blocks,
      edges: edgesOf(geometryOf(spec), page.n),
    } as PageLayout;
  }
  return { spec: { ...spec, pages: out }, notes };
}
