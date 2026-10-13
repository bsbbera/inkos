/*
 * The page planned by arithmetic (the fast plan).
 *
 * The composer had the model place every frame of every page and sent it back
 * up to twice when a check failed: about eighteen calls for one design of a
 * four-page issue, an hour for three options, and the frames it placed still
 * left holes, because a body frame reserved rows its copy never reached and
 * Affinity sets a text frame to its copy.
 *
 * Here the page is computed, not asked for. A few editorial arrangements
 * (picture at the head, at the foot, down one side) are laid on the issue's own
 * grid, and every frame is sized to what it carries: the title to the rows its
 * words take at full size, the deck to its lines, the body to its words at a
 * readable measure. What is left over goes to the picture, up to the share a
 * dominant element may hold, and past that it is one zone of white at the foot,
 * never a band between frames. Each candidate is checked by the same checks a
 * model's composition was (composition.ts) and ranked by the same numbers the
 * page score uses, so the plan is the best of many in milliseconds and the
 * visual loop (page-score-run.ts) can walk down the ranking when a proof fails.
 */
import type { DesignSpec, PageLayout } from "./publication-design.js";
import { checkComposition, layoutOf, type ComposedPage, type PageCopy, type PageSetting } from "./composition.js";
import { sizeOf } from "./page-blocks.js";
import { PAGE_H, PAGE_W, bodyCapacity, boxOf, geometryOf, titleSize, wordsOf, type Geometry } from "./layout-engine.js";
import type { Shape } from "./page-art.js";

const PT = 25.4 / 72;
/** The picture shapes the renderer paints well (art stage `sizeForFrame`): 1:2 to 2.4:1. */
export const MIN_ASPECT = 0.5, MAX_ASPECT = 2.4;

/** Where the picture stands on the page. */
export type Arrangement = "head" | "foot" | "side" | "type";

export interface PlanCandidate {
  /** "head .618 / body 2 col / pull": what the arrangement is, as the loop and the editor read it. */
  readonly id: string;
  readonly arrangement: Arrangement;
  readonly composed: ComposedPage;
  /** Higher is better. */
  readonly score: number;
  /** Share of the page the picture holds. */
  readonly dominance: number;
  /** Extras set beside the body (pull, figure, panel). */
  readonly extras: number;
  /** True when the picture took every spare row (no white zone of its own). */
  readonly filled: boolean;
  readonly why: readonly string[];
  /** The edges that cut the picture's subject, so its drawn layer meets the trim there. */
  readonly cut?: readonly string[];
}

export interface PlanOptions {
  /** The arrangement of the page before, so neighbours differ. */
  readonly previous?: Arrangement;
  /** Words a picture's brief should say, when the page has none. */
  readonly shows?: string;
  readonly setting?: PageSetting;
  /**
   * The width:height of the page's picture, when it is known (a picture already made, or
   * its brief's orientation). The frame is fitted to it: Birds' tall kingfisher and hornbill
   * were planned into wide bands at the foot, so each stood small in the middle of a strip.
   */
  readonly aspect?: number;
  /**
   * Edges of the picture that cut its subject ("left", "right", "top", "bottom"). A cut edge
   * goes to the trim: the Birds kingfisher, cut at its right, was set down the left side and
   * its body ended in a straight line in the middle of the page.
   */
  readonly cut?: readonly string[];
}

type Raw = { kind: string; col: number; span: number; row: number; rows: number; bleed?: boolean; columns?: number; lines?: number; brief?: unknown };

/** Rows a box of `span` cells needs for `need` mm of depth. */
const rowsFor = (geo: Geometry, mm: number) => Math.max(1, Math.ceil(mm / geo.baseline));

/** The depth fractions a system holds as its own: where a picture's edge may fall. */
function guidesOf(geo: Geometry): number[] {
  const own = geo.guides.length ? geo.guides : [0.382, 0.5, 0.618];
  return [...new Set([...own, 0.382, 0.5, 0.618].map((g) => Math.round(g * 1000) / 1000))].filter((g) => g >= 0.3 && g <= 0.7).sort();
}

