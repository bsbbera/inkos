import { describe, expect, it } from "vitest";
import { agentForStage } from "../pipeline/publication-agents.js";

describe("a magazine stage's agent", () => {
  it("routes every tag the runner actually emits", () => {
    // These are the literal second arguments to ctx.ask in publication-runner
    // and the two helpers it hands `ask` to.
    expect(agentForStage("research:plan")).toBe("publication-researcher");
    expect(agentForStage("research:health")).toBe("publication-researcher");
    expect(agentForStage("plan")).toBe("publication-planner");
    expect(agentForStage("page-12")).toBe("publication-writer");
    expect(agentForStage("design")).toBe("publication-designer");
    expect(agentForStage("factcheck:extract:p3")).toBe("publication-fact-checker");
    expect(agentForStage("factcheck:verify:p3")).toBe("publication-fact-checker");
    expect(agentForStage("audit-7")).toBe("publication-auditor");
    expect(agentForStage("revise-7")).toBe("publication-reviser");
    expect(agentForStage("element-4-furniture")).toBe("publication-reviser");
  });

  it("keeps the old id for a stage nobody has split yet", () => {
    // Falling back to "publication" means an unrecognised stage behaves exactly
    // as it did before the split, pin included.
    expect(agentForStage("something-new")).toBe("publication");
  });

  it("does not confuse the auditor with a page it is auditing", () => {
    expect(agentForStage("page-3")).not.toBe(agentForStage("audit-3"));
  });
});

describe("the split and the settings page agree", () => {
  it("offers a row for every agent a stage can route to", async () => {
    // The map and the roster are two lists of the same thing. If a stage routes
    // to an id the page cannot show, that stage is unpinnable and nobody finds
    // out until they wonder why their pin did nothing.
    const { AGENT_ROSTER } = await import("../llm/agent-roster.js");
    const { PUBLICATION_AGENTS } = await import("../pipeline/publication-agents.js");
    const ids = new Set(AGENT_ROSTER.map((role) => role.id));
    for (const agent of Object.values(PUBLICATION_AGENTS)) {
      expect(ids.has(agent), agent).toBe(true);
    }
  });

  it("puts every one of them in a job, so the default view can set it", async () => {
    const { AGENT_JOBS } = await import("../llm/agent-roster.js");
    const { PUBLICATION_AGENTS } = await import("../pipeline/publication-agents.js");
    const claimed = new Set(AGENT_JOBS.flatMap((job) => job.members));
    for (const agent of Object.values(PUBLICATION_AGENTS)) {
      expect(claimed.has(agent), agent).toBe(true);
    }
  });
});

describe("the search ladder", () => {
  it("does not refuse to research when the model browses on its own", async () => {
    // The old guard threw whenever no Tavily/Brave key was set, which told a
    // user running a browsing CLI to go and configure a searcher they had.
    const { researchPublication } = await import("../pipeline/publication-research.js");
    const asked: string[] = [];
    const report = await researchPublication({
      projectRoot: process.cwd(),
      cachePath: `${process.cwd()}/.tmp-research-cache.json`,
      subject: "tide pools",
      pillars: ["how"],
      sources: [],
      modelSearches: true,
      ask: async (_prompt, tag) => {
        asked.push(tag);
        return { queries: { how: ["tide pool zonation"] }, claims: [] };
      },
    });
    expect(asked[0]).toMatch(/^research/);
    expect(report).toBeDefined();
  });

  it("still refuses when nothing can search at all", async () => {
    const { researchPublication } = await import("../pipeline/publication-research.js");
    await expect(researchPublication({
      projectRoot: process.cwd(),
      cachePath: `${process.cwd()}/.tmp-research-cache-2.json`,
      subject: "tide pools",
      pillars: ["how"],
      sources: [],
      modelSearches: false,
      ask: async () => ({}),
    })).rejects.toThrow(/does not browse|memory alone/);
  });
});
