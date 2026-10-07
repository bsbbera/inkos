/*
 * The page as blocks (Phase 5, analysis/25-pages-from-the-spec.md).
 *
 * A block is one thing on a page — a picture, a figure, a run of body — and a
 * slot is where it goes in grid arithmetic: columns across, baselines down.
 * The design stage writes them, `onePageScript` (cli-shim/affinity.mjs) builds
 * them, and the score reads them back. A slot written as prose
 * ("col-10-12-upper") is a legacy block: kept, never placed, and the builder
 * falls back to the page type's own arrangement.
 */
import type { DesignSpec, PageLayout } from "./publication-design.js";
import { contrast } from "./publication-design.js";

export const BLOCK_KINDS = [
  "image", "drawn", "figure", "title", "deck", "kicker", "body", "dropcap",
  "pull", "panel", "runhead", "wordmark", "rule", "folio",
] as const;
export type BlockKind = typeof BLOCK_KINDS[number];

/** Columns from 1, baselines from the head of the live area. */
export interface BlockSlot {
  readonly col: number;
  readonly span: number;
  readonly row: number;
  readonly rows: number;
  /** Run past the margin to the trim on every side the slot touches. */
  readonly bleed?: boolean;
}

export type BlockColour = "ink" | "paper" | "accent" | "field";

export interface PageBlock {
  readonly kind: string;
  readonly slot: string | BlockSlot;
  /** A deliberate transgression; the page must declare it in `breaks`. */
  readonly crosses?: "image-edge";
  readonly color?: BlockColour;
  /** Point size, when the scale's default for this kind is not wanted. */
  readonly size?: number;
  /** Body: how many text columns the slot is cut into. */
  readonly columns?: number;
  /** Drop cap: how many body lines it stands in. */
  readonly lines?: number;
  /** Drawn art: what is drawn, and the seed that makes a re-layout draw it again. */
  readonly drawn?: "contours" | "rain" | "contours+rain";
  readonly seed?: number;
  /** Words the block carries when the page content does not (a kicker, a panel's head, a pin). */
  readonly text?: string;
}

export interface PlacedBlock extends PageBlock { readonly kind: BlockKind; readonly slot: BlockSlot }

/** The block grid, from the spec: symmetric margins, columns, baselines. */
export interface BlockGrid {
  readonly columns: number;
  readonly gutter: number;
  readonly margin: number;
  readonly baseline: number;
  /** Baselines from the head of the live area to its foot (above the folio). */
  readonly rows: number;
}

export function gridOf(spec: DesignSpec | null | undefined): BlockGrid {
  const g = spec?.grid;
  const pos = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  const columns = Math.round(pos(g?.columns, 12));
  const gutter = pos(g?.gutterMm, 4);
  const margin = pos(g?.marginMm, 14);
  const baseline = pos(g?.baselineMm, 4.7625);
  // The folio sits below the foot: 297 - margin - 10.
  const rows = Math.floor((297 - 2 * margin - 10) / baseline);
  return { columns, gutter, margin, baseline, rows };
}

const TEXT: ReadonlySet<string> = new Set(["figure", "title", "deck", "kicker", "body", "dropcap", "pull", "panel", "runhead", "wordmark", "folio"]);
const PICTURE: ReadonlySet<string> = new Set(["image", "drawn"]);

const isSlot = (s: unknown): s is BlockSlot => {
  const o = s as Record<string, unknown> | null;
  return !!o && typeof o === "object" && ["col", "span", "row", "rows"].every((k) => Number.isInteger(o[k]));
};

/** The blocks of a page the builder can place; legacy prose slots are not among them. */
export function placedBlocks(layout: PageLayout | null | undefined): PlacedBlock[] {
  return (layout?.blocks ?? []).filter((b): b is PlacedBlock =>
    (BLOCK_KINDS as readonly string[]).includes(b.kind) && isSlot(b.slot));
}

const overlaps = (a: BlockSlot, b: BlockSlot) =>
  a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.rows && b.row < a.row + a.rows;

/**
 * Keep the blocks a page can be built from; drop the rest and say why.
 *
 * Not a refusal: the design stage throws on a spec problem, and one badly
 * placed block must not cost a whole issue's design. A dropped block leaves
 * the page to its type's default arrangement if nothing placeable is left.
 */