/** How many text columns make a readable line in a frame `w` mm wide, nearest 60 characters. */
export function columnsFor(w: number, spec: Pick<DesignSpec, "grid" | "type">): { columns: number; chars: number } {
  const pt = sizeOf({ kind: "body" }, spec.type?.scale) ?? 9.5, gut = spec.grid?.gutterMm ?? 4;
  let best = { columns: 1, chars: 0, off: Infinity };
  for (let k = 1; k <= 3; k++) {
    const chars = Math.round(((w - (k - 1) * gut) / k) / (pt * PT * 0.5));
    const off = chars < 40 ? (40 - chars) * 2 : chars > 72 ? chars - 72 : Math.abs(chars - 60) / 10;
    if (off < best.off) best = { columns: k, chars, off };
  }
  return { columns: best.columns, chars: best.chars };
}

/** The rows a body of `words` needs in `span` cells, with a little to spare (print sets tighter than the estimate). */
function bodyRows(geo: Geometry, n: number, span: number, col: number, columns: number, words: number, spec: Pick<DesignSpec, "grid" | "type">): number {
  const need = Math.ceil(words * 1.08);
  for (let rows = 2; rows <= geo.rows; rows++) {
    if (bodyCapacity(boxOf(geo, n, { col, span, row: 0, rows }), columns, spec) >= need) return rows;
  }
  return geo.rows;
}

/** The rows the title takes at its full size in `span` cells, or the most a title may take. */
function titleRows(geo: Geometry, n: number, span: number, col: number, title: string, top: number, share: number): number {
  const cap = Math.max(2, Math.round(geo.rows * share));
  for (let rows = 1; rows <= cap; rows++) {
    if (titleSize(title, boxOf(geo, n, { col, span, row: 0, rows }), top) >= top) return rows;
  }
  // Not at full size within a third of the page: the size it reaches there is accepted.
  return cap;
}

function deckRows(geo: Geometry, w: number, deck: string, size: number): number {
  const lines = Math.ceil(deck.length * size * PT * 0.5 / Math.max(1, w - 4));
  return rowsFor(geo, lines * size * PT * 1.3 + 1);
}

function pullRows(geo: Geometry, w: number, text: string, size: number): number {
  const lines = Math.ceil(text.length * size * PT * 0.52 / Math.max(1, w));
  return rowsFor(geo, lines * size * PT * 1.15 + 7);
}

/** The extras a page can carry beside its body, in the order a minimal page would keep them. */
function extrasOf(page: PageCopy): Array<"pull" | "figure" | "panel"> {
  const f = page.furniture ?? [];
  return [
    ...(page.pullQuote ? ["pull" as const] : []),
    ...(f.some((x) => x.kind === "pull-number") ? ["figure" as const] : []),
    ...(f.some((x) => x.kind === "sidefact" || x.kind === "did-you-know") ? ["panel" as const] : []),
  ];
}

/** How wide a side rail is on this grid, in cells, for an extra beside the body. */
function railOf(cols: number): number {
  return cols >= 12 ? 4 : cols >= 6 ? 2 : 1;
}

/** Spans a picture may take down one side, by system: the minor and the major part of the measure. */
function sideSpans(cols: number): number[] {
  // Down to a quarter of the measure: a tall picture beside long copy needs a narrow column,
  // and with 5 of 12 the Birds kingfisher's copy did not fit and the page lost its picture.
  if (cols >= 12) return [3, 4, 5, 7];
  if (cols >= 6) return [2, 3, 4];
  if (cols === 3) return [1, 2];
  return [Math.max(1, Math.floor(cols / 2))];
}

