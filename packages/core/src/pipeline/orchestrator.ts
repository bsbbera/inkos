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
import { readdir, readFile } from "node:fs/promises";
import { commitAtomicFileSet } from "../utils/atomic-file-set.js";
import { PRODUCTIONS, type ProductionPipeline, type ProductionSpec, type PipelineGate } from "../productions/registry.js";
import { executorFor, type StageExecutor, type StageResult } from "./executors.js";
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
  rewind as rewindState,
  skipReason,
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

/**
 * Walk a run to a gate and on past it, for work that was finished without a run.
 *
 * Every short and book written before `pipeline.json` existed has no state, so
 * nothing ever advanced it and its pictures and build never started. This
 * moves a fresh (or earlier) run forward to the gate, leaves the gate open for
 * a sign-off, and carries on into the next stage. A run already past the gate
 * is an error rather than a quiet no-op, so a second press cannot restart it.
 */
export async function openGate(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly gate: PipelineGate;
  readonly totalUnits: number;
  readonly emit?: EventSink;
}): Promise<AdvanceResult> {
  const pipeline = pipelineFor(input.ref.type);
  if (!pipeline) throw new Error(`${input.ref.type} does not run a pipeline`);
  const current = await ensurePipeline(input);
  const target = `gate:${input.gate}` as StageId;
  const at = reachStage(current, pipeline, target);
  if (at.stage !== target) {
    throw new Error(`the run is at ${current.stage} and cannot reach the ${input.gate} gate from there`);
  }
  return advance({
    projectRoot: input.projectRoot, ref: input.ref, state: at,
    ...(input.emit ? { emit: input.emit } : {}),
  });
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
    // The run is past this stage, so the report is stale and crediting it
    // would move work along twice. Say where the run actually is rather than
    // silently doing nothing.
    return { state: at, moved: false, reason: `run is at ${at.stage}, not ${input.satisfies}` };
  }
  const next = completeUnit(at, input.unit);
  await savePipeline(input.projectRoot, input.ref, next);
  return advance({ ...input, state: next });
}

/**
 * Stand the run on the stage a runner is about to perform.
 *
 * For runners that own their own loop — the magazine walks its seven steps
 * itself — the run file used to hear only about finished pages, so it sat on
 * `content.write` while the words were long done and the fact-check was
 * halfway through. The runner says where it is; the state file stops lying.
 *
 * Only forward, like `reachStage`: a late call cannot drag a run backwards.
 */
export async function markStage(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly stage: StageId;
  readonly emit?: EventSink;
}): Promise<PipelineState> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const pipeline = pipelineFor(input.ref.type);
  if (!pipeline) throw new Error(`${input.ref.type} does not run a pipeline`);
  const next = reachStage(current, pipeline, input.stage);
  if (next === current) return current;
  await savePipeline(input.projectRoot, input.ref, next);
  if (input.emit) input.emit(emitFor(next, input.ref, true));
  return next;
}

/**
 * Stand the run on an earlier stage, to do it again.
 *
 * `markStage` only moves forward, so a person asking to re-research an issue
 * whose run was already writing had no way to say so: the run file stayed on
 * `content.write` and the research was redone behind its back. Sign-offs are
 * left alone — redoing work is not withdrawing an approval, and the stages that
 * need one still check for it.
 */
export async function rewindTo(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly stage: StageId;
}): Promise<PipelineState> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const pipeline = pipelineFor(input.ref.type);
  if (!pipeline) throw new Error(`${input.ref.type} does not run a pipeline`);
  const next = rewindState(current, pipeline, input.stage);
  if (next !== current) await savePipeline(input.projectRoot, input.ref, next);
  return next;
}

/**
 * Change how many units a run has.
 *
 * A magazine's run starts before its flatplan exists, sized to the extent it
 * asked for; the plan is the first moment the page count is real, and a plan
 * that came back one page short must not leave the run waiting for a page
 * that will never be written.
 */
