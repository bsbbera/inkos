/*
 * Where a piece of work stands, drawn one way everywhere.
 *
 * Status was drawn three ways: the issue page's one-line strip, the run
 * screen's own stage list rebuilt from loose events, and nothing at all in
 * chat. They disagreed, and none of them could be asked anything. This is
 * the one drawing, in three sizes:
 *
 *   StageRail   the full rail on a production's page. Every stage is a
 *               button; opening one says what it did or is waiting for, why
 *               it stopped in plain words, and offers to run from there.
 *   LiveStrip   one line for chat and the rail: what is running, how far,
 *               how long, Stop, Open.
 *   StageDots   one dot per stage, for a list row.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./ui/icon";
import { Orb, orbForStage } from "./ui/working";
import { Failed } from "./ui/states";
import { isStop } from "../lib/error-copy";
import type { Workflow, WorkflowStage } from "./workflow";
import { jobLabel } from "../hooks/use-jobs";

const LABEL: Record<string, string> = {
  research: "Research",
  plan: "Plan",
  write: "Write",
  "fact-check": "Fact-check",
  audit: "Audit",
  design: "Design",
  art: "Art",
  build: "Build",
};

/** What each stage is for, said once, so a stage that has not run still explains itself. */
const PURPOSE: Record<string, string> = {
  research: "Searches the web and your research files for what the issue will stand on.",
  plan: "Turns the research into a page-by-page plan, in sections.",
  write: "Writes every page, with a brief for each picture.",
  "fact-check": "Checks each claim against the sources and flags what they do not support.",
  audit: "Reads every page back for voice, rhythm and anything that reads machine-written, then revises.",
  design: "Chooses the type, colour and grid, and composes each page.",
  art: "Draws the pictures the pages asked for.",
  build: "Lays the pages out and exports the PDF.",
};

/** What a running stage is doing, as the strip's verb. */
const DOING: Record<string, string> = {
  research: "Researching",
  plan: "Planning",
  write: "Writing",
  "fact-check": "Checking facts",
  audit: "Reading it back",
  design: "Designing",
  art: "Drawing",
  build: "Building",
};

export const stageLabel = (s: string): string =>
  LABEL[s] ?? s.replace(/^[a-z]+\./, "").replace(/^\w/, (c) => c.toUpperCase());