/** The text group of a page, stacked from `row` in cells [col, col+span), its extra (if any) beside the body. */
function textGroup(
  geo: Geometry, page: PageCopy, spec: Pick<DesignSpec, "grid" | "type">,
  at: { col: number; span: number; row: number }, extra: "pull" | "figure" | "panel" | null,
  titleShare: number,
): { blocks: Raw[]; rows: number } | null {
  const scale = spec.type?.scale;
  const top = sizeOf({ kind: "title" }, scale) ?? 28;
  const out: Raw[] = [];
  let row = at.row;
  const width = (span: number) => boxOf(geo, page.n, { col: at.col, span, row: 0, rows: 1 }).w;
  if (page.title) {
    const rows = titleRows(geo, page.n, at.span, at.col, page.title, top, titleShare);
    out.push({ kind: "title", col: at.col, span: at.span, row, rows });
    row += rows;
  }
  if (page.deck) {
    const rows = deckRows(geo, width(at.span), page.deck, sizeOf({ kind: "deck" }, scale) ?? 12);
    out.push({ kind: "deck", col: at.col, span: at.span, row: row + 1, rows });
    row += rows + 1;
  }
  const words = wordsOf(page.body);
  if (!words) return { blocks: out, rows: row - at.row };
  // An extra stands in a rail beside the body, never stacked into it.
  const rail = extra && at.span > railOf(geo.cells.recto.length) ? railOf(geo.cells.recto.length) : 0;
  const bodySpan = at.span - rail;
  const { columns } = columnsFor(width(bodySpan), spec);
  const bRows = bodyRows(geo, page.n, bodySpan, at.col, columns, words, spec);
  const bodyRow = row + 2;
  out.push({ kind: "body", col: at.col, span: bodySpan, row: bodyRow, rows: bRows, columns });
  if (words > 120 && columns >= 1) out.push({ kind: "dropcap", col: at.col, span: 1, row: bodyRow, rows: Math.min(bRows, 3), lines: 3 });
  let used = bodyRow + bRows;
  if (rail && extra) {
    const rc = at.col + bodySpan, rw = width(rail);
    const text = extra === "pull" ? page.pullQuote ?? ""
      : (page.furniture ?? []).filter((f) => extra === "figure" ? f.kind === "pull-number" : f.kind === "sidefact" || f.kind === "did-you-know").map((f) => f.text ?? "").join(" ");
    const size = extra === "pull" ? sizeOf({ kind: "pull" }, scale) ?? 18 : extra === "figure" ? (sizeOf({ kind: "pull" }, scale) ?? 18) : 9;
    // A panel's notes are set by the builder at its own sizes: sized as twice the words at text size.
    const rows = extra === "panel" ? rowsFor(geo, 17 + Math.ceil(text.length * 2 * 9 * PT * 0.5 / Math.max(1, rw - 9)) * 9 * PT * 1.3) : pullRows(geo, rw, text, size);
    out.push({ kind: extra, col: rc, span: rail, row: bodyRow, rows });
    used = Math.max(used, bodyRow + rows);
  }
  return { blocks: out, rows: used - at.row };
}

