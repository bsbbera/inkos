/**
 * Where a production has got to, as a value.
 *
 * Every kind of run in this app already knows its own progress, and no two
 * agree on how to say so: a book keeps chapter records in `chapters/index.json`,
 * a magazine keeps gate flags on `publication.json`, a translation keeps
 * neither and simply stops. Nothing outside a runner can ask "what is this
 * waiting for" without knowing which runner made it, so nothing outside a
 * runner ever asks — which is why finishing a chapter does not start anything,
 * and why a Studio restart mid-run loses the thread entirely.
 *
 * This is that question given one answer for all of them. The transitions here
 * are pure: `advance`, `approve`, `reject` and `withdraw` take a state and
 * return a state, touching no disk and starting no work. The orchestrator does
 * the starting; keeping the decision separate from the doing is what makes the
 * decision testable, and the sequencing is the part that has been wrong.
 *
 * Approvals are reversible on purpose. Today a signed-off chapter cannot be
 * reopened — the flag only goes one way — so a mistake at a gate means editing
 * JSON by hand. `withdraw` is the inverse of `approve`, and the rule it comes
 * from is that the only irreversible thing is a side effect that already left
 * the machine.
 */

import type { PipelineGate, ProductionPipeline } from "../productions/registry.js";

export const PIPELINE_STATE_VERSION = 1 as const;

export type PipelineStatus = "idle" | "running" | "waiting-gate" | "failed" | "done";
export type GateState = "blocked" | "waiting" | "approved" | "rejected";

/** `content.write`, `gate:content`, or the two terminals. */
export type StageId = string;

export const DONE: StageId = "done";

export interface UnitFailure {
  readonly unit: number;
  readonly error: string;
  /** False only when re-running cannot possibly help. */
  readonly resumable: boolean;
}

export interface PipelineUnits {
  readonly kind: ProductionPipeline["unit"];
  readonly total: number;
  /** Unit numbers finished in the CURRENT stage, cleared on entering the next. */
  readonly done: ReadonlyArray<number>;
  readonly failed: ReadonlyArray<UnitFailure>;
}

export interface GateRecord {
  readonly state: GateState;
  readonly at?: string;
  readonly by?: string;
  readonly note?: string;
  /**
   * Per-unit decisions. A gate is only approved once every unit is, which is
   * what lets a reader sign off chapter 3 while chapter 4 is still being
   * written instead of waiting for the whole book.
   */
  readonly perUnit?: Readonly<Record<string, GateState>>;
}

export interface HistoryEntry {
  readonly at: string;
  readonly event: string;
  readonly stage?: StageId;
  readonly gate?: PipelineGate;
  readonly units?: ReadonlyArray<number>;
  readonly note?: string;
}

export interface PipelineState {
  readonly version: typeof PIPELINE_STATE_VERSION;
  readonly type: string;
  readonly stage: StageId;
  readonly status: PipelineStatus;
  readonly units: PipelineUnits;
  readonly gates: Readonly<Record<string, GateRecord>>;
  /**
   * Append-only. Withdrawing an approval adds an entry; it never removes the
   * one it undoes, because how a production got here is not the same question
   * as where it is, and the second must not overwrite the first.
   */
  readonly history: ReadonlyArray<HistoryEntry>;
}

/** Deterministic clock injection keeps the transitions testable. */
export type Now = () => string;
const systemNow: Now = () => new Date().toISOString();

/**
 * Every step of the run, in order, gates included.
 *
 * A macro-stage with no sub-stages contributes nothing and neither does its
 * gate — that is how a screenplay (deliberately not art-directed) and a
 * translation (no art at all) walk the same rails as a magazine without a
 * single branch anywhere else.
 */
export function stageSequence(pipeline: ProductionPipeline): ReadonlyArray<StageId> {
  const out: StageId[] = [];
  const macros: ReadonlyArray<readonly [PipelineGate, ReadonlyArray<string>]> = [
    ["content", pipeline.content],
    ["design", pipeline.design],
    ["build", pipeline.build],
  ];
  for (const [macro, subs] of macros) {
    if (subs.length === 0) continue;
    for (const sub of subs) out.push(`${macro}.${sub}`);
    if (pipeline.gates.includes(macro)) out.push(`gate:${macro}`);
  }
  out.push(DONE);
  return out;
}

export function isGate(stage: StageId): boolean {
  return stage.startsWith("gate:");
}

export function gateOf(stage: StageId): PipelineGate | null {
  return isGate(stage) ? (stage.slice("gate:".length) as PipelineGate) : null;
}

export function initialState(input: {
  readonly type: string;
  readonly pipeline: ProductionPipeline;
  readonly totalUnits: number;
  readonly now?: Now;
}): PipelineState {
  const now = (input.now ?? systemNow)();
  const sequence = stageSequence(input.pipeline);
  const gates: Record<string, GateRecord> = {};
  // Every gate starts blocked. "Waiting" is a claim that someone can act, and
  // nobody can act on the design gate before any content exists.
  for (const gate of input.pipeline.gates) gates[gate] = { state: "blocked" };
  return {
    version: PIPELINE_STATE_VERSION,
    type: input.type,
    stage: sequence[0] ?? DONE,
    status: "idle",
    units: { kind: input.pipeline.unit, total: input.totalUnits, done: [], failed: [] },
    gates,
    history: [{ at: now, event: "created", stage: sequence[0] ?? DONE }],
  };
}

