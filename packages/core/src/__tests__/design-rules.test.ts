import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  declaredBreaks, goldenRules, mathScopeOf, parseNumberRule, readMath, repairGoldenRules, writeMath,
} from "../pipeline/design-rules.js";
import type { DesignSpec } from "../pipeline/publication-design.js";

const page = (imageSlot: string, extra: Record<string, unknown> = {}) =>
  ({ layout: "x", imageSlot, ...extra });
const spec = (pages: Record<string, unknown>): DesignSpec => ({ pages } as unknown as DesignSpec);
const sections = [{ n: 1, label: "Light", from: 1, to: 4 }, { n: 2, label: "Dark", from: 5, to: 8 }];

describe("golden rules a spec can answer", () => {
  it("refuses three full-bleeds in a row, and allows two", () => {
    const run = spec({ 1: page("full-bleed"), 2: page("full-bleed"), 3: page("full-bleed"), 4: page("top") });
    expect(goldenRules(run, sections)).toEqual(["pages 1-3 are 3 full-bleeds in a row - the law is 2"]);
    expect(goldenRules(spec({ 1: page("full-bleed"), 2: page("full-bleed"), 3: page("top") }), sections)).toEqual([]);
    // Not in a row: a gap in the page numbers ends the run.
    expect(goldenRules(spec({ 1: page("full-bleed"), 2: page("full-bleed"), 4: page("full-bleed") }), sections)).toEqual([]);
  });

  it("rations declared breaks to one per section and wants each one explained", () => {
    const over = spec({ 1: page("top", { breaks: ["type crosses the gutter"] }), 2: page("top", { breaks: ["a red page"] }) });
    expect(goldenRules(over, sections)).toEqual(["Light declares 2 breaks - the law is 1"]);
    // One in each section is fine, and they are listed for the gate's badge.
    const fine = spec({ 1: page("top", { breaks: ["a"] }), 6: page("top", { breaks: ["b"] }) });
    expect(goldenRules(fine, sections)).toEqual([]);
    expect(declaredBreaks(fine)).toEqual([{ page: 1, note: "a" }, { page: 6, note: "b" }]);
    expect(goldenRules(spec({ 1: page("top", { breaks: [" "] }) }), sections)[0]).toContain("without saying what it breaks");
  });

  it("holds the numbers a taste rule has set", () => {
    const run = spec({ 1: page("full-bleed"), 2: page("full-bleed"), 3: page("top") });
    expect(goldenRules(run, sections, { maxFullBleedRun: 1 })).toEqual(["pages 1-2 are 2 full-bleeds in a row - the law is 1"]);
    const busy = spec({ 1: page("top", { blocks: [{ kind: "a", slot: "x" }, { kind: "b", slot: "y" }, { kind: "c", slot: "z" }] }) });
    expect(goldenRules(busy, sections, { maxBlocksPerPage: 2 })).toEqual(["page 1 carries 3 blocks - the law is 2"]);
    expect(goldenRules(busy, sections)).toEqual([]);
  });
});

describe("mending a spec before it is refused", () => {
  it("ends a run of full-bleeds, rations breaks and trims blocks, and says what it did", () => {
    const blocks = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "b" + i, slot: "x" }));
    const broken = spec({
      1: page("full-bleed"), 2: page("full-bleed"), 3: page("full-bleed"), 4: page("full-bleed"),
      5: page("top", { breaks: ["a"] }), 6: page("top", { breaks: ["b"], blocks: blocks(5) }),
    });
    const { spec: mended, repairs } = repairGoldenRules(broken, sections, { maxBlocksPerPage: 3 });
    expect(repairs).toEqual([
      "page 3: full-bleed became a top picture, to end a run of 3",
      "page 6: dropped a break past the section's 1",
      "page 6: kept the first 3 of 5 blocks",
    ]);
    expect(goldenRules(mended, sections, { maxBlocksPerPage: 3 })).toEqual([]);
    // The original is not touched, and a clean spec comes back unchanged.
    expect(goldenRules(broken, sections).length).toBeGreaterThan(0);
    expect(repairGoldenRules(mended, sections, { maxBlocksPerPage: 3 }).repairs).toEqual([]);
  });
});

describe("number rules", () => {
  it("reads the sentences the engine writes, and nothing else", () => {
    expect(parseNumberRule("No more than 1 full-bleed in a row")).toEqual({ key: "maxFullBleedRun", value: 1 });
    expect(parseNumberRule("At most 3 blocks per page")).toEqual({ key: "maxBlocksPerPage", value: 3 });
    expect(parseNumberRule("Whitespace ≥ 18%")).toEqual({ key: "minWhitespace", value: 0.18 });
    expect(parseNumberRule("Dominant element at least 50%")).toEqual({ key: "dominantMin", value: 0.5 });
    expect(parseNumberRule("Prefer warmer photographs")).toBeNull();
  });

  it("is kept per scope and read back layered, the issue last", async () => {
    const root = await mkdtemp(join(tmpdir(), "quire-math-"));
    try {
      await writeMath(root, mathScopeOf({}), "maxFullBleedRun", 1);
      await writeMath(root, mathScopeOf({ world: "riso" }), "maxBlocksPerPage", 4);
      await writeMath(root, mathScopeOf({ work: "publication/i1" }), "maxFullBleedRun", 2);
      expect(await readMath(root, { type: "publication", id: "i1", worlds: ["riso"] }))
        .toEqual({ maxFullBleedRun: 2, maxBlocksPerPage: 4 });
      // Another issue keeps the global limit and does not see the first one's.
      expect(await readMath(root, { type: "publication", id: "i2", worlds: [] })).toEqual({ maxFullBleedRun: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

afterAll(() => undefined);