/** Every arrangement of the page this grid allows, sized to its copy. */
function arrangements(page: PageCopy, spec: Pick<DesignSpec, "grid" | "type">, shows: string, aspect?: number, cut: readonly string[] = [], layers = false): Array<{ id: string; arrangement: Arrangement; raw: Raw[]; filled: boolean; extras: number }> {
  const geo = geometryOf(spec);
  const cols = geo.cells.recto.length, R = geo.rows;
  const picture = (col: number, span: number, row: number, rows: number): Raw =>
    ({ kind: "image", col, span, row, rows, bleed: true, brief: { shows, tone: "mid", route: "generate" } });
  const all = extrasOf(page);
  const choices: Array<"pull" | "figure" | "panel" | null> = [null, ...all.slice(0, 2)];
  const out: Array<{ id: string; arrangement: Arrangement; raw: Raw[]; filled: boolean; extras: number }> = [];
  const runhead = (col: number, span: number): Raw => ({ kind: "runhead", col, span, row: 0, rows: 1 });

  // The title at its full voice (up to a fifth of the depth), or compact so the picture can lead.
  for (const titleShare of [0.2, 0.12])
  for (const extra of choices) {
    const tag = (extra ? ` / ${extra}` : "") + (titleShare < 0.2 ? " / compact title" : "");
    // The picture across the head, the text below it; the picture across the foot, the text above.
    for (const where of ["head", "foot"] as const) {
      // A band meets the trim at its sides and at the head or the foot: a subject cut at the
      // top or the bottom only stands in the band that bleeds there.
      if ((cut.includes("top") && where !== "head") || (cut.includes("bottom") && where !== "foot")) continue;
      const text = textGroup(geo, page, spec, { col: 1, span: cols, row: 0 }, extra, titleShare);
      if (!text) continue;
      const free = R - text.rows - 2 - (where === "foot" ? 1 : 0);
      const most = Math.round(R * 0.62);
      for (const g of [...guidesOf(geo), null]) {
        // null: the picture takes every spare row up to the dominant's ceiling.
        const pRows = g === null ? Math.min(free, most) : Math.round(R * g);
        // Long copy narrows the picture to a band (down to 15 % of the depth) before it loses it.
        if (pRows < Math.round(R * 0.15) || pRows > free) continue;
        // No wider than the renderer paints well: a thinner band is a strip of nothing.
        if (PAGE_W / (pRows * geo.baseline + geo.top) > MAX_ASPECT) continue;
        const filled = g === null && free <= most;
        const raw: Raw[] = [];
        if (where === "head") {
          raw.push(picture(1, cols, 0, pRows));
          const shift = pRows + 2;
          raw.push(...text.blocks.map((b) => ({ ...b, row: b.row + shift })));
        } else {
          // The text sits down on the picture; what is spare is one zone at the head, under the runhead.
          const start = R - pRows - 2 - text.rows;
          raw.push(runhead(1, cols));
          raw.push(...text.blocks.map((b) => ({ ...b, row: b.row + start })));
          raw.push(picture(1, cols, R - pRows, pRows));
        }
        out.push({ id: `${where} ${g === null ? "fill" : g.toFixed(3)}${tag}`, arrangement: where, raw, filled, extras: extra ? 1 : 0 });
      }
    }
    // The picture down one side at full depth, the text in the other cells.
    for (const span of sideSpans(cols)) {
      if (cols - span < 1) continue;
      for (const side of ["left", "right"] as const) {
        // Down one side the picture meets the trim on that side only, and at the foot.
        if (cut.includes(side === "left" ? "right" : "left") || cut.includes("top")) continue;
        const pCol = side === "left" ? 1 : cols - span + 1, tCol = side === "left" ? span + 1 : 1;
        const text = textGroup(geo, page, spec, { col: tCol, span: cols - span, row: 2 }, extra, titleShare);
        if (!text || text.rows + 2 > R) continue;
        // No taller than the renderer paints well (1:2): a full-depth strip was painted at 1:2
        // and shrunk into it, leaving the bird small in an empty column (Birds p14).
        const w = boxOf(geo, page.n, { col: pCol, span, row: 0, rows: R, bleed: true }).w;
        // A picture of known shape gets a frame of that shape, standing on the foot of the
        // page (a subject cut by its picture's lower edge is then cut by the trim).
        if (aspect) {
          // In a layered look the picture stands in an arch: room for its dome over the subject.
          const tall = w / aspect + (layers ? w * 0.35 : 0);
          const rows = Math.max(Math.round(R * 0.3), Math.min(R, Math.round((tall - (PAGE_H - geo.top - R * geo.baseline)) / geo.baseline)));
          // The picture stands on the foot, so the head of the page is free: the runhead takes
          // the whole measure, where the text cells were too narrow for its words (Birds p14).
          const raw: Raw[] = [rows < R - 1 ? runhead(1, cols) : runhead(tCol, cols - span), picture(pCol, span, R - rows, rows), ...text.blocks];
          out.push({ id: `side ${side} ${span}/${cols} foot${tag}`, arrangement: "side", raw, filled: false, extras: extra ? 1 : 0 });
          continue;
        }
        const pRows = Math.min(R, Math.floor((w / MIN_ASPECT - geo.top) / geo.baseline));
        const raw: Raw[] = [runhead(tCol, cols - span), picture(pCol, span, 0, pRows), ...text.blocks];
        out.push({ id: `side ${side} ${span}/${cols}${tag}`, arrangement: "side", raw, filled: false, extras: extra ? 1 : 0 });
      }
    }
    // No room for a picture at all: the page is led by its type, the white one zone at the foot.
    // Kept even when the copy runs past the foot, cut to the page: the checks then say how
    // much is over, rather than the page going unplanned.
    const text = textGroup(geo, page, spec, { col: 1, span: cols, row: 2 }, extra, titleShare);
    if (text) {
      const fit = text.blocks.filter((b) => b.row < R).map((b) => ({ ...b, rows: Math.min(b.rows, R - b.row) }));
      out.push({ id: `type${tag}`, arrangement: "type", raw: [runhead(1, cols), ...fit], filled: false, extras: extra ? 1 : 0 });
    }
  }
  return out;
}