function log(state: PipelineState, entry: HistoryEntry): ReadonlyArray<HistoryEntry> {
  return [...state.history, entry];
}

/** Mark one unit finished in the current stage. Does not move the pipeline. */
export function completeUnit(
  state: PipelineState,
  unit: number,
  now: Now = systemNow,
): PipelineState {
  if (state.units.done.includes(unit)) return state;
  return {
    ...state,
    status: "running",
    units: {
      ...state.units,
      done: [...state.units.done, unit].sort((a, b) => a - b),
      // Succeeding clears an earlier failure for the same unit; leaving it
      // behind would keep a finished run looking broken forever.
      failed: state.units.failed.filter((f) => f.unit !== unit),
    },
    history: log(state, { at: now(), event: "unit:done", stage: state.stage, units: [unit] }),
  };
}

export function failUnit(
  state: PipelineState,
  failure: UnitFailure,
  now: Now = systemNow,
): PipelineState {
  return {
    ...state,
    status: "failed",
    units: {
      ...state.units,
      failed: [...state.units.failed.filter((f) => f.unit !== failure.unit), failure],
    },
    history: log(state, {
      at: now(), event: "unit:failed", stage: state.stage,
      units: [failure.unit], note: failure.error,
    }),
  };
}

function stageComplete(state: PipelineState): boolean {
  return state.units.failed.length === 0 && state.units.done.length >= state.units.total;
}

/**
 * Move to the next step, or explain why not.
 *
 * The one function that changes `stage`. Everything else records facts about
 * the current one; this reads those facts and decides. Keeping that in a single
 * place is the whole point — the hand-off between stages is exactly what does
 * not exist today, and it cannot be made to exist by nine runners each
 * deciding for themselves.
 */
export function advance(
  state: PipelineState,
  pipeline: ProductionPipeline,
  now: Now = systemNow,
): { readonly state: PipelineState; readonly moved: boolean; readonly reason?: string } {
  if (state.stage === DONE) return { state, moved: false, reason: "already done" };

  const gate = gateOf(state.stage);
  if (gate) {
    // A gate is not something the pipeline can walk past on its own. It waits
    // for a person, and `approve` is what calls back in here.
    if (state.gates[gate]?.state !== "approved") {
      const waiting: PipelineState = {
        ...state,
        status: "waiting-gate",
        gates: { ...state.gates, [gate]: { ...state.gates[gate], state: "waiting" } },
        history: state.gates[gate]?.state === "waiting"
          ? state.history
          : log(state, { at: now(), event: "gate:open", gate, stage: state.stage }),
      };
      return { state: waiting, moved: false, reason: `waiting on ${gate} gate` };
    }
  } else if (!stageComplete(state)) {
    const reason = state.units.failed.length > 0
      ? `${state.units.failed.length} unit(s) failed`
      : `${state.units.done.length}/${state.units.total} units done`;
    return { state, moved: false, reason };
  }

  const sequence = stageSequence(pipeline);
  const index = sequence.indexOf(state.stage);
  const next = index === -1 ? DONE : sequence[index + 1] ?? DONE;
  const nextGate = gateOf(next);

  const moved: PipelineState = {
    ...state,
    stage: next,
    status: next === DONE ? "done" : nextGate ? "waiting-gate" : "running",
    // Unit progress is per stage. Carrying it forward would make the next
    // stage look finished before it had started.
    units: { ...state.units, done: [], failed: [] },
    gates: nextGate
      ? { ...state.gates, [nextGate]: { ...state.gates[nextGate], state: "waiting" } }
      : state.gates,
    history: log(state, {
      at: now(),
      event: nextGate ? "gate:open" : next === DONE ? "run:done" : "stage:start",
      stage: next,
      ...(nextGate ? { gate: nextGate } : {}),
    }),
  };
  return { state: moved, moved: true };
}

function unitsOrAll(state: PipelineState, units?: ReadonlyArray<number>): ReadonlyArray<number> {
  if (units && units.length > 0) return units;
  return Array.from({ length: state.units.total }, (_, i) => i + 1);
}

function withPerUnit(
  record: GateRecord | undefined,
  units: ReadonlyArray<number>,
  value: GateState,
): Readonly<Record<string, GateState>> {
  const perUnit: Record<string, GateState> = { ...(record?.perUnit ?? {}) };
  for (const unit of units) perUnit[String(unit)] = value;
  return perUnit;
}

function everyUnitIs(
  perUnit: Readonly<Record<string, GateState>>,
  total: number,
  value: GateState,
): boolean {
  for (let unit = 1; unit <= total; unit += 1) {
    if (perUnit[String(unit)] !== value) return false;
  }
  return true;
}

