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
import { jobDetail, jobLabel, type JobsView } from "../hooks/use-jobs";
import { Icon } from "../components/ui/icon";
import { toast } from "../components/ui/vermilion";
import { Ring } from "../components/ui/working";
import { copyText } from "../lib/clipboard";


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

export interface Stage {
  readonly name: string;
  readonly state: "done" | "now" | "queued" | "failed" | "skipped";
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

/** A run's own graph, as `pipeline.json` and the registry state it. */
export interface RunGraph {
  readonly sequence: ReadonlyArray<string>;
  readonly stage: string;
  readonly status: string;
  /**
   * Steps this kind of work walks past, and why.
   *
   * Every kind declares the whole spine, so the strip draws every step for
   * every kind. A novel still shows "fact-check" — greyed, with the reason —
   * rather than leaving a hole where a step should be.
   */
  readonly skipped?: Readonly<Record<string, string>>;
}

/**
 * The stages from the run's state file, which is the truth (14 §1.2).
 *
 * The event-derived list above only knows stages that announced themselves
 * since the page loaded; this knows every stage the run will walk, where it is
 * standing, and which sign-offs are still ahead.
 */
export function stagesFromGraph(graph: RunGraph): Stage[] {
  const at = graph.stage === "done" ? graph.sequence.length : graph.sequence.indexOf(graph.stage);
  return graph.sequence.map((name, i) => {
    const gate = name.startsWith("gate:");
    const label = gate ? `${name.slice(5)} sign-off` : name.replace(".", " · ");
    // A skipped step is never "done": nothing was done. It reads as skipped
    // wherever the run happens to be standing.
    const why = graph.skipped?.[name];
    if (why) return { name: label, state: "skipped" as const, took: why };
    if (i < at) return { name: label, state: "done" as const, took: "done" };
    if (i === at) {
      return {
        name: label,
        state: graph.status === "failed" ? ("failed" as const) : ("now" as const),
        took: gate ? "waiting on you" : graph.status,
      };
    }
    return { name: label, state: "queued" as const, took: "" };
  });
}

export function RunPage({
  sse,
  run,
  jobs,
}: {
  readonly sse: { readonly messages: readonly SSEMessage[] };
  readonly run: ActiveRun | null;
  readonly jobs: JobsView;
}) {
  /*
   * What this screen is about, from whichever source knows.
   *
   * `run` is derived from the event stream, which starts empty on every load
   * and carries nothing at all for a stage that announces itself only through
   * the job queue - a restyle being the plain case. So this screen said
   * "Nothing is running" while fourteen chapters were being rewritten. The
   * queue is asked as well, and either answer draws the page.
   */
  const lead = jobs.live[0];
  const head = useMemo<ActiveRun | null>(() => {
    if (run) return run;
    if (!lead) return null;
    return {
      what: jobLabel(lead),
      where: jobDetail(lead),
      startedAt: Date.parse(lead.startedAt ?? lead.queuedAt) || Date.now(),
    };
  }, [run, lead]);

  // Only while a clock is actually running: a page that re-renders every
  // second forever is a laptop fan.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!head) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [head]);

  const since = head?.startedAt ?? 0;
  const transcript = useMemo(
    () => sse.messages.filter((m) => m.event !== "ping" && m.timestamp >= since).slice(-60),
    [sse.messages, since],
  );
  /*
   * The run's graph, when the thing running is a pipeline run. Re-read on
   * every pipeline event rather than kept in step by hand: the state file is
   * small and it is the only account that survives a reload.
   */
  const runRef = lead?.ref ?? null;
  const [graph, setGraph] = useState<RunGraph | null>(null);
  const pipelineTicks = useMemo(
    () => sse.messages.filter((m) => m.event === "pipeline:stage").length,
    [sse.messages],
  );
  useEffect(() => {
    if (!runRef) {
      setGraph(null);
      return;
    }
    let live = true;
    const base = `/api/v1/productions`;
    void Promise.all([
      fetch(`${base}/${encodeURIComponent(runRef.type)}/${encodeURIComponent(runRef.id)}/pipeline`)
        .then((r) => r.json()).catch(() => null),
      fetch(base).then((r) => r.json()).catch(() => null),
    ]).then(([run, all]) => {
      const state = (run as { state?: { stage?: string; status?: string } } | null)?.state;
      const spec = (all as {
        productions?: Array<{
          id: string;
          pipeline?: { sequence?: string[]; skip?: Record<string, string> } | null;
        }>;
      } | null)?.productions?.find((p) => p.id === runRef.type)?.pipeline;
      const sequence = spec?.sequence;
      if (!live) return;
      setGraph(state?.stage && Array.isArray(sequence)
        ? { sequence, stage: state.stage, status: state.status ?? "", ...(spec?.skip ? { skipped: spec.skip } : {}) }
        : null);
    });
    return () => { live = false; };
  }, [runRef?.type, runRef?.id, pipelineTicks]);

  const stages = useMemo(
    () => (graph ? stagesFromGraph(graph) : deriveStages(sse.messages, since)),
    [graph, sse.messages, since],
  );

  const done = stages.filter((s) => s.state === "done").length;
  const pct = stages.length ? Math.round((done / stages.length) * 100) : 0;

  if (!head) {
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
    <div className="cols cols-a items-start">
      <div className="dark crop px-6 pt-5.5 pb-6">

        <div className="spread mb-5 relative">
          <div>
            <div className="label">
              {stages.length ? `Stage ${Math.min(done + 1, stages.length)} of ${stages.length}` : "Working"}
            </div>
            <h3 className="text-lead mt-2">
              {head.what}
              {head.where ? ` · ${head.where}` : ""}
            </h3>
          </div>
          <span className="pill">{clock(Date.now() - head.startedAt)}</span>
        </div>

        <div className="thread relative">
          {transcript.map((m) => (
            <div className="msg" key={m.seq}>
              <span className="who-av model">Q</span>
              <div className="body">
                <div className="tag">{m.event.replace(/:/g, " · ")}</div>
                <p className="text-body leading-relaxed">{line(m)}</p>
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

        <div className="rowflex mt-5.5 relative">
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              const text = transcript.map((m) => `${m.event}\t${line(m)}`).join("\n");
              void copyText(text).then((ok) => toast(
                ok ? "Transcript copied." : "Could not reach the clipboard.",
              ));
            }}
          >
            Copy the transcript
          </button>
        </div>
      </div>

      <div className="stack">
        {/*
          * Everything in flight, not only the thing in front.
          *
          * The queue runs one stage at a time and holds the rest, and until
          * now the only screen that could see a queued job was whichever one
          * had started it - so walking away from a restyle was the same as
          * losing it. Stopping is here rather than only on the page that
          * started it, for the same reason.
          */}
        {jobs.live.length > 0 ? (
          <div className="panel">
            <h3 className="h-panel">In hand</h3>
            <p className="hint mt-1">
              {jobs.live.length === 1
                ? "One stage, running now."
                : `${jobs.live.length} stages. They run one at a time.`}
            </p>
            <div className="rows mt-3">
              {jobs.live.map((job) => (
                <div className="row py-2.5 px-1 gap-2.5" key={job.id}>
                  <span className={`${job.status === "running" ? "st now" : "st"} gap-2.5`}>
                    <i />
                    {jobLabel(job)}
                  </span>
                  <span className="grow" />
                  <span className="meta max-w-55">{jobDetail(job)}</span>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => void jobs.cancel(job.id)}
                  >
                    Stop
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="panel">
          <div className="spread items-start">
            <div>
              <h3 className="h-panel">Where it is</h3>
              <p className="hint mt-1">
                {graph ? "Every stage this run walks, from its state file." : "Stages, as this run reports them."}
              </p>
            </div>
            <div className="rowflex gap-2.5">
              <Ring value={pct / 100} />
              <span className="pct">{pct}%</span>
            </div>
          </div>
          <div className="rows mt-3">
            {stages.map((s) => (
              <div className="row py-2.5 px-1" key={s.name}>
                <span
                  className={`${s.state === "done"
                    ? "st done"
                    : s.state === "now"
                      ? "st now"
                      : s.state === "skipped"
                        ? "st skip"
                        : "st"} gap-2.5`}
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
