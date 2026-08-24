// The 50-style register vocabulary, as data.
//
// Lifted from ideaverse-skills/skills/mag-design/references/design-styles.md so
// the shim can reach it on a machine that has Quire but not the skills repo.
// The tiering is the load-bearing part: a Tier 3 prop list has nothing to say
// about the fortieth page of a magazine, so only Tier 1 may run a section.
//
// ponytail: a flat array, not a database. It changes about once a year.

/** tier 1 = a system that can run a page alone. 2 = a mark-making technique.
 *  3 = a palette plus a bag of motifs, usable only for its structural rule. */

export interface DesignStyle {
  readonly id: number;
  readonly name: string;
  /** 1 = a system that can run a page alone. 2 = a mark-making technique.
   *  3 = a palette plus a bag of motifs, usable only for its structural rule. */
  readonly tier: 1 | 2 | 3;
  readonly group: string;
  readonly type?: string;
  readonly colour?: string;
  readonly marks?: string;
  readonly mood?: string;
  /** Built on luminosity or blur: leaves no legible ink on paper. */
  readonly screenOnly?: boolean;
}

export const STYLES: readonly DesignStyle[] = [
  // --- Classical & ornamental
  { id: 1, name: "Neoclassical", tier: 1, group: "classical", type: "serif, symmetric", colour: "muted + gold", marks: "columns, laurels, marble", mood: "formal, noble, timeless" },
  { id: 2, name: "Baroque", tier: 3, group: "classical", type: "ornate serif", colour: "high contrast, gold leaf", marks: "flourishes, deep shadow, mythological motifs", mood: "regal, theatrical, excessive" },
  { id: 5, name: "Filigree", tier: 3, group: "classical", type: "monogram, fine", colour: "metallic ink", marks: "delicate linework, lace, curves", mood: "luxurious, ceremonial" },
  { id: 6, name: "Acanthus", tier: 3, group: "classical", type: "classical serif", colour: "greens + golds, stone", marks: "leaf motifs, symmetrical vines", mood: "regal, organic" },
  { id: 16, name: "Victorian", tier: 3, group: "classical", type: "ornate serif", colour: "deep reds/greens, gilt", marks: "damask, heavy florals, framing", mood: "opulent, historical" },
  { id: 18, name: "Art Nouveau", tier: 1, group: "classical", type: "hand-lettered", colour: "earthy", marks: "curving line, botanical, stained glass", mood: "poetic, organic" },
  { id: 31, name: "Gothic", tier: 3, group: "classical", type: "blackletter", colour: "black, deep purple", marks: "pointed arch, stone, stained glass", mood: "dark, spiritual" },

  // --- Modernist systems
  { id: 22, name: "Bauhaus", tier: 1, group: "modernist", type: "geometric sans", colour: "red/blue/yellow", marks: "circle-triangle-square, visible grid", mood: "rational, structured" },
  { id: 38, name: "Utilitarian", tier: 1, group: "modernist", type: "monospace / industrial", colour: "muted, few", marks: "grid, no ornament, function-first", mood: "practical, efficient" },
  { id: 39, name: "Mid-Century", tier: 1, group: "modernist", type: "clean sans", colour: "warm retro", marks: "boomerangs, mod pattern, organic geometry", mood: "optimistic, modernist" },
  { id: 23, name: "Brutalism", tier: 1, group: "modernist", type: "monospace", colour: "greyscale", marks: "hard edges, solid blocks, default controls", mood: "honest, disruptive" },
  { id: 50, name: "Neo-Brutalism", tier: 1, group: "modernist", type: "large bold", colour: "bold flats", marks: "stark layout, purposeful asymmetry, hard shadow", mood: "confident, raw-but-usable" },
  { id: 49, name: "Modular Typography", tier: 1, group: "modernist", type: "geometric letterforms", colour: "minimal", marks: "type on a grid, uniform spacing, variable layout", mood: "structural, playful" },
  { id: 28, name: "Bento Box", tier: 1, group: "modernist", type: "label sans", colour: "neutral", marks: "rounded modular blocks, compartments", mood: "organized, digestible" },
  { id: 11, name: "Japandi", tier: 1, group: "modernist", type: "clean sans", colour: "beige/grey, light wood", marks: "soft curves, negative space, natural material", mood: "calm, intentional" },
  { id: 44, name: "Wabi Sabi", tier: 1, group: "modernist", type: "minimal sans", colour: "earthy", marks: "asymmetry, rough texture, natural light", mood: "humble, contemplative" },
  { id: 10, name: "Luxury Typography", tier: 1, group: "modernist", type: "expressive serif", colour: "monochrome + foil", marks: "wide tracking, bespoke ligatures, type as the whole image", mood: "elegant, elite" },
  { id: 17, name: "Art Deco", tier: 1, group: "modernist", type: "flared sans", colour: "jewel + gold", marks: "sunbursts, angular symmetry, streamlining", mood: "glamorous, aspirational" },
  { id: 47, name: "Rebus", tier: 1, group: "modernist", type: "any", colour: "clean", marks: "pictograms, visual puns, image-type hybrids", mood: "witty, intellectual" },

  // --- Retro-digital
  { id: 8, name: "Pixel Art", tier: 2, group: "retro-digital", marks: "grid pixels, 8/16-bit, tiny palette", mood: "nostalgic, geeky" },
  { id: 21, name: "Y2K", tier: 3, group: "retro-digital", marks: "chrome, metallic, iridescent gradient, matrix grid", mood: "futuristic-nostalgic, edgy" },
  { id: 25, name: "Synthwave", tier: 3, group: "retro-digital", marks: "grid horizon, neon gradient, 3D chrome type, purple/cyan", mood: "retro-futuristic" },
  { id: 26, name: "Vaporwave", tier: 3, group: "retro-digital", marks: "pastel pink/purple, VHS glitch, Greek busts, lo-fi", mood: "ironic, dreamy", screenOnly: true },
  { id: 24, name: "Cybercore", tier: 3, group: "retro-digital", marks: "neon, glitch, code patterns, green-on-black", mood: "dystopian, chaotic" },
  { id: 41, name: "Neo Frutiger Aero", tier: 3, group: "retro-digital", marks: "aqua, gloss, semi-transparent bubbles, rounded UI", mood: "clean, optimistic-futuristic", screenOnly: true },
  { id: 48, name: "Glassmorphism", tier: 2, group: "retro-digital", marks: "frosted blur, semi-transparency, layered depth", mood: "sleek, elegant", screenOnly: true },

  // --- Pop & street
  { id: 12, name: "Memphis", tier: 3, group: "pop", marks: "squiggles, clashing primaries, block shapes", mood: "rebellious, youthful" },
  { id: 27, name: "Pop Art", tier: 3, group: "pop", marks: "Ben-Day dots, bold outline, speech bubbles", mood: "loud, energetic" },
  { id: 20, name: "Kitsch", tier: 3, group: "pop", marks: "clashing prints, dated fonts, plastic gloss, excess", mood: "campy, ironic" },
  { id: 29, name: "Graffiti", tier: 3, group: "pop", marks: "spray texture, drips, concrete, freestyle letterforms", mood: "urban, defiant" },
  { id: 35, name: "Kawaii", tier: 3, group: "pop", marks: "pastels, round icons, baby faces, handwritten type", mood: "sweet, joyful" },
  { id: 7, name: "Anthropomorphic", tier: 2, group: "pop", marks: "eyes and limbs on objects, character icons", mood: "friendly, quirky" },

  // --- Techniques
  { id: 30, name: "Tenebrism", tier: 2, group: "technique", marks: "chiaroscuro, black ground, spotlighting", mood: "intense, cinematic" },
  { id: 32, name: "Pointillism", tier: 2, group: "technique", marks: "dot clusters, optical mixing", mood: "textured, tranquil" },
  { id: 9, name: "Conceptual Sketch", tier: 2, group: "technique", marks: "pencil/ink, crosshatch, annotations, sketch paper", mood: "raw, idea-driven" },
  { id: 33, name: "Mixed Media", tier: 2, group: "technique", marks: "cutouts, overlays, analog+digital collage", mood: "eclectic, avant-garde" },
  { id: 37, name: "Surrealism", tier: 2, group: "technique", marks: "disjointed objects, melting forms, unexpected scale", mood: "dreamlike, provocative" },
  { id: 40, name: "Scrapbook", tier: 3, group: "technique", marks: "washi tape, torn edges, Polaroid frames, hand notes", mood: "sentimental, warm" },

  // --- Atmosphere & place
  { id: 3, name: "Aurora", tier: 3, group: "atmosphere", marks: "iridescent gradient, blur, organic waves", mood: "dreamy, meditative", screenOnly: true },
  { id: 4, name: "Ethereal", tier: 3, group: "atmosphere", marks: "pastels, gauze overlay, low contrast, feathered shadow", mood: "mystical, weightless", screenOnly: true },
  { id: 13, name: "Bohemian", tier: 3, group: "atmosphere", marks: "mandalas, jewel tones, ethnic print, layered textile", mood: "free, soulful" },
  { id: 14, name: "Shabby Chic", tier: 3, group: "atmosphere", marks: "whitewash, faded floral, lace, cursive", mood: "romantic, nostalgic" },
  { id: 15, name: "Cottagecore / Farmhouse", tier: 3, group: "atmosphere", marks: "gingham, wood, antique finish, hand-drawn type", mood: "cosy, wholesome" },
  { id: 19, name: "Mystical Western", tier: 3, group: "atmosphere", marks: "tarot symbols, cacti, sun/moon, leather, western serif", mood: "folkloric, rugged" },
  { id: 45, name: "South West / Wild West", tier: 3, group: "atmosphere", marks: "terracotta, denim, cacti, western serif", mood: "rugged, heritage" },
  { id: 46, name: "Nautical", tier: 3, group: "atmosphere", marks: "navy/white, rope, stripe, brass, stencil", mood: "fresh, orderly" },
  { id: 34, name: "Steampunk", tier: 3, group: "atmosphere", marks: "copper, cogs, leather, steam, Victorian serif", mood: "retro-futurist" },
  { id: 36, name: "Coquette", tier: 3, group: "atmosphere", marks: "baby pink, ribbon, pearl, dainty serif", mood: "delicate, girly" },
  { id: 42, name: "Dark Magic Academia", tier: 3, group: "atmosphere", marks: "candles, antique etching, black/gold, serif calligraphy", mood: "scholarly, occult" },
  { id: 43, name: "Light Academia", tier: 3, group: "atmosphere", marks: "cream neutrals, serif, linen, sunlight", mood: "calm, refined" },
];

