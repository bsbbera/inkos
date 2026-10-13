import { describe, expect, it } from "vitest";
import { blockRules, cleanBlocks, gridOf, placedBlocks, sizeOf, type PageBlock } from "../pipeline/page-blocks.js";
import { scorePage } from "../pipeline/page-score.js";
import type { DesignSpec } from "../pipeline/publication-design.js";

const spec = (blocks: PageBlock[], extra: Record<string, unknown> = {}): DesignSpec => ({
  palette: { paper: "#eef0ea", ink: "#14211d", accent: "#f0a202" },
  type: { display: "Gloock", text: "Newsreader", scale: [30, 14, 9.5] },
  grid: { columns: 12, gutterMm: 4, marginMm: 14, baselineMm: 4.7625 },
  imageDirection: "contours and rain",
  pages: { "3": { layout: "feature", imageSlot: "top", blocks, ...extra } },
});

describe("page blocks", () => {
  it("keeps the body when a pull placed before it sits on it (Rain l2 p2)", () => {
    const { spec: out, dropped } = cleanBlocks(spec([
      { kind: "pull", slot: { col: 1, span: 6, row: 30, rows: 6 } },
      { kind: "body", slot: { col: 1, span: 12, row: 28, rows: 20 } },
    ]));
    expect(out.pages["3"]!.blocks!.map((b) => b.kind)).toEqual(["body"]);
    expect(dropped.join()).toMatch(/dropped pull - it sat on the body/);
  });

  it("knows the grid's depth from the spec", () => {
    expect(gridOf(spec([])).rows).toBe(Math.floor((297 - 28 - 10) / 4.7625));
    expect(gridOf(null).columns).toBe(12);
  });

  it("keeps placeable blocks and legacy ones, drops what cannot be built, and says why", () => {
    const { spec: out, dropped } = cleanBlocks(spec([
      { kind: "drawn", slot: { col: 1, span: 12, row: 0, rows: 30, bleed: true } },
      { kind: "title", slot: { col: 1, span: 8, row: 33, rows: 4 } },
      { kind: "deck", slot: { col: 5, span: 6, row: 34, rows: 3 } },                 // on the title
      { kind: "body", slot: { col: 1, span: 8, row: 38, rows: 16 } },
      { kind: "dropcap", slot: { col: 1, span: 1, row: 38, rows: 3 }, lines: 3 },   // in the body, by design
      { kind: "panel", slot: { col: 10, span: 4, row: 38, rows: 10 } },               // off the 12 columns
      { kind: "masthead", slot: { col: 1, span: 2, row: 0, rows: 2 } },               // not a kind
      { kind: "sidefact", slot: "col-10-12-upper" },                                  // legacy, kept unplaced
    ]));
    const kinds = out.pages["3"]!.blocks!.map((b) => b.kind);
    expect(kinds).toEqual(["drawn", "title", "body", "dropcap", "sidefact"]);
    expect(dropped).toHaveLength(3);
    expect(dropped.join(" ")).toMatch(/deck - it sits on another block of type/);
    expect(dropped.join(" ")).toMatch(/panel - its columns run off/);
    expect(placedBlocks(out.pages["3"]).map((b) => b.kind)).toEqual(["drawn", "title", "body", "dropcap"]);
  });

  it("sets sizes from the scale unless a block names one", () => {
    expect(sizeOf({ kind: "title" }, [30, 14, 9.5])).toBe(30);
    expect(sizeOf({ kind: "pull" }, [30, 14, 9.5])).toBe(14);
    expect(sizeOf({ kind: "body" }, [30, 14, 9.5])).toBe(9.5);
    expect(sizeOf({ kind: "figure" }, [30, 14, 9.5])).toBeNull();
    expect(sizeOf({ kind: "title", size: 22 }, [30])).toBe(22);
  });

  const colours = { paper: "#eef0ea", ink: "#14211d", accent: "#f0a202", field: "#15302a" };

  it("finds sizes too close, weak contrast on the real ground, and undeclared transgressions", () => {
    const s = spec([
      { kind: "drawn", slot: { col: 1, span: 12, row: 0, rows: 30, bleed: true } },
      { kind: "figure", slot: { col: 1, span: 8, row: 24, rows: 8 }, crosses: "image-edge" },
      { kind: "title", slot: { col: 1, span: 8, row: 33, rows: 4 }, size: 16 },
      { kind: "pull", slot: { col: 9, span: 4, row: 33, rows: 6 }, size: 14.5 },
      { kind: "kicker", slot: { col: 9, span: 4, row: 40, rows: 1 }, color: "accent" },
    ]);
    const notes = blockRules(s, 3, colours);
    expect(notes.find((n) => n.dim === "H")?.says).toMatch(/16pt and 14.5pt are under 1.2x apart/);
    // Marigold on paper fails a label's 4.5:1; the figure is over the field and holds.
    expect(notes.filter((n) => n.dim === "C").map((n) => n.says)).toEqual([expect.stringMatching(/^the kicker is 1\.\d:1/)]);
    expect(notes.find((n) => n.dim === "G")?.says).toMatch(/figure crosses a picture's edge and the page declares no break/);
  });

  it("says nothing of a declared transgression or a page with no blocks", () => {
    const s = spec([
      { kind: "drawn", slot: { col: 1, span: 12, row: 0, rows: 30, bleed: true } },
      { kind: "figure", slot: { col: 1, span: 8, row: 24, rows: 8 }, crosses: "image-edge" },
    ], { breaks: ["the figure crosses the picture's foot"] });
    expect(blockRules(s, 3, colours)).toEqual([]);
    expect(blockRules(spec([]), 3, colours)).toEqual([]);
  });

  it("charges block notes and line length to the page score", () => {
    const s = scorePage({
      type: "magazine", checkpoint: "page-score",
      blockNotes: [{ dim: "C", penalty: 15, says: "the kicker is 1.9:1 on its ground, under 4.5:1" }],
      contrastFailures: 0,
      layout: {
        frames: [
          { role: "drawn", text: false, x: 0, y: 0, w: 210, h: 150 },
          { role: "body", text: true, x: 14, y: 180, w: 120, h: 80 },
        ],
        grid: { x0: 14, x1: 196, top: 14, foot: 263, col: 11.5, gut: 4, ncol: 12 },
        measure: { chars: 90 },
      },
    });
    expect(s.dims.C).toBe(85);
    expect(s.notes.find((n) => n.dim === "T")?.says).toMatch(/90 characters, outside 35-75/);
  });
});
