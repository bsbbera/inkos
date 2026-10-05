import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advance, approve, ensurePipeline, loadPipeline, pause, pipelinePath,
  reject, reportUnitDone, reportUnitFailed, runStage, waitingOn, withdraw,
  type OrchestratorEvent, type ProductionRef,
} from "../pipeline/orchestrator.js";
import { registerExecutor } from "../pipeline/executors.js";

let root = "";
const book: ProductionRef = { type: "book", id: "the-tower" };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "quire-pipeline-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Finish every unit of whatever stage the run is in. */
async function finishStage(ref: ProductionRef, total: number, events?: OrchestratorEvent[]) {
  let last;
  for (let unit = 1; unit <= total; unit += 1) {
    last = await reportUnitDone({
      projectRoot: root, ref, unit,
      ...(events ? { emit: (e: OrchestratorEvent) => events.push(e) } : {}),
    });
  }
  return last!;
}

describe("state on disk", () => {
  it("writes under the registry's own outDir", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    expect(pipelinePath(root, book)).toBe(join(root, "books", "the-tower", "pipeline.json"));
    const raw = JSON.parse(await readFile(pipelinePath(root, book), "utf-8"));
    expect(raw.type).toBe("book");
    expect(raw.stage).toBe("content.research");
    expect(raw.units.kind).toBe("chapter");
  });

  it("does not restart a run it already has", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    await finishStage(book, 2);
    const again = await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    expect(again.stage).toBe("content.plan");
  });

  it("reads a torn or foreign file as absent rather than acting on it", async () => {
    await mkdir(join(root, "books", "the-tower"), { recursive: true });
    await writeFile(pipelinePath(root, book), '{"version":99,"stage":"buil', "utf-8");
    expect(await loadPipeline(root, book)).toBeNull();
  });

  it("refuses a kind that does not run a pipeline", async () => {
    await expect(ensurePipeline({
      projectRoot: root, ref: { type: "play", id: "w1" }, totalUnits: 1,
    })).rejects.toThrow(/does not run a pipeline/);
  });
});

describe("the run does not wait on a sign-off", () => {
  it("carries a one-unit book from content straight into design", async () => {
    const events: OrchestratorEvent[] = [];
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 1 });

    // Walk the five content sub-stages. One unit each, so each report both
    // completes a stage and starts the next.
    for (let i = 0; i < 5; i += 1) await finishStage(book, 1, events);

    const state = (await loadPipeline(root, book))!;
    expect(state.stage).toBe("design.artplan");
    expect(state.status).toBe("running");
    // Passed, not skipped: the gate is open for a sign-off.
    expect(state.gates.content?.state).toBe("waiting");
    expect(events).toContainEqual(expect.objectContaining({ kind: "gate:open", gate: "content" }));
    expect(events.some((e) => e.kind === "stage:start" && e.stage === "design.artplan")).toBe(true);
  });

  it("records a sign-off without moving the run", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 3 });
    for (let i = 0; i < 5; i += 1) await finishStage(book, 3);

    const partial = await approve({ projectRoot: root, ref: book, gate: "content", units: [1, 2] });
    expect(partial.state.stage).toBe("design.artplan");
    expect(partial.state.gates.content?.state).toBe("waiting");

    const rest = await approve({ projectRoot: root, ref: book, gate: "content", units: [3] });
    expect(rest.state.gates.content?.state).toBe("approved");
    expect(rest.state.stage).toBe("design.artplan");
  });
});

describe("a failure stops the run where it happened", () => {
  it("does not advance past a failed unit, and resumes when it succeeds", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    await reportUnitDone({ projectRoot: root, ref: book, unit: 1 });
    await reportUnitFailed({
      projectRoot: root, ref: book,
      failure: { unit: 2, error: "the model timed out", resumable: true },
    });

    const blocked = await advance({ projectRoot: root, ref: book });
    expect(blocked.moved).toBe(false);
    expect(blocked.state.stage).toBe("content.research");
    expect(blocked.state.status).toBe("failed");

    // Re-running the unit clears the failure and the run continues.
    const resumed = await reportUnitDone({ projectRoot: root, ref: book, unit: 2 });
    expect(resumed.moved).toBe(true);
    expect(resumed.state.stage).toBe("content.plan");
    expect(resumed.state.units.failed).toEqual([]);
  });
});

