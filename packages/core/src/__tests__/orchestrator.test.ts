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
    expect(raw.stage).toBe("content.plan");
    expect(raw.units.kind).toBe("chapter");
  });

  it("does not restart a run it already has", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    await finishStage(book, 2);
    const again = await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    expect(again.stage).toBe("content.write");
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

describe("approving the last unit is what starts the next stage", () => {
  it("carries a one-unit book from content through to the design gate", async () => {
    const events: OrchestratorEvent[] = [];
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 1 });

    // Walk the four content sub-stages. One unit each, so each report both
    // completes a stage and starts the next.
    for (let i = 0; i < 4; i += 1) await finishStage(book, 1, events);

    let state = (await loadPipeline(root, book))!;
    expect(state.stage).toBe("gate:content");
    expect(state.status).toBe("waiting-gate");
    expect(events.at(-1)).toMatchObject({ kind: "gate:open", gate: "content", pendingUnits: [1] });

    // The whole complaint, in one call: approving is all the user does.
    const after = await approve({
      projectRoot: root, ref: book, gate: "content", by: "user",
      emit: (e) => events.push(e),
    });
    expect(after.moved).toBe(true);
    expect(after.state.stage).toBe("design.artplan");
    expect(after.state.status).toBe("running");
    expect(events.some((e) => e.kind === "stage:start" && e.stage === "design.artplan")).toBe(true);

    // And it survives a restart, because it is on disk, not in a process.
    state = (await loadPipeline(root, book))!;
    expect(state.stage).toBe("design.artplan");
  });

  it("holds while any unit is still unapproved", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 3 });
    for (let i = 0; i < 4; i += 1) await finishStage(book, 3);

    const partial = await approve({ projectRoot: root, ref: book, gate: "content", units: [1, 2] });
    expect(partial.moved).toBe(false);
    expect(partial.state.stage).toBe("gate:content");

    const rest = await approve({ projectRoot: root, ref: book, gate: "content", units: [3] });
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
    expect(blocked.state.stage).toBe("content.plan");
    expect(blocked.state.status).toBe("failed");

    // Re-running the unit clears the failure and the run continues.
    const resumed = await reportUnitDone({ projectRoot: root, ref: book, unit: 2 });
    expect(resumed.moved).toBe(true);
    expect(resumed.state.stage).toBe("content.write");
    expect(resumed.state.units.failed).toEqual([]);
  });
});

describe("nothing signed off is stuck that way", () => {
  it("reopens a withdrawn gate and keeps the record of the approval", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    for (let i = 0; i < 4; i += 1) await finishStage(book, 2);
    await approve({ projectRoot: root, ref: book, gate: "content" });

    const reopened = await withdraw({ projectRoot: root, ref: book, gate: "content", units: [2] });
    expect(reopened.gates.content?.state).toBe("waiting");
    expect(reopened.gates.content?.perUnit?.["1"]).toBe("approved");
    expect(reopened.history.some((h) => h.event === "gate:approved")).toBe(true);
    expect(reopened.history.at(-1)?.event).toBe("gate:withdrawn");
  });

  it("sends a chapter back to writing when the art was rejected for the text", async () => {
    await ensurePipeline({ projectRoot: root, ref: book, totalUnits: 2 });
    for (let i = 0; i < 4; i += 1) await finishStage(book, 2);
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
    for (let i = 0; i < 4; i += 1) await finishStage(book, 2);
    await approve({ projectRoot: root, ref: book, gate: "content", units: [1] });

    const script: ProductionRef = { type: "script", id: "pilot" };
    await ensurePipeline({ projectRoot: root, ref: script, totalUnits: 1 });
    for (let i = 0; i < 4; i += 1) await finishStage(script, 1);

    const waiting = waitingOn([
      { ref: book, state: (await loadPipeline(root, book))! },
      { ref: script, state: (await loadPipeline(root, script))! },
    ]);
    expect(waiting).toEqual([
      { ref: book, gate: "content", units: [2], stage: "gate:content" },
      { ref: script, gate: "content", units: [1], stage: "gate:content" },
    ]);
  });
});

describe("stopping a stage", () => {
  it("leaves the unit alone and does not call it a failure", async () => {
    const controller = new AbortController();
    registerExecutor("content.plan", async (ctx) => {
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
    expect(state?.stage).toBe("content.plan");

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
    registerExecutor("content.plan", async (ctx) => {
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