/** "4m", "1h 12m". Ticks every 15 seconds while on screen. */
export function Elapsed({ since }: { readonly since: number | string }) {
  const at = typeof since === "number" ? since : Date.parse(since);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!Number.isFinite(at)) return null;
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  return <span className="tnum">{m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`}</span>;
}

const STATE_WORD: Record<string, string> = {
  done: "Done",
  running: "Working now",
  partial: "Part done",
  failed: "Stopped on an error",
  pending: "Not started",
};

function Glyph({ s }: { readonly s: WorkflowStage }) {
  if (s.state === "running") return <Orb state={orbForStage(s.stage)} />;
  if (s.state === "done") return <Icon name="check" size={12} />;
  if (s.state === "failed") return <Icon name="alert" size={12} />;
  return null;
}

/* ---------------------------------------------------------------- full */

export function StageRail({
  workflow,
  onRunFrom,
  onStop,
  busy,
  startedAt,
  label = "finish",
  gates,
  layout = "row",
}: {
  readonly workflow: Workflow;
  /** Offered on every stage that is not running: run from here to the end. */
  readonly onRunFrom?: (stage: string) => void;
  readonly onStop?: () => void;
  readonly busy?: boolean;
  /** When the running stage began, for "working now · 4m". */
  readonly startedAt?: string | number | null;
  /** Completes "Ready to …". */
  readonly label?: string;
  /** The sign-offs, in a drawer under the rail. */
  readonly gates?: ReactNode;
  /** A narrow column draws the stages top to bottom. */
  readonly layout?: "row" | "column";
}) {
  const stages = workflow.stages;
  /* Opens on what needs attention: the stage running, or the one that broke. */
  const focus = stages.find((s) => s.state === "running") ?? stages.find((s) => s.state === "failed");
  const [open, setOpen] = useState<string | null>(focus?.stage ?? null);
  const [gatesOpen, setGatesOpen] = useState(false);
  useEffect(() => { if (focus) setOpen(focus.stage); }, [focus?.stage]);
  const picked = stages.find((s) => s.stage === open) ?? null;
  const doneCount = stages.filter((s) => s.state === "done").length;
  const held = !workflow.done.can;
  const [firstBlocker, ...moreBlockers] = workflow.done.blockers;
  /* Sign-offs are about finished work. Shouting "not approved" while research
     is still running warned about something nobody could act on yet. */
  const early = held && doneCount < stages.length - 1 && stages.some((s) => s.state === "running" || s.state === "pending");

  return (
    <section className="srail-wrap" aria-label="Progress">
      <div className="srail-head">
        <span className="srail-sum">
          <b className="tnum">{doneCount} of {stages.length}</b> stages done
          {workflow.running ? <> · <span className="srail-live">working now</span></> : null}
        </span>
        <span className="grow" />
        {gates ? (
          <button
            type="button"
            className={`wf-state ${early ? "" : held ? "is-held" : "is-ok"}`}
            aria-expanded={gatesOpen}
            onClick={() => setGatesOpen(!gatesOpen)}
          >
            <Icon name={early ? "check" : held ? "alert" : "check"} size={13} />
            <span className="wf-say">{early ? "Sign-offs" : held ? firstBlocker ?? `Cannot ${label} yet` : `Ready to ${label}`}</span>
            {!early && moreBlockers.length > 0 ? <span className="wf-more">+{moreBlockers.length}</span> : null}
            <Icon name={gatesOpen ? "up" : "down"} size={12} />
          </button>
        ) : null}
        {workflow.running && onStop && picked?.state !== "running" ? (
          <button type="button" className="btn btn-line btn-sm" onClick={onStop} disabled={busy}>
            <Icon name="stop" size={13} />Stop
          </button>
        ) : null}
      </div>

      <ol className={`srail${layout === "column" ? " is-column" : ""}`} style={{ ["--n" as string]: stages.length }}>
        {stages.map((s, i) => (
          <li key={s.stage} className={`srail-step is-${s.state}${open === s.stage ? " is-open" : ""}`}>
            <button
              type="button"
              aria-expanded={open === s.stage}
              onClick={() => setOpen(open === s.stage ? null : s.stage)}
              title={`${stageLabel(s.stage)}: ${s.detail}`}
            >
              <span className="srail-dot"><Glyph s={s} />{s.state === "pending" || s.state === "partial" ? <span className="tnum">{i + 1}</span> : null}</span>
              <span className="srail-name">{stageLabel(s.stage)}</span>
              <span className="srail-detail">{s.detail}</span>
              {s.count && s.count.total > 0 ? (
                <span className="srail-bar" aria-hidden="true"><i style={{ transform: `scaleX(${s.count.done / s.count.total})` }} /></span>
              ) : null}
            </button>
          </li>
        ))}
      </ol>

      {picked ? (
        <StagePanel
          s={picked}
          workflow={workflow}
          {...(onRunFrom ? { onRunFrom } : {})}
          {...(onStop ? { onStop } : {})}
          {...(busy ? { busy } : {})}
          {...(startedAt ? { startedAt } : {})}
        />
      ) : null}

      {gatesOpen && gates ? <div className="wf-drop">{gates}</div> : null}
    </section>
  );
}

function StagePanel({
  s, workflow, onRunFrom, onStop, busy, startedAt,
}: {
  readonly s: WorkflowStage;
  readonly workflow: Workflow;
  readonly onRunFrom?: (stage: string) => void;
  readonly onStop?: () => void;
  readonly busy?: boolean;
  readonly startedAt?: string | number;
}) {
  const err = workflow.lastError && workflow.lastError.stage === s.stage ? workflow.lastError : null;
  const stopped = err ? isStop(err) : false;
  const canRun = onRunFrom && !workflow.running;
  const runLabel = s.state === "failed" || stopped ? `Pick up from ${stageLabel(s.stage).toLowerCase()}`
    : s.state === "done" ? `Run ${stageLabel(s.stage).toLowerCase()} again`
    : `Start from ${stageLabel(s.stage).toLowerCase()}`;
  const run = canRun ? (
    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onRunFrom!(s.stage)}>
      <Icon name="play" size={13} />{busy ? "Starting…" : runLabel}
    </button>
  ) : null;

  return (
    <div className={`srail-panel is-${s.state}`} role="region" aria-label={`${stageLabel(s.stage)} stage`}>
      <div className="srail-panel-head">
        <b>{stageLabel(s.stage)}</b>
        <span className={`pill srail-pill is-${s.state}`}>
          {stopped ? "Stopped by you" : STATE_WORD[s.state] ?? s.state}
          {s.state === "running" && startedAt ? <> · <Elapsed since={startedAt} /></> : null}
        </span>
      </div>
      <p className="dim text-small">{PURPOSE[s.stage] ?? ""}</p>
      {s.state === "failed" && err && !stopped ? (
        <Failed what={`${stageLabel(s.stage)} stopped`} detail={err.message}>{run}</Failed>
      ) : (
        <>
          <p className="text-body">{sentence(s)}</p>
          <div className="rowflex gap-2 mt-2">
            {run}
            {s.state === "running" && onStop ? (
              <button type="button" className="btn btn-line btn-sm" onClick={onStop} disabled={busy}>
                <Icon name="stop" size={13} />Stop
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/* The line under the pill: never the pill again in other words. */
function sentence(s: WorkflowStage): string {
  // A live message already says what it is doing ("searching: …").
  if (s.state === "running") return /^\w+ing/.test(s.detail) ? `${cap(s.detail)}` : `${DOING[s.stage] ?? "Working"}: ${s.detail}.`;
  if (s.state === "pending" && /^not started$/i.test(s.detail)) return "Everything it needs is done; it can start now.";
  if (s.state === "pending" && /^waits for/i.test(s.detail)) return `${cap(s.detail)}; it starts once that is done.`;
  return `${cap(s.detail)}.`;
}

/* --------------------------------------------------------------- strip */

export interface LiveRun {
  readonly jobId: string | null;
  /** The work's kind - "publication", "book", "short" - or what a job names: "task", "house". */
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  readonly kindLabel: string;
  /** The job's own stage id, worded by `jobLabel`. */
  readonly stage: string | null;
  readonly status: "queued" | "running" | "done" | "failed" | "cancelled";
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly message: string | null;
  readonly error: string | null;
  /** Null for a job that is not on a production: a chat task still starting, a crawl. */
  readonly workflow: Workflow | null;
}

/** Where a run opens: the work in Audit, or the screen that owns that kind of job. */
export function runHref(run: Pick<LiveRun, "kind" | "id">): string {
  switch (run.kind) {
    case "task": return "#/chat";
    case "house": return "#/house";
    case "taste": return "#/taste";
    case "research": return "#/";
    default: return `#/audit/${encodeURIComponent(run.kind)}/${encodeURIComponent(run.id)}`;
  }
}

