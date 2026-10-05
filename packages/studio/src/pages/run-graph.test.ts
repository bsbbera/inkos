import { describe, expect, it } from "vitest";
import { stagesFromGraph } from "./RunPage.js";

const sequence = [
  "content.research", "content.plan", "content.write", "content.factcheck",
  "content.audit", "content.destyle", "gate:content",
  "design.artplan", "design.generate", "design.review", "gate:design",
  "build.layout", "build.export", "gate:build", "done",
];

describe("the strip a run draws", () => {
  // Every kind shows the whole spine. A step this kind walks past is drawn
  // greyed with its reason, so "this work is never fact-checked" is a sentence
  // on the screen rather than a step missing from it.
  it("draws a skipped step as skipped, wherever the run is standing", () => {
    const stages = stagesFromGraph({
      sequence,
      stage: "content.audit",
      status: "running",
      skipped: { "content.factcheck": "A novel is not held to the record.", "build.layout": "A novel reflows." },
    });
    const byName = Object.fromEntries(stages.map((s) => [s.name, s]));
    expect(byName["content · factcheck"]).toMatchObject({
      state: "skipped", took: "A novel is not held to the record.",
    });
    // Ahead of the run, and still skipped rather than queued.
    expect(byName["build · layout"]?.state).toBe("skipped");
    // The steps that do run are unaffected.
    expect(byName["content · write"]?.state).toBe("done");
    expect(byName["content · audit"]?.state).toBe("now");
    expect(byName["content · destyle"]?.state).toBe("queued");
  });

  it("never counts a skipped step as done", () => {
    const stages = stagesFromGraph({
      sequence, stage: "build.export", status: "running",
      skipped: { "content.factcheck": "not held to the record" },
    });
    expect(stages.filter((s) => s.state === "skipped")).toHaveLength(1);
    expect(stages.find((s) => s.name === "content · factcheck")?.state).not.toBe("done");
  });
});
