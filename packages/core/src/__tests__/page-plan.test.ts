import { describe, expect, it } from "vitest";
import { planPage, rerank } from "../pipeline/page-plan.js";
import { bodyCapacity } from "../pipeline/layout-engine.js";
import type { DesignSpec } from "../pipeline/publication-design.js";

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
const systems = [
  { system: "modular", columns: 6, gutterMm: 4, marginMm: 12, baselineMm: 5.6 },
  { system: "golden", gutterMm: 5, marginMm: 14, baselineMm: 4.8 },
  { system: "thirds", gutterMm: 4, marginMm: 15, baselineMm: 4.5 },
  { system: "columns", columns: 12, gutterMm: 4, marginMm: 15, baselineMm: 4.5 },
];
const page = {
  n: 2, type: "feature", title: "The Peacock's Hundred Eyes", deck: "Why a bird would carry a train five times its body.",
  body: words(260), pullQuote: "Every eye is a promise of a healthy father.",
  furniture: [{ kind: "did-you-know", text: "A train holds about 170 eyespots." }],
};

describe("the page planned by arithmetic", () => {
  for (const grid of systems) {
    it(`gives a page on a ${grid.system} grid nothing the checks refuse, no hole, and its words room`, () => {
      const spec = { grid, type: { display: "D", text: "T", scale: [72, 28, 10] } } as unknown as DesignSpec;
      const [best] = planPage(page, spec);
      expect(best).toBeDefined();
      expect(best!.composed.problems).toEqual([]);
      const body = best!.composed.blocks.find((b) => b.kind === "body")!;
      expect(bodyCapacity(body.box, body.columns, spec)).toBeGreaterThanOrEqual(260);
      // One dominant picture, at a share a dominant may hold.
      expect(best!.dominance).toBeGreaterThanOrEqual(0.3);
      expect(best!.dominance).toBeLessThanOrEqual(0.65);
    });
  }

  it("fits the frame to a picture of known shape: a tall bird down a side from the foot, a wide one across", () => {
    const spec = { grid: systems[1], type: { display: "D", text: "T", scale: [60, 24, 10] } } as unknown as DesignSpec;
    const tall = planPage(page, spec, { aspect: 0.4 })[0]!;
    expect(tall.arrangement).toBe("side");
    const pic = tall.composed.blocks.find((b) => b.kind === "image")!;
    expect(pic.box.y + pic.box.h).toBeCloseTo(297, 0);
    expect(pic.box.w / pic.box.h).toBeLessThan(0.6);
    const wide = planPage(page, spec, { aspect: 2.2 })[0]!;
    expect(["head", "foot"]).toContain(wide.arrangement);
  });

  it("does not repeat the arrangement of the page before when another is as good", () => {
    const spec = { grid: systems[0], type: { display: "D", text: "T", scale: [72, 28, 10] } } as unknown as DesignSpec;
    const first = planPage(page, spec)[0]!;
    const next = planPage(page, spec, { previous: first.arrangement })[0]!;
    expect(next.arrangement).not.toBe(first.arrangement);
  });

  it("puts fewer things on a page whose proof was found crowded", () => {
    const spec = { grid: systems[0], type: { display: "D", text: "T", scale: [72, 28, 10] } } as unknown as DesignSpec;
    const ranked = rerank(planPage(page, spec), ["major: two dominants compete for the eye"]);
    expect(ranked[0]!.extras).toBe(0);
  });
});

describe("a page whose copy leaves little room", () => {
  it("narrows its picture to a band, and with no room at all is led by its type, never left unplanned", () => {
    const spec = { grid: { system: "golden", gutterMm: 5, marginMm: 14, baselineMm: 5 }, type: { display: "D", text: "T", scale: [60, 24, 10] } } as unknown as DesignSpec;
    const long = { ...page, body: words(440), deck: "x ".repeat(80) };
    const ranked = planPage(long, spec);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.composed.problems).toEqual([]);
    const huge = { ...page, body: words(900) };
    expect(planPage(huge, spec).some((c) => c.arrangement === "type")).toBe(true);
  });
});

describe("a picture frame the renderer can paint", () => {
  it("is never narrower than 1:2 or wider than 2.4:1, on any grid", async () => {
    const { MIN_ASPECT, MAX_ASPECT } = await import("../pipeline/page-plan.js");
    for (const grid of systems) {
      const spec = { grid, type: { display: "D", text: "T", scale: [60, 24, 10] } } as unknown as DesignSpec;
      for (const c of planPage(page, spec)) {
        const pic = c.composed.blocks.find((b) => b.kind === "image");
        if (!pic) continue;
        const a = pic.box.w / pic.box.h;
        expect(a).toBeGreaterThanOrEqual(MIN_ASPECT - 0.02);
        expect(a).toBeLessThanOrEqual(MAX_ASPECT + 0.02);
      }
    }
  });
});
