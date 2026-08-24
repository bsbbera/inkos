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
  /** Where each block goes, in the order they should be placed. */
  readonly blocks?: readonly { kind: string; slot: string }[];
  readonly note?: string;
}

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

Return ONLY JSON:
{
  "palette": {"paper": "#rrggbb", "ink": "#rrggbb", "accent": "#rrggbb"},
  "type": {"display": "...", "text": "...", "scale": [48, 24, 10]},
  "grid": {"columns": 12, "gutterMm": 5, "marginMm": 15, "baselineMm": 4},
  "imageDirection": "one paragraph, no single subject",
  "pages": {"1": {"layout": "...", "imageSlot": "full-bleed|top|bottom|left|right|inset|none", "blocks": [{"kind": "...", "slot": "..."}], "note": ""}}
}
`.trim();
