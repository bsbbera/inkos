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
  /**
   * Units whose approved work was made from something that has since been
   * withdrawn upstream. The artefacts are still on disk — this is a mark, not
   * a deletion — so the screen can say which ones need another look and the
   * rest can be reused rather than regenerated.
   */
  readonly stale?: ReadonlyArray<number>;
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

/**
 * Put the run on the stage a runner has just done, if it is not there already.
 *
 * Units are credited to whatever stage the run is standing on, which is only
 * safe when every stage before it has actually run. Most of them have not: a
 * book declares `plan` before `write`, nothing wires the architect to the
 * pipeline yet, and so reporting a written chapter used to complete the *plan*
 * stage and leave the whole run one step behind itself for the rest of its
 * life. The audits then completed `write`, and the destyle stage was never
 * reached at all.
 *
 * So a runner says which stage it satisfied and this walks the run there,
 * recording the skipped stages rather than pretending they happened. Three
 * rules keep that honest:
 *
 * - It only ever moves forward. A report for a stage the run has already left
 *   is stale — a page rewritten after its gate opened — and is ignored, which
 *   is what stops a late call from dragging a run backwards.
 * - It crosses gates like any other step - a gate is a sign-off, not a stop -
 *   and leaves each one it crosses open for that sign-off.
 * - It clears unit progress on the way, because the units done in the stage
 *   being left belong to that stage, not to the one being entered.
 */
export function reachStage(
  state: PipelineState,
  pipeline: ProductionPipeline,
  stage: StageId,
  now: Now = systemNow,
): PipelineState {
  if (state.stage === stage) return state;
  const sequence = stageSequence(pipeline);
  const from = sequence.indexOf(state.stage);
  const to = sequence.indexOf(stage);
  if (from < 0 || to < 0 || to < from) return state;
  const gates: Record<string, GateRecord> = { ...state.gates };
  for (const s of sequence.slice(from, to)) {
    const g = gateOf(s);
    if (g && gates[g]?.state !== "approved") gates[g] = { ...gates[g], state: "waiting" };
  }
  return {
    ...state,
    stage,
    status: "running",
    gates,
    units: { ...state.units, done: [], failed: [] },
    history: log(state, {
      at: now(),
      event: "stage:skipped",
      stage,
      note: `entered from ${state.stage}`,
    }),
  };
}

/**
 * Put the run back on an earlier stage, to perform it again.
 *
 * The inverse of `reachStage`, and only ever backwards. Units clear because the
 * stage is being done again; gates keep their records, because doing work
 * again is not taking a sign-off back — `withdraw` is that.
 */
