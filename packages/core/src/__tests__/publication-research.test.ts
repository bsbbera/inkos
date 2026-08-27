import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findingsFor, researchPublication, searchProviders } from "../pipeline/publication-research.js";

const root = () => mkdtempSync(join(tmpdir(), "pub-research-"));

describe("searchProviders", () => {
  const saved = { tavily: process.env.TAVILY_API_KEY, brave: process.env.BRAVE_API_KEY };
  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;
  });
  afterEach(() => {
    if (saved.tavily) process.env.TAVILY_API_KEY = saved.tavily;
    else delete process.env.TAVILY_API_KEY;
    if (saved.brave) process.env.BRAVE_API_KEY = saved.brave;
    else delete process.env.BRAVE_API_KEY;
  });

  it("finds nothing when nothing is configured", async () => {
    const dir = root();
    try {
      expect(await searchProviders(dir)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("takes the configured provider before the environment", async () => {
    const dir = root();
    process.env.TAVILY_API_KEY = "env-key";
    writeFileSync(join(dir, "inkos.json"), JSON.stringify({
      researchSearch: { enabled: true, provider: "brave", apiKey: "cfg-key" },
    }));
    try {
      const found = await searchProviders(dir);
      expect(found[0]).toMatchObject({ provider: "brave", apiKey: "cfg-key" });
      expect(found.map((p) => p.provider)).toContain("tavily");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("researchPublication", () => {
  // The failure this exists for: with no way to search, the old stage happily
  // produced a research report out of the model's memory and every page below
  // it inherited unverifiable claims.
  it("refuses to research from memory when no provider is configured", async () => {
    const dir = root();
    const savedT = process.env.TAVILY_API_KEY;
    const savedB = process.env.BRAVE_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;
    const ask = vi.fn();
    try {
      await expect(researchPublication({
        projectRoot: dir,
        cachePath: join(dir, "cache.json"),
        subject: "film photography",
        pillars: ["what"],
        ask,
      })).rejects.toThrow(/no web search is configured/);
      expect(ask).not.toHaveBeenCalled();
    } finally {
      if (savedT) process.env.TAVILY_API_KEY = savedT;
      if (savedB) process.env.BRAVE_API_KEY = savedB;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops a claim whose source was never in the results", async () => {
    const dir = root();
    process.env.TAVILY_API_KEY = "test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: "Grain", url: "https://example.com/grain", content: "Kodak Gold 200." }],
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const ask = vi.fn()
      .mockResolvedValueOnce({ title: "Grain", thesis: "t", queries: { what: ["q"] } })
      .mockResolvedValueOnce({ findings: [
        { claim: "real", kind: "figure", source_url: "https://example.com/grain" },
        { claim: "invented", kind: "fact", source_url: "https://nowhere.example/made-up" },
      ] });

    try {
      const report = await researchPublication({
        projectRoot: dir,
        cachePath: join(dir, "cache.json"),
        subject: "film photography",
        pillars: ["what"],
        ask,
      });
      const claims = report.pillars.what!.findings.map((f) => f.claim);
      expect(claims).toEqual(["real"]);
      expect(findingsFor(report, "what")).toContain("https://example.com/grain");
    } finally {
      vi.unstubAllGlobals();
      delete process.env.TAVILY_API_KEY;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves a repeated query from the cache instead of searching again", async () => {
    const dir = root();
    process.env.TAVILY_API_KEY = "test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: "Grain", url: "https://example.com/grain", content: "Kodak Gold 200." }],
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const ask = vi.fn()
      .mockResolvedValue({ title: "Grain", thesis: "t", queries: { what: ["q"] }, findings: [] });

    try {
      const once = {
        projectRoot: dir,
        cachePath: join(dir, "cache.json"),
        subject: "film photography",
        pillars: ["what"],
        ask,
      };
      // Count searches, not fetches: resolving the source list also asks the
      // shim which MCP servers are enabled, and that happens once per run
      // whether or not the query itself is cached.
      const searches = () => fetchMock.mock.calls.filter(
        ([url]) => !String(url).includes("/mcp/"),
      ).length;
      await researchPublication(once);
      expect(searches()).toBe(1);
      await researchPublication(once);
      expect(searches()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.TAVILY_API_KEY;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
