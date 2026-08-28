import { describe, expect, it } from "vitest";
import { splitModelId, toFamilies } from "./model-picker-state";

describe("splitModelId", () => {
  it("separates the effort from the model", () => {
    expect(splitModelId("devin/claude-opus-5-medium"))
      .toEqual({ base: "devin/claude-opus-5", variant: "medium" });
  });

  it("takes a delivery mode alongside the effort", () => {
    expect(splitModelId("devin/gpt-5-6-sol-xhigh-priority"))
      .toEqual({ base: "devin/gpt-5-6-sol", variant: "xhigh priority" });
    expect(splitModelId("devin/glm-5-2-none-1m"))
      .toEqual({ base: "devin/glm-5-2", variant: "none 1m" });
  });

  it("leaves a model with no variant alone", () => {
    expect(splitModelId("claude/opus")).toEqual({ base: "claude/opus", variant: "" });
    expect(splitModelId("codex/gpt-5.5")).toEqual({ base: "codex/gpt-5.5", variant: "" });
  });

  // A model whose own name ends in one of these words is still a model.
  it("never eats the whole name", () => {
    expect(splitModelId("devin/max")).toEqual({ base: "devin/max", variant: "" });
  });

  it("keeps a word that only looks like a variant", () => {
    expect(splitModelId("devin/swe-1-7-lightning-medium"))
      .toEqual({ base: "devin/swe-1-7-lightning", variant: "medium" });
  });
});

describe("toFamilies", () => {
  it("collapses the five efforts of one model into one row", () => {
    const families = toFamilies([
      { id: "devin/claude-opus-5-high" },
      { id: "devin/claude-opus-5-low" },
      { id: "devin/claude-opus-5-max" },
      { id: "devin/kimi-k3-high" },
    ]);
    expect(families.map((f) => f.base)).toEqual(["devin/claude-opus-5", "devin/kimi-k3"]);
    expect(families[0]!.variants.map((v) => v.variant)).toEqual(["low", "high", "max"]);
  });

  it("orders variants by how hard the model is asked to think", () => {
    const [family] = toFamilies([
      { id: "m/x-max" }, { id: "m/x-none" }, { id: "m/x-medium" }, { id: "m/x-xhigh" },
    ]);
    expect(family!.variants.map((v) => v.variant)).toEqual(["none", "medium", "xhigh", "max"]);
  });

  it("carries the context window through for the row to show", () => {
    const [family] = toFamilies([{ id: "m/x-high", contextWindow: 200000 }]);
    expect(family!.variants[0]!.contextWindow).toBe(200000);
  });

  // 183 flat strings is the number that made the picker unusable.
  it("turns devin's catalogue into something countable", () => {
    const ids = ["claude-opus-5", "claude-sonnet-5", "gpt-5-6-sol", "glm-5-2", "kimi-k3"]
      .flatMap((base) => ["none", "low", "medium", "high", "xhigh", "max"]
        .map((effort) => ({ id: `devin/${base}-${effort}` })));
    expect(ids).toHaveLength(30);
    expect(toFamilies(ids)).toHaveLength(5);
  });
});