export function rewind(
  state: PipelineState,
  pipeline: ProductionPipeline,
  stage: StageId,
  now: Now = systemNow,
): PipelineState {
  if (state.stage === stage) return state;
  const sequence = stageSequence(pipeline);
  const from = sequence.indexOf(state.stage);
  const to = sequence.indexOf(stage);
  if (to < 0 || (from >= 0 && to > from)) return state;
  return {
    ...state,
    stage,
    status: "running",
    units: { ...state.units, done: [], failed: [] },
    history: log(state, { at: now(), event: "stage:rewound", stage, note: `back from ${state.stage}` }),
  };
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
 * Why this kind walks past this stage, or null when it performs it.
 *
 * Every kind declares the whole spine (`SPINE` in the registry); a kind that
 * cannot use a step says so here rather than dropping it from the graph. The
 * sentence is written for the person reading the strip, not for the log.
 */
export function skipReason(pipeline: ProductionPipeline, stage: StageId): string | null {
  return pipeline.skip?.[stage] ?? null;
}

/** A macro-stage with nothing left to perform — every step of it is skipped. */
export function macroSkipped(pipeline: ProductionPipeline, gate: PipelineGate): boolean {
  const subs = gate === "content" ? pipeline.content : gate === "design" ? pipeline.design : pipeline.build;
  return subs.length > 0 && subs.every((sub) => skipReason(pipeline, `${gate}.${sub}`) !== null);
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

  /*
   * A gate is a sign-off, not a stop. The run walks through it and the gate
   * stays open for a yes whenever the person gets to it: the prompts exist
   * from the first draft, and the writing, the pictures and the layout can all
   * be changed at any point, so holding the pictures back until the words were
   * signed bought nothing but a wait.
   */
  const gate = gateOf(state.stage);
  /*
   * A skipped stage is walked past, not waited on.
   *
   * It is still a step of this run: it is in the sequence, the strip draws it,
   * and the history says it was skipped and why. What it is not is work — so
   * the "are all units done" question below does not apply to it, and asking
   * it would park the run on a stage nothing will ever perform.
   */
  const skipped = gate ? null : skipReason(pipeline, state.stage);
  if (!gate && !skipped && !stageComplete(state)) {
    const reason = state.units.failed.length > 0
      ? `${state.units.failed.length} unit(s) failed`
      : `${state.units.done.length}/${state.units.total} units done`;
    return { state, moved: false, reason };
  }

  const sequence = stageSequence(pipeline);
  const index = sequence.indexOf(state.stage);
  const next = index === -1 ? DONE : sequence[index + 1] ?? DONE;
  const nextGate = gateOf(next);
  /*
   * A sign-off given early stands; only an unsigned gate reads as open.
   *
   * A gate whose every step was skipped signs itself. Asking someone to
   * approve the design of a translation — which has none, by declaration —
   * would put a permanent "waiting on you" on the Home screen for a decision
   * with nothing in it. The signature says who made it.
   */
  const opened = (g: PipelineGate): GateRecord => {
    const held = state.gates[g] ?? { state: "blocked" as GateState };
    if (held.state === "approved") return { ...held, state: "approved" };
    if (macroSkipped(pipeline, g)) {
      return { ...held, state: "approved", at: now(), by: "quire", note: "every step of this was skipped" };
    }
    return { ...held, state: "waiting" };
  };

  const moved: PipelineState = {
    ...state,
    stage: next,
    status: next === DONE ? "done" : "running",
    // Unit progress is per stage. Carrying it forward would make the next
    // stage look finished before it had started.
    units: { ...state.units, done: [], failed: [] },
    gates: {
      ...state.gates,
      // Reached by `reachStage` rather than walked into: still "blocked".
      ...(gate ? { [gate]: opened(gate) } : {}),
      ...(nextGate ? { [nextGate]: opened(nextGate) } : {}),
    },
    // Two facts when a stage is skipped: that it was, and where the run went.
    // One entry would lose whichever half it left out.
    history: [
      ...state.history,
      ...(skipped ? [{ at: now(), event: "stage:skipped", stage: state.stage, note: skipped }] : []),
      {
        at: now(),
        event: nextGate ? "gate:open" : next === DONE ? "run:done" : "stage:start",
        stage: next,
        ...(nextGate ? { gate: nextGate } : {}),
      },
    ],
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
  // Signing off is the moment a stale unit stops being stale: the person has
  // now seen the work an upstream withdrawal made questionable.
  const record = clearStale(state.gates[gate] ?? { state: "waiting" }, units);
  return {
    ...state,
    gates: {
      ...state.gates,
      [gate]: {
        ...record,
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
   * The run stays where it is. A gate no longer holds anything back, so taking
   * a sign-off back is a fact about the sign-off, not a reason to stop or
   * redo the pictures.
   */

  /*
   * Everything downstream loses its sign-off for these units too.
   *
   * A cover was drawn from copy that has just been withdrawn, so the approval
   * of that cover was an approval of a picture of something else. Leaving it
   * standing is how a run reaches the build gate carrying art nobody has
   * agreed to since the words under it changed.
   *
   * The units are marked stale rather than cleared: the file stays on disk
   * with its recipe beside it, so re-approving the copy can reuse the art it
   * already has instead of paying for it twice, and only the stale units come
   * back for review.
   */
  const downstream = input.pipeline
    ? input.pipeline.gates.slice(input.pipeline.gates.indexOf(gate) + 1)
    : [];
  const gates: Record<string, GateRecord> = {
    ...state.gates,
    [gate]: { ...record, state: "waiting", at: now(), perUnit },
  };
  for (const later of downstream) {
    const laterRecord = state.gates[later];
    if (!laterRecord) continue;
    const laterUnits = units.filter(
      (u) => (laterRecord.perUnit?.[String(u)] ?? laterRecord.state) === "approved",
    );
    const stale = [...new Set([...(laterRecord.stale ?? []), ...units])].sort((a, b) => a - b);
    gates[later] = {
      ...laterRecord,
      ...(laterRecord.state === "approved" ? { state: "waiting" as const } : {}),
      ...(laterUnits.length ? { perUnit: withPerUnit(laterRecord, laterUnits, "waiting") } : {}),
      stale,
    };
  }

  return {
    ...state,
    gates,
    history: log(state, { at: now(), event: "gate:withdrawn", gate, units }),
  };
}

/**
 * Clear the stale mark on units that have been looked at again.
 *
 * Approving a gate is the moment its stale units stop being stale: the person
 * has now seen what the withdrawal made questionable and said yes to it.
 */
function clearStale(record: GateRecord, units: ReadonlyArray<number>): GateRecord {
  if (!record.stale?.length) return record;
  const left = record.stale.filter((u) => !units.includes(u));
  if (left.length === record.stale.length) return record;
  const { stale: _dropped, ...rest } = record;
  return left.length ? { ...rest, stale: left } : rest;
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
