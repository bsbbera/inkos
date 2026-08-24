import { describe, expect, it } from "vitest";
import { checkSpec, contrast, type DesignSpec } from "../pipeline/publication-design.js";

const good = (): DesignSpec => ({
  palette: { paper: "#faf7f0", ink: "#161310", accent: "#b2452c" },
  type: { display: "GT Sectra", text: "Söhne", scale: [48, 24, 10] },
  grid: { columns: 12, gutterMm: 5, marginMm: 15, baselineMm: 4 },
  imageDirection: "Muted colour photography, single soft source, deep shadow.",
  pages: { 1: { layout: "full-bleed", imageSlot: "full-bleed" } },
});

describe("checkSpec", () => {
  it("passes a complete spec", () => {
    expect(checkSpec(good(), [1])).toEqual([]);
  });

  it("refuses a spec that lays out a page the issue does not have", () => {
    expect(checkSpec(good(), [1, 2]).join(" ")).toMatch(/page 2 has no layout/);
  });

  // The spec is written from the copy, so a spec covering pages that no longer
  // exist means it was written against a draft that has since been cut.
  it("refuses a spec written against a different draft", () => {
    const spec = { ...good(), pages: { ...good().pages, 9: { layout: "x", imageSlot: "none" } } };
    expect(checkSpec(spec as DesignSpec, [1]).join(" ")).toMatch(/lays out page 9/);
  });

  it("refuses a colour that is not a hex", () => {
    const spec = { ...good(), palette: { ...good().palette, accent: "warm red" } };
    expect(checkSpec(spec as DesignSpec, [1]).join(" ")).toMatch(/palette.accent/);
  });

  it("refuses an empty image direction", () => {
    expect(checkSpec({ ...good(), imageDirection: "  " }, [1]).join(" "))
      .toMatch(/imageDirection is empty/);
  });

  it("refuses a type scale of fewer than three sizes", () => {
    const spec = { ...good(), type: { ...good().type, scale: [12, 10] } };
    expect(checkSpec(spec as DesignSpec, [1]).join(" ")).toMatch(/at least three sizes/);
  });
});

describe("contrast", () => {
  // Print is less forgiving than a screen; the runner rejects below 7:1.
  it("passes near-black on near-white and fails mid grey on grey", () => {
    expect(contrast("#161310", "#faf7f0")).toBeGreaterThan(7);
    expect(contrast("#777777", "#999999")).toBeLessThan(7);
  });
});