describe("nothing signed off is stuck that way", () => {
  it("reopens a withdrawn gate and keeps the record of the approval", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    for (let i = 0; i < 5; i += 1) await finishStage(book, 2);
    await approve({ projectRoot: root, ref: book, gate: "content" });

    const reopened = await withdraw({ projectRoot: root, ref: book, gate: "content", units: [2] });
    expect(reopened.gates.content?.state).toBe("waiting");
    expect(reopened.gates.content?.perUnit?.["1"]).toBe("approved");
    expect(reopened.history.some((h) => h.event === "gate:approved")).toBe(true);
    expect(reopened.history.at(-1)?.event).toBe("gate:withdrawn");
  });

  it("sends a chapter back to writing when the art was rejected for the text", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    for (let i = 0; i < 5; i += 1) await finishStage(book, 2);
    await approve({ projectRoot: root, ref: book, gate: "content" });

    const sentBack = await reject({
      projectRoot: root, ref: book, gate: "design", units: [2],
      note: "the scene does not happen", backTo: "content",
    });
    expect(sentBack.gates.design?.state).toBe("rejected");
    expect(sentBack.gates.content?.perUnit?.["2"]).toBe("waiting");
    expect(sentBack.gates.content?.perUnit?.["1"]).toBe("approved");
  });
});

describe("waitingOn", () => {
  it("lists what needs a person, across kinds, in one shape", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    for (let i = 0; i < 5; i += 1) await finishStage(book, 2);
    await approve({ projectRoot: root, ref: book, gate: "content", units: [1] });

    const script: ProductionRef = { type: "script", id: "pilot" };
    await ensurePipeline({ projectRoot: root, ref: script, totalUnits: 1 });
    for (let i = 0; i < 5; i += 1) await finishStage(script, 1);

    const waiting = waitingOn([
      { ref: book, state: (await loadPipeline(root, book))! },
      { ref: script, state: (await loadPipeline(root, script))! },
    ]);
    expect(waiting).toEqual([
      { ref: book, gate: "content", units: [2], stage: "design.artplan" },
      { ref: script, gate: "content", units: [1], stage: expect.any(String) },
    ]);
  });
});

describe("stopping a stage", () => {
  it("leaves the unit alone and does not call it a failure", async () => {
    const controller = new AbortController();
    // The stage a fresh run is in, so the abort happens on the first thing the
    // run tries rather than one the run never reaches.
    registerExecutor("content.research", async (ctx) => {
      // Stopped while this unit was in flight, which is what an aborted render
      // or model call looks like from here.
      controller.abort();
      return { ok: false, artifacts: [], error: `aborted at unit ${ctx.unit}` };
    }, "book");

    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    const out = await runStage({ projectRoot: root, ref: book, signal: controller.signal });
    expect(out.advanced).toBe(false);

    const state = await loadPipeline(root, book);
    expect(state?.units.failed).toEqual([]);
    expect(state?.units.done).toEqual([]);
    expect(state?.stage).toBe("content.research");

  });

  it("stops the file claiming somebody is working on it", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    // One unit in, the run is under way — which is the state a cancel has to
    // undo. A run that never started needs no undoing, and pause leaves it be.
    await reportUnitDone({ projectRoot: root, ref: book, unit: 1 });
    expect((await loadPipeline(root, book))?.status).toBe("running");

    const paused = await pause({ projectRoot: root, ref: book });
    expect(paused?.status).toBe("idle");
    expect(paused?.history.at(-1)?.event).toBe("run:cancelled");

    // Twice is not two cancellations.
    const again = await pause({ projectRoot: root, ref: book });
    expect(again?.history.filter((h) => h.event === "run:cancelled")).toHaveLength(1);
  });

  it("stops before the next unit when the signal is already raised", async () => {
    const seen: number[] = [];
    const controller = new AbortController();
    registerExecutor("content.research", async (ctx) => {
      seen.push(ctx.unit);
      controller.abort();
      return { ok: true, artifacts: [] };
    }, "book");

    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 3 });
    await runStage({ projectRoot: root, ref: book, signal: controller.signal });

    // Unit 1 ran and is credited; nothing after it was started.
    expect(seen).toEqual([1]);
    expect((await loadPipeline(root, book))?.units.done).toEqual([1]);
  });
});

