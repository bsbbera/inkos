import { describe, expect, it } from "vitest";
import {
  advance, approve, completeUnit, failUnit, initialState, macroSkipped,
  pendingUnits, reachStage, reject, skipReason, stageSequence, withdraw,
  type PipelineState,
} from "../pipeline/pipeline-state.js";
import { ALL_GATES, PRODUCTIONS, SPINE } from "../productions/registry.js";
import type { ProductionPipeline } from "../productions/registry.js";

const spec = (id: string) => {
  const found = PRODUCTIONS.find((p) => p.id === id);
  if (!found?.pipeline) throw new Error(`no pipeline for ${id}`);
  return found.pipeline;
};

/** Fixed clock so history is comparable. */
let tick = 0;
const now = () => `2026-01-01T00:00:${String(tick++).padStart(2, "0")}.000Z`;

function start(id: string, totalUnits: number): { state: PipelineState; pipeline: ProductionPipeline } {
  const pipeline = spec(id);
  return { state: initialState({ type: id, pipeline, totalUnits, now }), pipeline };
}

/** Finish every unit of the current stage. */
function finishStage(state: PipelineState): PipelineState {
  let next = state;
  for (let unit = 1; unit <= state.units.total; unit += 1) next = completeUnit(next, unit, now);
  return next;
}

describe("reachStage puts a run where the work actually happened", () => {
  it("walks forward over stages nothing has wired yet", () => {
    // A book opens on content.plan because it declares one, but nothing runs
    // the architect through the pipeline. Without this the writer's first
    // chapter would complete the *plan* stage and the run would spend the rest
    // of its life one step behind itself.
    const { state, pipeline } = start("book", 3);
    expect(state.stage).toBe("content.research");
    const moved = reachStage(state, pipeline, "content.write", now);
    expect(moved.stage).toBe("content.write");
    expect(moved.status).toBe("running");
    expect(moved.history.at(-1)?.event).toBe("stage:skipped");
  });

  it("does nothing when the run is already there", () => {
    const { state, pipeline } = start("book", 3);
    const at = reachStage(state, pipeline, "content.write", now);
    expect(reachStage(at, pipeline, "content.write", now)).toBe(at);
  });

  it("refuses to drag a run backwards", () => {
    // A page rewritten after its gate opened must not pull the whole issue
    // back into the writing stage.
    const { state, pipeline } = start("book", 3);
    const ahead = reachStage(state, pipeline, "content.destyle", now);
    expect(reachStage(ahead, pipeline, "content.write", now).stage).toBe("content.destyle");
  });

  it("crosses a gate and leaves it open for a sign-off", () => {
    const { state, pipeline } = start("book", 3);
    const atDestyle = reachStage(state, pipeline, "content.destyle", now);
    // design.artplan sits on the far side of gate:content.
    const past = reachStage(atDestyle, pipeline, "design.artplan", now);
    expect(past.stage).toBe("design.artplan");
    expect(past.gates.content?.state).toBe("waiting");
  });

  it("leaves the units of the stage it is leaving behind", () => {
    const { state, pipeline } = start("book", 3);
    const withProgress = completeUnit(state, 1, now);
    expect(withProgress.units.done).toEqual([1]);
    // Unit 1 of the plan stage is not unit 1 of the write stage.
    expect(reachStage(withProgress, pipeline, "content.write", now).units.done).toEqual([]);
  });
});

