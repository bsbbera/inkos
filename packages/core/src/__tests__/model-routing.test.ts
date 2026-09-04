import { describe, expect, it } from "vitest";
import {
  normalizeOverrides,
  resolveAgentRoute,
  resolveRoutingTable,
} from "../llm/model-routing.js";
import { AGENT_ROSTER, agentRole, canonicalAgentId } from "../llm/agent-roster.js";

const global = { service: "claudeCli", model: "claude/opus" };

describe("an agent with no pin", () => {
  it("uses the global model, and says so", () => {
    const route = resolveAgentRoute({ agent: "writer", global });
    expect(route).toEqual({ ...global, source: "global" });
  });

  it("is unaffected by a pin on some other agent", () => {
    const route = resolveAgentRoute({
      agent: "auditor", global,
      overrides: { writer: "claude/sonnet" },
    });
    expect(route.source).toBe("global");
    expect(route.model).toBe("claude/opus");
  });
});

describe("a pin", () => {
  it("wins over the global model", () => {
    const route = resolveAgentRoute({
      agent: "writer", global,
      overrides: { writer: "claude/sonnet" },
    });
    expect(route).toEqual({ model: "claude/sonnet", source: "pin" });
  });

  it("may name a different service, and keeps the rest of its object", () => {
    const pin = { service: "deepseek", model: "deepseek-chat", apiKeyEnv: "DEEPSEEK_API_KEY" };
    const route = resolveAgentRoute({ agent: "auditor", global, overrides: { auditor: pin } });
    expect(route.source).toBe("pin");
    expect(route.service).toBe("deepseek");
    expect(route.model).toBe("deepseek-chat");
    expect(route.override).toEqual(pin);
  });
});

describe("the spelling drift this exists to close", () => {
  it("honours a pin written the old way", () => {
    // runner.ts asks for "state-validator" in three places and "stateValidator"
    // in one. A config carrying either must cover both.
    const route = resolveAgentRoute({
      agent: "stateValidator", global,
      overrides: { "state-validator": "claude/haiku" },
    });
    expect(route.model).toBe("claude/haiku");
    expect(canonicalAgentId("stateValidator")).toBe("state-validator");
  });

  it("rewrites old names on save and drops emptied rows", () => {
    const cleaned = normalizeOverrides({
      stateValidator: "claude/haiku",
      destyle: { model: " claude/sonnet " },
      writer: "",
      auditor: { model: "" } as never,
    });
    expect(cleaned).toEqual({
      "state-validator": "claude/haiku",
      destyler: { model: "claude/sonnet" },
    });
  });
});

describe("a pin to something that is gone", () => {
  const overrides = { writer: { service: "devinCli", model: "devin/claude-opus-5-medium" } };
  const isAvailable = (t: { service?: string }) => t.service !== "devinCli";

  it("falls back to the global model rather than failing at the provider", () => {
    const route = resolveAgentRoute({ agent: "writer", global, overrides, isAvailable });
    expect(route.model).toBe("claude/opus");
    expect(route.source).toBe("global");
  });

  it("reports what it dropped, so the page can say why", () => {
    const route = resolveAgentRoute({ agent: "writer", global, overrides, isAvailable });
    expect(route.droppedPin).toEqual({
      service: "devinCli",
      model: "devin/claude-opus-5-medium",
      reason: "unreachable",
    });
  });

  it("keeps the pin when nothing is asked about availability", () => {
    // Offline, in tests, and anywhere without a live roster, a pin is trusted.
    const route = resolveAgentRoute({ agent: "writer", global, overrides });
    expect(route.source).toBe("pin");
  });
});

describe("the table the settings page renders", () => {
  it("has a row for every agent, pinned or not", () => {
    const table = resolveRoutingTable({
      agents: AGENT_ROSTER.map((r) => r.id),
      overrides: { writer: "claude/sonnet" },
      global,
    });
    expect(Object.keys(table)).toHaveLength(AGENT_ROSTER.length);
    expect(table.writer?.source).toBe("pin");
    expect(table.architect?.source).toBe("global");
  });

  it("names every agent it offers", () => {
    for (const role of AGENT_ROSTER) {
      expect(role.label.length, role.id).toBeGreaterThan(0);
      expect(role.does.length, role.id).toBeGreaterThan(0);
      expect(agentRole(role.id)?.id).toBe(role.id);
    }
  });

  it("carries the de-AI pass, which had no name to pin at all", () => {
    expect(agentRole("destyler")?.group).toBe("checks");
    expect(canonicalAgentId("destyle")).toBe("destyler");
  });
});

describe("a local server that is not running", () => {
  it("offers nothing, rather than the seed compiled into its card", async () => {
    // Ollama and LM Studio answer for themselves on loopback. A silent one is
    // not installed, and every model in its shipped list would fail on the
    // first call — which is how 52 Ollama models reached the picker of a
    // machine with no Ollama on it.
    const { listModelsForService } = await import("../llm/service-presets.js");
    const { getEndpoint } = await import("../llm/providers/index.js");
    expect(getEndpoint("ollama")?.group).toBe("local");
    expect(getEndpoint("ollama")!.models.length).toBeGreaterThan(10);
    expect(await listModelsForService("ollama", "", "http://127.0.0.1:1/v1")).toEqual([]);
  });
});
