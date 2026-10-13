import { describe, expect, it } from "vitest";
import { optionsBlock, type PublicationDesign } from "../pipeline/publication-runner.js";

const option = (display: string, accent: string, register: string): PublicationDesign => ({
  sections: [{ n: 1, register, technique: "gouache" } as never],
  spec: { type: { display, text: "Lora" }, palette: { paper: "#fff", ink: "#111", accent }, grid: { system: "columns" } } as never,
  direction: "- composition: one drop per page, a void above it",
});

describe("design options for one creation", () => {
  it("says nothing when the gate wants one design", () => {
    expect(optionsBlock([], 1)).toBe("");
  });

  it("tells each later option what the earlier ones chose, so the looks differ (Rain: three looks, one issue)", () => {
    const first = optionsBlock([], 3);
    expect(first).toMatch(/OPTION 1 OF 3 FOR THIS SAME ISSUE/);
    expect(first).not.toMatch(/already made/);
    const third = optionsBlock([option("Bodoni MT", "#C8102E", "fashion"), option("Rozha One", "#D81B6A", "monsoon")], 3);
    expect(third).toMatch(/OPTION 3 OF 3/);
    expect(third).toMatch(/option 1: Bodoni MT \/ Lora; colours #fff #111 #C8102E; grid columns; worlds fashion \/ gouache; one drop per page/);
    expect(third).toMatch(/option 2: Rozha One/);
  });
});