/**
 * Sign off some units, or all of them.
 *
 * The gate itself only turns green once nothing is outstanding, so the caller
 * can approve as it reads rather than in one sitting. Approving the last unit
 * is what makes the run continue — the caller advances immediately afterwards,
 * which is the hand-off the user described as missing: approving content is
 * what starts the images.
 */
export function approve(input: {
  readonly state: PipelineState;
  readonly gate: PipelineGate;
  readonly units?: ReadonlyArray<number>;
  readonly by?: string;
  readonly now?: Now;
}): PipelineState {
  const { state, gate } = input;
  const now = input.now ?? systemNow;
  const units = unitsOrAll(state, input.units);
  const perUnit = withPerUnit(state.gates[gate], units, "approved");
  const settled = everyUnitIs(perUnit, state.units.total, "approved");
  return {
    ...state,
    gates: {
      ...state.gates,
      [gate]: {
        ...state.gates[gate],
        state: settled ? "approved" : "waiting",
        at: now(),
        ...(input.by ? { by: input.by } : {}),
        perUnit,
      },
    },
    history: log(state, { at: now(), event: settled ? "gate:approved" : "gate:unit-approved", gate, units }),
  };
}

/**
 * Send units back, optionally to an earlier macro-stage.
 *
 * `backTo` is what makes a design-gate rejection able to say "the problem is
 * the writing": those units return to the content stage and their content
 * approval is withdrawn with them, rather than being re-illustrated to fix a
 * sentence.
 */
export function reject(input: {
  readonly state: PipelineState;
  readonly gate: PipelineGate;
  readonly units: ReadonlyArray<number>;
  readonly note?: string;
  readonly backTo?: PipelineGate;
  readonly now?: Now;
}): PipelineState {
  const { state, gate } = input;
  const now = input.now ?? systemNow;
  const perUnit = withPerUnit(state.gates[gate], input.units, "rejected");
  let next: PipelineState = {
    ...state,
    status: "waiting-gate",
    gates: {
      ...state.gates,
      [gate]: {
        ...state.gates[gate],
        state: "rejected",
        at: now(),
        ...(input.note ? { note: input.note } : {}),
        perUnit,
      },
    },
    history: log(state, {
      at: now(), event: "gate:rejected", gate, units: input.units,
      ...(input.note ? { note: input.note } : {}),
    }),
  };
  if (input.backTo && input.backTo !== gate) {
    next = withdraw({ state: next, gate: input.backTo, units: input.units, now });
  }
  return next;
}

/**
 * Undo an approval without erasing that it happened.
 *
 * The counters and the history stay exactly as they were; only the gate state
 * for those units reopens. A withdrawal is a new fact about the run, not the
 * deletion of an old one, which is why `history` grows here rather than
 * shrinking.
 */
export function withdraw(input: {
  readonly state: PipelineState;
  readonly gate: PipelineGate;
  readonly units?: ReadonlyArray<number>;
  /** Needed to walk the run back to the gate. Omit only in a pure gate test. */
  readonly pipeline?: ProductionPipeline;
  readonly now?: Now;
}): PipelineState {
  const { state, gate } = input;
  const now = input.now ?? systemNow;
  const record = state.gates[gate];
  if (!record) return state;
  const units = unitsOrAll(state, input.units);
  const perUnit = withPerUnit(record, units, "waiting");

  /*
   * The run goes back to the gate it is no longer allowed past.
   *
   * Reopening the record alone left the state incoherent: the content gate
   * read "waiting" while the run stood in design.artplan, which is a position
   * it only reached by being approved. Whatever design has produced stays on
   * disk - withdrawal is not deletion - but the run is behind the gate again,
   * and re-approving walks it forward through `advance` exactly as the first
   * approval did.
   */
  const sequence = input.pipeline ? stageSequence(input.pipeline) : [];
  const gateStage = `gate:${gate}`;
  const here = sequence.indexOf(state.stage);
  const there = sequence.indexOf(gateStage);
  const rewind = there !== -1 && here !== -1 && here > there;

  return {
    ...state,
    ...(rewind
      ? {
          stage: gateStage,
          status: "waiting-gate" as const,
          // Unit progress belongs to the stage that was interrupted, not to
          // the gate we are standing back at.
          units: { ...state.units, done: [], failed: [] },
        }
      : {}),
    gates: {
      ...state.gates,
      [gate]: { ...record, state: "waiting", at: now(), perUnit },
    },
    history: log(state, {
      at: now(), event: "gate:withdrawn", gate, units,
      ...(rewind ? { stage: gateStage, note: `run returned from ${state.stage}` } : {}),
    }),
  };
}

/** Units still owed a decision at a gate — what a "waiting on you" list shows. */
export function pendingUnits(state: PipelineState, gate: PipelineGate): ReadonlyArray<number> {
  const perUnit = state.gates[gate]?.perUnit ?? {};
  const out: number[] = [];
  for (let unit = 1; unit <= state.units.total; unit += 1) {
    if (perUnit[String(unit)] !== "approved") out.push(unit);
  }
  return out;
}
