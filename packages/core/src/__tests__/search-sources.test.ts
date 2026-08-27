import { describe, expect, it } from "vitest";
import { parseMcpResults, searchAllSources, type SearchSource } from "../utils/search-sources.js";
import { modelCapabilities, modelSearchesWeb } from "../llm/providers/lookup.js";

const source = (id: string, rows: Array<{ title: string; url: string; snippet: string }>): SearchSource => ({
  id,
  kind: "mcp",
  run: async (_q, limit) => rows.slice(0, limit),
});

const failing = (id: string, why: string): SearchSource => ({
  id,
  kind: "mcp",
  run: async () => { throw new Error(why); },
});

describe("model capability", () => {
  // The whole point of A: a provider declares once, every model inherits.
  it("gives a probed model its provider's declaration", () => {
    // Not in the ten-model seed; devin serves 183.
    expect(modelSearchesWeb("devinCli", "devin/some-model-added-last-tuesday")).toBe(true);
  });

  it("lets a model card override the provider default", () => {
    expect(modelCapabilities("devinCli", "devin/glm-5-2").imageInput).toBe(false);
    expect(modelCapabilities("devinCli", "devin/kimi-k3-high").imageInput).toBe(true);
  });

  it("does not claim search for a provider that never declared it", () => {
    expect(modelSearchesWeb("deepseek", "deepseek-chat")).toBe(false);
  });

  it("still answers for a model nobody has ever heard of", () => {
    expect(modelSearchesWeb("nosuchprovider", "nosuchmodel")).toBe(false);
  });
});

describe("parseMcpResults", () => {
  it("reads a JSON results array", () => {
    const text = JSON.stringify({ results: [
      { title: "Kolam", url: "https://example.com/a", snippet: "one line" },
    ] });
    expect(parseMcpResults(text, 5)).toEqual([
      { title: "Kolam", url: "https://example.com/a", snippet: "one line" },
    ]);
  });

  it("reads a bare JSON array with link/description keys", () => {
    const text = JSON.stringify([{ name: "B", link: "https://example.com/b", description: "d" }]);
    expect(parseMcpResults(text, 5)).toEqual([
      { title: "B", url: "https://example.com/b", snippet: "d" },
    ]);
  });

  it("falls back to markdown links when the server answers in prose", () => {
    const text = "Found two: [First](https://example.com/1) and [Second](https://example.com/2).";
    expect(parseMcpResults(text, 5).map((r) => r.url))
      .toEqual(["https://example.com/1", "https://example.com/2"]);
  });

  it("does not count the same url twice across both scans", () => {
    const text = "[A](https://example.com/a) — see also https://example.com/a";
    expect(parseMcpResults(text, 5)).toHaveLength(1);
  });

  it("returns nothing rather than guessing when there are no urls", () => {
    expect(parseMcpResults("I could not search just now.", 5)).toEqual([]);
  });

  it("honours the limit", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, url: `https://e.com/${i}`, snippet: "" }));
    expect(parseMcpResults(JSON.stringify(rows), 5)).toHaveLength(5);
  });
});

describe("searchAllSources", () => {
  const a = { title: "A", url: "https://example.com/a", snippet: "" };
  const b = { title: "B", url: "https://example.com/b", snippet: "" };

  // First-provider-wins was the old rule, and it meant a configured Brave key
  // never ran while Tavily answered.
  it("asks every source, not just the first that answers", async () => {
    const sweep = await searchAllSources([source("tavily", [a]), source("brave", [b])], "q");
    expect(sweep.answered).toEqual(["tavily", "brave"]);
    expect(sweep.results.map((r) => r.url)).toEqual([a.url, b.url]);
  });

  it("keeps the first mention when two sources agree on a url", async () => {
    const sweep = await searchAllSources([source("tavily", [a]), source("brave", [a, b])], "q");
    expect(sweep.results).toHaveLength(2);
    expect(sweep.results[0]!.source).toBe("tavily");
  });

  it("records where each result came from", async () => {
    const sweep = await searchAllSources([source("mcp/tavily-mcp", [a])], "q");
    expect(sweep.results[0]!.source).toBe("mcp/tavily-mcp");
  });

  it("one broken source does not lose the others", async () => {
    const sweep = await searchAllSources([failing("brave", "401"), source("tavily", [a])], "q");
    expect(sweep.results.map((r) => r.url)).toEqual([a.url]);
    expect(sweep.failures).toEqual(["brave: 401"]);
  });

  it("takes at most perSource from each", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `${i}`, url: `https://e.com/${i}`, snippet: "" }));
    const sweep = await searchAllSources([source("tavily", many)], "q", 5);
    expect(sweep.results).toHaveLength(5);
  });

  it("says so plainly when nothing is configured", async () => {
    const sweep = await searchAllSources([], "q");
    expect(sweep.results).toEqual([]);
    expect(sweep.failures[0]).toMatch(/no search source/);
  });
});