export const byName = (n: string | undefined): DesignStyle | undefined =>
  STYLES.find((s) => s.name.toLowerCase() === String(n || "").trim().toLowerCase());

export const registers = (): DesignStyle[] => STYLES.filter((s) => s.tier === 1);
export const techniques = (): DesignStyle[] => STYLES.filter((s) => s.tier === 2);

/** The rules a design decision is judged against, stated once for both prompts and checks. */
export const LAW = `A style is a REGISTER (what world the page is printed in: type, palette,
surface, ornament) held constant across a whole section. It is NOT a DEVICE (what document
the page pretends to be) which changes every spread.

- The register of a section MUST be a Tier 1 system. Tier 1 has rules — a grid logic, a type
  logic, a stated relationship between form and function — and survives being applied to
  content it was never designed for.
- The figure technique MAY be a Tier 2 technique. Tier 2 is a way of making a mark, not a way
  of running a page, so it draws the figures inside a Tier 1 register and never runs the page.
- Tier 3 is a palette plus a bag of motifs. Applied literally it produces clip-art. Use it only
  by extracting its structural rule and discarding the props: Nautical is not anchors, it is
  rigid horizontal banding plus stencil type plus a two-value palette.
- The productive hybrid is one Tier 1 system x one Tier 2 technique. The system runs the page,
  the technique draws the figures.
- Every section gets its own world: no two sections may share a typeface family.
- Colour is a field and a spot, not a flood. Most pages of a section run its PAPER (a light
  ground); the saturated FIELD belongs on two or three pages only — the plate, and one feature
  that earns it. Everywhere else the saturated colour does structural work: card grounds, tab
  bars, rules, initial letters, the image field.
- What never changes issue-wide: the folio (same corner, every non-plate page), the trim,
  margins and grid skeleton, and the section-divider spec. Those three are what make N worlds
  one object.
- Print laws beat style. Registers built on luminosity, blur and mid-tone grounds (Aurora,
  Ethereal, Vaporwave, Glassmorphism) leave no legible ink on paper. Translate to paper terms
  or do not use them.`;

/** Compact catalogue for a prompt — full rows would be most of a context window. */
export function catalogue(tier?: number): string {
  return STYLES.filter((s) => !tier || s.tier === tier)
    .map((s) => `${s.name} (${s.mood}${s.marks ? "; " + s.marks : ""})`)
    .join(" · ");
}

/* ------------------------------------------------------------------ colour */
const hex = (c: unknown): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
  return m ? m[1] : null;
};

/** Relative luminance, WCAG 2.1. */
function lum(h: string): number {
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

/**
 * Contrast ratio between two hex colours, or null if either is unparseable.
 * Print is less forgiving than screen, so the thresholds callers use are higher
 * than the WCAG minimums — body type on paper wants 7:1, not 4.5:1.
 */
export function contrast(a: unknown, b: unknown): number | null {
  const [x, y] = [hex(a), hex(b)];
  if (!x || !y) return null;
  const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}
