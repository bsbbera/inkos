import { describe, expect, it } from "vitest";
import { validateDefinition } from "../publications/types.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Read rather than import: the definition is data the build copies, not a
// module, and importing JSON would tie the test to the module resolution the
// package happens to use today.
const def = JSON.parse(readFileSync(
  join(import.meta.dirname, "../../publications/magazine.json"),
  "utf-8",
)) as Record<string, unknown>;

describe("block declarations", () => {
  it("ships a magazine whose blocks validate", () => {
    expect(validateDefinition(def as never)).toEqual([]);
  });

  it("refuses a block kind no archetype could carry", () => {
    const broken = { ...def, blocks: { kinds: ["caption"], byArchetype: { feature: ["stat"] } } };
    expect(validateDefinition(broken as never).join(" ")).toMatch(/unknown kind stat/);
  });

  it("refuses an allowance for an archetype that does not exist", () => {
    const broken = { ...def, blocks: { kinds: ["caption"], byArchetype: { nope: ["caption"] } } };
    expect(validateDefinition(broken as never).join(" ")).toMatch(/unknown archetype nope/);
  });

  it("gives a full-bleed plate no blocks at all", () => {
    expect((def as { blocks: { byArchetype: Record<string, string[]> } }).blocks.byArchetype.plate)
      .toEqual([]);
  });
});
