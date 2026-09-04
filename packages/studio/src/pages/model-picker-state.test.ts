import { describe, expect, it } from "vitest";
import { modelLabel, prettyModelName, scopeToProvider, splitModelId, toFamilies } from "./model-picker-state";

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

describe("prettyModelName", () => {
  it("writes the name a person would say, not the slug the CLI returns", () => {
    expect(prettyModelName("devin/claude-sonnet-5", "high")).toBe("Claude Sonnet 5 High");
    expect(prettyModelName("antigravity/gemini-3.7-flash", "low")).toBe("Gemini 3.7 Flash Low");
  });

  it("keeps the casing conventions the vendors use", () => {
    expect(prettyModelName("devin/glm-5-2")).toBe("GLM 5 2");
    expect(prettyModelName("devin/gpt-5-6-sol", "xhigh")).toBe("GPT 5 6 Sol XHigh");
    expect(prettyModelName("devin/swe-1-7")).toBe("SWE 1 7");
    expect(prettyModelName("antigravity/gpt-oss-120b", "medium")).toBe("GPT OSS 120b Medium");
  });

  it("says nothing extra for a model with no variants", () => {
    expect(prettyModelName("claude/haiku")).toBe("Haiku");
  });

  it("drops the provider prefix, which the strip already says", () => {
    expect(prettyModelName("devin/kimi-k3", "max")).toBe("Kimi K3 Max");
  });
});

describe("scopeToProvider", () => {
  const groups = [
    { service: "devin", label: "Devin" },
    { service: "antigravity", label: "Antigravity" },
  ];

  it("shows the provider that is selected", () => {
    expect(scopeToProvider(groups, "antigravity").current?.service).toBe("antigravity");
  });

  it("offers every provider to switch to, whichever is showing", () => {
    expect(scopeToProvider(groups, "devin").providers).toHaveLength(2);
  });

  it("falls back to the first rather than rendering an empty list", () => {
    // The selected provider can disappear — a CLI uninstalled, a rescan. An
    // empty picker reads as "no models exist", which sends people to Settings
    // to fix something that is not broken.
    expect(scopeToProvider(groups, "codex").current?.service).toBe("devin");
    expect(scopeToProvider(groups, null).current?.service).toBe("devin");
  });

  it("has nothing to show when nothing is connected", () => {
    expect(scopeToProvider([], "devin")).toEqual({ current: null, providers: [] });
  });
});

describe("modelLabel", () => {
  it("uses the name the CLI sent, not a name derived from the slug", () => {
    // Devin sends this verbatim over ACP. No rule turns `glm-5-2` into
    // "GLM-5.2 High" — the version separators are not in the id and the
    // default effort is not either. The whole bug was discarding it.
    expect(modelLabel({ id: "devin/glm-5-2", variant: "", name: "GLM-5.2 High" }, "devin/glm-5-2"))
      .toBe("GLM-5.2 High");
    expect(modelLabel({ id: "devin/glm-5-2-none", variant: "none", name: "GLM-5.2 No Thinking" },
      "devin/glm-5-2")).toBe("GLM-5.2 No Thinking");
  });

  it("falls back to the tidied slug when a CLI sends no name", () => {
    expect(modelLabel({ id: "claude/haiku", variant: "" }, "claude/haiku")).toBe("Haiku");
  });
});

describe("toFamilies keeps the vendor's name", () => {
  it("carries a name through to the variant", () => {
    const [family] = toFamilies([{ id: "devin/glm-5-2-max", name: "GLM-5.2 Max" }]);
    expect(family!.variants[0]!.name).toBe("GLM-5.2 Max");
  });

  it("ignores a name that is only the id echoed back", () => {
    // The studio's models route fills `name: id` for endpoints that send none.
    // Treating that as a real name would silence the fallback that tidies it.
    const [family] = toFamilies([{ id: "claude/haiku", name: "claude/haiku" }]);
    expect(family!.variants[0]!.name).toBeUndefined();
    expect(modelLabel(family!.variants[0]!, family!.base)).toBe("Haiku");
  });
});
