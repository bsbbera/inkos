import { describe, expect, it } from "vitest";
import { brandHouse, brandLanguage, holdBrandShapes, listBrands, loadBrand, offBrandColours, pairOf, placeOf } from "../pipeline/brand.js";
import { checkHouse } from "../pipeline/house.js";
import { holdShapes } from "../pipeline/page-art.js";

const ochin = loadBrand("ochin")!;

describe("brand", () => {
  it("ships Ochin with its standard, references and kit", () => {
    expect(ochin.name).toBe("Ochin");
    expect(ochin.standard).toContain("Who decides what");
    expect(ochin.references.length).toBeGreaterThan(5);
    expect(listBrands().map((b) => b.id)).toContain("ochin");
    expect(loadBrand("no-such-brand")).toBeNull();
  });

  it("its house is a house Quire accepts", () => {
    expect(checkHouse(brandHouse(ochin))).toEqual([]);
  });

  it("a section's colours are rebuilt from its pair, whatever the model wrote", () => {
    const pair = pairOf(ochin, ["neel", "gold"], ["#123456"]);
    expect(pair[0]).toBe("neel");
    expect(ochin.sectionColours).toContain(pair[1]);
    const lang = brandLanguage(ochin, pair, { panel: { fill: "second", stroke: "ink", weight: 2, radius: 6, cut: 3, shadow: { dx: 1, dy: 1, colour: "ink" }, rotate: 4 }, motif: "kantha paths" });
    expect(offBrandColours(ochin, lang)).toEqual([]);
    expect(lang.panel).toMatchObject({ radius: 0, cut: 0, shadow: null, rotate: 0 });
    expect(offBrandColours(ochin, { a: "#ff00ff", b: ochin.colours.neel!.hex })).toEqual(["#ff00ff"]);
  });

  it("brand shapes keep to their rations and the brand's colours", () => {
    const shapes = [
      { s: "bird", p: { body: "kajol" } }, { s: "bird", p: {} },
      { s: "lalpaar", p: { solid: "sindur" } },
      { s: "alpana", p: { solid: "gold" } },
    ];
    const inner = holdBrandShapes(ochin, shapes, placeOf("feature"));
    expect(inner.shapes.map((s) => s.s)).toEqual(["alpana"]);   // no bird or lal paar on a running page
    expect(inner.shapes[0]!.p).not.toHaveProperty("solid");    // "gold" is not an Ochin colour
    const cover = holdBrandShapes(ochin, shapes, placeOf("cover"));
    expect(cover.shapes.filter((s) => s.s === "bird")).toHaveLength(1);
    expect(cover.shapes.some((s) => s.s === "lalpaar")).toBe(true);
  });

  it("page art accepts brand kinds only under a brand", () => {
    const raw = { shapes: [{ s: "alpana", x: 10, y: 10, w: 40, h: 40, p: { solid: "holud" } }, { s: "rect", x: 0, y: 0, w: 10, h: 10, fill: "accent" }] };
    expect(holdShapes(raw, []).map((s) => s.s)).toEqual(["rect"]);
    expect(holdShapes(raw, [], { brand: ochin, place: placeOf("opener") }).map((s) => s.s)).toEqual(["alpana", "rect"]);
  });
});
