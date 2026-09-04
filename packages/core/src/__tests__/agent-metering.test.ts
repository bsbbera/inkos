import { beforeEach, describe, expect, it, vi } from "vitest";

const runWorkerAgentMock = vi.hoisted(() => vi.fn());
vi.mock("../agent/worker-agent.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runWorkerAgent: runWorkerAgentMock,
}));

const { BaseAgent } = await import("../agents/base.js");
import type { AgentContext } from "../agents/base.js";
import type { LLMMessage, LLMResponse } from "../llm/provider.js";
import { addUsage, byAgent, totalUsage, type UsageLedger } from "../llm/session-usage.js";

class Probe extends BaseAgent {
  readonly name = "probe";

  run(messages: ReadonlyArray<LLMMessage>): Promise<LLMResponse> {
    return this.chat(messages);
  }
}

const ctx = (over: Partial<AgentContext>): AgentContext => ({
  client: { service: "claudeCli" } as AgentContext["client"],
  model: "claude/sonnet",
  projectRoot: process.cwd(),
  ...over,
});

const said = (promptTokens: number, completionTokens: number): LLMResponse => ({
  content: "ok",
  usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
});

describe("what a completion reports", () => {
  beforeEach(() => runWorkerAgentMock.mockReset());

  it("names the agent that spent it, not just the model", () => {
    // The point of the split: two agents on one model are two spends.
    const seen: Array<{ agent: string; model: string; input: number }> = [];
    runWorkerAgentMock.mockResolvedValue(said(120, 30));
    return new Probe(ctx({ agent: "writer", onUsage: (e) => seen.push(e) }))
      .run([{ role: "user", content: "x" }])
      .then(() => {
        expect(seen).toEqual([{
          agent: "writer", service: "claudeCli", model: "claude/sonnet",
          input: 120, output: 30, reported: true,
        }]);
      });
  });

  it("marks a provider that counted nothing as unreported", async () => {
    // devin over ACP sends no token counts, and the shim no longer invents an
    // estimate — so zero arrives, and zero must not read as a measured zero.
    const seen: Array<{ reported: boolean }> = [];
    runWorkerAgentMock.mockResolvedValue(said(0, 0));
    await new Probe(ctx({ agent: "planner", onUsage: (e) => seen.push(e) }))
      .run([{ role: "user", content: "x" }]);
    expect(seen[0]?.reported).toBe(false);
  });

  it("stays silent when nobody is listening, and returns the reply either way", async () => {
    runWorkerAgentMock.mockResolvedValue(said(5, 5));
    const reply = await new Probe(ctx({ agent: "writer" })).run([{ role: "user", content: "x" }]);
    expect(reply.content).toBe("ok");
  });

  it("feeds the ledger the settings page reads", async () => {
    let ledger: UsageLedger = {};
    runWorkerAgentMock.mockResolvedValue(said(100, 20));
    await new Probe(ctx({ agent: "writer", onUsage: (e) => { ledger = addUsage(ledger, e); } }))
      .run([{ role: "user", content: "x" }]);
    runWorkerAgentMock.mockResolvedValue(said(0, 0));
    await new Probe(ctx({
      agent: "planner",
      client: { service: "devinCli" } as AgentContext["client"],
      model: "devin/glm-5-2",
      onUsage: (e) => { ledger = addUsage(ledger, e); },
    })).run([{ role: "user", content: "x" }]);

    const rows = byAgent(ledger);
    expect(rows.map((r) => r.agent)).toEqual(["writer", "planner"]);
    expect(rows[1]?.reported).toBe(false);
    // One row could not be counted, so the total is a floor, not a sum.
    expect(totalUsage(ledger)).toMatchObject({ total: 120, partial: true });
  });
});