/**
 * Score a checked candidate by the page score's own numbers: one dominant at
 * 40-60 % of the page, the title at its full size, the body at a readable
 * measure, nothing the checks refuse, and not the arrangement of the page
 * before it. The numbers are the ones the rendered page is judged by; this is
 * only their estimate from the plan.
 */
function rank(c: ComposedPage, spec: Pick<DesignSpec, "grid" | "type">, page: PageCopy, arrangement: Arrangement, extras: number, previous?: Arrangement, setting?: PageSetting, aspect?: number): { score: number; dominance: number; why: string[] } {
  const why: string[] = [];
  let score = 100;
  if (c.problems.length) { score -= 40 * c.problems.length; why.push(...c.problems); }
  const pic = c.blocks.find((b) => b.kind === "image");
  const dominance = pic ? (pic.box.w * pic.box.h) / (PAGE_W * PAGE_H) : 0;
  if (dominance < 0.4) { score -= (0.4 - dominance) * 120; why.push(`the picture holds ${Math.round(dominance * 100)} % of the page, under 40`); }
  if (dominance > 0.6) { score -= (dominance - 0.6) * 120; why.push(`the picture holds ${Math.round(dominance * 100)} % of the page, over 60`); }
  const top = sizeOf({ kind: "title" }, spec.type?.scale) ?? 28;
  const title = c.blocks.find((b) => b.kind === "title") as { size?: number } | undefined;
  if (title?.size && title.size < top) { score -= (1 - title.size / top) * 30; why.push(`the title reaches ${title.size} of ${top} pt`); }
  const body = c.blocks.find((b) => b.kind === "body");
  if (body) {
    const k = body.columns ?? 1, pt = sizeOf({ kind: "body" }, spec.type?.scale) ?? 9.5;
    const chars = Math.round(((body.box.w - (k - 1) * (spec.grid?.gutterMm ?? 4)) / k) / (pt * PT * 0.5));
    if (chars < 40 || chars > 72) { score -= 8; why.push(`the body reads at about ${chars} characters a line`); }
  }
  // The chosen look decides what an extra is worth: in a layered look a coloured box is part
  // of the look, in a look that limits extras each one must earn its place, and with no look
  // chosen an extra is neither.
  score += setting?.layers ? extras * 4 : setting?.extras != null ? -extras * 4 : 0;
  if (previous && previous === arrangement) { score -= 12; why.push(`the page before is also arranged ${arrangement}`); }
  // A frame of another shape than its picture leaves the subject small in a strip of nothing.
  if (aspect && pic) {
    const off = Math.abs(Math.log((pic.box.w / pic.box.h) / aspect));
    if (off > 0.2) { score -= off * 30; why.push(`the frame is ${(pic.box.w / pic.box.h).toFixed(2)}:1 for a ${aspect.toFixed(2)}:1 picture`); }
  }
  void page;
  return { score: Math.round(score * 10) / 10, dominance: Math.round(dominance * 1000) / 1000, why };
}

