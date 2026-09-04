/*
 * Logs. Mock 34.
 *
 * The one screen in the app that is allowed to look like a terminal, because
 * it is one: charcoal, monospace, tabular time. Everything the shim, the
 * daemon and the writer said while working.
 *
 * The level segment carries counts, so "is anything actually wrong" is
 * answered before the filter is touched.
 */
import { useMemo, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import { Icon } from "../components/ui/icon";
import { Empty, Failed, Loading } from "../components/ui/states";

interface LogEntry {
  readonly level?: string;
  readonly tag?: string;
  readonly message: string;
  readonly timestamp?: string;
}

const LEVELS = ["all", "error", "warn", "info", "debug"] as const;
type Level = (typeof LEVELS)[number];

/** State colours, and the charcoal twins are picked by `.dark` around it. */
const LEVEL_COLOR: Record<string, string> = {
  error: "var(--bad)",
  warn: "var(--warn)",
  info: "var(--ok)",
  debug: "var(--ink-3)",
};

export function selectLogs(
  entries: readonly LogEntry[],
  level: Level,
  query: string,
): readonly LogEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (level !== "all" && (e.level ?? "info").toLowerCase() !== level) return false;
    if (!q) return true;
    return `${e.tag ?? ""} ${e.message}`.toLowerCase().includes(q);
  });
}

export function LogViewer({ t }: { readonly t: TFunction }) {
  const { data, loading, error, refetch } = useApi<{ entries: ReadonlyArray<LogEntry> }>("/logs");
  const [level, setLevel] = useState<Level>("all");
  const [query, setQuery] = useState("");

  const entries = data?.entries ?? [];
  const shown = useMemo(() => selectLogs(entries, level, query), [entries, level, query]);
  const counts = useMemo(() => {
    const n: Record<string, number> = { all: entries.length };
    for (const e of entries) {
      const k = (e.level ?? "info").toLowerCase();
      n[k] = (n[k] ?? 0) + 1;
    }
    return n;
  }, [entries]);

  return (
    <div className="stack-lg">
      <section className="crop" style={{ paddingBottom: 0 }}>
        <span className="disc stroke" style={{ width: 160, height: 160, left: -74, top: -80, opacity: 0.28 }} />
        <h2 className="h-page">The machine talking to itself</h2>
        <p className="muted" style={{ fontSize: 14, marginTop: 8, maxWidth: "60ch" }}>
          Everything the shim, the daemon and the writer said while working. {t("logs.showingRecent")}
        </p>
      </section>

      <div className="rowflex" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="seg">
          {LEVELS.map((l) => (
            <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>
              {l === "all" ? "All" : l[0].toUpperCase() + l.slice(1)}
              {counts[l] ? <span className="n tnum">{counts[l]}</span> : null}
            </button>
          ))}
        </div>
        <span className="grow" />
        <label className="input" style={{ display: "flex", alignItems: "center", gap: 7, width: 230, padding: "6px 10px" }}>
          <Icon name="search" size={14} className="dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by tag or text"
            aria-label="Filter the log"
            style={{ border: 0, background: "none", outline: 0, width: "100%", font: "inherit", color: "inherit" }}
          />
        </label>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => refetch()}>
          <Icon name="redo" size={14} />
          {t("common.refresh")}
        </button>
      </div>

      {error ? (
        <Failed what="Could not read the log." detail={error} retry={() => refetch()} />
      ) : loading && entries.length === 0 ? (
        <Loading what="Reading the log…" rows={6} />
      ) : entries.length === 0 ? (
        <Empty icon="list" title="The machine has not said anything yet.">
          {t("logs.empty")}
        </Empty>
      ) : (
        <section className="panel panel-flush dark on-char">
          <div className="panel-body scroll-y mono" style={{ maxHeight: 440, fontSize: 11, lineHeight: 1.9 }}>
            {shown.length === 0 ? (
              <p className="dim">Nothing in the log matches that.</p>
            ) : (
              shown.map((e, i) => (
                <div className="rowflex" style={{ gap: 10 }} key={i}>
                  <span className="dim tnum" style={{ width: 62, flex: "none" }}>
                    {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ""}
                  </span>
                  <span
                    style={{
                      width: 46,
                      flex: "none",
                      color: LEVEL_COLOR[(e.level ?? "info").toLowerCase()] ?? "var(--ink-3)",
                    }}
                  >
                    {(e.level ?? "info").toUpperCase()}
                  </span>
                  {e.tag ? (
                    <span style={{ color: "var(--vermilion-ink)", flex: "none" }}>[{e.tag}]</span>
                  ) : null}
                  <span>{e.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
