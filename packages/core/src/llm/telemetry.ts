/*
 * What each run spent, call by call (20 §5, Phase 2 step 3).
 *
 * A run opens a meter (`withRunMeter`) around its work; every model call made
 * inside it, at any depth, lands in `<runDir>/_telemetry/llm.jsonl` and in the
 * run's running total. AsyncLocalStorage carries the meter, so no call site
 * between the stage and the transport has to pass anything along.
 *
 * Two places record, because there are two transports: `chatCompletion` for
 * the pipelines and the stream guard for agent sessions (provider.ts).
 *
 * Cost is the model's list price times its tokens. A CLI or local model has no
 * price and records 0 dollars; its tokens still count, which is why the budget
 * has a token ceiling as well as a dollar one.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface LlmCall {
  readonly at: string;
  readonly agent?: string;
  readonly service?: string;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly costUsd: number;
  /**
   * The provider reported no counts (most CLIs) and these are chars/4. Kept so
   * the ceiling can see a CLI at all; shown with a ~, never as measured.
   */
  readonly estimated?: boolean;
}

export interface RunTotals {
  readonly calls: number;
  readonly input: number;
  readonly output: number;
  readonly costUsd: number;
  /** Some of the tokens are estimates. */
  readonly estimated?: boolean;
}

interface Meter {
  readonly file: string;
  /** Shared by every agent scope of the same run. */
  readonly run: { totals: RunTotals };
  readonly agent?: string;
  /** This production's own pins, read by the runner before the project's (21). */
  readonly pins?: Readonly<Record<string, string | { readonly service?: string; readonly model: string }>>;
}

const ZERO: RunTotals = { calls: 0, input: 0, output: 0, costUsd: 0 };
const als = new AsyncLocalStorage<Meter>();

export const telemetryFile = (runDir: string) => join(runDir, "_telemetry", "llm.jsonl");

/** Sum a run's telemetry file. Missing or partly written lines count as nothing. */
export async function readRunTotals(runDir: string): Promise<RunTotals> {
  let text = "";
  try { text = await readFile(telemetryFile(runDir), "utf-8"); } catch { return ZERO; }
  let t = ZERO;
  for (const line of text.split("\n")) {
    try { t = add(t, JSON.parse(line) as LlmCall); } catch { /* blank or torn */ }
  }
  return t;
}

const add = (t: RunTotals, c: Pick<LlmCall, "input" | "output" | "costUsd" | "estimated">): RunTotals => ({
  calls: t.calls + 1,
  input: t.input + (c.input || 0),
  output: t.output + (c.output || 0),
  costUsd: t.costUsd + (c.costUsd || 0),
  ...(t.estimated || c.estimated ? { estimated: true } : {}),
});

/** chars/4: the budget's stand-in for a provider that reports nothing. */
export const roughTokens = (chars: number) => Math.ceil(chars / 4);

// One meter per run for the life of the process, so the ceiling check never
// races the file appends. ponytail: never evicted; it is a few numbers a run.
const meters = new Map<string, Meter>();

async function meterFor(runDir: string): Promise<Meter> {
  let meter = meters.get(runDir);
  if (!meter) {
    meter = { file: telemetryFile(runDir), run: { totals: await readRunTotals(runDir) } };
    meters.set(runDir, meter);
  }
  return meter;
}

/** Run `fn` with every model call inside it metered against `runDir`. Totals resume from the file. */
export async function withRunMeter<T>(
  runDir: string,
  fn: () => Promise<T>,
  pins?: Meter["pins"],
): Promise<T> {
  const meter = await meterFor(runDir);
  return als.run(pins ? { ...meter, pins } : meter, fn);
}

/** The running production's own pins, or none outside one. */
export const currentRunPins = (): Meter["pins"] => als.getStore()?.pins;

/** A run's totals so far, including calls whose lines are still being written. */
export async function runTotals(runDir: string): Promise<RunTotals> {
  return (await meterFor(runDir)).run.totals;
}

/** Name the agent for calls made inside `fn`, for the telemetry rows and the model pill. */
export function asAgent<T>(agent: string, fn: () => T): T {
  const meter = als.getStore();
  if (!meter) return fn();
  return als.run({ ...meter, agent }, fn);
}

/** The open run's totals, or null outside one. */
export const currentRunTotals = (): RunTotals | null => als.getStore()?.run.totals ?? null;

/** Dollars from a pi model's $/million-token prices. */
export function priceOf(
  cost: { readonly input?: number; readonly output?: number } | undefined,
  input: number,
  output: number,
): number {
  return ((cost?.input ?? 0) * input + (cost?.output ?? 0) * output) / 1e6;
}

/** Record one call against the open run. Outside a run it is not recorded: chat has its own ledger. */
export function recordLlmCall(call: Omit<LlmCall, "at" | "agent">): void {
  const meter = als.getStore();
  if (!meter) return;
  const row: LlmCall = { at: new Date().toISOString(), ...(meter.agent ? { agent: meter.agent } : {}), ...call };
  meter.run.totals = add(meter.run.totals, row);
  // ponytail: fire-and-forget append; a lost line under a crash costs one row, not the run.
  void mkdir(join(meter.file, ".."), { recursive: true })
    .then(() => appendFile(meter.file, `${JSON.stringify(row)}\n`, "utf-8"))
    .catch(() => { /* telemetry never fails a run */ });
}

export interface Budget {
  readonly perRunUsd?: number;
  readonly perRunTokens?: number;
}

/** Why the run must stop now, or null while it is under its ceiling. */
export function overBudget(totals: RunTotals, budget: Budget | undefined): string | null {
  if (budget?.perRunUsd !== undefined && totals.costUsd >= budget.perRunUsd) {
    return `Paused at the budget ceiling: $${totals.costUsd.toFixed(2)} of $${budget.perRunUsd.toFixed(2)} spent.`;
  }
  const tokens = totals.input + totals.output;
  if (budget?.perRunTokens !== undefined && tokens >= budget.perRunTokens) {
    return `Paused at the budget ceiling: ${tokens.toLocaleString("en")} of ${budget.perRunTokens.toLocaleString("en")} tokens used.`;
  }
  return null;
}

export interface WhoWrote {
  readonly agent: string;
  readonly service?: string;
  readonly model: string;
  readonly calls: number;
  readonly tokens: number;
  readonly costUsd: number;
}

/** A run's calls grouped by agent and model: the Run screen's "who wrote what". */
export async function readWhoWrote(runDir: string): Promise<ReadonlyArray<WhoWrote>> {
  let text = "";
  try { text = await readFile(telemetryFile(runDir), "utf-8"); } catch { return []; }
  const rows = new Map<string, WhoWrote>();
  for (const line of text.split("\n")) {
    let c: LlmCall;
    try { c = JSON.parse(line) as LlmCall; } catch { continue; }
    const key = `${c.agent ?? ""}|${c.service ?? ""}|${c.model}`;
    const prev = rows.get(key);
    rows.set(key, {
      agent: c.agent ?? "", ...(c.service ? { service: c.service } : {}), model: c.model,
      calls: (prev?.calls ?? 0) + 1,
      tokens: (prev?.tokens ?? 0) + (c.input || 0) + (c.output || 0),
      costUsd: (prev?.costUsd ?? 0) + (c.costUsd || 0),
    });
  }
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens);
}