/** Every candidate arrangement of one page, best first. */
export function planPage(page: PageCopy, spec: Pick<DesignSpec, "grid" | "type">, opts: PlanOptions = {}): PlanCandidate[] {
  const shows = opts.shows || page.title || "the subject of the page";
  return arrangements(page, spec, shows, opts.aspect, opts.cut ?? [], !!opts.setting?.layers).map((a) => {
    const composed = checkComposition({ idea: `plan: ${a.id}`, blocks: a.raw }, page, spec, opts.setting);
    const r = rank(composed, spec, page, a.arrangement, a.extras, opts.previous, opts.setting, opts.aspect);
    return { id: a.id, arrangement: a.arrangement, composed, score: r.score, dominance: r.dominance, extras: a.extras, filled: a.filled, why: r.why, ...(opts.cut?.length ? { cut: opts.cut } : {}) };
  }).sort((x, y) => y.score - x.score);
}

/** The slot a picture stands in, in the treatment table's words, from where the plan put it. */
export function imageSlotOf(c: PlanCandidate): PageLayout["imageSlot"] {
  const pic = c.composed.blocks.find((b) => b.kind === "image");
  if (!pic) return "none";
  if (c.arrangement === "side") return pic.box.x < 1 ? "left" : "right";
  return c.arrangement === "head" ? "top" : "bottom";
}

/** The page's layout from a planned candidate; a layered look draws its shapes with it. */
export function layoutOfPlan(c: PlanCandidate, spec: Pick<DesignSpec, "grid" | "type">, n: number, before?: PageLayout, setting?: PageSetting): PageLayout {
  const out = { ...layoutOf(c.composed, spec, n, before), imageSlot: imageSlotOf(c), plan: c.id } as PageLayout;
  return setting?.layers ? { ...out, shapes: layerShapes(c.composed.blocks, c.cut) } : out;
}

type Box = { x: number; y: number; w: number; h: number };

/** An arch: a rectangle under a half-circle, as points. */
function arch(x: number, top: number, w: number, bottom: number): Array<[number, number]> {
  const r = w / 2, cy = top + r, pts: Array<[number, number]> = [[x, bottom]];
  for (let i = 0; i <= 16; i++) { const a = Math.PI - (i * Math.PI) / 16; pts.push([x + r + r * Math.cos(a), cy - r * Math.sin(a)]); }
  pts.push([x + w, bottom]);
  return pts;
}

const shapeOf = (s: Partial<Shape> & Pick<Shape, "s" | "x" | "y" | "w" | "h">): Shape =>
  ({ opacity: 1, weight: 1, rot: 0, r: 0, n: 5, layer: "back", ...s } as Shape);

/**
 * The layered look's drawn layer, from where the plan put things: no model call.
 *
 * What the look asks for (a cut-out picture on a coloured shape, type on a
 * coloured ground, one strong band of colour) is placed by the frames' own
 * geometry, in the section's colour roles, so every page of the look is built
 * the same way and in its section's colours:
 * - a picture is held in a shape that echoes its frame and spans it: an arch in a
 *   tall frame (a border of the section's colour round an arch of the picture's own
 *   ground), the frame itself in a wide one, on a sill of the section's colour;
 * - the deck sits on a block of the section's light colour, on its own column
 *   edges, clear of the title and the body;
 * - a band of the accent runs across the foot, so the page has a floor.
 * Nothing is drawn under running text.
 */