export async function resizeUnits(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly total: number;
}): Promise<PipelineState> {
  const current = await loadPipeline(input.projectRoot, input.ref);
  if (!current) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  if (current.units.total === input.total || input.total < 1) return current;
  const next: PipelineState = {
    ...current,
    units: {
      ...current.units,
      total: input.total,
      done: current.units.done.filter((u) => u <= input.total),
    },
  };
  await savePipeline(input.projectRoot, input.ref, next);
  return next;
}

/**
 * A whole stage done at once, for work that has no per-unit shape.
 *
 * An issue's fact-check is one pass over the whole issue, not fifty separate
 * approvals, so crediting unit 1 and leaving 49 outstanding would park the run
 * on a stage that had finished. Every unit is credited, then the run moves.
 */
export async function completeStage(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
  readonly stage: StageId;
  readonly emit?: EventSink;
}): Promise<AdvanceResult> {
  const at = await markStage(input);
  if (at.stage !== input.stage) {
    return { state: at, moved: false, reason: `run is at ${at.stage}, not ${input.stage}` };
  }
  let state = at;
  for (let unit = 1; unit <= state.units.total; unit += 1) state = completeUnit(state, unit);
  await savePipeline(input.projectRoot, input.ref, state);
  return advance({ ...input, state });
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
 * Units in flight, so one can be dropped without ending the stage.
 *
 * Cancelling used to mean cancelling a whole stage: fifty pages of art, ended
 * because page nine was going wrong. A unit gets its own signal, chained to
 * the stage's, and stopping it leaves the unit unfinished — not failed — so
 * the stage stays open and the next run picks that one up.
 */
const unitsInFlight = new Map<string, Map<number, AbortController>>();

const flightKey = (ref: ProductionRef): string => `${ref.type}/${ref.id}`;

/** Stop the unit this run is working on, and let the stage carry on. */
export function cancelUnit(ref: ProductionRef, unit: number): boolean {
  const controller = unitsInFlight.get(flightKey(ref))?.get(unit);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Which units of this run are being worked on right now. */
export function unitsRunning(ref: ProductionRef): ReadonlyArray<number> {
  return [...(unitsInFlight.get(flightKey(ref))?.keys() ?? [])];
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
  /**
   * Stop after the unit in hand.
   *
   * Checked between units and handed to the executor, which is the only pair of
   * places where stopping is safe. A stage abandoned mid-unit would leave the
   * half-written file that every executor's resume check then mistakes for
   * finished work.
   */
  readonly signal?: AbortSignal;
  /** Told which unit is in hand, so the queue can show it and aim a stop at it. */
  readonly onUnit?: (unit: number) => void;
  /**
   * The run's own executors, ahead of the registered ones.
   *
   * A magazine run carries its model call in its context — chat's session, the
   * issue page's, the recurring clock's — and a registry filled once at boot
   * cannot hold a per-run context. Same loop, same bookkeeping; only where the
   * stage's work comes from differs.
   */
  readonly executor?: (stage: string) => StageExecutor | null;
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
  const pipeline = pipelineFor(input.ref.type);
  /*
   * A stage this kind skips is walked past here rather than performed.
   *
   * It has to happen in this function as well as in `advance`, because a run
   * can be standing *on* a skipped stage already: an older run file written
   * before the stage existed, or one that stopped at the step before. Without
   * this the run would sit there forever waiting for an executor that, by
   * declaration, is never coming.
   */
  const skipped = pipeline ? skipReason(pipeline, state.stage) : null;
  if (skipped) {
    input.onProgress?.(`Skipped ${state.stage}: ${skipped}`);
    const after = await advance({
      projectRoot: input.projectRoot,
      ref: input.ref,
      state,
      ...(input.emit ? { emit: input.emit } : {}),
    });
    return { ran: false, stage: state.stage, artifacts: [], advanced: after.moved };
  }
  const executor = input.executor?.(state.stage) ?? executorFor(state.stage, input.ref.type);
  if (!executor || gateOf(state.stage) || state.stage === "done") {
    return { ran: false, stage: state.stage, artifacts: [], advanced: false };
  }

  const stage = state.stage;
  const artifacts: string[] = [];
  for (let unit = 1; unit <= state.units.total; unit += 1) {
    if (state.units.done.includes(unit)) continue;
    if (input.signal?.aborted) {
      // Units already finished stay finished; the run simply stands where it
      // is, which is the same state a crash would leave and the same one
      // `resume` picks up.
      input.onProgress?.(`Cancelled before unit ${unit}`);
      return { ran: true, stage, artifacts, advanced: false };
    }
    /*
     * One signal per unit, chained to the stage's.
     *
     * The executor is handed this rather than the stage's own, so "stop this
     * page" and "stop this stage" are different acts with different costs.
     */
    const perUnit = new AbortController();
    const relay = () => perUnit.abort();
    input.signal?.addEventListener("abort", relay, { once: true });
    const flight = unitsInFlight.get(flightKey(input.ref)) ?? new Map<number, AbortController>();
    flight.set(unit, perUnit);
    unitsInFlight.set(flightKey(input.ref), flight);
    input.onUnit?.(unit);

    const result = await executor({
      projectRoot: input.projectRoot,
      type: input.ref.type,
      id: input.ref.id,
      unit,
      ...(input.shimUrl ? { shimUrl: input.shimUrl } : {}),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      signal: perUnit.signal,
    }).catch((error: unknown): StageResult => ({
      ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error),
    })).finally(() => {
      input.signal?.removeEventListener("abort", relay);
      flight.delete(unit);
      if (flight.size === 0) unitsInFlight.delete(flightKey(input.ref));
    });

    // Stopped on its own, with the stage still wanted: the unit stays
    // unfinished, the run stays on this stage, and the next pass picks it up.
    if (perUnit.signal.aborted && !input.signal?.aborted) {
      input.onProgress?.(`Stopped ${state.units.kind} ${unit}; the rest of the stage carries on`);
      continue;
    }

    if (!result.ok) {
      if (input.signal?.aborted) {
        // The stage did not fail; it was stopped. Recording a failed unit here
        // would put "fetch aborted" on the screen as though something broke,
        // and leave the run marked failed for a decision somebody made on
        // purpose. The unit stays untouched, which is where a cancel leaves it.
        input.onProgress?.(`Cancelled during unit ${unit}`);
        return { ran: true, stage, artifacts, advanced: false };
      }
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
    // Credited to the stage that ran, not whichever the run now stands on: an
    // executor that reports its own unit can finish the stage first, and the
    // same unit then landed on the next stage, which it never touched.
    await reportUnitDone({
      projectRoot: input.projectRoot, ref: input.ref, unit, satisfies: stage,
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
/**
 * Every run this workspace knows about, whatever state it is in.
 *
 * Walks the out-directory of each type that runs a pipeline. It is a scan of
 * the disk rather than an index, which is fine at this size and is the thing a
 * cache would later be built from — the files stay the truth either way.
 */
export async function allRuns(projectRoot: string): Promise<ReadonlyArray<{
  readonly ref: ProductionRef;
  readonly state: PipelineState;
}>> {
  const out: Array<{ ref: ProductionRef; state: PipelineState }> = [];
  for (const spec of PRODUCTIONS) {
    if (!spec.pipeline) continue;
    let ids: string[];
    try {
      ids = (await readdir(join(projectRoot, spec.outDir), { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue; // A type with no folder simply has no runs.
    }
    // The magazine keeps its issues one level down, which is why a plain
    // listing of its out dir finds "issues" and nothing else.
    if (ids.length === 1 && ids[0] === "issues") {
      try {
        ids = (await readdir(join(projectRoot, spec.outDir, "issues"), { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        continue;
      }
    }
    for (const id of ids) {
      const ref = { type: spec.id, id };
      const state = await loadPipeline(projectRoot, ref);
      if (state) out.push({ ref, state });
    }
  }
  return out;
}

/**
 * Tell the truth about runs the last shutdown interrupted.
 *
 * `status: "running"` written to disk means a stage was in flight when the
 * process ended. Nothing survives a restart, so on boot that status is a lie —
 * and it is the lie that made a killed Studio look like it was still working:
 * the screen showed a run in progress that no longer had anything behind it,
 * forever, with no control to restart it.
 *
 * The unit is recorded as failed-but-resumable rather than done, because
 * whether it finished is exactly what nobody knows. Re-running a stage that had
 * in fact completed is cheap and safe — every executor checks for its own
 * output first — and losing a chapter is not.
 */
export async function markInterrupted(projectRoot: string): Promise<ReadonlyArray<ProductionRef>> {
  const touched: ProductionRef[] = [];
  for (const { ref, state } of await allRuns(projectRoot)) {
    if (state.status !== "running") continue;
    const next: PipelineState = {
      ...state,
      status: "failed",
      units: {
        ...state.units,
        failed: [
          ...state.units.failed.filter((f) => f.unit !== 0),
          { unit: 0, error: `interrupted at ${state.stage} — the app stopped mid-stage`, resumable: true },
        ],
      },
      history: [...state.history, {
        at: new Date().toISOString(),
        event: "run:interrupted",
        stage: state.stage,
      }],
    };
    await savePipeline(projectRoot, ref, next);
    touched.push(ref);
  }
  return touched;
}

/**
 * Say, on disk, that nobody is working on this any more.
 *
 * A cancelled stage leaves `status: "running"` behind, and that is the same lie
 * a crash leaves — a run the screen shows as in progress with nothing behind
 * it. `markInterrupted` only tells it at boot, which is far too late for a
 * cancel: the app is still up and the person is looking at it.
 *
 * Idle rather than failed. Nothing went wrong; somebody changed their mind, and
 * the work that was finished stays finished.
 */
export async function pause(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
}): Promise<PipelineState | null> {
  const state = await loadPipeline(input.projectRoot, input.ref);
  if (!state || state.status !== "running") return state;
  const next: PipelineState = {
    ...state,
    status: "idle",
    history: [...state.history, {
      at: new Date().toISOString(), event: "run:cancelled", stage: state.stage,
    }],
  };
  await savePipeline(input.projectRoot, input.ref, next);
  return next;
}

/**
 * Pick a run back up.
 *
 * Clears the interruption mark and hands the state back; the caller starts the
 * stage, because starting work is the Studio's job and this module's whole
 * point is that deciding and doing stay apart.
 */
export async function resume(input: {
  readonly projectRoot: string;
  readonly ref: ProductionRef;
}): Promise<PipelineState> {
  const state = await loadPipeline(input.projectRoot, input.ref);
  if (!state) throw new Error(`No pipeline state for ${input.ref.type}/${input.ref.id}`);
  const failed = state.units.failed.filter((f) => f.unit !== 0);
  const next: PipelineState = {
    ...state,
    status: "running",
    units: { ...state.units, failed },
    history: [...state.history, {
      at: new Date().toISOString(), event: "run:resumed", stage: state.stage,
    }],
  };
  await savePipeline(input.projectRoot, input.ref, next);
  return next;
}

export function waitingOn(
  states: ReadonlyArray<{ readonly ref: ProductionRef; readonly state: PipelineState }>,
): ReadonlyArray<WaitingProduction> {
  const out: WaitingProduction[] = [];
  // Every gate still unsigned, wherever the run has got to: the run does not
  // stand at a gate any more, it walks through and leaves it open.
  for (const { ref, state } of states) {
    for (const [name, record] of Object.entries(state.gates)) {
      if (record.state !== "waiting") continue;
      const gate = name as PipelineGate;
      out.push({ ref, gate, units: pendingUnits(state, gate), stage: state.stage });
    }
  }
  return out;
}