/** What a run is doing, in one phrase: "Writing · 3/4 pages written". */
export function runDoing(run: LiveRun): string {
  if (run.status === "queued") return "waiting its turn";
  const now = run.workflow?.stages.find((s) => s.state === "running");
  if (now) return `${DOING[now.stage] ?? stageLabel(now.stage)} · ${now.detail}`;
  const said = run.message?.trim();
  const what = run.stage ? jobLabel({ stage: run.stage }) : "Working";
  return said ? `${what} · ${said}` : what;
}

/** One line: what is running, how far, how long. Opens the work; stops it. */
export function LiveStrip({ run, onOpen, onStop }: {
  readonly run: LiveRun;
  readonly onOpen?: () => void;
  readonly onStop?: () => void;
}) {
  const now = run.workflow?.stages.find((s) => s.state === "running");
  return (
    <div className="lstrip" role="status" aria-live="polite">
      {run.status === "queued" ? <Icon name="clock" size={14} /> : <Orb state={orbForStage(now?.stage ?? run.stage ?? undefined)} />}
      <span className="lstrip-what">
        <b>{run.title}</b>
        <span className="dim">
          {` · ${runDoing(run)}`}
          {run.startedAt ? <> · <Elapsed since={run.startedAt} /></> : null}
        </span>
      </span>
      {run.workflow ? <StageDots stages={run.workflow.stages} /> : null}
      {onOpen ? <button type="button" className="btn btn-quiet btn-sm" onClick={onOpen}>Open</button> : null}
      {onStop && run.jobId ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onStop} aria-label={`Stop ${run.title}`}>
          <Icon name="stop" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- dots */

export function StageDots({ stages }: { readonly stages: ReadonlyArray<WorkflowStage> }) {
  const done = stages.filter((s) => s.state === "done").length;
  return (
    <span className="sdots" role="img" aria-label={`${done} of ${stages.length} stages done`}>
      {stages.map((s) => <i key={s.stage} className={`is-${s.state}`} title={`${stageLabel(s.stage)}: ${s.detail}`} />)}
    </span>
  );
}
