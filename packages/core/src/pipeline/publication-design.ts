/**
 * The design decision: one spec, two renderers.
 *
 * There was no design stage. `issue.design` was declared, checked by `build`,
 * and never written by anything — so a PDF could not succeed for any issue, and
 * ComfyUI was prompted by whatever the page writer had improvised while it was
 * still guessing at the copy.
 *
 * This stage runs **after** the copy is finished and after the editor's notes
 * have landed on it, because that is when the real headline lengths, the real
 * block counts and the real image slots exist. What it emits is the single
 * source both renderers read: image direction becomes ComfyUI's prompt suffix,
 * layout becomes Affinity's instructions.
 *
 * Generic to every publication type. A cookbook, a report and a magazine all
 * need to know what colour the page is; only the law they are checked against
 * differs, and that comes from the definition.
 */

import type { PageBlock } from "./page-blocks.js";
import type { Shape } from "./page-art.js";

/** Colour, type and grid for the whole publication. */
export interface DesignSpec {
  /** Who lays the pages out: the arithmetic planner (page-plan.ts, the default) or the model's composer. */
  readonly composer?: "plan" | "model";
  readonly palette: {
    readonly paper: string;
    readonly ink: string;
    readonly accent: string;
    /** Optional per-section accents, keyed by section number. */
    readonly sections?: Readonly<Record<string, string>>;
  };
  readonly type: {
    readonly display: string;
    readonly text: string;
    /** Point sizes, largest first, that the whole publication is set from. */
    readonly scale: readonly number[];
  };
  readonly grid: {
    /** The composition system (house.ts GRID_SYSTEMS); columns when absent. */
    readonly system?: "columns" | "modular" | "thirds" | "golden" | "canon";
    readonly columns: number;
    readonly gutterMm: number;
    readonly marginMm: number;
    readonly baselineMm: number;
  };
  /** How every image in this publication should look, before the page's own brief. */
  readonly imageDirection: string;
  /** Per page, keyed by page number as a string. */
  readonly pages: Readonly<Record<string, PageLayout>>;
}

export interface PageLayout {
  /** Named arrangement — full-bleed, two-column, panel-left, and so on. */
  readonly layout: string;
  /** Where the image sits, or none if the page carries no image. */
  readonly imageSlot: "full-bleed" | "top" | "bottom" | "left" | "right" | "inset" | "none";
  /**
   * Where each block goes, in the order they should be placed. A grid slot
   * (`{col, span, row, rows}`) is built; a prose slot is a legacy block the
   * builder leaves to the page type's own arrangement (page-blocks.ts).
   */
  readonly blocks?: readonly PageBlock[];
  readonly note?: string;
  /** Rule-breaking this page does on purpose, one sentence each; rationed per section (08 §5 rule 7). */
  readonly breaks?: readonly string[];
  /** An arrangement the page score chose when the page failed by W or H (page-score-run.ts). */
  readonly variant?: PageVariant;
  /** The layout pattern the page wears (layout-engine.ts); its blocks are computed from it. */
  readonly pattern?: string;
  /** The arrangement the arithmetic planner chose (page-plan.ts), e.g. "head 0.618 / pull". */
  readonly plan?: string;
  readonly mirror?: boolean;
  /** The fallback vector generator, drawn only when the page has no shapes. */
  readonly art?: string;
  /** The page's art, composed by the model from primitives (page-art.ts), in page mm. */
  readonly shapes?: readonly Shape[];
  /** One line: what the art shows. */
  readonly artIdea?: string;
  readonly seed?: number;
  readonly kicker?: string;
  readonly panelTitle?: string;
  /** The page's vertical grid lines in mm, for the score's alignment check. */
  readonly edges?: readonly number[];
  /** The model's reading of the page's copy (plan 27, Phase 13): how it reads, what it shows. */
  readonly reading?: string;
  /** The model's own composition of the page (composition.ts), and what the checks still found wrong. */
  readonly composed?: { readonly idea: string; readonly problems: readonly string[] };
  /** What Affinity measured on the laid page at the last build: overset, overlapping frames. */
  readonly measured?: readonly string[];
}

/**
 * What is still wrong on the composed pages, as gate blockers. The composer
 * gets three tries a page; a page that still breaks a rule after them used to
 * be kept with a note, and the gate never read the note.
 */