describe("withdrawal makes downstream work stale", () => {
  /** Walk a run to the design gate with both gates signed off. */
  function throughDesign(total: number) {
    const { state, pipeline } = start("book", total);
    let next = reachStage(state, pipeline, "content.write", now);
    for (const stage of ["content.write", "content.audit", "content.destyle"]) {
      next = reachStage(next, pipeline, stage, now);
      next = advance(finishStage(next), pipeline, now).state;
    }
    next = approve({ state: next, gate: "content", now });
    next = advance(next, pipeline, now).state;
    for (const stage of ["design.artplan", "design.generate", "design.review"]) {
      next = reachStage(next, pipeline, stage, now);
      next = advance(finishStage(next), pipeline, now).state;
    }
    next = approve({ state: next, gate: "design", now });
    return { state: next, pipeline };
  }

  it("un-approves the design of a unit whose copy was withdrawn", () => {
    // The cover was drawn from words that no longer stand, so approving it
    // was approving a picture of something else.
    const { state, pipeline } = throughDesign(2);
    expect(state.gates.design?.state).toBe("approved");
    const back = withdraw({ state, gate: "content", units: [1], pipeline, now });
    expect(back.gates.design?.state).toBe("waiting");
    expect(back.gates.design?.perUnit?.["1"]).toBe("waiting");
    // The unit nobody touched keeps its sign-off.
    expect(back.gates.design?.perUnit?.["2"]).toBe("approved");
  });

  it("marks the unit stale rather than erasing what was made", () => {
    const { state, pipeline } = throughDesign(2);
    const back = withdraw({ state, gate: "content", units: [1], pipeline, now });
    expect(back.gates.design?.stale).toEqual([1]);
  });

  it("clears the mark when that unit is signed off again", () => {
    const { state, pipeline } = throughDesign(2);
    const back = withdraw({ state, gate: "content", units: [1], pipeline, now });
    const again = approve({ state: back, gate: "design", units: [1], now });
    expect(again.gates.design?.stale).toBeUndefined();
  });

  it("leaves an upstream gate alone: staleness only runs downhill", () => {
    const { state, pipeline } = throughDesign(1);
    const back = withdraw({ state, gate: "design", units: [1], pipeline, now });
    expect(back.gates.content?.stale).toBeUndefined();
    expect(back.gates.content?.state).toBe("approved");
  });
});

describe("stageSequence", () => {
  it("walks content, design and build with a gate after each", () => {
    expect(stageSequence(spec("book"))).toEqual([
      "content.research", "content.plan", "content.write", "content.factcheck",
      "content.audit", "content.destyle", "gate:content",
      "design.artplan", "design.generate", "design.review", "gate:design",
      "build.layout", "build.export", "gate:build",
      "done",
    ]);
  });

  it("gives every kind the same spine, and says which steps it walks past", () => {
    // The steps a kind does not perform are declared and skipped, never
    // missing. A novel that needs checking against the record can have that
    // stage switched on; before this it had nowhere to switch it on.
    const book = spec("book");
    expect(stageSequence(book)).toContain("content.factcheck");
    expect(skipReason(book, "content.factcheck")).toMatch(/not held to the record/i);
    expect(skipReason(book, "content.write")).toBeNull();

    // A screenplay is set to an industry format on purpose: the design steps
    // are there, greyed, with that sentence on them.
    const script = spec("script");
    expect(stageSequence(script)).toContain("design.generate");
    expect(macroSkipped(script, "design")).toBe(true);
    expect(macroSkipped(script, "content")).toBe(false);

    // Every kind that runs a pipeline declares the whole spine.
    for (const production of PRODUCTIONS) {
      if (!production.pipeline) continue;
      expect(production.pipeline.content, production.id).toEqual([...SPINE.content]);
      expect(production.pipeline.design, production.id).toEqual([...SPINE.design]);
      expect(production.pipeline.build, production.id).toEqual([...SPINE.build]);
      expect(production.pipeline.gates, production.id).toEqual([...ALL_GATES]);
      // A reason is what makes a skipped step honest; an empty one is a hole.
      for (const [stage, why] of Object.entries(production.pipeline.skip ?? {})) {
        expect(stageSequence(production.pipeline), `${production.id} ${stage}`).toContain(stage);
        expect(why.trim().length, `${production.id} ${stage}`).toBeGreaterThan(10);
      }
    }
  });

  it("walks past a skipped step without waiting for work nobody will do", () => {
    // The stage has no executor and never will. Before skipping existed, a
    // step like this parked the run for good.
    let { state, pipeline } = start("short", 1);
    expect(state.stage).toBe("content.research");
    state = advance(finishStage(state), pipeline, now).state;
    expect(state.stage).toBe("content.plan");

    const moved = advance(state, pipeline, now);
    expect(moved.moved).toBe(true);
    expect(moved.state.stage).toBe("content.write");
    const skipped = moved.state.history.filter((h) => h.event === "stage:skipped");
    expect(skipped.at(-1)).toMatchObject({ stage: "content.plan" });
    expect(skipped.at(-1)?.note).toMatch(/one pass/);
  });

  it("signs off a gate whose every step was skipped, instead of asking", () => {
    // A translation has no design of its own. Asking for a design sign-off on
    // one would put a permanent "waiting on you" on the Home screen.
    let { state, pipeline } = start("translation", 1);
    for (let guard = 0; guard < 30 && state.stage !== "gate:design"; guard += 1) {
      state = state.stage.startsWith("gate:")
        ? approve({ state, gate: state.stage.slice(5) as "content", now })
        : finishStage(state);
      state = advance(state, pipeline, now).state;
    }
    expect(state.gates.design).toMatchObject({ state: "approved", by: "quire" });
    expect(state.gates.design?.note).toMatch(/skipped/);
  });

  it("gives every type that runs one a graph ending in done", () => {
    for (const production of PRODUCTIONS) {
      if (!production.pipeline) continue;
      const sequence = stageSequence(production.pipeline);
      expect(sequence[sequence.length - 1], production.id).toBe("done");
      expect(sequence.length, production.id).toBeGreaterThan(1);
    }
  });
});

