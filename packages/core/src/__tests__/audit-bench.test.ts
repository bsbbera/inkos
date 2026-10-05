import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  benchFromSettled, benchSummary, readBench, runBench, writeBenchCase, type BenchCase,
} from "../pipeline/audit-bench.js";
import { noAuditPack, parseAuditPack, resolveAuditPack } from "../pipeline/audit-pack.js";
import { slopScore } from "../agents/slop-score.js";
import { auditProposals, type TasteEvent } from "../pipeline/taste-engine.js";

/* A passage with every machine habit: same-length paragraphs, hedges, joins. */
const SLOPPY = [
  "It seems the lamp was perhaps lit, and however the room stayed dark somehow.",
  "It seems the door was perhaps shut, and however the hall stayed cold somehow.",
  "It seems the clock was perhaps slow, and however the hour stayed late somehow.",
  "It seems the fire was perhaps out, and however the grate stayed warm somehow.",
].join("\n\n");

const HUMAN = [
  "The lamp guttered.",
  "She had been standing at the window for an hour, long enough that the cold had come up through the boards and settled in her heels, and still the road stayed empty. Somewhere below, a door closed. Not his.",
  "Rain.",
].join("\n\n");

describe("the local slop score", () => {
  it("scores machine habits above careful prose, and never claims certainty", () => {
    const bad = slopScore(SLOPPY, "en");
    const good = slopScore(HUMAN, "en");
    expect(bad.score).toBeGreaterThan(good.score);
    expect(bad.provider).toBe("local");
    expect(bad.reasons.length).toBeGreaterThan(0);
    // Never 1: a count of habits is not proof of authorship.
    expect(bad.score).toBeLessThanOrEqual(0.95);
    expect(good.score).toBeGreaterThanOrEqual(0);
  });

  it("counts a word the pack added", () => {
    const text = Array.from({ length: 12 }, () => "The lamp was nestled there.").join(" ");
    const pack = resolveAuditPack({
      available: [parseAuditPack({
        id: "p", version: 1, deterministic: { hedgeWords: { add: ["nestled"] } },
      })!],
      selected: ["p"],
    });
    expect(slopScore(text, "en", pack).score).toBeGreaterThan(slopScore(text, "en").score);
  });
});

describe("the bench", () => {
  const cases: BenchCase[] = [
    { id: "known-bad", type: "book", text: SLOPPY, catches: ["ai-tell"] },
    { id: "known-good", type: "book", text: HUMAN, allows: ["ai-tell"] },
  ];

  it("passes when the criteria still judge both passages the same way", async () => {
    const run = await runBench(cases, noAuditPack());
    expect(run.ok).toBe(true);
    expect(benchSummary(run)).toContain("All 2");
  });

  it("reports the check going quiet when a pack silences it", async () => {
    const silent = resolveAuditPack({
      available: [parseAuditPack({ id: "q", version: 1, dimensions: { disable: ["ai-tell"] } })!],
      selected: ["q"],
    });
    const run = await runBench(cases, silent);
    expect(run.ok).toBe(false);
    expect(run.results.find((r) => r.id === "known-bad")?.missed).toContain("ai-tell");
    // The known-good passage is still fine — silence cannot make it noisy.
    expect(run.results.find((r) => r.id === "known-good")?.ok).toBe(true);
    expect(benchSummary(run)).toContain("no longer caught");
  });

  it("turns settled findings into cases the person's own way round", () => {
    const out = benchFromSettled([
      {
        id: "f1", path: "books/a/ch1.md", category: "ai-tell/Hedge density", state: "accepted",
        quote: "seems", paragraph: SLOPPY,
      },
      {
        id: "f2", path: "books/a/ch2.md", category: "readability/sentence", state: "ignored",
        quote: "x", paragraph: HUMAN,
      },
      // Too short to mean anything on its own — dropped rather than kept as noise.
      { id: "f3", path: "books/a/ch3.md", category: "x", state: "accepted", quote: "y", paragraph: "Short." },
    ], "book");
    expect(out.map((c) => c.id)).toEqual(["f1", "f2"]);
    expect(out[0]!.catches).toEqual(["ai-tell/Hedge density"]);
    expect(out[1]!.allows).toEqual(["readability/sentence"]);
  });

  it("reads back what it wrote, filtered by type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quire-bench-"));
    try {
      await writeBenchCase(dir, cases[0]!);
      await writeBenchCase(dir, { ...cases[1]!, type: "short" });
      expect((await readBench(dir)).map((c) => c.id).sort()).toEqual(["known-bad", "known-good"]);
      expect((await readBench(dir, "book")).map((c) => c.id)).toEqual(["known-bad"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("checks the person keeps waving away", () => {
  const verdict = (n: number, category: string, keep: boolean): TasteEvent => ({
    id: `fb${n}`, at: "2026-09-11T00:00:00Z",
    ref: { type: "book", id: "one" },
    surface: "content", verdict: keep ? "keep" : "reject",
    source: "audit", scope: { audit: category },
  });

  it("proposes silencing one ignored four times in five, and nothing under ten verdicts", () => {
    // Twelve of fifteen left alone: exactly the four-in-five the rule asks for.
    const ignored = Array.from({ length: 15 }, (_, i) => verdict(i, "ai-tell/Hedge density", i % 5 === 0));
    const out = auditProposals(ignored, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain("ai-tell/Hedge density");
    expect(out[0]!.scope).toEqual({ surface: "content", work: "book/one", audit: "ai-tell/Hedge density" });

    // Nine verdicts is not yet a pattern, however one-sided.
    expect(auditProposals(ignored.slice(0, 9), [])).toEqual([]);
    // Ten verdicts but only seven ignored is under the bar, so nothing is proposed.
    expect(auditProposals(
      Array.from({ length: 10 }, (_, i) => verdict(i, "pacing", i < 3)), [])).toEqual([]);
    // A check whose fixes get taken is left alone.
    expect(auditProposals(
      Array.from({ length: 12 }, (_, i) => verdict(i, "continuity", true)), [])).toEqual([]);
  });

  it("does not propose the same thing twice", () => {
    const events = Array.from({ length: 12 }, (_, i) => verdict(i, "ai-tell", false));
    const first = auditProposals(events, []);
    expect(auditProposals(events, first.map((p) => ({ text: p.text, scope: p.scope })))).toEqual([]);
  });
});