export function pageBlockers(
  spec: Pick<DesignSpec, "pages"> | null | undefined,
  { measured = true }: { readonly measured?: boolean } = {},
): string[] {
  return Object.entries(spec?.pages ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .flatMap(([n, l]) => [...(l.composed?.problems ?? []), ...(measured ? l.measured ?? [] : [])].map((x) => `p${n}: ${x}`));
}

/** What `onePageScript` (cli-shim/affinity.mjs) can do differently on an editorial page. */
export type PageVariant = "small-band" | "large-band" | "pull" | "big-deck";

/**
 * Check a spec before anything consumes it.
 *
 * A spec that is wrong here becomes a wrong Affinity document and a wasted
 * GPU hour, and both failures point at the wrong place. The checks are the
 * cheap deterministic ones — the taste is the model's job, the arithmetic is
 * not.
 */
export function checkSpec(
  spec: DesignSpec | null | undefined,
  pageNumbers: readonly number[],
): string[] {
  const bad: string[] = [];
  if (!spec) return ["no design spec"];

  for (const [name, value] of Object.entries(spec.palette ?? {})) {
    if (name === "sections") continue;
    if (!/^#[0-9a-f]{6}$/i.test(String(value))) {
      bad.push(`palette.${name} is "${value}" — needs a #rrggbb hex`);
    }
  }
  if (!spec.type?.display) bad.push("type.display is missing");
  if (!spec.type?.text) bad.push("type.text is missing");
  if (!Array.isArray(spec.type?.scale) || spec.type.scale.length < 3) {
    bad.push("type.scale needs at least three sizes");
  } else if (spec.type.scale.some((n) => !(n > 0))) {
    bad.push("type.scale holds a size that is not a positive number");
  }

  const grid = spec.grid;
  if (!grid || !(grid.columns >= 1)) bad.push("grid.columns must be at least 1");
  if (!grid || !(grid.marginMm > 0)) bad.push("grid.marginMm must be positive");
  if (!grid || !(grid.baselineMm > 0)) bad.push("grid.baselineMm must be positive");

  if (!String(spec.imageDirection ?? "").trim()) {
    bad.push("imageDirection is empty — every image would be directed by nothing");
  }

  // Every page needs a layout, and a layout for a page that does not exist is
  // a sign the spec was written against a different draft.
  const laid = new Set(Object.keys(spec.pages ?? {}));
  for (const n of pageNumbers) {
    if (!laid.has(String(n))) bad.push(`page ${n} has no layout`);
  }
  for (const key of laid) {
    if (!pageNumbers.includes(Number(key))) bad.push(`spec lays out page ${key}, which is not in the issue`);
  }
  return bad;
}

/** Contrast of two hex colours, for the print floor the style law already sets. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return 0;
    const channel = (v: string) => {
      const s = parseInt(v, 16) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(m[1]!) + 0.7152 * channel(m[2]!) + 0.0722 * channel(m[3]!);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * The prompt that produces a spec.
 *
 * Definitions may carry their own; this is what a type that says nothing gets,
 * so adding a publication type does not mean writing a design brief from
 * scratch before it can render anything.
 */
/** How a page is described as blocks: the design prompt and a one-page redesign both say it. */
export const BLOCK_GUIDE = `PAGE BLOCKS. A page is built from its blocks, placed on the grid you chose.
Kinds, spelled exactly: image, drawn, figure, title, deck, kicker, body,
dropcap, pull, panel, runhead, wordmark, rule, folio.
- slot: {"col": 1-based column, "span": columns, "row": baselines from the head
  of the live area, "rows": baselines tall}. Add "bleed": true to run a picture
  to the trim on the sides it touches. The live area is
  floor((297 - 2 x marginMm - 10) / baselineMm) baselines deep.
- image: the page's picture. drawn: art drawn as vectors instead of a picture
  ("drawn": "contours" | "rain" | "contours+rain", "seed": a number, "text": a
  place to pin). figure: the page's pull-number, oversized. panel: the page's
  sidefacts as label/value rows on the field colour ("text": its heading).
  dropcap: "lines": how many body lines it stands in. wordmark: the magazine's
  name, fitted to its slot. runhead: the line at the head of the page.
- "color": "ink" | "paper" | "accent" | "field", when the default is wrong.
- One dominant per page (a picture, a drawn field or a figure), holding 40-60 %
  of its weight. Type sizes on a page at least 1.2x apart. Blocks of type never
  sit on each other. A block that crosses a picture's edge sets
  "crosses": "image-edge" and the page declares that break.
- Only a page whose blocks all have grid slots is built from them; otherwise
  it gets its type's standard arrangement.`;

/**
 * How a page is laid out by pattern (layout-engine.ts, Phase 8): the art
 * director chooses, the engine computes. Offered for the systems allowed.
 */
export function patternGuide(systems: readonly string[], catalogue: string): string {
  return `PAGE LAYOUT. Choose a composition system for the issue (grid.system, one of: ${systems.join(", ")})
and, for every page, a PATTERN of that system. You choose; the engine computes every
position, fits the type and picks a roomier pattern if the copy does not fit.
- "pattern": a pattern id below, of the system you chose, suited to what the page is.
- "mirror": true to flip it left-right (alternate pages read better mirrored).
- "kicker": 1-4 words over the title. "panelTitle": 1-3 words heading the facts panel.
Vary the patterns: neighbouring pages never wear the same one.

PATTERNS:
${catalogue}`;
}

export const DEFAULT_DESIGN_PROMPT = `
You are art-directing "{{title}}" — {{extent}} pages about {{subject}}.
THESIS: {{thesis}}
{{notes}}
{{referenceNote}}

The copy is finished and approved. Below is each page as written: its title,
type, length, the blocks it carries and how it opens. Read it before deciding
anything: the design comes from this writing.

{{pageDigest}}

First, READ. For every page write "reading": what it is and how it reads (its
pace and register, in your words), what a reader should see first, what in it
could be pictured, and what is better as a picture, as drawn vector art, or as
type alone.

Then write the DIRECTION for this issue, in your own words, from those readings:
- composition: how pages are built (how full or empty, flat or deep, centred or
  not, how type meets pictures, what reaches the edges)
- type: how big, how tight, how titles behave
- colour: the logic of colour across the issue and its sections
- art: what the pictures and the drawn art are like, and how much of each
- rhythm: how one page follows another across the issue
Nothing is preset. It is decided from this writing, not from any other issue.
{{recentBlock}}
Then decide, for the whole publication:
- a palette for the issue as a whole: paper, ink, accent (each section then
  writes its own language, below). Ink on paper 7:1 or better for print.
- two typefaces: one for display, one for text.
- a type scale of at least three sizes, in points, largest first.
- a grid: system, columns, gutter, margin, baseline, all in millimetres. Systems:
  {{gridSystems}}.
- image direction: one paragraph describing how EVERY generated picture in this
  publication looks. It is prefixed to each picture's own brief, so it must not
  describe any single picture.

Each page is then composed on the grid by you, page by page, from its reading
and the direction: you do not place frames here.
{{fontBlock}}
{{sectionBlock}}
Also decide the FIXED FURNITURE — the few things that never change from
section to section, and are what make several different-looking sections one
object: the folio (where the page number sits and how it is set), the trim,
the grid in one line, and the divider that marks a section break.

Return ONLY JSON:
{
  "direction": {"composition": "...", "type": "...", "colour": "...", "art": "...", "rhythm": "..."},
  "palette": {"paper": "#rrggbb", "ink": "#rrggbb", "accent": "#rrggbb"},
  "fixed": {"folio": "...", "trim": "...", "grid": "why this system, one sentence", "divider": "..."},
  "type": {"display": "...", "text": "...", "scale": [48, 24, 10]},
  "grid": {"system": "...", "columns": 12, "gutterMm": 5, "marginMm": 15, "baselineMm": 4.5},
  "imageDirection": "one paragraph, no single subject",
  "pages": {"1": {"reading": "..."}},
  "sections": [{"n": 1, "register": "...", "technique": "...", "idiom": "...", "language": {...}, "imagePrompt": "under 60 words, no single subject", "negative": "..."}]
}
"sections" holds one world per section listed above, and is [] when none are.
`.trim();

/**
 * Design precedent the editor has collected.
 *
 * Every `.md` under `<project>/design-references/` is read and handed to the
 * design stage as **precedent**, on exactly the terms the voice skill is handed
 * to the writer: inspiration, not law. A reference set that happens to contain
 * no sidebars is not an argument against sidebars, so nothing here is phrased
 * as a rule and nothing is forbidden by it.
 *
 * Never throws. A missing folder is the normal case for a fresh project.
 */
export async function designReferences(
  projectRoot: string,
  maxChars = 9000,
): Promise<string> {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = `${projectRoot}/design-references`;
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".md")).sort();
  } catch { return ""; }
  if (!names.length) return "";

  const parts: string[] = [];
  for (const name of names) {
    try { parts.push(`--- ${name} ---\n${await readFile(`${dir}/${name}`, "utf-8")}`); }
    catch { /* one unreadable reference does not cost the others */ }
  }
  const body = parts.join("\n\n").slice(0, maxChars).trim();
  if (!body) return "";

  return [
    "DESIGN PRECEDENT THE EDITOR HAS COLLECTED.",
    "Read it the way an art director reads a mood board: it shows what has",
    "worked, and how this editor sees a page. It is not a template, not a rule",
    "set, and nothing in it is forbidden by omission — a reference that carries",
    "no sidebars is not an argument against sidebars. Take the thinking, then",
    "decide this publication on its own terms.",
    "",
    body,
  ].join("\n");
}
