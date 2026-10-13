/*
 * What the machine is doing, from anywhere.
 *
 * Status used to live on whichever screen started the work: the issue page
 * knew about the issue's run, the run screen rebuilt it from events, chat
 * knew nothing. Two pieces of chrome now answer it on every screen - the
 * "Now" pill in the topbar and the card at the foot of the rail - and both
 * open this drawer: every run in flight, each with its stages you can open,
 * Stop, and the way to the work; under them what finished in the last hours,
 * with a plain reason for anything that stopped.
 */
import { createContext, useContext, useState } from "react";
import { Icon } from "../ui/icon";
import { Orb, orbForStage } from "../ui/working";
import { TypeMark } from "../TypeMark";
import { Elapsed, StageDots, StageRail, runDoing, runHref, type LiveRun } from "../stage-rail";
import { jobLabel } from "../../hooks/use-jobs";
import { plainError } from "../../lib/error-copy";
import { useTitles } from "../../hooks/use-titles";

export interface NowState {
  readonly runs: ReadonlyArray<LiveRun>;
  readonly recent: ReadonlyArray<LiveRun>;
  readonly stop: (jobId: string) => Promise<void>;
}

/** The pill for screens that draw their own topbar (chat), opening the shell's drawer. */
export const NowSlot = createContext<{ readonly now: NowState; readonly open: () => void } | null>(null);
export function NowPillHere() {
  const ctx = useContext(NowSlot);
  return ctx ? <NowPill now={ctx.now} onOpen={ctx.open} /> : null;
}

/** The topbar's standing answer to "is anything running". */
export function NowPill({ now, onOpen }: { readonly now: NowState; readonly onOpen: () => void }) {
  const first = now.runs[0];
  const stage = first?.workflow?.stages.find((s) => s.state === "running")?.stage ?? first?.stage ?? undefined;
  return (
    <button
      type="button"
      className={first ? "nowpill is-live" : "nowpill"}
      onClick={onOpen}
      title={first ? `${first.title} · ${runDoing(first)}` : "Nothing is running. Open to see what finished."}
    >
      {first ? <Orb state={orbForStage(stage)} /> : <span className="nowpill-idle" aria-hidden="true" />}
      <span className="nowpill-say">
        {first
          ? now.runs.length > 1 ? `${now.runs.length} running` : runDoing(first).split(" · ")[0]
          : "Idle"}
      </span>
      {first?.startedAt ? <span className="dim"><Elapsed since={first.startedAt} /></span> : null}
    </button>
  );
}

const ENDED: Record<string, { icon: "check" | "alert" | "stop"; word: string; tone: string }> = {
  done: { icon: "check", word: "Finished", tone: "is-ok" },
  failed: { icon: "alert", word: "Stopped on an error", tone: "is-bad" },
  cancelled: { icon: "stop", word: "Stopped by you", tone: "" },
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function RunCard({ run, onStop, onClose }: {
  readonly run: LiveRun;
  readonly onStop: () => void;
  readonly onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`nowcard${open ? " is-open" : ""}`}>
      <button type="button" className="nowcard-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mark-slot"><TypeMark kind={run.kind} /></span>
        <span className="grow min-w-0">
          <span className="nowcard-title">{run.title}</span>
          <span className="nowcard-doing">
            {run.status === "queued" ? null : <Orb state={orbForStage(run.workflow?.stages.find((s) => s.state === "running")?.stage ?? run.stage ?? undefined)} />}
            <span className="trunc">{runDoing(run)}</span>
          </span>
        </span>
        <span className="nowcard-side">
          {run.startedAt ? <span className="dim text-cap"><Elapsed since={run.startedAt} /></span> : null}
          {run.workflow ? <StageDots stages={run.workflow.stages} /> : null}
        </span>
        <Icon name={open ? "up" : "down"} size={12} />
      </button>
      {open ? (
        <div className="nowcard-body">
          {run.workflow ? (
            <StageRail workflow={run.workflow} layout="column" {...(run.startedAt ? { startedAt: run.startedAt } : {})} />
          ) : (
            <p className="dim text-small">{run.kindLabel} · {run.message ?? "working"}</p>
          )}
        </div>
      ) : null}
      <div className="nowcard-foot">
        <span className="dim text-cap grow">{run.kindLabel}</span>
        <a className="btn btn-line btn-sm" href={runHref(run)} onClick={onClose}>Open</a>
        {run.jobId ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onStop}>
            <Icon name="stop" size={13} />Stop
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function NowDrawer({ now, waiting, onClose }: {
  readonly now: NowState;
  readonly waiting: number;
  readonly onClose: () => void;
}) {
  const nameOf = useTitles();
  return (
    <div className="scrim scrim-side" onClick={onClose}>
      <aside className="drawer drawer-now" role="dialog" aria-label="What is running" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3 className="h-panel grow">
            {now.runs.length === 0 ? "Nothing is running" : `${now.runs.length} running`}
          </h3>
          <button type="button" className="btn btn-quiet btn-sm" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="drawer-body stack">
          {waiting > 0 ? (
            <a className="nowwait" href="#/" onClick={onClose}>
              <span className="gatepill"><span className="n tnum">{waiting}</span>waiting on you</span>
              <span className="dim text-small grow">Sign-offs and reads only you can give.</span>
              <Icon name="chevR" size={13} />
            </a>
          ) : null}

          {now.runs.length === 0 ? (
            <p className="dim text-small">
              When something is being written, checked or built it shows here, from every screen,
              with its stages and a Stop button.
            </p>
          ) : (
            now.runs.map((r) => (
              <RunCard
                key={r.jobId ?? `${r.kind}/${r.id}`}
                run={r}
                onClose={onClose}
                onStop={() => { if (r.jobId) void now.stop(r.jobId); }}
              />
            ))
          )}

          {now.recent.length > 0 ? (
            <section className="stack-xs">
              <div className="label"><span>Earlier today</span></div>
              <div className="rows">
                {now.recent.map((r) => {
                  const end = ENDED[r.status] ?? ENDED.done!;
                  const why = r.status === "failed" && r.error ? plainError(r.error) : null;
                  return (
                    <a key={r.jobId ?? r.id} className="row py-2 gap-2.5" href={runHref(r)} onClick={onClose}>
                      <span className={`nowend ${end.tone}`}><Icon name={end.icon} size={12} /></span>
                      <span className="grow min-w-0">
                        <span className="name trunc">{nameOf(r.id)} · {r.stage ? jobLabel({ stage: r.stage }) : r.kindLabel}</span>
                        <span className="meta">
                          {end.word} · {ago(r.endedAt)}
                          {why ? ` · ${why.text}` : ""}
                        </span>
                      </span>
                    </a>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <div className="drawer-foot">
          <a className="btn btn-quiet btn-sm" href="#/run" onClick={onClose}>
            <Icon name="list" size={13} />The full run log
          </a>
        </div>
      </aside>
    </div>
  );
}
