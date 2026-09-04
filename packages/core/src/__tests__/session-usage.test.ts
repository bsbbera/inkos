import { describe, expect, it } from "vitest";
import {
  addUsage, byAgent, byModel, totalUsage, usageFromResponse,
  type UsageLedger,
} from "../llm/session-usage.js";

const call = (agent: string, model: string, input: number, output: number, reported = true) =>
  ({ agent, service: "claudeCli", model, input, output, reported });

describe("the session ledger", () => {
  it("keeps one row per agent and model, not per call", () => {
    let l: UsageLedger = {};
    l = addUsage(l, call("writer", "claude/sonnet", 100, 20));
    l = addUsage(l, call("writer", "claude/sonnet", 50, 10));
    const rows = byAgent(l);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ input: 150, output: 30, total: 180, calls: 2 });
  });

  it("separates the same model used by two agents", () => {
    // The whole point of routing: the writer and the auditor are different
    // spends even when they run on one model.
    let l: UsageLedger = {};
    l = addUsage(l, call("writer", "claude/sonnet", 100, 20));
    l = addUsage(l, call("auditor", "claude/sonnet", 10, 5));
    expect(byAgent(l)).toHaveLength(2);
    expect(byAgent(l)[0]?.agent).toBe("writer");   // biggest first
  });

  it("rolls the same rows up per model when asked the other way", () => {
    let l: UsageLedger = {};
    l = addUsage(l, call("writer", "claude/sonnet", 100, 20));
    l = addUsage(l, call("auditor", "claude/sonnet", 10, 5));
    const models = byModel(l);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ model: "claude/sonnet", total: 135, calls: 2 });
  });

  it("never shows an uncounted provider as having spent zero", () => {
    // devin over ACP reports no tokens. A measured zero and an unmeasured one
    // look identical as a number and mean opposite things.
    let l: UsageLedger = {};
    l = addUsage(l, { agent: "planner", service: "devinCli", model: "devin/glm-5-2", input: 0, output: 0, reported: false });
    expect(byAgent(l)[0]?.reported).toBe(false);
    expect(totalUsage(l).partial).toBe(true);
  });

  it("counts a row as measured once any one call reported", () => {
    let l: UsageLedger = {};
    l = addUsage(l, call("writer", "claude/sonnet", 0, 0, false));
    l = addUsage(l, call("writer", "claude/sonnet", 80, 10, true));
    expect(byAgent(l)[0]?.reported).toBe(true);
  });

  it("has no cost at all when nothing priced itself", () => {
    // Inventing a price per provider is the stale-seed failure again.
    let l: UsageLedger = {};
    l = addUsage(l, call("writer", "claude/sonnet", 100, 20));
    expect(totalUsage(l).costUsd).toBeNull();
    l = addUsage(l, { ...call("writer", "claude/sonnet", 1, 1), costUsd: 0.02 });
    expect(totalUsage(l).costUsd).toBeCloseTo(0.02);
  });

  it("reads the shim's own reporting block", () => {
    const e = usageFromResponse(
      { agent: "writer", service: "codexCli", model: "gpt-5" },
      { prompt_tokens: 19557, completion_tokens: 5, x_quire: { reported: true, cache_read_tokens: 9984 } },
    );
    expect(e).toMatchObject({ input: 19557, output: 5, cacheRead: 9984, reported: true });
  });

  it("reads reported off the count when nothing says otherwise", () => {
    // The shim's extra block does not survive the OpenAI client, and a table of
    // "which providers count" is the metadata that went stale last time. A
    // provider that does not count sends zero, and zero is the signal.
    expect(usageFromResponse({ agent: "a", model: "m" }, { prompt_tokens: 5, completion_tokens: 1 }).reported).toBe(true);
    expect(usageFromResponse({ agent: "a", model: "m" }, { prompt_tokens: 0, completion_tokens: 0 }).reported).toBe(false);
    expect(usageFromResponse({ agent: "a", model: "m" }, { x_quire: { reported: false }, prompt_tokens: 9 }).reported).toBe(false);
  });

  it("survives a response with no usage at all", () => {
    expect(usageFromResponse({ agent: "a", model: "m" }, null)).toMatchObject({ input: 0, output: 0 });
  });
});
