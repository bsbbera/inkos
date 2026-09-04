import { describe, expect, it } from "vitest";
import { countModels, filterGroups, type SearchGroup } from "./model-search";

const groups: SearchGroup[] = [
  { service: "devinCli", label: "Devin", models: [{ id: "devin/glm-5-2" }, { id: "devin/kimi" }] },
  { service: "claudeCli", label: "Claude Code", models: [{ id: "claude/sonnet" }, { id: "claude/opus" }] },
  { service: "ollama", label: "Ollama", models: [{ id: "gpt-oss:20b", name: "GPT OSS 20B" }] },
];

describe("model search", () => {
  it("returns everything for an empty query", () => {
    expect(countModels(filterGroups(groups, "  "))).toBe(5);
  });

  it("matches on the model id", () => {
    expect(filterGroups(groups, "glm")).toEqual([
      { service: "devinCli", label: "Devin", models: [{ id: "devin/glm-5-2" }] },
    ]);
  });

  it("matches the provider and the model together, in any order", () => {
    // The point of searching two fields: "glm" alone can hit several providers.
    expect(countModels(filterGroups(groups, "devin glm"))).toBe(1);
    expect(countModels(filterGroups(groups, "glm devin"))).toBe(1);
  });

  it("matches a display name, not only the id", () => {
    expect(filterGroups(groups, "oss 20b")[0]?.models[0]?.id).toBe("gpt-oss:20b");
  });

  it("drops groups with no match rather than showing an empty heading", () => {
    expect(filterGroups(groups, "sonnet").map((g) => g.service)).toEqual(["claudeCli"]);
    expect(filterGroups(groups, "nothing-here")).toEqual([]);
  });
});
