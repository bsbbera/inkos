/*
 * One publication issue, as a place rather than a chat transcript.
 *
 * A publication was reachable only through the chat that made it: the stages
 * it had been through, the findings the audit left, and the two approvals the
 * build gates read all existed on disk with nothing on screen showing them.
 * The consequence was not cosmetic - `designApproved` had no surface anywhere
 * in the app, so the build gate could never be opened by anyone, and a run
 * that stopped after `write` was finished for good.
 *
 * Read-first, act-second. Everything shown here is derived from the issue
 * file, so a page opened after a tool changed something out from under it is
 * right rather than stale.
 *
 * The findings section is the audit screen's treatment rather than a list:
 * a queue you work through, and beside it the page itself on charcoal with the
 * offending sentence marked. It used to be thirty-six grey paragraphs saying
 * things like "p4: detected 7 consecutive sentences with the same opening
 * pattern" - true, unreadable, and impossible to act on without going to find
 * the seven sentences by hand.
 */
import { vtName } from "../lib/view-transition";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../components/ui/icon";
import { RunError } from "../components/ui/run-error";
import { Empty, Failed, Loading } from "../components/ui/states";
import { Tabs, toast, useQueueKeys } from "../components/ui/vermilion";
import {
  GateCard, MarkedPassage, ReadAloud, SEV_CLASS, Suggestion, WorkflowBar,
  type Workflow,
} from "../components/workflow";

type Stage = "research" | "plan" | "write" | "fact-check" | "audit" | "design" | "art" | "build";

interface Page {
  readonly n: number;
  readonly title: string;
  readonly type: string;
  readonly density: string;
  readonly body: string | null;
  readonly words?: number;
  readonly image?: string | null;
}

/** One run of pages with a question of its own to answer. */
interface Section {
  readonly n: number;
  readonly label: string;
  readonly question: string;
  readonly from: number;
  readonly to: number;
}

/** What a section is meant to look like. One per section, once art has run. */
interface World {
  readonly n: number;
  readonly register: string;
  readonly technique?: string;
  readonly idiom: string;
  readonly paper: string;
  readonly ink: string;
}

/** A finding that knows where it is. `start < 0` means it has no one place. */
interface Located {
  readonly id: string;
  readonly path: string;
  readonly section: string;
  readonly quote: string;
  readonly severity: "blocking" | "warning" | "note";
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly suggestion: string;
  readonly para: number;
  readonly start: number;
  readonly end: number;
}

interface Issue {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly subject: string;
  readonly thesis: string;
  readonly status: string;
  readonly angle?: string;
  readonly extent?: number;
  readonly notes?: string;
  readonly pages: readonly Page[];
  /* All three have been on the wire since the first version of this screen -
     the server sends the whole issue - and none of them were ever named here,
     so the brief and the section board had no data to render and were never
     built. */
  readonly sections?: readonly Section[];
  readonly design?: {
    readonly sections?: readonly World[];
    /* The issue's own law. A section can only be re-decided inside one. */
    readonly spec?: unknown;
  } | null;
  readonly research?: Record<string, unknown> | null;
  readonly audit?: { at: string; rounds?: number } | null;
  readonly lastError?: { at: string; stage?: string; message: string } | null;
  readonly build?: { pdf?: string | null };
}

interface Detail {
  readonly issue: Issue;
  readonly workflow: Workflow;
  readonly located: readonly Located[];
  readonly running: boolean;
  /** The research files the run could read, cited ones first. */
  readonly inputs?: {
    readonly sources: number;
    readonly files: ReadonlyArray<{
      readonly title: string;
      readonly source: string;
      readonly path: string;
      readonly chars: number;
      readonly cited: boolean;
    }>;
  };
}

interface Nav { toDashboard: () => void }

// Must match the server's list. It did not: `fact-check` was a real stage the
// server would run and this screen displayed, but neither dropdown offered it,
// so a run could never be resumed at the only stage that checks facts.
// `design` sits between the audit and the art. It was missing from this list
// while the runner already had it, so the one stage that decides the look
// could not be reached from the screen that runs the issue.
const STAGES: readonly Stage[] = ["research", "plan", "write", "fact-check", "audit", "design", "art", "build"];