describe("advance", () => {
  it("will not leave a stage while units are outstanding", () => {
    const { state, pipeline } = start("book", 3);
    const one = completeUnit(state, 1, now);
    const result = advance(one, pipeline, now);
    expect(result.moved).toBe(false);
    expect(result.reason).toBe("1/3 units done");
    expect(result.state.stage).toBe("content.research");
  });

  it("moves on when the last unit lands", () => {
    const { state, pipeline } = start("book", 3);
    const result = advance(finishStage(state), pipeline, now);
    expect(result.moved).toBe(true);
    expect(result.state.stage).toBe("content.plan");
    // The next stage starts with nothing done, or it would look finished.
    expect(result.state.units.done).toEqual([]);
  });

  it("holds at a failed unit instead of walking past it", () => {
    const { state, pipeline } = start("book", 2);
    const broken = failUnit(completeUnit(state, 1, now), { unit: 2, error: "boom", resumable: true }, now);
    const result = advance(broken, pipeline, now);
    expect(result.moved).toBe(false);
    expect(result.reason).toBe("1 unit(s) failed");
    expect(result.state.status).toBe("failed");
  });

  it("walks through a gate and leaves it open, rather than stopping", () => {
    let { state, pipeline } = start("book", 1);
    // Walk the whole content macro-stage.
    for (const _ of pipeline.content) {
      state = advance(finishStage(state), pipeline, now).state;
    }
    expect(state.stage).toBe("gate:content");
    expect(state.gates.content?.state).toBe("waiting");

    const through = advance(state, pipeline, now);
    expect(through.moved).toBe(true);
    expect(through.state.stage).toBe("design.artplan");
    // Nobody signed it, so it is still open.
    expect(through.state.gates.content?.state).toBe("waiting");
  });
});

describe("a sign-off is a record, not a stop", () => {
  it("starts the design stage whether or not the writing is signed", () => {
    let { state, pipeline } = start("book", 2);
    for (const _ of pipeline.content) state = advance(finishStage(state), pipeline, now).state;
    state = approve({ state, gate: "content", units: [1], now });
    expect(pendingUnits(state, "content")).toEqual([2]);
    const moved = advance(state, pipeline, now);
    expect(moved.moved).toBe(true);
    expect(moved.state.stage).toBe("design.artplan");
    expect(moved.state.status).toBe("running");
  });

  it("keeps a sign-off given before the gate is reached", () => {
    let { state, pipeline } = start("book", 1);
    state = approve({ state, gate: "content", now });
    for (const _ of pipeline.content) state = advance(finishStage(state), pipeline, now).state;
    expect(state.stage).toBe("gate:content");
    expect(state.gates.content?.state).toBe("approved");
  });
});

