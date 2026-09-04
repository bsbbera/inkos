/**
 * The session panel's numbers, as text.
 *
 * Pure: the ledger arrives already folded from core, and this only decides how
 * a row reads. Kept out of the component because the interesting decisions here
 * are editorial — what an unmeasured row says, when a total stops being a total
 * — and those deserve tests rather than a screenshot.
 */
import {
  byAgent, byModel, totalUsage,
  type UsageLedger, type UsageRow,
} from "@actalk/quire-core/llm/session-usage";

export type LedgerGrouping = "agent" | "model";

export interface LedgerLine {
  readonly key: string;
  /** Agent name, or the call count when rows are merged per model. */
  readonly who: string;
  readonly model: string;
  readonly service?: string;
  /** "18.6k", or "not reported" when the provider counts nothing. */
  readonly tokens: string;
  readonly reported: boolean;
  /** Cache hits and web searches, when the provider said. */
  readonly note: string | null;
}

/**
 * 18_600 → "18.6k". Small numbers stay exact; nobody rounds 340 to 0.3k, and
 * a rounded 9_984 is "10k", not "10.0k" — a decimal that is always zero reads
 * as precision the number does not have.
 */
const trim = (s: string) => s.replace(/\.0$/, "");

export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim((n / 1000).toFixed(n < 10_000 ? 1 : 0))}k`;
  return `${trim((n / 1_000_000).toFixed(1))}M`;
}

function noteOf(row: UsageRow): string | null {
  const parts: string[] = [];
  if (row.cacheRead) parts.push(`${compact(row.cacheRead)} cached`);
  if (row.reasoning) parts.push(`${compact(row.reasoning)} reasoning`);
  if (row.webSearches) parts.push(`${row.webSearches} search${row.webSearches === 1 ? "" : "es"}`);
  return parts.length ? parts.join(" · ") : null;
}

export function ledgerLines(
  ledger: UsageLedger | undefined,
  grouping: LedgerGrouping,
): ReadonlyArray<LedgerLine> {
  if (!ledger) return [];
  const rows = grouping === "model" ? byModel(ledger) : byAgent(ledger);
  return rows.map((row) => ({
    key: row.key,
    who: row.agent,
    model: row.model,
    ...(row.service ? { service: row.service } : {}),
    // A provider that reports nothing has not spent zero — it has not said.
    tokens: row.reported ? compact(row.total) : "not reported",
    reported: row.reported,
    note: noteOf(row),
  }));
}

export interface LedgerTotal {
  readonly tokens: string;
  /** True when a row could not be counted: the figure is a floor, not a sum. */
  readonly partial: boolean;
  readonly label: string;
}

export function ledgerTotal(ledger: UsageLedger | undefined): LedgerTotal | null {
  if (!ledger || Object.keys(ledger).length === 0) return null;
  const total = totalUsage(ledger);
  return {
    tokens: compact(total.total),
    partial: total.partial,
    // "at least" is the whole difference between a measurement and a claim.
    label: total.partial ? "at least" : "total",
  };
}