const post = async (path: string, body: unknown) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
  return out;
};

/** Which page a finding sits on, read back out of the path it was given. */
export function pageOf(finding: { readonly path: string }): number {
  const m = /#p(\d+)$/.exec(finding.path);
  return m ? Number(m[1]) : 0;
}

const SEVERITY_ORDER: Record<string, number> = { blocking: 0, warning: 1, note: 2 };

/** Worst first, then in page order - the order an issue is actually worked. */
export function orderFindings(findings: readonly Located[]): readonly Located[] {
  return [...findings].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
    || pageOf(a) - pageOf(b)
    || a.start - b.start);
}

export function PublicationDetail({ issueId, nav }: { issueId: string; nav: Nav }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [from, setFrom] = useState<Stage>("write");
  const [stopAt, setStopAt] = useState<Stage>("audit");
  const [openPage, setOpenPage] = useState<number | null>(null);
  const [tab, setTab] = useState<"brief" | "sections" | "pages" | "audit" | "build">("pages");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Record<number, string>>({});
  // What the machine pre-screen said about each rendered spread (13 §9).
  const [screens, setScreens] = useState<Record<number, ReadonlyArray<{ category: string; description: string }>>>({});
  const [schedule, setSchedule] = useState<{ recurring: string; audience: string } | null>(null);
  /* Which section the editor is re-deciding, and what they asked for. */
  const [reWorld, setReWorld] = useState<number | null>(null);
  const [reWorldNote, setReWorldNote] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/publications/${encodeURIComponent(issueId)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [issueId]);

  useEffect(() => { void load(); }, [load]);

  // A resume runs past any request, so the page has to watch rather than wait.
  useEffect(() => {
    if (!data?.running) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [data?.running, load]);

  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(String((e as Error).message));
      toast(String((e as Error).message));
    } finally {
      setBusy(null);
      await load();
    }
  };

  /* ---- the queue ---- */

  const findings = useMemo(() => orderFindings(data?.located ?? []), [data?.located]);
  const [atIndex, setAtIndex] = useState(0);
  const current = findings[Math.min(atIndex, findings.length - 1)] ?? null;

  useQueueKeys({
    enabled: findings.length > 0,
    onNext: () => setAtIndex((i) => Math.min(i + 1, findings.length - 1)),
    onPrev: () => setAtIndex((i) => Math.max(i - 1, 0)),
    /* Nothing here is settled one finding at a time yet - a magazine page is
       rewritten as a whole by the revise pass - so the two verdict keys the
       audit screen binds would do nothing, and a key that does nothing is
       worse than one that is not bound. */
    onAccept: () => undefined,
    onIgnore: () => undefined,
  });

  if (!data) {
    return error
      ? <Failed what="Could not open this issue." detail={error} retry={() => void load()} />
      : <Loading what="Opening the issue…" rows={4} />;
  }

  const { issue, workflow } = data;
  const api = `/api/v1/publications/${encodeURIComponent(issue.id)}`;
  const copy = workflow.gates.find((g) => g.name === "copy");
  const design = workflow.gates.find((g) => g.name === "design");
  const currentPage = current ? issue.pages.find((p) => p.n === pageOf(current)) : undefined;
  const stageDone = (name: string) =>
    workflow.stages.find((s) => s.stage === name)?.state === "done";

  /* The tabs are the pipeline, which is what the mock drew and what the screen
     never had: one scroll held the brief, the board, every page and the build,
     so the only way to reach page 40 was past everything else. */
  const tabs = [
    { value: "brief" as const, label: "Brief", dot: true, done: stageDone("research") },
    { value: "sections" as const, label: "Sections", dot: true, done: stageDone("plan") },
    { value: "pages" as const, label: "Pages", dot: true, done: stageDone("write") },
    { value: "audit" as const, label: "Audit", dot: true, done: stageDone("audit") },
    { value: "build" as const, label: "Build", dot: true, done: stageDone("build") },
  ];

  return (
    <div className="stack">
      {/* ----------------------------------------------------------- header */}
      <section>
        <div className="spread items-start gap-4">
          <div className="min-w-0">
            <button type="button" className="btn btn-quiet btn-sm" onClick={nav.toDashboard}>
              <Icon name="chevL" size={14} />Magazine
            </button>
            <h2 className="h-page mt-2" style={vtName(issue.id)}>{issue.title || issue.subject}</h2>
            <p className="dim text-body mt-1.5 max-w-wide">
              {issue.thesis}
            </p>
            <p className="dim text-small mt-1.5">
              {/* What it is, not what it is doing: the stage strip below says
                  that, and saying it twice let the two disagree. */}
              {issue.type} · {issue.pages.length} pages
            </p>
          </div>
          <button type="button" className="btn btn-line btn-sm" onClick={() => void load()}>
            <Icon name="redo" size={14} />Refresh
          </button>
        </div>
      </section>

      {error ? <Failed what="That did not work." detail={error} /> : null}

      {/* Why the last run stopped, and the one button that continues it.
          This lived in the Build tab, three clicks from the stage that
          failed, so a run that died in research looked like a run that had
          never happened. */}
      {workflow.lastError && !data.running ? (
        <RunError
          stage={workflow.lastError.stage}
          message={workflow.lastError.message}
          {...(workflow.lastError.stopped ? { stopped: true } : {})}
          {...(workflow.lastError.at ? { at: workflow.lastError.at } : {})}
          later={{
            id: `publication:${issue.id}`,
            label: issue.title || issue.subject,
            url: `${api}/resume`,
            body: { from: workflow.lastError.stage ?? from, stopAt },
          }}
        >
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => {
              const at = (workflow.lastError?.stage ?? from) as Stage;
              setFrom(at);
              void act("resume", () => post(`${api}/resume`, { from: at, stopAt }));
            }}
          >
            <Icon name="play" size={14} />
            {busy === "resume"
              ? "Starting…"
              : `Pick up from ${workflow.lastError.stage ?? from}`}
          </button>
        </RunError>
      ) : null}

      {/* --------------------------------------------- stages, gates, hold */}
      <WorkflowBar workflow={workflow} label="build">
        <div className="cols cols-2">
          {copy ? (
            <GateCard
              gate={copy}
              busy={busy === "copy"}
              onApprove={() => void act("copy", () => post(`${api}/approve`, { what: "copy", approve: true }))}
              onRevoke={() => void act("copy", () => post(`${api}/approve`, { what: "copy", approve: false }))}
            />
          ) : null}
          {design ? (
            <GateCard
              gate={design}
              busy={busy === "design"}
              onApprove={() => void act("design", () => post(`${api}/approve`, { what: "design", approve: true }))}
              onRevoke={() => void act("design", () => post(`${api}/approve`, { what: "design", approve: false }))}
            />
          ) : null}
        </div>
      </WorkflowBar>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {/* ------------------------------------------------------------ brief */}
      {tab === "brief" ? (
        <div className="cols cols-a items-start">
          <div className="panel">
            <div className="panel-head"><h3>What you told it</h3></div>
            <div className="panel-body">
              <div className="spec">
                <div><span>Subject</span><span>{issue.subject}</span></div>
                {issue.angle ? <div><span>Angle</span><span>{issue.angle}</span></div> : null}
                <div><span>Type</span><span>{issue.type}</span></div>
                <div><span>Extent</span><span>{issue.extent ?? issue.pages.length} pages</span></div>
                <div><span>Thesis</span><span>{issue.thesis}</span></div>
              </div>
              {issue.notes ? (
                <p className="hint mt-3">
                  Standing note for every stage: {issue.notes}
                </p>
              ) : null}
            </div>
          </div>

          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <h3>Pillars</h3>
                <span className="dim mono text-cap">
                  {(issue.sections ?? []).length} sections
                </span>
              </div>
              <div className="panel-body">
                {(issue.sections ?? []).length === 0 ? (
                  <Empty compact icon="layers" title="The sections land here once the plan stage has run." />
                ) : (
                  <div className="rows">
                    {(issue.sections ?? []).map((s) => (
                      <div key={s.n} className="row py-2.5 px-0.5">
                        <span className="num tnum">
                          {String(s.n).padStart(2, "0")}
                        </span>
                        <span className="grow">
                          <span className="name text-body">{s.label}</span>
                          <span className="meta">{s.question}</span>
                        </span>
                        <span className="dim mono text-cap">
                          p{s.from}–{s.to}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head"><h3>Research it stands on</h3></div>
              <div className="panel-body">
                {/* What was read, file by file. This used to print the keys of
                    the research object ("title, thesis, pillars"). */}
                <p className="dim text-small">
                  {issue.research
                    ? `${data.inputs?.sources ?? 0} sources cited, ${
                      data.inputs?.files.filter((f) => f.cited).length ?? 0
                    } of them from your research files.`
                    : "Nothing gathered yet. Your research files below are read first."}
                </p>
                {data.inputs?.files.length ? (
                  <ul className="stack gap-2 mt-3 list-none p-0">
                    {data.inputs.files.map((f) => (
                      <li key={f.path} className="min-w-0">
                        <div className="rowflex gap-2 items-baseline">
                          <a
                            href={/^https?:/.test(f.source) ? f.source : undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="trunc text-body min-w-0 flex-1"
                          >
                            {f.title}
                          </a>
                          {issue.research ? (
                            <span className={`${f.cited ? "pill pill-ok" : "pill"} text-cap`}>
                              {f.cited ? "cited" : "not cited"}
                            </span>
                          ) : null}
                        </div>
                        <div className="mono dim trunc text-cap">{f.path}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint mt-2">
                    No research files in this workspace. Gathered pages land in the research folder.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- sections */}
      {tab === "sections" ? (
        (issue.sections ?? []).length === 0 ? (
          <Empty icon="pulse" title="There is no flatplan yet.">
            The plan stage divides the issue into sections and gives each one a question
            to answer. Resume at <span className="mono">plan</span> on the Build tab.
          </Empty>
        ) : (
          <div className="scroll-x">
            <div className="board">
              {(issue.sections ?? []).map((s) => {
                const world = (issue.design?.sections ?? []).find((w) => w.n === s.n);
                const own = issue.pages.filter((p) => p.n >= s.from && p.n <= s.to);
                return (
                  <div key={s.n} className="col-sec">
                    <h4>{s.label}</h4>
                    <p className="hint mb-2.5">{s.question}</p>
                    {world ? (
                      <div className="spec mb-2.5">
                        <div><span>Register</span><span>{world.register}</span></div>
                        {world.technique ? <div><span>Technique</span><span>{world.technique}</span></div> : null}
                        <div><span>Idiom</span><span>{world.idiom}</span></div>
                        <div><span>Paper</span><span>{world.paper}</span></div>
                        <div><span>Ink</span><span>{world.ink}</span></div>
                      </div>
                    ) : (
                      <p className="hint mb-2.5">
                        No design yet — the <span className="mono">design</span> stage decides one world
                        per section. Run it from the Build tab.
                      </p>
                    )}
                    {/* The stage's choice is a default, not the last word: a
                        register that is wrong for this section is the editor's
                        call, and each section is meant to differ from its
                        neighbours. Re-deciding one drops the design sign-off. */}
                    {issue.design?.spec ? (
                      reWorld === s.n ? (
                        <div className="stack gap-1.5 mb-2.5">
                          <input
                            className="input text-small"
                            autoFocus
                            placeholder="what this section should look like (optional)"
                            value={reWorldNote}
                            onChange={(e) => setReWorldNote(e.target.value)}
                          />
                          <div className="rowflex gap-1.5">
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busy !== null || data.running}
                              onClick={() => {
                                const note = reWorldNote;
                                setReWorld(null);
                                setReWorldNote("");
                                void act(`design-${s.n}`, () => post(`${api}/design/section`, { n: s.n, note }));
                              }}
                            >
                              {busy === `design-${s.n}` ? "Choosing…" : "Choose"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => { setReWorld(null); setReWorldNote(""); }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost mb-2.5"
                          disabled={busy !== null || data.running}
                          onClick={() => { setReWorld(s.n); setReWorldNote(""); }}
                        >
                          <Icon name="sliders" size={13} />
                          {world ? "Choose another design" : "Choose a design"}
                        </button>
                      )
                    ) : null}
                    {own.map((p) => (
                      <button
                        key={p.n}
                        type="button"
                        className="chip w-full cursor-pointer"
                        onClick={() => { setTab("pages"); setOpenPage(p.n); }}
                      >
                        <span className="mono">p{p.n}</span>
                        <span className="grow text-left">{p.title}</span>
                        <span className="dens">{p.density}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : null}

      {/* ------------------------------------------------------------ pages */}
      {tab === "pages" ? (
        <div className="stack">
          <div className="spread items-end">
            <div>
              <h3 className="h-panel">The flatplan</h3>
              <p className="hint mt-1">
                Reading order, always. The letter under each page is its density; the
                word beside it is what kind of page it is.
              </p>
            </div>
          </div>

          <div className="flat">
            {issue.pages.map((p) => {
              const mine = findings.filter((f) => pageOf(f) === p.n).length;
              return (
                <button
                  key={p.n}
                  type="button"
                  className="pg"
                  aria-current={openPage === p.n}
                  onClick={() => { setOpenPage(openPage === p.n ? null : p.n); setNote(""); }}
                >
                  <span className="sheet">
                    <span className="plate">
                      <span>{p.body ? `${p.words ?? 0} words` : "unwritten"}</span>
                    </span>
                    <span className="folio">{String(p.n).padStart(2, "0")}</span>
                  </span>
                  <span className="cap">
                    <span className="dens">{p.density}</span>
                    <span className="grow text-left">{p.type}</span>
                    {p.image ? <Icon name="image" size={12} /> : null}
                    {mine ? <span className="pill pill-warn">{mine}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>

          {/* The one page you opened, under the plan rather than inside it: a
              flatplan whose rows change height stops being a flatplan. */}
          {openPage !== null ? (() => {
            const p = issue.pages.find((x) => x.n === openPage);
            if (!p) return null;
            return (
              <div className="panel">
                <div className="panel-head">
                  <span className="grow">
                    <h3>p{p.n} · {p.title}</h3>
                    <span className="dim text-cap">
                      {p.type} · density {p.density}
                      {p.body ? ` · ${p.words ?? 0} words` : " · unwritten"}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => setOpenPage(null)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <div className="panel-body">
                  {p.body ? (
                    <div className="read scroll-y max-h-80" style={{ "--rs": "15px", "--rm": "62ch" } as React.CSSProperties}>
                      <p className="whitespace-pre-wrap">{p.body}</p>
                    </div>
                  ) : (
                    <p className="hint">This page has not been written yet.</p>
                  )}

                  <div className="rowflex gap-2 mt-3 flex-wrap">
                    <button
                      type="button"
                      className="btn btn-line btn-sm"
                      disabled={busy !== null}
                      onClick={() => void act(`render-${p.n}`, async () => {
                        const out = await post(`${api}/render`, { page: p.n });
                        if (!out.image) throw new Error(out.error || "the spread could not be rendered");
                        setPreview((prev) => ({ ...prev, [p.n]: out.image }));
                        setScreens((prev) => ({ ...prev, [p.n]: Array.isArray(out.prescreen) ? out.prescreen : [] }));
                      })}
                    >
                      {busy === `render-${p.n}` ? "Rendering…" : "Render spread"}
                    </button>
                    {/* One row per page, so no picker here: the speed is set once on the
                        passage below and applies to all of them. */}
                    {p.body ? <ReadAloud rateControl={false} text={p.body} label="Hear the page" /> : null}
                    {preview[p.n] ? (
                      <span className="dim mono text-cap self-center">
                        {preview[p.n]}
                      </span>
                    ) : null}
                  </div>

                  {/* The pre-screen: a crowded, loud, busy or washed-out page
                      is named here, before anyone has to judge it by eye. */}
                  {screens[p.n] ? (
                    screens[p.n]!.length ? (
                      <ul className="hint mt-2 pl-4.5">
                        {screens[p.n]!.map((f) => <li key={f.category}>{f.description}</li>)}
                      </ul>
                    ) : <p className="hint mt-2">Pre-screen: nothing crowded, loud or busy.</p>
                  ) : null}

                  {/* A note here is not a comment field. It becomes a finding
                      and goes through the same revise pass the audit uses. */}
                  <div className="rowflex gap-2 mt-2.5">
                    <input
                      className="input grow"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What is wrong with this page? It will be rewritten to fix it."
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!note.trim() || busy !== null}
                      onClick={() => void act(`note-${p.n}`, async () => {
                        await post(`${api}/feedback`, { page: p.n, note });
                        setNote("");
                      })}
                    >
                      {busy === `note-${p.n}` ? "Revising…" : "Revise page"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })() : null}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ audit */}
      {tab === "audit" ? (
        <div className="stack">
          <div className="spread items-end">
            <div>
              <h3 className="h-panel">What the audit found</h3>
              <p className="dim text-small mt-1">
                {issue.audit
                  ? `${findings.length} standing · ${issue.audit.rounds
                    ? `${issue.audit.rounds} revise rounds`
                    : "reported, not revised"}`
                  : "This issue has never been audited."}
              </p>
            </div>
            <div className="rowflex gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== null || data.running}
                onClick={() => void act("audit", () => post(`${api}/audit`, { revise: true }))}
              >
                {busy === "audit" ? "Reading…" : "Audit & revise"}
              </button>
              <button
                type="button"
                className="btn btn-line btn-sm"
                disabled={busy !== null || data.running}
                onClick={() => void act("deslop", () => post(`${api}/audit`, { deslop: true }))}
              >
                {busy === "deslop" ? "Rewriting…" : "De-AI pass"}
              </button>
            </div>
          </div>

          {findings.length === 0 ? (
            issue.audit
              ? <Empty icon="check" title="Nothing left to fix.">
                  The last read found nothing standing against this issue.
                </Empty>
              : <Empty icon="pulse" title="This issue has never been read.">
                  An audit reads every written page against the checks, and marks
                  the sentences it objects to.
                </Empty>
          ) : (
            <div className="cols cols-b items-start">
              {/* ---- the queue ---- */}
              <div className="panel">
                <div className="panel-head">
                  <h3>The queue</h3>
                  <span className="dim mono text-cap">
                    {findings.length} standing
                  </span>
                </div>
                <div className="panel-body scroll-y p-2 max-h-120">
                  {findings.map((f, i) => (
                    <button
                      /* Position, not id: an id is derived from path, category
                         and quote, so two unquoted findings of one category on
                         one page would share one. Rare, but a duplicate React
                         key drops a row silently. */
                      key={`${f.id}-${i}`}
                      type="button"
                      className="finding"
                      aria-current={current?.id === f.id}
                      onClick={() => setAtIndex(i)}
                    >
                      <span className="rowflex gap-2 flex-nowrap">
                        <span className={SEV_CLASS[f.severity] ?? "sev sev-info"} />
                        <span className="grow">
                          <b>{f.title}</b>
                          <span className="cat">
                            p{pageOf(f)} · {f.category}
                          </span>
                        </span>
                        {/* A finding with nowhere to point still belongs in the
                            queue; saying so beats a passage that looks broken. */}
                        {f.start < 0 ? <span className="pill">whole page</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="panel-body border-t border-t-(--line) py-2.5 px-4">
                  <p className="hint">
                    <span className="kbd">J</span> <span className="kbd">K</span> move through them.
                    Rewriting is the revise pass, above.
                  </p>
                </div>
              </div>

              {/* ---- the passage ---- */}
              {current ? (
                <div className="dark crop">

                  <div className="px-6 pt-4.5 pb-0 relative">
                    <div className="spread items-start">
                      <div>
                        <div className="label">
                          p{pageOf(current)} · {current.category}
                        </div>
                        <h3 className="text-lead mt-2">{current.title}</h3>
                      </div>
                      <span className="pill">
                        {Math.min(atIndex, findings.length - 1) + 1} of {findings.length}
                      </span>
                    </div>
                    <p className="muted text-body mt-2.5 max-w-measure">
                      {current.description}
                    </p>
                  </div>

                  <div className="px-6 pt-4.5 pb-0 relative">
                    {currentPage?.body ? (
                      <MarkedPassage
                        text={currentPage.body}
                        markStart={current.start}
                        markEnd={current.end}
                      />
                    ) : (
                      <p className="muted text-body">
                        This page has not been written yet.
                      </p>
                    )}
                  </div>

                  <div className="px-6 pt-4.5 pb-0 relative">
                    <Suggestion suggestion={current.suggestion} />
                  </div>

                  <div className="read-actions mt-5">
                    {/* Hearing it is the fastest way to judge a sentence that
                        scans badly, which is most of what these checks find. */}
                    <ReadAloud
                      dark
                      text={
                        current.start >= 0 && currentPage?.body
                          ? currentPage.body.slice(current.start, current.end)
                          : currentPage?.body ?? ""
                      }
                      label={current.start >= 0 ? "Hear the sentence" : "Hear the page"}
                    />
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => { setTab("pages"); setOpenPage(pageOf(current)); }}
                    >
                      <Icon name="pencil" size={15} />Ask for a rewrite
                    </button>
                    <span className="grow" />
                    <span className="kbd">J</span><span className="kbd">K</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ build */}
      {tab === "build" ? (
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h3>Pick the run back up</h3>
              <span className="dim text-cap">
                A run that stopped part-way starts again here.
              </span>
            </div>
            <div className="panel-body rowflex gap-2.5 flex-wrap">
              <span className="label">Resume from</span>
              <select
                className="input w-auto py-1.5 px-2.5 text-small"
                value={from}
                onChange={(e) => setFrom(e.target.value as Stage)}
              >
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="label">through</span>
              <select
                className="input w-auto py-1.5 px-2.5 text-small"
                value={stopAt}
                onChange={(e) => setStopAt(e.target.value as Stage)}
              >
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== null || data.running}
                onClick={() => void act("resume", () => post(`${api}/resume`, { from, stopAt }))}
              >
                <Icon name="play" size={14} />
                {data.running ? "Running…" : "Resume"}
              </button>
            </div>
          </div>

          {/* Why the last run stopped is said once, above the tabs, beside the
              button that continues it. */}

          {/* Who it is for picks the writing bar; a repeat makes the next
              issue on its own and stops it at the copy sign-off. */}
          {(() => {
            const saved = issue as { recurring?: string | null; audience?: string };
            const s = schedule ?? { recurring: saved.recurring ?? "", audience: saved.audience ?? "" };
            return (
              <div className="panel">
                <div className="panel-head"><h3>Reader and repeat</h3></div>
                <div className="panel-body rowflex gap-2 flex-wrap">
                  <input
                    className="input"
                    value={s.audience}
                    placeholder="Who reads it — e.g. kids 7-10"
                    aria-label="Reader"
                    onChange={(e) => setSchedule({ ...s, audience: e.target.value })}
                  />
                  <select
                    value={s.recurring}
                    aria-label="Repeat"
                    onChange={(e) => setSchedule({ ...s, recurring: e.target.value })}
                  >
                    <option value="">One issue</option>
                    <option value="weekly">A new issue weekly</option>
                    <option value="monthly">A new issue monthly</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-line btn-sm"
                    disabled={busy !== null || schedule === null}
                    onClick={() => void act("schedule", async () => {
                      await post(`${api}/schedule`, { audience: s.audience, recurring: s.recurring || null });
                      setSchedule(null);
                    })}
                  >
                    Save
                  </button>
                </div>
              </div>
            );
          })()}

          <div className="panel">
            <div className="panel-head"><h3>When it finishes</h3></div>
            <div className="panel-body">
              {issue.build?.pdf
                ? <p className="mono text-small">{issue.build.pdf}</p>
                : (
                  <p className="hint">
                    No PDF yet. The build stage lays the issue out in Affinity and exports
                    one — it opens Affinity when you start it, and at no other time.
                  </p>
                )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