describe("approvals are reversible", () => {
  it("reopens a gate without erasing that it was approved", () => {
    let { state } = start("book", 2);
    state = approve({ state, gate: "content", by: "user", now });
    expect(state.gates.content?.state).toBe("approved");
    const approvedAt = state.history.length;

    state = withdraw({ state, gate: "content", units: [2], now });
    expect(state.gates.content?.state).toBe("waiting");
    expect(pendingUnits(state, "content")).toEqual([2]);
    // Unit 1 keeps its decision; only the withdrawn one reopens.
    expect(state.gates.content?.perUnit?.["1"]).toBe("approved");
    // History grew. Nothing was rewritten to pretend the approval never was.
    expect(state.history.length).toBe(approvedAt + 1);
    expect(state.history.at(-1)?.event).toBe("gate:withdrawn");
    expect(state.history.some((h) => h.event === "gate:approved")).toBe(true);
  });

  it("rejecting at the design gate for a writing problem reopens content", () => {
    let { state } = start("book", 3);
    state = approve({ state, gate: "content", now });
    state = reject({
      state, gate: "design", units: [2],
      note: "the scene it illustrates is wrong", backTo: "content", now,
    });
    expect(state.gates.design?.state).toBe("rejected");
    // The point of backTo: chapter 2 is owed writing, not another picture.
    expect(state.gates.content?.state).toBe("waiting");
    expect(pendingUnits(state, "content")).toEqual([2]);
    expect(state.gates.content?.perUnit?.["1"]).toBe("approved");
    expect(state.gates.content?.perUnit?.["3"]).toBe("approved");
  });
});

describe("a run with one gate fewer", () => {
  it("takes a script from content to build through its skipped design", () => {
    let { state, pipeline } = start("script", 1);
    for (let guard = 0; guard < 30 && state.stage !== "gate:content"; guard += 1) {
      state = advance(finishStage(state), pipeline, now).state;
    }
    expect(state.stage).toBe("gate:content");
    state = approve({ state, gate: "content", now });
    // Three design steps, all skipped, then a gate that signs itself: the run
    // arrives at the build without anyone being asked about art direction.
    for (let guard = 0; guard < 10 && state.stage !== "build.layout"; guard += 1) {
      state = advance(state, pipeline, now).state;
    }
    expect(state.stage).toBe("build.layout");
    expect(state.gates.design?.state).toBe("approved");
  });

  it("reaches done and stays there", () => {
    let { state, pipeline } = start("translation", 1);
    for (let guard = 0; guard < 40 && state.stage !== "done"; guard += 1) {
      const gate = state.stage.startsWith("gate:") ? state.stage.slice(5) : null;
      state = gate
        ? approve({ state, gate: gate as "content" | "build", now })
        : finishStage(state);
      state = advance(state, pipeline, now).state;
    }
    expect(state.stage).toBe("done");
    expect(state.status).toBe("done");
    expect(advance(state, pipeline, now).moved).toBe(false);
  });
});

/* A gate holds nothing back, so taking a sign-off back moves nothing either. */
describe("withdraw leaves the run where it is", () => {
  it("reopens the gate without walking the run back", () => {
    const { state: fresh, pipeline } = start("short", 1);
    let state = fresh;
    // Walk it to the far side of the content gate.
    for (;;) {
      state = finishStage(state);
      const step = advance(state, pipeline);
      state = step.state;
      if (state.stage === "gate:content") break;
    }
    state = approve({ state, gate: "content" });
    state = advance(state, pipeline).state;
    expect(state.stage).toBe("design.artplan");

    const undone = withdraw({ state, gate: "content", pipeline });
    expect(undone.stage).toBe("design.artplan");
    expect(undone.gates.content?.state).toBe("waiting");
    // The record of the approval is kept; only its effect is undone.
    expect(undone.history.some((h) => h.event === "gate:approved")).toBe(true);
  });

  it("leaves a run alone when the gate is still ahead of it", () => {
    const { state, pipeline } = start("short", 1);
    expect(withdraw({ state, gate: "content", pipeline }).stage).toBe(state.stage);
  });
});
