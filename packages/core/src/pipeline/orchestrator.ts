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
  PIPELINE_STATE_VERSION,
  type PipelineState,
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
 * Record a unit of the current stage as finished, and advance if that was the
 * last one. This is what a runner calls when it has written a chapter.
 */
export async function reportUnitDone(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly unit: number;
  readonly emit?: EventSink;
}): Promise<AdvanceResult> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const next = completeUnit(current, input.unit);
  await savePipeline(input.projectRoot, input.ref, next);
  return advance({ ...input, state: next });
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
