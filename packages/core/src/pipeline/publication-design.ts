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

/** Colour, type and grid for the whole publication. */
export interface DesignSpec {
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
export const DEFAULT_DESIGN_PROMPT = `
You are art-directing "{{title}}" — {{extent}} pages about {{subject}}.
THESIS: {{thesis}}
{{notes}}
{{referenceNote}}

The copy is finished and approved. Below is what is actually on each page:
its real title, its type, its length, and the blocks it carries. Direct the
design from what is there, not from what a page of this type usually holds.

{{pageDigest}}

Decide, for the whole publication:
- a palette: paper, ink, one accent. Ink on paper must be legible in print,
  which is a harder floor than a screen — aim well past 7:1.
- two typefaces: one for display, one for text, both widely available.
- a type scale of at least three sizes, in points, largest first.
- a grid: columns, gutter, margin, baseline, all in millimetres.
- image direction: one paragraph describing how EVERY image in this
  publication should look — medium, palette, light, treatment. It is prefixed
  to each page's own brief, so it must not describe any single picture.

Then, for every page listed above, a layout: the arrangement, where the image
sits, and where each of that page's blocks goes.

PAGE BLOCKS. A page is built from its blocks, placed on the grid you chose.
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
  it gets its type's standard arrangement.
{{fontBlock}}
{{sectionBlock}}
Also decide the FIXED FURNITURE — the few things that never change from
section to section, and are what make several different-looking sections one
object: the folio (where the page number sits and how it is set), the trim,
the grid in one line, and the divider that marks a section break.

Return ONLY JSON:
{
  "palette": {"paper": "#rrggbb", "ink": "#rrggbb", "accent": "#rrggbb"},
  "fixed": {"folio": "...", "trim": "...", "grid": "...", "divider": "...", "blocks": [{"kind": "runhead", "slot": {"col": 1, "span": 12, "row": 0, "rows": 1}}]},
  "type": {"display": "...", "text": "...", "scale": [48, 24, 10]},
  "grid": {"columns": 12, "gutterMm": 5, "marginMm": 15, "baselineMm": 4},
  "imageDirection": "one paragraph, no single subject",
  "pages": {"1": {"layout": "...", "imageSlot": "full-bleed|top|bottom|left|right|inset|none", "blocks": [{"kind": "drawn", "slot": {"col": 1, "span": 12, "row": 0, "rows": 30, "bleed": true}, "drawn": "contours+rain", "seed": 7}, {"kind": "title", "slot": {"col": 1, "span": 8, "row": 33, "rows": 4}}, {"kind": "body", "slot": {"col": 1, "span": 8, "row": 38, "rows": 16}, "columns": 2}], "note": "", "breaks": []}},
  "sections": [{"n": 1, "register": "...", "technique": "...", "idiom": "...", "paper": "#rrggbb", "ink": "#rrggbb", "hue": "#rrggbb", "imagePrompt": "under 60 words, no single subject", "negative": "..."}]
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
