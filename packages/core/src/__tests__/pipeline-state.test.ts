import { describe, expect, it } from "vitest";
import {
  advance, approve, completeUnit, failUnit, initialState,
  pendingUnits, reject, stageSequence, withdraw,
  type PipelineState,
} from "../pipeline/pipeline-state.js";
import { PRODUCTIONS } from "../productions/registry.js";
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

describe("stageSequence", () => {
  it("walks content, design and build with a gate after each", () => {
    expect(stageSequence(spec("book"))).toEqual([
      "content.plan", "content.write", "content.audit", "content.destyle", "gate:content",
      "design.artplan", "design.generate", "design.review", "gate:design",
      "build.layout", "build.export", "gate:build",
      "done",
    ]);
  });

  it("skips a macro-stage a type does not have, and its gate with it", () => {
    // A screenplay is set to an industry format on purpose. No design steps,
    // and therefore no design gate to be stuck at.
    const script = stageSequence(spec("script"));
    expect(script.some((s) => s.startsWith("design."))).toBe(false);
    expect(script).not.toContain("gate:design");
    expect(script).toContain("gate:content");
    expect(script).toContain("build.export");
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
    expect(result.state.stage).toBe("content.plan");
  });

  it("moves on when the last unit lands", () => {
    const { state, pipeline } = start("book", 3);
    const result = advance(finishStage(state), pipeline, now);
    expect(result.moved).toBe(true);
    expect(result.state.stage).toBe("content.write");
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

  it("stops at a gate and says so, rather than approving itself", () => {
    let { state, pipeline } = start("book", 1);
    // Walk the whole content macro-stage.
    for (const _ of pipeline.content) {
      state = advance(finishStage(state), pipeline, now).state;
    }
    expect(state.stage).toBe("gate:content");
    expect(state.status).toBe("waiting-gate");
    expect(state.gates.content?.state).toBe("waiting");

    const blocked = advance(state, pipeline, now);
    expect(blocked.moved).toBe(false);
    expect(blocked.reason).toBe("waiting on content gate");
    expect(blocked.state.stage).toBe("gate:content");
  });
});

describe("the hand-off that did not exist", () => {
  it("approving the last content unit is what starts the design stage", () => {
    let { state, pipeline } = start("book", 2);
    for (const _ of pipeline.content) state = advance(finishStage(state), pipeline, now).state;
    expect(state.stage).toBe("gate:content");

    // One of two chapters signed off: still waiting, nothing starts.
    state = approve({ state, gate: "content", units: [1], now });
    expect(state.gates.content?.state).toBe("waiting");
    expect(pendingUnits(state, "content")).toEqual([2]);
    expect(advance(state, pipeline, now).moved).toBe(false);

    // The last one lands and the run continues on its own.
    state = approve({ state, gate: "content", units: [2], by: "user", now });
    expect(state.gates.content?.state).toBe("approved");
    const moved = advance(state, pipeline, now);
    expect(moved.moved).toBe(true);
    expect(moved.state.stage).toBe("design.artplan");
    expect(moved.state.status).toBe("running");
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
  it("takes a script from content straight to build", () => {
    let { state, pipeline } = start("script", 1);
    for (const _ of pipeline.content) state = advance(finishStage(state), pipeline, now).state;
    expect(state.stage).toBe("gate:content");
    state = approve({ state, gate: "content", now });
    const moved = advance(state, pipeline, now);
    expect(moved.state.stage).toBe("build.layout");
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
