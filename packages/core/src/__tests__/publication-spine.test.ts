import { describe, expect, it } from "vitest";
import { SPINE_STAGE, STAGE_ORDER, type Stage } from "../pipeline/publication-runner.js";
import { PRODUCTIONS } from "../productions/registry.js";
import { stageSequence } from "../pipeline/pipeline-state.js";

const publication = PRODUCTIONS.find((p) => p.id === "publication")!.pipeline!;

describe("the magazine on the common spine", () => {
  // The magazine drives its own loop and always will — a page is not a
  // chapter. What it may not do is speak a private language: the run file, the
  // Run page and the "waiting on you" list all read the spine, and while the
  // two were unconnected the issue page said fact-check was finished while
  // pipeline.json still read "content.write, 0 of 50 pages".
  it("says every one of its steps in the spine's words", () => {
    const sequence = stageSequence(publication);
    for (const stage of STAGE_ORDER) {
      expect(sequence, stage).toContain(SPINE_STAGE[stage]);
    }
  });

  it("names every stage it can run, so none can be forgotten in the map", () => {
    const named = Object.keys(SPINE_STAGE) as Stage[];
    expect([...STAGE_ORDER].sort()).toEqual([...named].sort());
  });

  /*
   * `runDesign` decides the palette, the type and one world per section, and
   * nothing called it: the function was exported, the registry declared the
   * stage, and no run ever performed it. An issue with every page written
   * therefore could not be built — `build` reads the design and refuses
   * without one.
   */
  it("runs the design between the audit and the art", () => {
    expect(STAGE_ORDER.indexOf("design")).toBeGreaterThan(STAGE_ORDER.indexOf("audit"));
    expect(STAGE_ORDER.indexOf("design")).toBeLessThan(STAGE_ORDER.indexOf("art"));
    expect(SPINE_STAGE.design).toBe("design.artplan");
    expect(SPINE_STAGE.art).toBe("design.generate");
  });

  it("skips only what it does elsewhere, and says where", () => {
    expect(Object.keys(publication.skip ?? {}).sort())
      .toEqual(["build.layout", "content.destyle", "design.review"]);
  });

  // The magazine's steps are the shared pipeline's executors now: every stage
  // it names is one it can perform, and nothing it skips has one.
  it("has an executor for every stage it names and none for what it skips", async () => {
    const { publicationExecutor } = await import("../pipeline/publication-runner.js");
    const ctx = { projectRoot: ".", definition: { needsImages: true, needsPdf: true } } as never;
    for (const stage of STAGE_ORDER) {
      expect(publicationExecutor(ctx, SPINE_STAGE[stage]), stage).not.toBeNull();
    }
    for (const skipped of Object.keys(publication.skip ?? {})) {
      expect(publicationExecutor(ctx, skipped), skipped).toBeNull();
    }
  });
});
