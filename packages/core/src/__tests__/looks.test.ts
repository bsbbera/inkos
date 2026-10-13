import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageStyleOf, listLooks, lookOf, saveImageStyle } from "../pipeline/looks.js";
import { layerShapes } from "../pipeline/page-plan.js";

describe("looks", () => {
  it("reads a look's standard and numbers, and imposes nothing when there is none", async () => {
    const root = mkdtempSync(join(tmpdir(), "looks-"));
    expect(await lookOf(root, "minimal")).toBeNull();
    expect(await lookOf(root, null)).toBeNull();
    expect(await lookOf(root, "../x")).toBeNull();
    const dir = join(root, "_taste", "references", "layered");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "STANDARD.md"), "# Layered\nPictures stand on drawn shapes.");
    writeFileSync(join(dir, "look.json"), JSON.stringify({ extras: 3, layers: true }));
    writeFileSync(join(dir, "01.jpg"), "x");
    const look = await lookOf(root, "layered");
    expect(look).toMatchObject({ name: "layered", extras: 3, layers: true });
    expect(look!.standard).toMatch(/drawn shapes/);
    expect(look!.images).toHaveLength(1);
    expect((await listLooks(root)).map((l) => l.name)).toEqual(["layered"]);
  });

  it("keeps the editor's image style until it is changed", async () => {
    const root = mkdtempSync(join(tmpdir(), "style-"));
    expect(await imageStyleOf(root)).toBeNull();
    await expect(saveImageStyle(root, { style: " " })).rejects.toThrow();
    await saveImageStyle(root, { style: "gouache miniature", from: "Birds" });
    expect(await imageStyleOf(root)).toMatchObject({ style: "gouache miniature", from: "Birds" });
  });
});

describe("the layered look's drawn layer", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  it("stands a tall picture in an arch, a wide one on a band, the deck on a block, and gives the page a floor", () => {
    const tall = layerShapes([
      { kind: "image", box: box(140, 0, 70, 140) },
      { kind: "title", box: box(14, 20, 110, 30) },
      { kind: "deck", box: box(14, 56, 110, 14) },
      { kind: "body", box: box(14, 80, 110, 150) },
    ]);
    // A border arch in the section's colour, and inside it the arch that holds the plate.
    expect(tall[0]).toMatchObject({ s: "poly", fill: "second", layer: "back" });
    expect(tall[1]).toMatchObject({ s: "poly", fill: "ground", hold: true });
    expect(tall[1]!.x).toBeGreaterThan(tall[0]!.x);
    const deck = tall.find((s) => s.fill === "third")!;
    // Clear of the title above and the body below.
    expect(deck.y).toBeGreaterThanOrEqual(50);
    expect(deck.y + deck.h).toBeLessThanOrEqual(80);
    expect(tall.some((s) => s.fill === "accent" && s.y >= 289)).toBe(true);

    const wide = layerShapes([{ kind: "image", box: box(0, 0, 210, 100) }, { kind: "body", box: box(14, 120, 180, 175) }]);
    // The wide frame holds its plate whole and stands on a sill of the section's colour.
    expect(wide[0]).toMatchObject({ s: "rect", fill: "ground", hold: true, y: 0, h: 100 });
    expect(wide.find((s) => s.fill === "second")).toMatchObject({ y: 100 });
    // Running text reaches the foot: no band under it.
    expect(wide.some((s) => s.fill === "accent" && s.y >= 289)).toBe(false);
  });
});
