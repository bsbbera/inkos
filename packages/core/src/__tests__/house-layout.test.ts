import { describe, expect, it } from "vitest";
import { applyHouse, checkHouse, scaleOf, type House } from "../pipeline/house.js";
import { holdLanguage } from "../pipeline/visual-language.js";
import { holdShapes } from "../pipeline/page-art.js";
import { contrast } from "../publications/styles.js";
import { PATTERNS, choosePattern, geometryOf, resolveLayouts, resolvePattern, type PageContent } from "../pipeline/layout-engine.js";
import { cleanBlocks } from "../pipeline/page-blocks.js";
import type { DesignSpec } from "../pipeline/publication-design.js";

const HOUSE: House = {
  name: "Level", status: "approved", type: { display: "Bodoni MT", text: "Georgia" }, scale: { body: 9.5, ratio: 1.333 },
  marginMm: 16, gutterMm: 5, baselineMm: 4.5, grids: ["golden", "thirds"],
  devices: { rule: "double", folio: "f", kicker: "k" },
};
const spec = (system: string): DesignSpec => ({
  palette: { paper: "#ffffff", ink: "#000000", accent: "#c0392b" },
  type: { display: "X", text: "Y", scale: scaleOf(HOUSE) },
  grid: { system: system as never, columns: 12, gutterMm: 5, marginMm: 16, baselineMm: 4.5 },
  imageDirection: "", pages: {},
});

describe("the house", () => {
  it("says what stops it being approved", () => {
    expect(checkHouse(HOUSE)).toEqual([]);
    const bad = checkHouse({ ...HOUSE, devices: { ...HOUSE.devices, rule: "zigzag" }, grids: [] }, ["Georgia"]);
    expect(bad.join("; ")).toMatch(/rule style/);
    expect(bad.join("; ")).toMatch(/no grid system/);
    expect(bad.join("; ")).toMatch(/Bodoni MT is not installed/);
  });

  it("holds the spec to its type and grids, and leaves colour to the sections", () => {
    const held = applyHouse(spec("columns"), HOUSE);
    expect(held.type.display).toBe("Bodoni MT");
    expect(held.palette.accent).toBe("#c0392b");
    expect(held.grid.system).toBe("golden");            // columns is not the house's
  });
});