export function layerShapes(blocks: ReadonlyArray<{ kind: string; box: Box }>, cut: readonly string[] = []): Shape[] {
  const out: Shape[] = [];
  const text = blocks.filter((b) => b.kind !== "image" && b.kind !== "drawn" && b.kind !== "rule").map((b) => ({ kind: b.kind, box: b.box }));
  for (const pic of blocks.filter((b) => b.kind === "image")) {
    const B = pic.box;
    if (B.w / B.h < 0.9) {
      // A tall frame is an arch: an outer one in the section's colour, and inside it, a
      // border's width in, the arch that holds the picture, filled with the picture's own
      // ground - a painting in a niche, the border in contrast, the plate's edge gone.
      // The frame's own width, so the arch shares the column edge and bleeds where it does.
      const top = B.y + Math.max(B.h * 0.06, 8), bottom = Math.min(PAGE_H, B.y + B.h), inset = Math.min(4, B.w * 0.05);
      out.push(shapeOf({ s: "poly", x: B.x, y: top, w: B.w, h: bottom - top, pts: arch(B.x, top, B.w, bottom), fill: "second" }));
      // On a side where the picture cuts its subject the holding arch runs to the trim, so the
      // cut is the page's edge, not a line inside the border.
      const toLeft = cut.includes("left") && B.x < 1, toRight = cut.includes("right") && B.x + B.w > PAGE_W - 1;
      const ix = toLeft ? B.x : B.x + inset, iw = (toRight ? B.x + B.w : B.x + B.w - inset) - ix, it = top + inset;
      out.push(shapeOf({ s: "poly", x: ix, y: it, w: iw, h: bottom - it, pts: arch(ix, it, iw, bottom), fill: "ground", hold: true }));
    } else {
      // A wide frame holds its picture whole, in the picture's own ground, and stands on a
      // sill of the section's colour with a row of dots: the plate's lower edge becomes a floor.
      out.push(shapeOf({ s: "rect", x: B.x, y: B.y, w: B.w, h: B.h, fill: "ground", hold: true }));
      const below = Math.min(PAGE_H, ...text.filter((t) => t.box.y >= B.y + B.h - 0.5).map((t) => t.box.y));
      const sill = Math.min(5, below - (B.y + B.h) - 1);
      if (sill >= 2) {
        out.push(shapeOf({ s: "rect", x: B.x, y: B.y + B.h, w: B.w, h: sill, fill: "second" }));
        out.push(shapeOf({ s: "dots", x: B.x, y: B.y + B.h + sill * 0.3, w: B.w, h: sill * 0.4, n: Math.max(8, Math.round(B.w / 5)), r: sill * 0.15, fill: "accent", layer: "front" }));
      }
    }
  }
  const deck = blocks.find((b) => b.kind === "deck");
  if (deck) {
    const D = deck.box;
    const above = Math.max(0, ...text.filter((t) => t.kind !== "deck" && t.box.y + t.box.h <= D.y + 0.5 && t.box.x < D.x + D.w && D.x < t.box.x + t.box.w).map((t) => t.box.y + t.box.h));
    const below = Math.min(PAGE_H, ...text.filter((t) => t.kind !== "deck" && t.box.y >= D.y + D.h - 0.5 && t.box.x < D.x + D.w && D.x < t.box.x + t.box.w).map((t) => t.box.y));
    const y0 = Math.max(above + 1, D.y - 3), y1 = Math.min(below - 1, D.y + D.h + 3);
    // On the deck's own column edges, so the block shares them with the title and the body.
    if (y1 - y0 > 4) out.push(shapeOf({ s: "rect", x: D.x, y: y0, w: D.w, h: y1 - y0, fill: "third" }));
  }
  const runningLow = text.filter((t) => ["body", "dropcap"].includes(t.kind)).some((t) => t.box.y + t.box.h > PAGE_H - 9);
  if (!runningLow) out.push(shapeOf({ s: "rect", x: 0, y: PAGE_H - 7, w: PAGE_W, h: 7, fill: "accent" }));
  return out;
}

/**
 * Re-rank for what a proof was found to lack. The plan's numbers are an
 * estimate; the eye and the pixels are the measurement. A fault about
 * competing elements asks for fewer extras and a bigger picture, a fault
 * about empty space for the arrangements whose picture takes the slack, a
 * fault about the reading path for the picture out of the text's way.
 */
export function rerank(cands: readonly PlanCandidate[], faults: readonly string[]): PlanCandidate[] {
  const said = faults.join(" ").toLowerCase();
  const crowded = /domina|compet|clutter|too many|notice board|busy|hierarch/.test(said);
  const empty = /empty|hole|gap|dead space|void|band/.test(said);
  const path = /reading path|order|above the title|flow/.test(said);
  return [...cands].map((c) => {
    let bonus = 0;
    if (crowded) bonus += (c.extras ? -10 : 6) + (c.dominance >= 0.45 ? 4 : 0);
    if (empty) bonus += c.filled || c.arrangement === "side" ? 8 : -4;
    if (path) bonus += c.arrangement === "head" || c.arrangement === "side" ? 4 : -4;
    return { ...c, score: c.score + bonus };
  }).sort((x, y) => y.score - x.score);
}
