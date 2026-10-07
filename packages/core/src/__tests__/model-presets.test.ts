import { expect, it } from "vitest";
import { describeModel, pickForAgent } from "../llm/model-presets.js";
import { resolveAgentRoute } from "../llm/model-routing.js";

const cards = [
  describeModel("claudeCli", "claude/opus"),
  describeModel("claudeCli", "claude/sonnet"),
  describeModel("claudeCli", "claude/haiku"),
];

// 20 §6 step 5's own test.
it("Frugal routes the de-AI styler to the cheapest model that qualifies", () => {
  expect(pickForAgent("destyler", "frugal", cards)?.card.model).toBe("claude/haiku");
  expect(pickForAgent("destyler", "frugal", cards)?.reason).toMatch(/^Frugal → claude\/haiku: .*cost 1/);
});

it("Best gives the writer the strongest reasoner, and never a model that misses its needs", () => {
  expect(pickForAgent("writer", "best", cards)?.card.model).toBe("claude/opus");
  expect(pickForAgent("writer", "frugal", cards)?.card.model).toBe("claude/sonnet");
});

it("a pin still wins, and an agent nothing qualifies for keeps the default with a reason", () => {
  const preset = { name: "frugal" as const, cards };
  expect(resolveAgentRoute({ agent: "destyler", overrides: { destyler: "x" }, global: { model: "g" }, preset }).model).toBe("x");
  const route = resolveAgentRoute({ agent: "publication-designer", global: { model: "g" }, preset: { name: "best", cards: [describeModel("ollama", "llama3-8b", { input: ["text"] })] } });
  expect(route).toMatchObject({ source: "global", model: "g" });
  expect(route.reason).toMatch(/no connected model meets/);
});
