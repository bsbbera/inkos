/**
 * The one thing that moves a production forward.
 *
 * `pipeline-state.ts` decides; this does. It owns reading and writing
 * `pipeline.json`, and it owns the rule that approving the last unit at a gate
 * immediately advances the run — which is the hand-off nothing performed
 * before. Finishing a chapter used to leave a file on disk and stop; whether
 * anything happened next depended on a person noticing and clicking.
 *
 * It deliberately implements no stage. Stages are done by the runners that
 * already exist — the writer, the auditor, the publication runner, the shim's
 * Comfy and Affinity endpoints — and are reached through an executor table the
 * caller supplies. Sequencing lives here, work lives there, and nothing in
 * here knows what a chapter is.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { PRODUCTIONS, type ProductionPipeline, type ProductionSpec, type PipelineGate } from "../productions/registry.js";
import { executorFor, type StageResult } from "./executors.js";
import {
  advance as advanceState,
  approve as approveState,
  reject as rejectState,
  withdraw as withdrawState,
  completeUnit,
  failUnit,
  gateOf,
  initialState,
  pendingUnits,
  reachStage,
  PIPELINE_STATE_VERSION,
  type PipelineState,
  type StageId,
  type UnitFailure,
} from "./pipeline-state.js";

export const PIPELINE_FILE = "pipeline.json";

/** Which production, in the only two terms that identify one. */
export interface ProductionRef {
  readonly type: string;
  readonly id: string;
}

export interface OrchestratorEvent {
  readonly kind: "stage:start" | "gate:open" | "run:done" | "stage:blocked";
  readonly ref: ProductionRef;
  readonly stage: string;
  readonly gate?: PipelineGate;
  readonly pendingUnits?: ReadonlyArray<number>;
  readonly reason?: string;
}

export type EventSink = (event: OrchestratorEvent) => void;

export function specFor(type: string): ProductionSpec | undefined {
  return PRODUCTIONS.find((p) => p.id === type);
}

export function pipelineFor(type: string): ProductionPipeline | null {
  return specFor(type)?.pipeline ?? null;
}

/**
 * Where a production's state file lives.
 *
 * The registry's `outDir` is the one place that knows — which is why scripts
 * were invisible to the audit screen for so long, that screen having kept its
 * own guess of `scripts/` while the runner wrote to `dramas/`.
 */
export function pipelinePath(projectRoot: string, ref: ProductionRef): string {
  const spec = specFor(ref.type);
  if (!spec) throw new Error(`Unknown production type: ${ref.type}`);
  return join(projectRoot, spec.outDir, ref.id, PIPELINE_FILE);
}

function relativePipelinePath(ref: ProductionRef): string {
  const spec = specFor(ref.type);
  if (!spec) throw new Error(`Unknown production type: ${ref.type}`);
  return `${spec.outDir}/${ref.id}/${PIPELINE_FILE}`;
}

