import { describe, expect, it } from "vitest";
import { modelBar, runningAgent } from "./chat-model-label";

const routes = {
  writer: { service: "claudeCli", model: "claude/sonnet" },
  auditor: { service: "devinCli", model: "devin/glm-5-2" },
};

describe("the composer's model bar", () => {
  it("names the default when nothing is running", () => {
    expect(modelBar({ fallback: "Devin · glm-5-2" })).toEqual({
      agent: null, text: "Devin · glm-5-2",
    });
  });

  it("names the running agent and its own model", () => {
    const tools = [
      { agent: "writer", status: "completed" as const },
      { agent: "auditor", status: "running" as const },
    ];
    expect(modelBar({ tools, routes, fallback: "Devin · glm-5-2" })).toEqual({
      agent: "auditor", text: "auditor · devin/glm-5-2",
    });
  });

  it("uses the role's label when there is one", () => {
    const tools = [{ agent: "writer", status: "running" as const }];
    expect(modelBar({ tools, routes, roleLabels: { writer: "writer" }, fallback: "x" }).text)
      .toBe("writer · claude/sonnet");
  });

  it("falls back to the default text for an agent with no row", () => {
    const tools = [{ agent: "mystery", status: "running" as const }];
    expect(modelBar({ tools, routes, fallback: "Devin · glm-5-2" }).text)
      .toBe("mystery · Devin · glm-5-2");
  });

  it("ignores finished tools and tools with no agent", () => {
    expect(runningAgent([{ status: "running" }, { agent: "writer", status: "completed" }]))
      .toBeNull();
  });
});
