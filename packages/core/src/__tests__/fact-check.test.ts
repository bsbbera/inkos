import { describe, expect, it, vi } from "vitest";
import { factCheck, factCheckReport, isProblem } from "../pipeline/fact-check.js";
import type { SearchSource } from "../utils/search-sources.js";

const source = (rows: Array<{ title: string; url: string; snippet: string }>): SearchSource => ({
  id: "tavily",
  kind: "key",
  run: async () => rows,
});

const hit = { title: "Kodaikanal survey", url: "https://example.com/k", snippet: "312 households." };

const ask = (extract: unknown, verify: unknown) => vi.fn(async (_p: string, label: string) => (
  label.startsWith("factcheck:extract") ? extract : verify
) as Record<string, unknown>);

describe("factCheck", () => {
  it("checks each extracted claim and keeps the verdict", async () => {
    const result = await factCheck({
      text: "6,393 kolams were recorded across 312 households in 2009.",
      where: "p14",
      ask: ask(
        { claims: [{ claim: "312 households", cited_source: "" }] },
        { verdict: "contradicted", note: "the survey says 213", sources: ["https://example.com/k"] },
      ),
      sources: [source([hit])],
    });
    expect(result.checked).toBe(1);
    expect(result.findings[0]).toMatchObject({
      where: "p14",
      verdict: "contradicted",
      note: "the survey says 213",
    });
    expect(result.searchedWith).toEqual(["tavily"]);
  });

  // The stage exists to catch invented precision, which is what the kolam
  // issue's own audit found by accident sixteen pages late.
  it("marks a figure nothing confirms as unsupported, not supported", async () => {
    const result = await factCheck({
      text: "A figure.",
      where: "p14",
      ask: ask({ claims: [{ claim: "6,393 kolams" }] }, { verdict: "unsupported", note: "not in any result" }),
      sources: [source([hit])],
    });
    expect(isProblem(result.findings[0]!)).toBe(true);
  });

  it("returns nothing checkable rather than inventing something to check", async () => {
    const result = await factCheck({
      text: "The line comes home.",
      where: "p2",
      ask: ask({ claims: [] }, {}),
      sources: [source([hit])],
    });
    expect(result.checked).toBe(0);
    expect(result.findings).toEqual([]);
  });

  // A dead provider is not the writing being wrong, and saying so would send
  // the user to rewrite a page that may well be correct.
  it("calls a claim unverifiable when the search itself failed", async () => {
    const broken: SearchSource = { id: "brave", kind: "key", run: async () => { throw new Error("401"); } };
    const result = await factCheck({
      text: "A figure.",
      where: "p5",
      ask: ask({ claims: [{ claim: "some number" }] }, {}),
      sources: [broken],
    });
    expect(result.findings[0]!.verdict).toBe("unverifiable");
    expect(isProblem(result.findings[0]!)).toBe(false);
  });

  it("does nothing at all with no sources, and does not call the model", async () => {
    const spy = ask({ claims: [{ claim: "x" }] }, {});
    const result = await factCheck({ text: "A figure.", where: "p1", ask: spy, sources: [] });
    expect(result.checked).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not trust a verdict the model made up", async () => {
    const result = await factCheck({
      text: "A figure.",
      where: "p1",
      ask: ask({ claims: [{ claim: "x" }] }, { verdict: "definitely true" }),
      sources: [source([hit])],
    });
    expect(result.findings[0]!.verdict).toBe("unverifiable");
  });

  it("honours the claim limit", async () => {
    const claims = Array.from({ length: 20 }, (_, i) => ({ claim: `c${i}` }));
    const result = await factCheck({
      text: "many",
      where: "p1",
      ask: ask({ claims }, { verdict: "supported" }),
      sources: [source([hit])],
      limit: 3,
    });
    expect(result.checked).toBe(3);
  });
});

describe("factCheckReport", () => {
  it("leads with the problems and says how many were checked", () => {
    const text = factCheckReport({
      at: "now",
      checked: 4,
      searchedWith: ["tavily"],
      findings: [
        { where: "p1", claim: "fine", verdict: "supported", note: "", sources: [] },
        { where: "p14", claim: "6,393 kolams", verdict: "unsupported", note: "nothing says this", sources: [] },
      ],
    });
    expect(text).toContain("4 claims checked · 1 worth acting on");
    expect(text).toContain("p14 — unsupported");
    expect(text).not.toContain("fine");
  });

  it("says so plainly when there was nothing to check", () => {
    expect(factCheckReport({ at: "now", checked: 0, findings: [], searchedWith: [] }))
      .toBe("Nothing checkable in this text.");
  });
});