describe("a section's language", () => {
  it("keeps what the model chose and mends only what print cannot carry", () => {
    const { language, notes } = holdLanguage({
      paper: "#fff4d6", ink: "#7a6a50", accent: "#ff5a1f", second: "#1d4ed8", third: "#ffe600", field: "#0b3d2e",
      panel: { fill: "second", radius: 9, shadow: { dx: 2, dy: 2, colour: "ink" }, rotate: 30 }, title: "accent",
      kicker: { ground: "accent", track: 0.2 }, motif: "tentacles",
    }, { paper: "#ffffff", ink: "#000000", accent: "#c0392b" });
    expect(contrast(language.ink, language.paper)!).toBeGreaterThanOrEqual(7);
    expect(notes.join("; ")).toMatch(/ink #7a6a50 darkened/);
    expect(language.second).toBe("#1d4ed8");                // bold colour is kept
    expect(language.panel).toEqual({ fill: "second", stroke: null, weight: 0.75, radius: 9, cut: 0, shadow: { dx: 2, dy: 2, colour: "ink" }, rotate: 6 });
    expect(language.kicker).toEqual({ ground: "accent", bar: null, track: 0.2 });
  });

  it("falls back to drawable values for what it cannot read", () => {
    const { language } = holdLanguage({ panel: { fill: "gold", radius: "big" }, title: "gold" }, { paper: "#ffffff", ink: "#111111", accent: "#c0392b" });
    expect(language.panel.fill).toBe("field");               // never an invisible panel
    expect(language.panel.radius).toBe(0);
    expect(language.title).toBe("ink");
  });
});

describe("page art", () => {
  const type = [{ kind: "body", box: { x: 20, y: 150, w: 170, h: 120 } }, { kind: "title", box: { x: 20, y: 40, w: 120, h: 30 } }];
  it("keeps shapes on the page and faint under running text", () => {
    const shapes = holdShapes({ shapes: [
      { s: "circle", x: 100, y: 140, w: 80, h: 80, fill: "accent" },              // under the body
      { s: "rect", x: 0, y: 0, w: 210, h: 100, fill: "field", layer: "front" },     // under all of the title
      { s: "rect", x: 100, y: 50, w: 60, h: 10, fill: "second" },                  // clips the title
      { s: "blob", pts: [[10, 10], [40, 5], [30, 40]], fill: "third" },
      { s: "blob", fill: "third" },                                                 // no points
      { s: "hexagon", x: 0, y: 0, w: 1, h: 1, fill: "ink" },                        // not a kind
      { s: "rect", x: 0, y: 0, w: 5, h: 5, fill: "gold" },                          // no colour it can draw
    ] }, type);
    expect(shapes.length).toBe(4);
    expect(shapes[0]!.opacity).toBe(0.15);
    expect(shapes[1]!.opacity).toBe(1);
    expect(shapes[2]!.opacity).toBe(0.25);
    expect(shapes[3]).toMatchObject({ x: 10, y: 5, w: 30, h: 35 });
  });
});

describe("the composition systems", () => {
  it("cut the page as the system says", () => {
    const g = geometryOf(spec("golden"));
    const [a, b, c] = g.cells.recto;
    expect(g.cells.recto).toHaveLength(3);
    // The golden lines are the gutters' centres: .382 and .618 of the measure.
    expect((b!.x + b!.w + 2.5 - 16) / (210 - 32)).toBeCloseTo(0.618, 3);
    expect(c!.w).toBeCloseTo(a!.w, 5);
    const k = geometryOf(spec("canon"));
    expect(k.top).toBeCloseTo(33, 0);
    expect(k.cells.recto[0]!.x).toBeLessThan(k.cells.verso[0]!.x);   // inner margin on the spine side
    expect(geometryOf(spec("thirds")).cells.recto).toHaveLength(3);
  });
});

describe("the patterns", () => {
  const page = (n: number, type: string, words: number): PageContent => ({ n, type, words, hasDeck: true, hasPull: true, hasFigure: true, hasNotes: true });

  it("every pattern lays out on its own system with no type on type", () => {
    for (const p of PATTERNS) {
      const s = spec(p.system);
      const r = resolvePattern(p, page(2, "feature", 50), s);
      const cleaned = cleanBlocks({ ...s, pages: { "2": { layout: p.id, imageSlot: "none", blocks: r.blocks } } });
      expect(cleaned.dropped, p.id).toEqual([]);
      for (const b of r.blocks) {
        const box = (b as { box: { x: number; y: number; w: number; h: number } }).box;
        expect(box.x, `${p.id} ${b.kind}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w, `${p.id} ${b.kind}`).toBeLessThanOrEqual(210.01);
        expect(box.y + box.h, `${p.id} ${b.kind}`).toBeLessThanOrEqual(297.01);
      }
    }
  });

  it("moves long copy to a roomier pattern, and says so when nothing holds it", () => {
    const s = spec("columns");
    const cap = resolvePattern(PATTERNS.find((p) => p.id === "c-feature-rail")!, page(2, "feature", 1), s).capacity;
    expect(choosePattern("c-feature-rail", page(2, "feature", Math.round(cap * 0.8)), s, 5).pattern).toBe("c-feature-rail");
    // Copy that would leave most of the columns empty moves to a pattern it fills.
    const short = choosePattern("c-feature-rail", page(2, "feature", 80), s, 5);
    expect(short.pattern).not.toBe("c-feature-rail");
    expect(short.notes[0]).toMatch(/% full/);
    const long = choosePattern("c-feature-band", page(2, "feature", 520), s, 5);
    expect(long.capacity).toBeGreaterThanOrEqual(520 * 1.05);
    expect(long.notes[0]).toMatch(/fits them/);
    const huge = choosePattern("c-feature-rail", page(2, "feature", 5000), s, 5);
    expect(huge.notes[0]).toMatch(/cut the copy/);
  });

  it("gives covers no running head and every other page one", () => {
    const s = { ...spec("thirds"), pages: { "1": { layout: "", imageSlot: "full-bleed" as const }, "2": { layout: "", imageSlot: "none" as const } } };
    const out = resolveLayouts(s, [{ n: 1, type: "cover", body: "a b c" }, { n: 2, type: "feature", body: "a b c" }], () => ["rings"]);
    expect(out.spec.pages["1"]!.blocks!.some((b) => b.kind === "runhead")).toBe(false);
    expect(out.spec.pages["2"]!.blocks!.some((b) => b.kind === "runhead")).toBe(true);
    expect(out.spec.pages["1"]!.blocks!.find((b) => b.kind === "drawn")!.drawn).toBe("rings");
  });
});