export function cleanBlocks(spec: DesignSpec): { spec: DesignSpec; dropped: string[] } {
  const grid = gridOf(spec);
  const dropped: string[] = [];
  const pages: Record<string, PageLayout> = {};
  for (const [key, layout] of Object.entries(spec.pages ?? {})) {
    const kept: PageBlock[] = [];
    for (const b of layout.blocks ?? []) {
      if (!isSlot(b.slot)) { kept.push(b); continue; }          // legacy: kept, not placed
      const why = !(BLOCK_KINDS as readonly string[]).includes(b.kind) ? `"${b.kind}" is not a block the builder knows`
        : b.slot.col < 1 || b.slot.span < 1 || b.slot.col + b.slot.span - 1 > grid.columns ? `its columns run off the ${grid.columns}-column grid`
        : b.slot.row < 0 || b.slot.rows < 1 || b.slot.row + b.slot.rows > grid.rows ? `its rows run off the ${grid.rows}-line grid`
        : b.kind === "body" && kept.some((k) => k.kind === "body") ? "a page has one body"
        : b.kind !== "dropcap" && TEXT.has(b.kind)
          && kept.some((k) => TEXT.has(k.kind) && k.kind !== "dropcap" && isSlot(k.slot) && overlaps(k.slot, b.slot as BlockSlot))
          ? "it sits on another block of type"
        : null;
      if (why) dropped.push(`page ${key}: dropped ${b.kind} - ${why}`);
      else kept.push(b);
    }
    pages[key] = { ...layout, blocks: kept };
  }
  return { spec: { ...spec, pages }, dropped };
}

/** The point size each kind is set in, from the spec's scale unless the block names one. */
export function sizeOf(block: Pick<PageBlock, "kind" | "size">, scale: ReadonlyArray<number> | undefined): number | null {
  if (block.size && block.size > 0) return block.size;
  const s = [...(scale ?? [])].filter((n) => n > 0).sort((a, b) => b - a);
  const body = Math.min(11, Math.max(8.5, s[s.length - 1] ?? 9.5));
  const top = s[0] ?? 28, mid = s[1] ?? top / 2;
  switch (block.kind) {
    case "title": return top;
    case "pull": return mid;
    case "deck": return Math.max(body * 1.2, Math.min(mid * 0.6, body * 1.6));
    case "body": return body;
    case "kicker": case "runhead": case "folio": return 7.5;
    // Fitted to their slot by the builder.
    default: return null;
  }
}

export interface BlockNote { readonly dim: "G" | "H" | "C" | "T"; readonly penalty: number; readonly says: string }

/**
 * What a page's blocks break, read from the spec alone.
 *
 * Scale steps: two kinds a page sets closer than `minScaleStep` (1.2x) read as
 * one level, and the hierarchy blurs. Contrast: every block of type against
 * the ground it actually sits on — the picture's field when it is over one.
 * Transgressions: a block that crosses a picture's edge is a break, and a
 * break is declared or it is a mistake.
 */
export function blockRules(
  spec: DesignSpec,
  n: number,
  colours: { readonly paper: string; readonly ink: string; readonly accent: string; readonly field?: string },
  math: { readonly minScaleStep?: number } = {},
): BlockNote[] {
  const layout = spec.pages?.[String(n)];
  const blocks = placedBlocks(layout);
  const notes: BlockNote[] = [];
  if (!blocks.length) return notes;

  const step = math.minScaleStep ?? 1.2;
  const sizes = [...new Set(blocks.map((b) => sizeOf(b, spec.type?.scale)).filter((s): s is number => s !== null))].sort((a, b) => b - a);
  for (let i = 1; i < sizes.length; i++) {
    if (sizes[i - 1]! / sizes[i]! < step) notes.push({ dim: "H", penalty: 10, says: `type at ${sizes[i - 1]}pt and ${sizes[i]}pt are under ${step}x apart: one level, not two` });
  }

  const pictures = blocks.filter((b) => PICTURE.has(b.kind));
  const field = colours.field || colours.ink;
  const hex: Record<BlockColour, string> = { ink: colours.ink, paper: colours.paper, accent: colours.accent, field };
  for (const b of blocks) {
    if (!TEXT.has(b.kind) || b.kind === "panel") continue;
    const over = pictures.some((p) => overlaps(p.slot, b.slot));
    const ground = over ? field : colours.paper;
    const colour = hex[b.color ?? (b.kind === "figure" || b.kind === "dropcap" ? "accent" : over ? "paper" : "ink")];
    const floor = ["body", "deck"].includes(b.kind) ? 7 : ["kicker", "runhead", "folio"].includes(b.kind) ? 4.5 : 3;
    const ratio = colour && ground ? contrast(colour, ground) : 0;
    if (ratio && ratio < floor) notes.push({ dim: "C", penalty: 15, says: `the ${b.kind} is ${ratio.toFixed(1)}:1 on its ground, under ${floor}:1` });
  }

  for (const b of blocks.filter((x) => x.crosses)) {
    if (!(layout?.breaks ?? []).length) notes.push({ dim: "G", penalty: 20, says: `the ${b.kind} crosses a picture's edge and the page declares no break` });
  }
  return notes;
}
