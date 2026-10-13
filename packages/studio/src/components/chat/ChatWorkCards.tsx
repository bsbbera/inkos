/*
 * The work, told in the conversation.
 *
 * A run started from chat used to leave the thread at "Confirmed" and say
 * nothing more: the pages were written somewhere else, the stages turned over
 * on another screen, and the end of it - finished, or stopped on page 3 - was
 * news only if you went looking. These cards carry it in the thread:
 *
 *   WorkCard     a run in flight; its stages as a timeline that fills in as
 *                they finish, what it is doing now, how long, Stop and Open
 *   EndCard      the run is over: what came of it and what to do next, or
 *                why it stopped and how to pick it up
 *   WaitingCard  sign-offs and reads only you can give
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/icon";
import { Orb, orbForStage } from "../ui/working";
import { TypeMark } from "../TypeMark";
import { Elapsed, StageDots, runDoing, runHref, stageLabel, type LiveRun } from "../stage-rail";
import { jobLabel } from "../../hooks/use-jobs";
import { plainError } from "../../lib/error-copy";

/* --------------------------------------------------------------- live */

export function WorkCard({ run, onStop }: { readonly run: LiveRun; readonly onStop?: () => void }) {
  const stages = run.workflow?.stages ?? [];
  const now = stages.find((s) => s.state === "running");
  const href = runHref(run);
  return (
    <article className="wcard is-live" aria-live="polite">
      <header className="wcard-head">
        <span className="mark-slot"><TypeMark kind={run.kind} /></span>
        <span className="grow min-w-0">
          <span className="wcard-kind">{run.kindLabel}{run.status === "queued" ? " · waiting its turn" : " · working"}</span>
          <b className="wcard-title">{run.title}</b>
        </span>
        {run.startedAt ? <span className="dim text-cap tnum"><Elapsed since={run.startedAt} /></span> : null}
      </header>

      <div className="wcard-now">
        {run.status === "queued" ? <Icon name="clock" size={14} /> : <Orb state={orbForStage(now?.stage ?? run.stage ?? undefined)} />}
        <span className="grow min-w-0">{runDoing(run)}</span>
        {now?.count && now.count.total > 0 ? (
          <span className="wcard-bar" aria-hidden="true"><i style={{ transform: `scaleX(${now.count.done / now.count.total})` }} /></span>
        ) : null}
      </div>

      {stages.length > 0 ? (
        <ol className="wcard-steps">
          {stages.map((s) => (
            <li key={s.stage} className={`is-${s.state}`}>
              <span className="wcard-dot">
                {s.state === "done" ? <Icon name="check" size={10} /> : s.state === "failed" ? <Icon name="alert" size={10} /> : null}
              </span>
              <span className="wcard-step-name">{stageLabel(s.stage)}</span>
              <span className="wcard-step-detail">{s.detail}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <footer className="wcard-foot">
        {run.workflow ? <StageDots stages={stages} /> : null}
        <span className="grow" />
        <a className="btn btn-line btn-sm" href={href}>Open</a>
        {onStop && run.jobId ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onStop}>
            <Icon name="stop" size={13} />Stop
          </button>
        ) : null}
      </footer>
    </article>
  );
}

/* ---------------------------------------------------------------- end */

export function EndCard({ run, onDismiss }: { readonly run: LiveRun; readonly onDismiss: () => void }) {
  const href = runHref(run);
  const isWork = href.startsWith("#/audit/");
  /* The screens a book and an issue keep for what Audit does not do. */
  const own = run.kind === "publication" ? { href: `#/publication/${encodeURIComponent(run.id)}`, label: "Brief, proofs & build" }
    : run.kind === "book" ? { href: `#/book/${encodeURIComponent(run.id)}/settings`, label: "Chapters & export" }
    : null;
  const what = run.stage ? jobLabel({ stage: run.stage }) : run.kindLabel;
  const why = run.status === "failed" && run.error ? plainError(run.error) : null;
  const tone = run.status === "done" ? "is-ok" : run.status === "failed" ? "is-bad" : "is-stopped";
  return (
    <article className={`wcard wcard-end ${tone}`}>
      <header className="wcard-head">
        <span className="wcard-end-glyph">
          <Icon name={run.status === "done" ? "check" : run.status === "failed" ? "alert" : "stop"} size={14} />
        </span>
        <span className="grow min-w-0">
          <span className="wcard-kind">
            {run.status === "done" ? "Finished" : run.status === "failed" ? "Stopped on an error" : "Stopped by you"} · {what}
          </span>
          <b className="wcard-title">{run.title}</b>
        </span>
        <button type="button" className="btn btn-quiet btn-sm" aria-label="Dismiss" onClick={onDismiss}>
          <Icon name="x" size={13} />
        </button>
      </header>
      {why ? <p className="wcard-why">{why.where ? `${why.where}: ` : ""}{why.text}</p> : null}
      {run.status === "done" && run.message ? <p className="wcard-why dim">{run.message}</p> : null}
      <footer className="wcard-foot">
        <span className="grow" />
        {isWork ? (
          <>
            <a className="btn btn-sm" href={href}>
              {run.status === "done" ? "Open in Audit" : run.status === "failed" ? "See where it stopped" : "Pick it up"}
            </a>
            {run.status === "done" && own ? <a className="btn btn-line btn-sm" href={own.href}>{own.label}</a> : null}
          </>
        ) : (
          <a className="btn btn-line btn-sm" href={href}>Open</a>
        )}
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------ waiting */

export function WaitingCard({ waiting }: { readonly waiting: number }) {
  if (waiting <= 0) return null;
  return (
    <a className="wcard wcard-wait" href="#/">
      <span className="gatepill"><span className="n tnum">{waiting}</span>waiting on you</span>
      <span className="dim text-small grow">Sign-offs and reads only you can give. They are listed on Home.</span>
      <Icon name="chevR" size={13} />
    </a>
  );
}

/* --------------------------------------------------------------- hook */

const KEY = "quire.chat.runs";

function load(): { seen: string[]; dismissed: string[] } {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as { seen: string[]; dismissed: string[] };
  } catch { /* private mode: start empty */ }
  return { seen: [], dismissed: [] };
}

/**
 * Which runs this chat should speak about: every one live now, and every one
 * that was live while the chat was open and has since ended. Remembered for
 * the browser session, so a reload does not lose the end of a run.
 */
export function useChatRuns(runs: ReadonlyArray<LiveRun>, recent: ReadonlyArray<LiveRun>) {
  const [mem, setMem] = useState(load);
  const first = useRef(true);

  useEffect(() => {
    const ids = runs.map((r) => r.jobId).filter((id): id is string => !!id && !mem.seen.includes(id));
    if (ids.length === 0) return;
    setMem((was) => ({ ...was, seen: [...was.seen, ...ids].slice(-40) }));
  }, [runs, mem.seen]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try { sessionStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* best effort */ }
  }, [mem]);

  const ended = useMemo(
    () => recent.filter((r) => r.jobId && mem.seen.includes(r.jobId) && !mem.dismissed.includes(r.jobId)).slice(0, 3).reverse(),
    [recent, mem],
  );

  const dismiss = (jobId: string | null) => {
    if (!jobId) return;
    setMem((was) => ({ ...was, dismissed: [...was.dismissed, jobId].slice(-40) }));
  };

  return { ended, dismiss };
}

/** Seconds while short, then minutes: "8s", "1m 05s". For the thinking line. */
export function Ticker({ since }: { readonly since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="tnum dim">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`}</span>;
}
