import { describe, expect, it } from "vitest";
import { addUsage, type UsageLedger } from "@actalk/quire-core/llm/session-usage";
import { compact, ledgerLines, ledgerTotal } from "./session-ledger-state";

const build = (...events: Array<Parameters<typeof addUsage>[1]>) =>
  events.reduce<UsageLedger>((l, e) => addUsage(l, e), {});

const spend = (agent: string, model: string, input: number, output: number, reported = true) =>
  ({ agent, service: "claudeCli", model, input, output, reported });

describe("how a number reads", () => {
  it("keeps small counts exact and abbreviates large ones", () => {
    // Nobody wants 340 rendered as 0.3k.
    expect(compact(340)).toBe("340");
    expect(compact(18_600)).toBe("19k");
    expect(compact(1_240)).toBe("1.2k");
    expect(compact(2_400_000)).toBe("2.4M");
  });
});

describe("the rows", () => {
  const ledger = build(
    spend("writer", "claude/sonnet", 18_000, 600),
    spend("auditor", "claude/sonnet", 1_000, 300),
    { agent: "planner", service: "devinCli", model: "devin/glm-5-2", input: 0, output: 0, reported: false },
  );

  it("lists the biggest spender first", () => {
    expect(ledgerLines(ledger, "agent").map((l) => l.who)).toEqual(["writer", "auditor", "planner"]);
  });

  it("says a provider did not report, rather than showing it as zero", () => {
    const planner = ledgerLines(ledger, "agent").find((l) => l.who === "planner");
    expect(planner).toMatchObject({ tokens: "not reported", reported: false });
  });

  it("regroups the same spend per model", () => {
    const models = ledgerLines(ledger, "model");
    expect(models).toHaveLength(2);
    expect(models[0]?.model).toBe("claude/sonnet");
    expect(models[0]?.who).toBe("2 calls");
  });

  it("mentions cache and searches only when the provider said so", () => {
    const withNote = build({ ...spend("writer", "claude/sonnet", 100, 20), cacheRead: 9_984, webSearches: 1 });
    expect(ledgerLines(withNote, "agent")[0]?.note).toBe("10k cached · 1 search");
    expect(ledgerLines(ledger, "agent")[0]?.note).toBeNull();
  });

  it("is empty before anything has run", () => {
    expect(ledgerLines(undefined, "agent")).toEqual([]);
    expect(ledgerTotal(undefined)).toBeNull();
    expect(ledgerTotal({})).toBeNull();
  });
});

describe("the total", () => {
  it("is a total when every row was counted", () => {
    expect(ledgerTotal(build(spend("writer", "claude/sonnet", 100, 20))))
      .toMatchObject({ tokens: "120", partial: false, label: "total" });
  });

  it("becomes a floor when any row was not", () => {
    // A sum that silently omits an uncounted provider is a claim, not a figure.
    const ledger = build(
      spend("writer", "claude/sonnet", 100, 20),
      { agent: "planner", service: "devinCli", model: "devin/glm-5-2", input: 0, output: 0, reported: false },
    );
    expect(ledgerTotal(ledger)).toMatchObject({ tokens: "120", partial: true, label: "at least" });
  });
});
