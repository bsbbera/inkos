import { describe, expect, it } from "vitest";
import { scorePage } from "../pipeline/page-score.js";
import { problemsFor, variantFor } from "../pipeline/page-score-run.js";

describe("which spec problems belong to a page", () => {
  const problems = [
    "pages 4-6 are 3 full-bleeds in a row - the law is 2",
    "page 9 carries 5 blocks - the law is 3",
    "Light declares 2 breaks - the law is 1",
  ];
  it("keeps a range that contains the page, a single page, and drops what is about the issue", () => {
    expect(problemsFor(problems, 5)).toEqual([problems[0]]);
    expect(problemsFor(problems, 9)).toEqual([problems[1]]);
    expect(problemsFor(problems, 1)).toEqual([]);
  });
});

describe("the arrangement a failing page is given", () => {
  const crowded = scorePage({ type: "magazine", checkpoint: "page-score", measured: { whitespace: 0.02, balance: 0.3, shares: { paper: 0.6, ink: 0.3, hue: 0.1 }, offPalette: 0 } });
  it("shrinks the picture band on a crowded page with a picture", () => {
    expect(crowded.cause).toBe("W");
    expect(variantFor("W", crowded, {}, true)).toBe("small-band");
  });
  it("leads a text page with its pull quote, then its standfirst, and never repeats itself", () => {
    expect(variantFor("H", crowded, { pullQuote: "Blue was a luxury.", deck: "d" }, false)).toBe("pull");
    expect(variantFor("H", crowded, { pullQuote: "Blue was a luxury.", deck: "d" }, false, "pull")).toBe("big-deck");
    expect(variantFor("H", crowded, { deck: "d" }, false, "big-deck")).toBeNull();
    expect(variantFor("H", crowded, {}, false)).toBeNull();
  });
});
