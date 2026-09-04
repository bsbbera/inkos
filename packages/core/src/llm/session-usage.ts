/**
 * Who spent what, this session.
 *
 * Usage existed per assistant message and went nowhere: nothing summed it,
 * nothing stored it, nothing sent it to the browser. With routing in place the
 * interesting question is no longer "how many tokens" but "how many, on whose
 * behalf" — the writer on an expensive model and the fact checker on a cheap
 * one are the decision this page exists to support, and a single total hides it.
 *
 * `reported` is the load-bearing field. A CLI that does not count (devin over
 * ACP, antigravity's plain text) must not be shown as having spent zero: a
 * measured zero and an unmeasured one look identical in a number and mean
 * opposite things. Rows carry the flag; the panel renders a blank, not a 0.
 *
 * Pure. Nothing here reads a file, a socket, or a clock.
 */

export interface UsageEvent {
  readonly agent: string;
  readonly service?: string | undefined;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly reported: boolean;
  readonly cacheRead?: number | undefined;
  readonly cacheWrite?: number | undefined;
  readonly reasoning?: number | undefined;
  readonly webSearches?: number | undefined;
  readonly costUsd?: number | undefined;
}

export interface UsageRow {
  readonly key: string;
  readonly agent: string;
  readonly service?: string;
  readonly model: string;
  readonly input: number;
  readonly output: number;
  readonly total: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;
  readonly webSearches: number;
  readonly costUsd: number | null;
  /** False when no call in this row's group carried a count. */
  readonly reported: boolean;
  readonly calls: number;
}

export type UsageLedger = Readonly<Record<string, UsageRow>>;

const keyOf = (e: { agent: string; service?: string | undefined; model: string }) =>
  `${e.agent}::${e.service ?? ""}::${e.model}`;

const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Fold one call into the ledger. Returns a new ledger; never mutates. */
export function addUsage(ledger: UsageLedger, event: UsageEvent): UsageLedger {
  const key = keyOf(event);
  const prev = ledger[key];
  const row: UsageRow = {
    key,
    agent: event.agent,
    ...(event.service ? { service: event.service } : {}),
    model: event.model,
    input: (prev?.input ?? 0) + n(event.input),
    output: (prev?.output ?? 0) + n(event.output),
    total: (prev?.total ?? 0) + n(event.input) + n(event.output),
    cacheRead: (prev?.cacheRead ?? 0) + n(event.cacheRead),
    cacheWrite: (prev?.cacheWrite ?? 0) + n(event.cacheWrite),
    reasoning: (prev?.reasoning ?? 0) + n(event.reasoning),
    webSearches: (prev?.webSearches ?? 0) + n(event.webSearches),
    // A cost only exists if some call in the group priced itself.
    costUsd: event.costUsd === undefined && prev?.costUsd == null
      ? null
      : (prev?.costUsd ?? 0) + n(event.costUsd),
    // One call that counted is enough to make the row a measurement.
    reported: (prev?.reported ?? false) || event.reported,
    calls: (prev?.calls ?? 0) + 1,
  };
  return { ...ledger, [key]: row };
}

/** Rows in spend order, biggest first — the order someone reads them in. */
export function byAgent(ledger: UsageLedger): ReadonlyArray<UsageRow> {
  return Object.values(ledger).sort((a, b) => b.total - a.total || a.agent.localeCompare(b.agent));
}

/** The same spend, grouped the other way: per model, across every agent. */
export function byModel(ledger: UsageLedger): ReadonlyArray<UsageRow> {
  const out = new Map<string, UsageRow>();
  for (const row of Object.values(ledger)) {
    const key = `${row.service ?? ""}::${row.model}`;
    const prev = out.get(key);
    out.set(key, {
      ...row,
      key,
      // The agent column is meaningless once several are merged into one row.
      agent: prev ? `${prev.calls + row.calls} calls` : `${row.calls} calls`,
      input: (prev?.input ?? 0) + row.input,
      output: (prev?.output ?? 0) + row.output,
      total: (prev?.total ?? 0) + row.total,
      cacheRead: (prev?.cacheRead ?? 0) + row.cacheRead,
      cacheWrite: (prev?.cacheWrite ?? 0) + row.cacheWrite,
      reasoning: (prev?.reasoning ?? 0) + row.reasoning,
      webSearches: (prev?.webSearches ?? 0) + row.webSearches,
      costUsd: prev?.costUsd == null && row.costUsd == null
        ? null
        : (prev?.costUsd ?? 0) + (row.costUsd ?? 0),
      reported: (prev?.reported ?? false) || row.reported,
      calls: (prev?.calls ?? 0) + row.calls,
    });
  }
  return [...out.values()].sort((a, b) => b.total - a.total);
}

/**
 * The one number at the bottom.
 *
 * `partial` is true when some row could not be counted: the total is then a
 * floor, not a sum, and saying so is the difference between a figure and a
 * claim.
 */
export function totalUsage(ledger: UsageLedger): {
  readonly input: number;
  readonly output: number;
  readonly total: number;
  readonly costUsd: number | null;
  readonly partial: boolean;
} {
  const rows = Object.values(ledger);
  const costed = rows.filter((r) => r.costUsd != null);
  return {
    input: rows.reduce((s, r) => s + r.input, 0),
    output: rows.reduce((s, r) => s + r.output, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
    costUsd: costed.length ? costed.reduce((s, r) => s + (r.costUsd ?? 0), 0) : null,
    partial: rows.some((r) => !r.reported),
  };
}

/**
 * A completion's usage, as a ledger event.
 *
 * Reported is inferred from the count itself, deliberately: the shim's extra
 * block does not survive the OpenAI client, and a table of "which providers
 * count" is exactly the hand-maintained metadata that went stale last time.
 * A provider that does not report sends zero — the shim no longer invents an
 * estimate — and zero tokens for a turn that produced text is not a
 * measurement anyone should print.
 */
export function usageFromResponse(
  input: { agent: string; service?: string | undefined; model: string },
  usage: {
    prompt_tokens?: number; completion_tokens?: number;
    x_quire?: {
      reported?: boolean; cache_read_tokens?: number; cache_write_tokens?: number;
      reasoning_tokens?: number; web_searches?: number; cost_usd?: number;
    };
  } | null | undefined,
): UsageEvent {
  const x = usage?.x_quire ?? {};
  return {
    ...input,
    input: n(usage?.prompt_tokens),
    output: n(usage?.completion_tokens),
    reported: x.reported ?? (n(usage?.prompt_tokens) + n(usage?.completion_tokens)) > 0,
    cacheRead: x.cache_read_tokens,
    cacheWrite: x.cache_write_tokens,
    reasoning: x.reasoning_tokens,
    webSearches: x.web_searches,
    costUsd: x.cost_usd,
  };
}