describe("a step this kind of work walks past", () => {
  it("moves the run on instead of waiting for an executor that is never coming", async () => {
    // A short declares `content.plan` like everything else and skips it: it is
    // outlined and written in one pass. Before skipping, a run standing on a
    // stage nobody performs stayed there for good.
    const { markStage } = await import("../pipeline/orchestrator.js");
    const short: ProductionRef = { type: "short", id: "the-lamp" };
    await ensurePipeline({ projectRoot: root, ref: short, totalUnits: 1 });
    const ran: number[] = [];
    registerExecutor("content.plan", async (ctx) => {
      ran.push(ctx.unit);
      return { ok: true, artifacts: [] };
    }, "short");

    // Standing on the skipped stage, which is where an older run file — one
    // written before this kind declared the step — leaves a run.
    await markStage({ projectRoot: root, ref: short, stage: "content.plan" });
    expect((await loadPipeline(root, short))?.stage).toBe("content.plan");

    const said: string[] = [];
    const out = await runStage({ projectRoot: root, ref: short, onProgress: (m) => said.push(m) });
    expect(ran).toEqual([]);
    expect(out.ran).toBe(false);
    expect(out.advanced).toBe(true);
    expect(said.join(" ")).toMatch(/Skipped content\.plan: .*one pass/);
    expect((await loadPipeline(root, short))?.stage).toBe("content.write");
  });
});

describe("stopping one unit", () => {
  it("drops that unit from the pass and lets the rest of the stage finish", async () => {
    // Cancelling used to be all or nothing: one bad page ended fifty. The unit
    // is left unfinished rather than failed, so the stage stays open for it.
    const { cancelUnit } = await import("../pipeline/orchestrator.js");
    const seen: number[] = [];
    registerExecutor("content.research", async (ctx) => {
      seen.push(ctx.unit);
      if (ctx.unit === 2) {
        cancelUnit(book, 2);
        // What an aborted render reports back once its socket is cut.
        return { ok: false, artifacts: [], error: "aborted" };
      }
      return { ok: true, artifacts: [] };
    }, "book");

    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 3 });
    const said: string[] = [];
    const out = await runStage({ projectRoot: root, ref: book, onProgress: (m) => said.push(m) });

    expect(seen).toEqual([1, 2, 3]);
    expect(out.ran).toBe(true);
    const state = await loadPipeline(root, book);
    expect(state?.units.done).toEqual([1, 3]);
    expect(state?.units.failed).toEqual([]);
    // The stage is still where it was, holding the one unit nobody finished.
    expect(state?.stage).toBe("content.research");
    expect(said.join(" ")).toMatch(/Stopped chapter 2/);
  });
});

describe("a runner that walks its own loop", () => {
  it("tells the run file where it is, and credits a whole-issue stage at once", async () => {
    // The magazine writes pages itself. The run file only ever heard about
    // finished pages, so a fact-check over the whole issue left it standing on
    // the writing with none of its units done.
    const { markStage, completeStage } = await import("../pipeline/orchestrator.js");
    const issue: ProductionRef = { type: "publication", id: "photography-film" };
    await ensurePipeline({ projectRoot: root, ref: issue, totalUnits: 50 });

    await markStage({ projectRoot: root, ref: issue, stage: "content.factcheck" });
    expect((await loadPipeline(root, issue))?.stage).toBe("content.factcheck");

    const after = await completeStage({ projectRoot: root, ref: issue, stage: "content.factcheck" });
    expect(after.moved).toBe(true);
    expect(after.state.stage).toBe("content.audit");

    // Only forwards: a late report cannot drag the run back to the writing.
    await markStage({ projectRoot: root, ref: issue, stage: "content.write" });
    expect((await loadPipeline(root, issue))?.stage).toBe("content.audit");
  });
});