/** The state file, or null when this production has never had one. */
export async function loadPipeline(
  projectRoot: string,
  ref: ProductionRef,
): Promise<PipelineState | null> {
  try {
    const raw = await readFile(pipelinePath(projectRoot, ref), "utf-8");
    const parsed = JSON.parse(raw) as PipelineState;
    if (parsed?.version !== PIPELINE_STATE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Written through the file-set transaction, not a bare write.
 *
 * A torn `pipeline.json` is worse than a missing one: a half-written state
 * file is read back as a run that is somewhere it never was, and the
 * orchestrator would then act on it.
 */
export async function savePipeline(
  projectRoot: string,
  ref: ProductionRef,
  state: PipelineState,
): Promise<void> {
  await commitAtomicFileSet({
    rootDir: projectRoot,
    writes: [{
      relativePath: relativePipelinePath(ref),
      content: `${JSON.stringify(state, null, 2)}\n`,
    }],
  });
}

/** Start tracking a production, or return the state it already has. */
export async function ensurePipeline(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly totalUnits: number;
}): Promise<PipelineState> {
  const existing = await loadPipeline(input.projectRoot, input.ref);
  if (existing) return existing;
  const pipeline = pipelineFor(input.ref.type);
  if (!pipeline) throw new Error(`${input.ref.type} does not run a pipeline`);
  const state = initialState({
    type: input.ref.type,
    pipeline,
    totalUnits: input.totalUnits,
  });
  await savePipeline(input.projectRoot, input.ref, state);
  return state;
}

function emitFor(state: PipelineState, ref: ProductionRef, moved: boolean, reason?: string): OrchestratorEvent {
  const gate = gateOf(state.stage);
  if (gate) {
    return { kind: "gate:open", ref, stage: state.stage, gate, pendingUnits: pendingUnits(state, gate) };
  }
  if (state.stage === "done") return { kind: "run:done", ref, stage: state.stage };
  if (!moved) return { kind: "stage:blocked", ref, stage: state.stage, ...(reason ? { reason } : {}) };
  return { kind: "stage:start", ref, stage: state.stage };
}

export interface AdvanceResult {
  readonly state: PipelineState;
  readonly moved: boolean;
  readonly reason?: string;
}

/**
 * Move as far as the run can go, then stop and say where.
 *
 * A loop rather than one step, because several stages can complete in the same
 * breath: a production with a single unit finishes a stage the moment that unit
 * lands, and stopping after one transition would leave the run parked one step
 * short of the gate it is actually waiting at. It always terminates — every
 * iteration either moves along a finite sequence or breaks.
 */
export async function advance(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly state?: PipelineState;
  readonly emit?: EventSink;
}): Promise<AdvanceResult> {
  const pipeline = pipelineFor(input.ref.type);
  if (!pipeline) throw new Error(`${input.ref.type} does not run a pipeline`);
  const loaded = input.state ?? await loadPipeline(input.projectRoot, input.ref);
  if (!loaded) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);

  let state = loaded;
  let moved = false;
  let reason: string | undefined;
  for (;;) {
    const step = advanceState(state, pipeline);
    state = step.state;
    if (!step.moved) {
      reason = step.reason;
      break;
    }
    moved = true;
    if (input.emit) input.emit(emitFor(state, input.ref, true));
    if (state.stage === "done") break;
  }

  if (state !== loaded) await savePipeline(input.projectRoot, input.ref, state);
  if (input.emit && !moved) input.emit(emitFor(state, input.ref, false, reason));
  return { state, moved, ...(reason ? { reason } : {}) };
}

/**
 * Sign off units at a gate, then keep going.
 *
 * The `advance` is the point. Approving used to set a flag and nothing else,
 * so the next stage waited for a second, separate instruction that the person
 * approving had no reason to expect was needed.
 */
export async function approve(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly gate: PipelineGate;
  readonly units?: ReadonlyArray<number>;
  readonly by?: string;
  readonly emit?: EventSink;
}): Promise<AdvanceResult> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const approved = approveState({
    state: current, gate: input.gate,
    ...(input.units ? { units: input.units } : {}),
    ...(input.by ? { by: input.by } : {}),
  });
  await savePipeline(input.projectRoot, input.ref, approved);
  return advance({ ...input, state: approved });
}

export async function reject(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly gate: PipelineGate;
  readonly units: ReadonlyArray<number>;
  readonly note?: string;
  readonly backTo?: PipelineGate;
}): Promise<PipelineState> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const next = rejectState({
    state: current, gate: input.gate, units: input.units,
    ...(input.note ? { note: input.note } : {}),
    ...(input.backTo ? { backTo: input.backTo } : {}),
  });
  await savePipeline(input.projectRoot, input.ref, next);
  return next;
}

/** Reopen an approval. Never deletes the record that it was given. */
export async function withdraw(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly gate: PipelineGate;
  readonly units?: ReadonlyArray<number>;
}): Promise<PipelineState> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const pipeline = pipelineFor(input.ref.type);
  const next = withdrawState({
    state: current, gate: input.gate,
    ...(pipeline ? { pipeline } : {}),
    ...(input.units ? { units: input.units } : {}),
  });
  await savePipeline(input.projectRoot, input.ref, next);
  return next;
}

/**
 * Record a unit as finished, and advance if that was the last one. This is what
 * a runner calls when it has written a chapter.
 *
 * `satisfies` names the stage the caller actually did. Pass it whenever the
 * caller knows — a writer knows it wrote, an audit knows it read — because
 * without it the unit is credited to whichever stage the run happens to be
 * standing on, and for any type that declares a stage nothing has wired yet
 * (a book's `plan`) that is the wrong one. It only ever moves the run forward
 * and never past a gate; a report for a stage already left is ignored.
 */
export async function reportUnitDone(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly unit: number;
  readonly satisfies?: StageId;
  readonly emit?: EventSink;
}): Promise<AdvanceResult> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const pipeline = pipelineFor(input.ref.type);
  if (!pipeline) throw new Error(`${input.ref.type} does not run a pipeline`);

  const at = input.satisfies ? reachStage(current, pipeline, input.satisfies) : current;
  if (input.satisfies && at.stage !== input.satisfies) {
    // The run is past this stage, or a gate stands between. Either way the
    // report is stale and crediting it would move work that is already signed
    // off. Say where the run actually is rather than silently doing nothing.
    return { state: at, moved: false, reason: `run is at ${at.stage}, not ${input.satisfies}` };
  }
  const next = completeUnit(at, input.unit);
  await savePipeline(input.projectRoot, input.ref, next);
  return advance({ ...input, state: next });
}

