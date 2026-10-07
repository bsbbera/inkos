import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  improvePage, readScore, saveScore, scorePage, WEIGHTS,
  type MeasuredPage, type PageScore, type PageScoreInput,
} from "../pipeline/page-score.js";

const good: MeasuredPage = { whitespace: 0.35, balance: 0.05, shares: { paper: 0.6, ink: 0.3, hue: 0.1 }, offPalette: 0 };
const input = (over: Partial<PageScoreInput> = {}): PageScoreInput =>
  ({ type: "magazine", checkpoint: "page-score", measured: good, specProblems: [], ...over });

describe("the weights", () => {
  it("sum to one for every production type", () => {
    for (const row of Object.values(WEIGHTS)) {
      expect(Object.values(row).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    }
  });
});

describe("scoring a page", () => {
  it("passes a well-set page, and says which dimensions nothing measured", () => {
    const s = scorePage(input());
    expect(s.pass).toBe(true);
    expect(s.total).toBeGreaterThanOrEqual(95);
    expect(s.cause).toBeNull();
    // Grid and hierarchy need frame geometry the spec does not carry yet; they are not credited.
    expect(s.unmeasured).toEqual(expect.arrayContaining(["G", "H", "I", "T"]));
    expect(s.dims.G).toBeNull();
  });

  it("names the cause with its worst sub-metric: a page leaning left is W", () => {
    // A mild lean costs points but passes: the bar is 80 overall and 55 on each dimension.
    expect(scorePage(input({ measured: { ...good, balance: 0.55, lean: { x: -0.31, y: 0 } } })).pass).toBe(true);

    const lean = { ...good, balance: 0.85, lean: { x: -0.4, y: 0 } };
    const s = scorePage(input({ measured: lean }));
    expect(s.pass).toBe(false);
    expect(s.cause).toBe("W");
    expect(s.causeLine).toBe("W 49 - weight sits 40% left of centre, no break declared");
    expect(s.fix).toBe("re-archetype");
    // A declared break excuses the lean up to a quarter.
    const excused = scorePage(input({ measured: lean, breakDeclared: true }));
    expect(excused.dims.W!).toBeGreaterThan(s.dims.W!);
  });

  it("routes a colour fault to recolour and an image fault back to its slot", () => {
    const colour = scorePage(input({ measured: { ...good, shares: { paper: 0.2, ink: 0.7, hue: 0.1 }, offPalette: 0.4 } }));
    expect(colour.cause).toBe("C");
    expect(colour.fix).toBe("recolour");
    expect(colour.rerenderImages).toBe(false);

    const image = scorePage({
      type: "magazine", checkpoint: "asset-check",
      assets: [{ slot: "p14-1", kind: "cutout", fill: 0.3, haloShare: 0.5, deltaE: 0.4, dpi: 90 }],
    });
    expect(image.cause).toBe("I");
    expect(image.fix).toBe("redo-image");
    expect(image.rerenderImages).toBe(true);
    expect(image.causeLine).toContain("p14-1: fill 0.30");
    expect(image.causeLine).toContain("90 dpi");
  });

  it("treats a broken golden rule as a hard fail whatever the rest scores", () => {
    const s = scorePage(input({ specProblems: ["pages 1-3 are 3 full-bleeds in a row - the law is 2"] }));
    expect(s.pass).toBe(false);
    expect(s.cause).toBe("R");
    expect(s.fix).toBe("repair");
    expect(s.causeLine).toContain("3 full-bleeds in a row");
  });

  it("scores the spec-only checkpoint without a render", () => {
    const s = scorePage({ type: "magazine", checkpoint: "spec-lint", words: 474, cap: 450, specProblems: [] });
    expect(s.dims.W).toBeNull();
    expect(s.dims.T).toBe(70);
    // 70 is under the pass mark, so the words are the cause.
    expect(s.pass).toBe(false);
    expect(s.cause).toBe("T");
    expect(s.causeLine).toBe("T 70 - 474 words; a page like this holds 450");
  });
});

describe("the two passes", () => {
  const failing = (): PageScore => scorePage(input({ measured: { ...good, shares: { paper: 0.2, ink: 0.7, hue: 0.1 }, offPalette: 0.4 } }));
  const passing = (): PageScore => scorePage(input());

  it("redesigns by cause until the page passes", async () => {
    const queue = [failing(), passing()];
    const fixed: string[] = [];
    const out = await improvePage({
      score: async () => queue.shift()!,
      fix: async (cause, fix) => { fixed.push(`${cause}:${fix}`); return true; },
    });
    expect(out.stopped).toBe("passed");
    expect(fixed).toEqual(["C:recolour"]);
    expect(out.passes).toHaveLength(1);
    expect(out.passes[0]!.after).toBeGreaterThan(out.passes[0]!.before);
  });

  it("stops after two passes, and when there is no automatic fix", async () => {
    let n = 0;
    const two = await improvePage({ score: async () => { n++; return failing(); }, fix: async () => true });
    expect(two.stopped).toBe("passes-used");
    expect(two.passes).toHaveLength(2);
    expect(n).toBe(3);

    const none = await improvePage({ score: async () => failing(), fix: async () => false });
    expect(none.stopped).toBe("no-fix");
    expect(none.passes).toHaveLength(0);
  });
});

describe("keeping the score", () => {
  it("is stored with the page and its history grows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quire-score-"));
    try {
      expect(await readScore(dir, 7)).toBeNull();
      await saveScore(dir, 7, scorePage(input({ measured: { ...good, shares: { paper: 0.2, ink: 0.7, hue: 0.1 }, offPalette: 0.4 } })));
      const file = await saveScore(dir, 7, scorePage(input()));
      expect(file.history).toHaveLength(2);
      expect(file.latest.pass).toBe(true);
      expect((await readScore(dir, 7))!.history[0]!.pass).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("what the layout reports (G, H, T)", () => {
  const grid = { x0: 18, x1: 192, top: 20, foot: 266, col: 25.6667, gut: 4, ncol: 6 };
  const colW = 3 * 25.6667 + 2 * 4;
  const frames = [
    { role: "ground", text: false, x: 0, y: 0, w: 210, h: 297 },
    { role: "image", text: false, x: 18, y: 20, w: 174, h: 92 },
    { role: "title", text: true, x: 18, y: 120, w: 112.7, h: 20 },
    { role: "body", text: true, x: 18, y: 160, w: colW, h: 100 },
    { role: "body", text: true, x: 18 + colW + 4, y: 160, w: colW, h: 100 },
  ];
  const laid = (over: object = {}) => input({ layout: { frames, grid, findings: [], cols: { words: [210, 200], overset: 0 }, leaks: [], ...over } });

  it("measures grid and hierarchy once a layout exists, and credits a clean page", () => {
    const s = scorePage(laid());
    expect(s.dims.G).toBe(100);
    expect(s.dims.H).toBe(100);
    expect(s.dims.T).toBe(100);
    expect(s.unmeasured).not.toContain("G");
    expect(s.pass).toBe(true);
  });

  it("names leaked markup and unbalanced columns as typography", () => {
    const s = scorePage(laid({ leaks: ["###"], cols: { words: [380, 20], overset: 0 } }));
    expect(s.cause).toBe("T");
    expect(s.notes.map((n) => n.says).join(" | ")).toContain("markup printed on the page: ###");
    expect(s.notes.map((n) => n.says).join(" | ")).toContain("columns unbalanced: 380 words against 20");
  });

  it("finds overlapping frames and frames off the grid", () => {
    const s = scorePage(laid({
      frames: [...frames, { role: "deck", text: true, x: 31, y: 142, w: 90, h: 15 }],
      findings: [{ level: "error", what: "two text frames overlap", area: 1200 }],
    }));
    expect(s.dims.G).toBe(60);
    expect(s.notes.find((n) => n.dim === "G" && n.says.includes("off the column grid"))!.says).toContain("deck");
  });

  it("says nothing dominates when the lead holds too little of the page's weight", () => {
    // Measured weights: body text outweighs the head many times over.
    const s = scorePage(laid({ frames: frames.filter((f) => f.role !== "image") }));
    const weighed = scorePage({ ...input({ layout: { frames, grid, findings: [], cols: { words: [210, 200], overset: 0 }, leaks: [] } }),
      measured: { ...good, weights: [{ role: "title", weight: 400 }, { role: "deck", weight: 350 }, { role: "body", weight: 2600 }, { role: "body", weight: 2500 }] } });
    expect(weighed.dims.H!).toBeLessThan(80);
    expect(weighed.notes.find((n) => n.dim === "H" && n.says.includes("nothing dominates"))).toBeTruthy();
    // The deck at 88 % of the title's weight competes with it.
    expect(weighed.notes.find((n) => n.says === "the deck competes with the title")).toBeTruthy();
    expect(s.dims.H).not.toBeNull();
  });

  it("does not blame colour for a page of body text on paper", () => {
    const s = scorePage(input({ measured: { ...good, shares: { paper: 0.9, ink: 0.1, hue: 0 } } }));
    expect(s.dims.C).toBe(100);
  });
});
