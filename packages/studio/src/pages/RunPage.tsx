/*
 * The run. Mock 09-run.
 *
 * One place that answers "what is it doing, and how far in". Before this the
 * answer was scattered: a floating card over the corner of whatever you were
 * reading, a progress bar inside the audit screen, and nothing at all for the
 * other nine kinds of run.
 *
 * Fed by the raw event stream. Plan 15 §2.2 replaces that with typed deltas -
 * think / tool / stream / fail - and when it lands only `line()` below changes;
 * the transcript, the stage list and the clock are already shaped for it.
 */
import { useEffect, useMemo, useState } from "react";
import type { SSEMessage } from "../hooks/use-sse";
import type { ActiveRun } from "../hooks/use-shell-data";
import { Icon } from "../components/ui/icon";
import { toast } from "../components/ui/vermilion";

const RING = 2 * Math.PI * 19;

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** One readable line per event. Unknown events are shown, never swallowed. */
function line(m: SSEMessage): string {
  const d = (m.data ?? {}) as Record<string, unknown>;
  const pick = ["message", "text", "line", "title", "stage", "chapter", "status"]
    .map((k) => d[k])
    .find((v) => typeof v === "string" && v.trim().length > 0);
  if (typeof pick === "string") return pick;
  const keys = Object.keys(d);
  return keys.length ? keys.map((k) => `${k}: ${String(d[k])}`).join(" · ") : m.event;
}

interface Stage {
  readonly name: string;
  readonly state: "done" | "now" | "queued" | "failed";
  readonly took: string;
}

/**
 * The stages this run has been through, from the events it emitted.
 *
 * Derived rather than declared: there is no run-state file yet (plan 14 §1.2
 * adds one), and a hardcoded stage list would be wrong for eleven of the
 * thirteen production types.
 */
export function deriveStages(messages: readonly SSEMessage[], since: number): Stage[] {
  const order: string[] = [];
  const started = new Map<string, number>();
  const ended = new Map<string, { at: number; ok: boolean }>();

  for (const m of messages) {
    if (m.timestamp < since) continue;
    const [thing, phase] = m.event.split(":");
    if (!thing || !phase) continue;
    if (phase === "start") {
      if (!order.includes(thing)) order.push(thing);
      started.set(thing, m.timestamp);
    } else if (phase === "complete" || phase === "error") {
      if (!order.includes(thing)) order.push(thing);
      ended.set(thing, { at: m.timestamp, ok: phase === "complete" });
    }
  }

  return order.map((name) => {
    const end = ended.get(name);
    const begin = started.get(name);
    if (!end) return { name, state: "now" as const, took: "running" };
    return {
      name,
      state: end.ok ? ("done" as const) : ("failed" as const),
      took: begin ? clock(end.at - begin) : "done",
    };
  });
}

export function RunPage({
  sse,
  run,
}: {
  readonly sse: { readonly messages: readonly SSEMessage[] };
  readonly run: ActiveRun | null;
}) {
  // Only while a clock is actually running: a page that re-renders every
  // second forever is a laptop fan.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [run]);

  const since = run?.startedAt ?? 0;
  const transcript = useMemo(
    () => sse.messages.filter((m) => m.event !== "ping" && m.timestamp >= since).slice(-60),
    [sse.messages, since],
  );
  const stages = useMemo(() => deriveStages(sse.messages, since), [sse.messages, since]);

  const done = stages.filter((s) => s.state === "done").length;
  const pct = stages.length ? Math.round((done / stages.length) * 100) : 0;

  if (!run) {
    return (
      <div className="empty">
        <Icon name="clock" size={22} />
        <h3>Nothing is running.</h3>
        <p>
          When a draft, an audit or an issue build starts, it appears here and in the rail,
          with its transcript and the stage it has reached.
        </p>
      </div>
    );
  }

  return (
    <div className="cols cols-a" style={{ alignItems: "start" }}>
      <div className="dark crop" style={{ padding: "22px 24px 24px" }}>
        <span
          className="disc stroke"
          style={{ width: 150, height: 150, right: -62, top: -68, opacity: 0.4 }}
        />

        <div className="spread" style={{ marginBottom: 20, position: "relative" }}>
          <div>
            <div className="label">
              {stages.length ? `Stage ${Math.min(done + 1, stages.length)} of ${stages.length}` : "Working"}
            </div>
            <h3 style={{ fontSize: 17.5, marginTop: 7 }}>
              {run.what}
              {run.where ? ` · ${run.where}` : ""}
            </h3>
          </div>
          <span className="pill">{clock(Date.now() - run.startedAt)}</span>
        </div>

        <div className="thread" style={{ position: "relative" }}>
          {transcript.map((m) => (
            <div className="msg" key={m.seq}>
              <span className="who-av model">Q</span>
              <div className="body">
                <div className="tag">{m.event.replace(/:/g, " · ")}</div>
                <p style={{ fontSize: 14, lineHeight: 1.6 }}>{line(m)}</p>
              </div>
            </div>
          ))}
          {transcript.length === 0 ? (
            <div className="thinking" aria-label="Waiting for the first event">
              <i />
              <i />
              <i />
            </div>
          ) : null}
        </div>

        <div className="rowflex" style={{ marginTop: 22, position: "relative" }}>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              const text = transcript.map((m) => `${m.event}\t${line(m)}`).join("\n");
              void navigator.clipboard
                .writeText(text)
                .then(() => toast("Transcript copied."))
                .catch(() => toast("Could not reach the clipboard."));
            }}
          >
            Copy the transcript
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="panel">
          <div className="spread" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 className="h-panel">Where it is</h3>
              <p className="hint" style={{ marginTop: 3 }}>
                Stages, as this run reports them.
              </p>
            </div>
            <div className="rowflex" style={{ gap: 9 }}>
              <svg className="ring" viewBox="0 0 44 44" aria-hidden="true">
                <circle className="t" cx="22" cy="22" r="19" />
                <circle
                  className="v"
                  cx="22"
                  cy="22"
                  r="19"
                  style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - pct / 100) }}
                />
              </svg>
              <span className="pct">{pct}%</span>
            </div>
          </div>
          <div className="rows" style={{ marginTop: 12 }}>
            {stages.map((s) => (
              <div className="row" style={{ padding: "9px 4px" }} key={s.name}>
                <span
                  className={s.state === "done" ? "st done" : s.state === "now" ? "st now" : "st"}
                  style={{ gap: 9 }}
                >
                  <i />
                  {s.name}
                </span>
                <span className="grow" />
                <span className="meta">{s.state === "failed" ? "failed" : s.took}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
