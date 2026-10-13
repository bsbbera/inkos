import { describe, expect, it } from "vitest";
import { eyeOf, faultsOf, spreadsOf } from "../pipeline/spread-author.js";
import type { PublicationPage } from "../pipeline/publication-runner.js";

const page = (n: number, body: string): PublicationPage => ({ n, title: "The dark room", type: "feature", body } as PublicationPage);

describe("authored spreads", () => {
  it("pairs pages the way the document does: cover alone, back alone", () => {
    expect(spreadsOf(20)).toEqual([[1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17], [18, 19], [20]]);
    expect(spreadsOf(5)).toEqual([[1], [2, 3], [4, 5]]);
  });

  it("passes a spread that placed all its copy cleanly", () => {
    const pages = [page(4, "Make a room completely dark."), page(5, "Light travels in straight lines.")];
    const texts = { h: { text: "The dark room" }, h2: { text: "The dark room" }, a: { text: "Make a room completely dark." }, b: { text: "Light travels in straight lines." } };
    const placed = { cleared: [4], photo: [], text: [
      { id: "h", P: 4, x: 16, y: 20, w: 100, h: 30 }, { id: "a", P: 4, x: 16, y: 60, w: 80, h: 20 },
      { id: "h2", P: 5, x: 20, y: 20, w: 100, h: 30 }, { id: "b", P: 5, x: 20, y: 60, w: 80, h: 20 },
      { id: "folio", P: 4, x: 14, y: 284.5, w: 80, h: 4 }, { id: "folio", P: 5, x: 116, y: 284.5, w: 80, h: 4 },
    ] };
    expect(faultsOf(pages, texts, placed, 20)).toEqual([]);
  });

  it("names missing copy, collisions, the fold, overruns and a missing folio", () => {
    const pages = [page(4, "Make a room completely dark. Leave one small hole in the shutter of the window opposite."), page(5, "")];
    const texts = { a: { text: "Make a room" }, b: { text: "x" }, c: { text: "unused" } };
    const placed = { cleared: [] as number[], photo: [], text: [
      { id: "a", P: 4, x: 16, y: 60, w: 80, h: 20 }, { id: "b", P: 4, x: 30, y: 65, w: 190, h: 20, over: true },
    ] };
    const f = faultsOf(pages, texts, placed, 20).join("\n");
    expect(f).toMatch(/the spread was not cleared/);
    expect(f).toMatch(/"c" was declared but never drawn/);
    expect(f).toMatch(/"b" overruns/);
    expect(f).toMatch(/"b" on p4 runs past the margin or the fold/);
    expect(f).toMatch(/"a" and "b" collide/);
    expect(f).toMatch(/page 4 has no folio/);
    expect(f).toMatch(/p4: copy is missing/);
  });

  it("reads the critic's scores on its 1-10 scale, even when it answers out of 100", () => {
    expect(eyeOf({ scores: { brand: 9, hierarchy: 8, composition: 8, legibility: 9, craft: 8 } })?.pass).toBe(true);
    const hundred = eyeOf({ scores: { brand: 72, hierarchy: 70, composition: 75, legibility: 72, craft: 71 } })!;
    expect(hundred.total).toBe(7.2);
    expect(hundred.pass).toBe(false);
  });
});