/**
 * Report to the pipeline without ever letting bookkeeping cost real work.
 *
 * Every runner needs this and none of them should own it. A runner's job is to
 * write the book; telling the state machine about it is secondary, and a run
 * that threw because `pipeline.json` was locked would lose prose that was
 * already on disk. So the failure is reported to the caller's progress line and
 * swallowed: a stale state file is a nuisance, a lost draft is not.
 */
export async function tryTrack(
  step: () => Promise<unknown>,
  onProgress?: (message: string) => void,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    onProgress?.(
      `Pipeline state not updated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function reportUnitFailed(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly failure: UnitFailure;
}): Promise<PipelineState> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const next = failUnit(current, input.failure);
  await savePipeline(input.projectRoot, input.ref, next);
  return next;
}

/**
 * Do the current stage, if this app knows how, and move on when it is done.
 *
 * The missing half of the hand-off. `advance` says a stage has started and
 * stops there; something has to actually run it, and until now that something
 * was a person clicking a different screen. A stage with no executor is left
 * alone — its runner still owns it — so this can be called after every
 * transition without knowing which stages are wired yet.
 *
 * Failures are recorded against the unit rather than thrown: a stage that
 * cannot run is a state the screen has to show, and a rejected promise on a
 * background call is a state nothing shows.
 */
export async function runStage(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  /** Passed to stages that render; ignored by the rest. */
  readonly shimUrl?: string;
  readonly onProgress?: (message: string) => void;
  readonly emit?: EventSink;
}): Promise<{
  readonly ran: boolean;
  readonly stage: string;
  readonly artifacts: ReadonlyArray<string>;
  /** True only when the run left the stage. A caller chains on this and not on
      `ran`: a stage that ran and failed is still standing where it was, and
      chaining on `ran` would run it again, and again. */
  readonly advanced: boolean;
}> {
  const state = await loadPipeline(input.projectRoot, input.ref);
  if (!state) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const executor = executorFor(state.stage);
  if (!executor || gateOf(state.stage) || state.stage === "done") {
    return { ran: false, stage: state.stage, artifacts: [], advanced: false };
  }

  const stage = state.stage;
  const artifacts: string[] = [];
  for (let unit = 1; unit <= state.units.total; unit += 1) {
    if (state.units.done.includes(unit)) continue;
    const result = await executor({
      projectRoot: input.projectRoot,
      type: input.ref.type,
      id: input.ref.id,
      unit,
      ...(input.shimUrl ? { shimUrl: input.shimUrl } : {}),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    }).catch((error: unknown): StageResult => ({
      ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error),
    }));

    if (!result.ok) {
      await reportUnitFailed({
        projectRoot: input.projectRoot,
        ref: input.ref,
        failure: { unit, error: result.error ?? "stage failed", resumable: true },
      });
      if (input.emit) {
        input.emit({ kind: "stage:blocked", ref: input.ref, stage, reason: result.error ?? "stage failed" });
      }
      return { ran: true, stage, artifacts, advanced: false };
    }
    artifacts.push(...result.artifacts);
    // Reporting per unit rather than at the end: a stage interrupted halfway
    // through eight pages should resume at the ninth, not redo the eight.
    await reportUnitDone({
      projectRoot: input.projectRoot, ref: input.ref, unit,
      ...(input.emit ? { emit: input.emit } : {}),
    });
  }
  const after = await loadPipeline(input.projectRoot, input.ref);
  return { ran: true, stage, artifacts, advanced: after?.stage !== stage };
}

export interface WaitingProduction {
  readonly ref: ProductionRef;
  readonly gate: PipelineGate;
  readonly units: ReadonlyArray<number>;
  readonly stage: string;
}

/**
 * Everything that cannot move until a person acts.
 *
 * The whole of the "waiting on you" list, which until now could not be built
 * because no two production kinds recorded waiting the same way.
 */
export function waitingOn(
  states: ReadonlyArray<{ readonly ref: ProductionRef; readonly state: PipelineState }>,
): ReadonlyArray<WaitingProduction> {
  const out: WaitingProduction[] = [];
  for (const { ref, state } of states) {
    if (state.status !== "waiting-gate") continue;
    const gate = gateOf(state.stage);
    if (!gate) continue;
    out.push({ ref, gate, units: pendingUnits(state, gate), stage: state.stage });
  }
  return out;
}
