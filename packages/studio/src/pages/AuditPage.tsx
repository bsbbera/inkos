/*
 * Audit. Mock 08.
 *
 * Scope, queue, passage. You say what gets read, you empty the queue with two
 * keys, and the paragraph that produced each finding is on screen beside it —
 * and you can take the pen back at any point and write the fix yourself.
 *
 * The three columns are the three decisions, in the order they are made. The
 * old screen had a file tree and an editor, which answered the second question
 * ("what does this file say") and never the first ("what am I checking") or
 * the third ("what do I do about this one"). Findings arrived in a response
 * body and vanished with it.
 *
 * Charcoal is reserved for the manuscript itself, so the passage column is
 * charcoal and the two that let you choose are paper. Square checkboxes are
 * your intent, round dots are the file's own state; they never mean the same
 * thing inside one row.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TypeMark } from "../components/TypeMark";
import type { SSEMessage } from "../hooks/use-sse";
import { fetchJson, useApi } from "../hooks/use-api";
import { useNewSSEMessages } from "../hooks/use-sse";
import { Icon } from "../components/ui/icon";
import { Empty, Failed, Loading } from "../components/ui/states";
import { Seg, toast, useQueueKeys } from "../components/ui/vermilion";
import {
  Grip, ReadAloud, useColumns, type Workflow,
} from "../components/workflow";

/* ------------------------------------------------------------------- types */

interface Project {
  readonly kind: string;
  readonly kindLabel: string;
  readonly id: string;
  readonly files: number;
  readonly words: number;
  readonly modified: string;
}

interface FileAudit {
  readonly checked?: string;
  readonly findings?: number;
  readonly warnings?: number;
  readonly rewritten?: string;
  readonly approved?: { readonly at: string; readonly by: string };
  /* How much has been done to it, not only when it last happened. */
  readonly reads?: number;
  readonly revisions?: number;
  readonly deslops?: number;
  readonly notes?: number;
}

/** "read 4x, rewritten twice" - said only where there is something to say. */
function historyOf(a: FileAudit): string {
  const parts: string[] = [];
  if (a.reads) parts.push(`read ${a.reads}×`);
  if (a.revisions) parts.push(`rewritten ${a.revisions}×`);
  if (a.deslops) parts.push(`de-AI ${a.deslops}×`);
  if (a.notes) parts.push(`${a.notes} note${a.notes === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

interface Item {
  readonly path: string;
  readonly name: string;
  readonly words: number;
  readonly modified: string;
  readonly audit: FileAudit;
  readonly backup: boolean;
}

/** `pipeline.json` as the run reports it. Only the parts this screen reads. */
interface PipelineRun {
  readonly stage: string;
  readonly status: string;
  readonly units: { readonly total: number; readonly done: readonly number[] };
  readonly gates: Readonly<Record<string, { readonly state: string }>>;
}

interface Detail {
  readonly kind: string;
  readonly kindLabel: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly items: ReadonlyArray<Item>;
  /** Where this work has got to and what is holding it. Every kind has one. */
  readonly workflow?: Workflow;
  /** Whether this kind's runner can be re-entered at a stage. */
  readonly resumable?: boolean;
}

/* The stages a publication run can be picked up at. Must match the server's
   list: `fact-check` was missing from the magazine screen's dropdowns for a
   while, so the only stage that checks facts could never be resumed at. */
const RESUME_STAGES = [
  "research", "plan", "write", "fact-check", "audit", "art", "build",
] as const;

type Severity = "blocking" | "warning" | "note";

interface Finding {
  readonly id: string;
  readonly path: string;
  readonly section: string;
  readonly quote: string;
  readonly severity: Severity;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly suggestion: string;
  readonly fix?: string;
  readonly state: "open" | "accepted" | "ignored";
  readonly para: number;
  readonly start: number;
  readonly end: number;
}

interface Counts {
  readonly blocking: number;
  readonly warning: number;
  readonly note: number;
  readonly open: number;
  /** Accepted or deliberately left. Proof the page was worked, not skipped. */
  readonly settled: number;
}

/* --------------------------------------------------------------- pure parts */

/**
 * What a file's dot says about it, before anybody has selected anything.
 *
 * Four states and no more, because a dot that can mean six things means none:
 * never read, read and clean, read and something is open, and blocked.
 */
export function fileState(
  item: Item,
  findings: ReadonlyArray<Finding>,
): { readonly dot: string; readonly note: string } {
  const mine = findings.filter((f) => f.path === item.path && f.state === "open");
  if (mine.some((f) => f.severity === "blocking")) {
    return { dot: "dot dot-bad", note: `${mine.length} open · blocks approval` };
  }
  if (mine.length > 0) return { dot: "dot dot-warn", note: `${mine.length} open` };
  if (item.audit.checked) return { dot: "dot dot-clean", note: "clean" };
  return { dot: "dot dot-never", note: "never read" };
}

/**
 * How long reading this much prose takes.
 *
 * One number, stated before the run rather than in a dialog afterwards,
 * because the cost is part of the choice. Derived from what runs actually
 * take: a section is one model turn and a chapter is a few of them.
 */
export function estimate(words: number): string {
  if (words === 0) return "nothing selected";
  const minutes = Math.max(1, Math.round(words / 3200));
  return `about ${minutes} min`;
}

/** Worst first, then in reading order — the order a queue is actually worked. */
const SEVERITY_ORDER: Record<Severity, number> = { blocking: 0, warning: 1, note: 2 };

/**
 * The page's findings, still-open ones first.
 *
 * This dropped everything settled, so a page that had been read and worked
 * showed an empty list under the words "Nothing is open" — the same screen a
 * page nobody has ever read showed. Eleven findings dealt with and eleven
 * findings that never existed are not the same page, and the one thing the
 * reviewer wants to see is that the work was done.
 */
export function queueOf(
  findings: ReadonlyArray<Finding>,
  filter: Severity | "all",
): ReadonlyArray<Finding> {
  return findings
    .filter((f) => filter === "all" || f.severity === filter)
    .slice()
    .sort((a, b) =>
      Number(a.state !== "open") - Number(b.state !== "open")
      || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      || a.path.localeCompare(b.path)
      || a.start - b.start);
}

const SEV_CLASS: Record<Severity, string> = {
  blocking: "sev sev-bad",
  warning: "sev sev-warn",
  note: "sev sev-info",
};

/** `books/tide/chapters/0009_nine.md` reads as `ch09` in a queue row. */
export function placeOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const num = /^(\d{2,4})/.exec(name);
  if (num) return `ch${String(Number(num[1])).padStart(2, "0")}`;
  return name.replace(/\.md$/, "");
}

/* ---------------------------------------------------------------- the page */

export function AuditPage({ sse }: { readonly sse: { readonly messages: ReadonlyArray<SSEMessage> } }) {
  const { data: projectList, loading, error, refetch: refetchProjects } =
    useApi<{ projects: ReadonlyArray<Project> }>("/audit/projects");
  const projects = useMemo(() => projectList?.projects ?? [], [projectList]);

  const [picked, setPicked] = useState<{ kind: string; id: string } | null>(null);
  useEffect(() => {
    // Open on the work touched most recently rather than on nothing at all.
    if (!picked && projects.length > 0) {
      const first = projects[0]!;
      setPicked({ kind: first.kind, id: first.id });
    }
  }, [picked, projects]);

  const { data: detail, refetch: refetchDetail } = useApi<Detail>(
    picked ? `/audit/project/${picked.kind}/${picked.id}` : "",
  );
  const items = useMemo(() => detail?.items ?? [], [detail]);

  /*
   * Where the run itself has got to, which is not the same question as what is
   * on disk.
   *
   * The panel below this reads the stages off the artefacts - how many files
   * exist, how many are signed. That is a good answer to "what is here" and no
   * answer at all to "what is this waiting for", because a run that has
   * stopped looks exactly like a run nobody started. The pipeline knows, and
   * until now nothing in the app asked it.
   */
  const { data: pipelineData, refetch: refetchPipeline } = useApi<{ state: PipelineRun | null }>(
    picked ? `/productions/${picked.kind}/${encodeURIComponent(picked.id)}/pipeline` : "",
  );
  const pipeRun = pipelineData?.state ?? null;
  const openGate = pipeRun?.status === "waiting-gate" ? pipeRun.stage.replace("gate:", "") : null;

  /* The gate to undo is the last one given, not the first one declared: with
     content and design both signed, withdrawing "content" would reopen the
     writing while the pictures stood approved on top of it. */
  const lastApproved = (["build", "design", "content"] as const)
    .find((g) => pipeRun?.gates[g]?.state === "approved") ?? null;

  const decideGate = async (verb: "approve" | "withdraw", gate: string | null) => {
    if (!picked || !gate) return;
    await act(verb === "approve" ? "gate" : "gate-undo", () => fetchJson(
      `/productions/${picked.kind}/${encodeURIComponent(picked.id)}/gates/${gate}/${verb}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    ), verb === "approve" ? "Signed off. The run moves on." : "Sign-off withdrawn.");
    await refetchPipeline();
  };

  const { data: findingData, refetch: refetchFindings } =
    useApi<{ findings: ReadonlyArray<Finding>; counts: Counts }>("/findings");
  const findings = useMemo(() => findingData?.findings ?? [], [findingData]);

  /* Two windows on one book must not disagree about what is still open. */
  useNewSSEMessages(sse.messages, useCallback((m: SSEMessage) => {
    if (m.event === "findings:changed" || m.event === "audit:state") void refetchFindings();
  }, [refetchFindings]));

  /* ---- the page being worked ---- */

  /*
   * One page, not a basket of them.
   *
   * This was a set of checkboxes feeding a batch read, which meant the screen
   * never knew which page you were looking at — so the queue showed every
   * finding in the workspace at once (ninety-three of them, across three
   * unrelated productions) and the reading panel showed a paragraph belonging
   * to whichever of those you last clicked. A page is the unit of the work.
   */
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => {
    /* Default to the first page nobody has read, else the first page. */
    setPage((was) => {
      if (was && items.some((i) => i.path === was)) return was;
      return (items.find((i) => !i.audit.checked) ?? items[0])?.path ?? null;
    });
  }, [items]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useNewSSEMessages(sse.messages, useCallback((m: SSEMessage) => {
    if (m.event !== "audit:progress") return;
    const d = (m.data ?? {}) as { message?: string };
    if (d.message) setProgress(d.message);
  }, []));

  const run = async (paths: readonly string[]) => {
    if (paths.length === 0) return;
    setRunning(true);
    setProgress(`Reading ${paths.length} file${paths.length === 1 ? "" : "s"}…`);
    try {
      const out = await fetchJson<{ ran?: ReadonlyArray<{ path: string; error?: string }> }>(
        "/audit/run",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Reporting only. Rewriting a file is the reviewer's decision here,
          // taken one finding at a time in the passage column.
          body: JSON.stringify({ paths, revise: false }),
        },
      );
      const failed = (out.ran ?? []).filter((r) => r.error);
      toast(failed.length === 0
        ? "Read. The queue has what it found."
        : `Read ${paths.length - failed.length} of ${paths.length}; ${failed.length} could not be read.`);
      await refetchFindings();
      await refetchProjects();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That read did not finish.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const stop = async () => {
    // One controller covers the whole run, so cancelling any of its files
    // cancels the run. The first is as good as any.
    const first = page ?? items[0]?.path;
    if (!first) return;
    await fetchJson("/audit/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: first }),
    }).catch(() => undefined);
  };

  /* ---- the workflow, and the four things it lets you do ---- */

  const [busy, setBusy] = useState<string | null>(null);

  const act = useCallback(async (key: string, run: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await run();
      toast(done);
      await refetchDetail();
      await refetchProjects();
      await refetchFindings();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not take.");
    } finally {
      setBusy(null);
      /* The progress line comes off the same SSE feed as a read's does, and
         only `run` was clearing it - so "Re-auditing after round 2…" stayed on
         screen after a revise had finished, and the page read as still working
         when nothing was. */
      setProgress(null);
    }
  }, [refetchDetail, refetchProjects, refetchFindings]);

  const approveProject = (yes: boolean, force = false) => {
    if (!picked || !detail) return;
    /* A publication keeps its approvals on the issue, so the two gates are
       forwarded to the routes that own them rather than duplicated here. */
    const path = picked.kind === "publication"
      ? `/publications/${encodeURIComponent(picked.id)}/approve`
      : `/audit/project/${picked.kind}/${encodeURIComponent(picked.id)}/approve`;
    const body = picked.kind === "publication"
      ? { what: "copy", approve: yes }
      : { approve: yes, ...(force ? { gate: "force" } : {}) };
    return act(
      "approve",
      () => fetchJson(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      yes ? "Signed off." : "Sign-off taken back.",
    );
  };

  const resume = (from: string, stopAt: string) => {
    if (!picked) return;
    return act(
      "resume",
      () => fetchJson(`/publications/${encodeURIComponent(picked.id)}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, stopAt }),
      }),
      "Picked the run back up.",
    );
  };

  /* Revise and the de-AI pass, on the page you are looking at. Same route as
     the reporting run, with the flag that lets it write.

     This took every file in the production for a while - `items.map(i => i.path)`
     sitting under a button that read "Audit & revise" - so picking chapter two
     and pressing it rewrote all twenty-three. The scope is the selected page,
     the way the read beside it is. The old text stays beside each rewritten
     file as `.pre-audit`. */
  const revisePage = (deslop: boolean) => {
    if (!page) {
      toast("Pick a page first.");
      return;
    }
    return act(
      deslop ? "deslop" : "revise",
      () => fetchJson("/audit/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [page], revise: true, ...(deslop ? { deslop: true } : {}) }),
      }),
      deslop ? "Rewritten to sound less machine-made." : "Read and revised.",
    );
  };

  /* ---- how the three columns are split ---- */

  /* Equal by default; drag a seam to change it, double-click one to go back.
     `reset` matters because the widths are kept in `localStorage`: without it
     a drag made on a wide monitor is the layout forever. */
  const { template, onGrip, reset: resetCols } = useColumns("audit", 3);

  /* The editor's note about the file the current finding is in. */
  const [note, setNote] = useState("");
  const [reviseBusy, setReviseBusy] = useState(false);

  const reviseFile = useCallback(async (path: string, what: string) => {
    setReviseBusy(true);
    try {
      const out = await fetchJson<{ changed?: boolean; sections?: number; error?: string }>(
        "/audit/file/revise",
        { method: "POST", body: JSON.stringify({ path, note: what }) },
      );
      toast(out.changed
        ? `Rewritten — ${out.sections} section${out.sections === 1 ? "" : "s"}.`
        : "The pass ran and left it as it was.");
      setNote("");
      await Promise.all([refetchFindings(), refetchDetail(), refetchProjects()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That rewrite did not run.");
    } finally {
      setReviseBusy(false);
    }
  }, [refetchFindings, refetchDetail, refetchProjects]);

  /* ---- queue ---- */

  const [filter, setFilter] = useState<Severity | "all">("all");
  /*
   * This page's findings, not the workspace's.
   *
   * `/findings` returns every finding on record - three productions' worth -
   * and this screen rendered the lot. So the magazine said "93 findings" and
   * listed objections belonging to a short story, and the count over the queue
   * was a fact about the whole workspace pretending to be a fact about the
   * thing you were reading.
   */
  const mine = useMemo(
    () => (page ? findings.filter((f) => f.path === page) : []),
    [findings, page],
  );
  const queue = useMemo(() => queueOf(mine, filter), [mine, filter]);
  const counts = useMemo(() => {
    const open = mine.filter((f) => f.state === "open");
    return {
      blocking: open.filter((f) => f.severity === "blocking").length,
      warning: open.filter((f) => f.severity === "warning").length,
      note: open.filter((f) => f.severity === "note").length,
      open: open.length,
      settled: mine.length - open.length,
    };
  }, [mine]);

  const [atIndex, setAtIndex] = useState(0);
  const current = queue[Math.min(atIndex, queue.length - 1)] ?? null;
  useEffect(() => { setAtIndex(0); }, [filter, page]);

  /* ---- the page itself ---- */

  const {
    data: pageData, loading: pageLoading, refetch: refetchPage,
  } = useApi<{ text: string }>(page ? `/audit/file?path=${encodeURIComponent(page)}` : "");
  const pageText = pageData?.text ?? "";
  const pageName = useMemo(() => {
    const item = items.find((i) => i.path === page);
    if (!item) return page ? placeOf(page) : "";
    return item.name.replace(/^\d+[_-]?/, "").replace(/\.md$/, "") || item.name;
  }, [items, page]);

  /* A rewrite lands as `audit:text`; the panel showing that text redraws. */
  useNewSSEMessages(sse.messages, useCallback((m: SSEMessage) => {
    if (m.event !== "audit:text") return;
    const d = (m.data ?? {}) as { path?: string };
    if (d.path && d.path === page) void refetchPage();
  }, [page, refetchPage]));

  /* ---- settling ---- */

  const [mode, setMode] = useState<"read" | "edit">("read");
  const [draft, setDraft] = useState("");
  const [settling, setSettling] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setMode("read");
    setDraft(pageText);
  }, [page, pageText]);

  /* Edit means the page now, so saving means the page. */
  const savePage = useCallback(async () => {
    if (!page || !draft.trim()) return;
    setSaving(true);
    try {
      await fetchJson("/audit/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: page, text: draft }),
      });
      toast("Saved. The old text is beside it as .pre-audit.");
      setMode("read");
      await Promise.all([refetchPage(), refetchDetail()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That save did not take.");
    } finally {
      setSaving(false);
    }
  }, [page, draft, refetchPage, refetchDetail]);

  const settle = useCallback(async (
    state: "accepted" | "ignored",
    /* The reviewer's own wording, which arrives as a whole paragraph. */
    paragraph?: string,
  ) => {
    if (!current) return;
    setSettling(true);
    try {
      await fetchJson(`/findings/${current.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          ...(paragraph ? { text: paragraph, scope: "paragraph" } : {}),
        }),
      });
      toast(state === "accepted" ? "Taken. The chapter has it now." : "Left as written.");
      await refetchFindings();
      /* The row stays in the list, in green, and sorts below the open ones.
         Step to what is now at the top of the open pile rather than holding an
         index that has just been re-sorted out from under it. */
      setAtIndex(0);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not take.");
    } finally {
      setSettling(false);
    }
  }, [current, queue.length, refetchFindings]);

  useQueueKeys({
    enabled: !running && queue.length > 0 && mode === "read",
    onNext: () => setAtIndex((i) => Math.min(i + 1, queue.length - 1)),
    onPrev: () => setAtIndex((i) => Math.max(i - 1, 0)),
    // Only a finding that proposes something can be accepted with one key.
    onAccept: () => { if (current?.fix) void settle("accepted"); },
    onIgnore: () => { void settle("ignored"); },
  });

  if (error) {
    return <Failed what="Could not list the work." detail={error} retry={() => refetchProjects()} />;
  }
  if (loading && projects.length === 0) return <Loading what="Looking for finished work…" rows={5} />;
  if (projects.length === 0) {
    return (
      <Empty icon="pulse" title="Nothing has been written yet.">
        Anything a production finishes — a chapter, a page, a script — can be read
        against the book&rsquo;s own rules here.
      </Empty>
    );
  }

  return (
    <div className="workbench">
      {/* The name of the thing, and the two passes that act on all of it. The
          rest of the workflow is the middle column, beside the queue it is
          about, rather than a strip across the top of all three. */}
      {detail ? (
        <div className="spread" style={{ alignItems: "flex-end", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="h-page" style={{ fontSize: 21 }}>{detail.title}</h2>
            <p className="dim" style={{ fontSize: 12, marginTop: 2 }}>{detail.subtitle}</p>
          </div>
        </div>
      ) : null}

      <div
        className="cols cols-audit"
        style={template ? ({ "--cols": template } as React.CSSProperties) : undefined}
      >
        <ScopeColumn
          projects={projects}
          picked={picked}
          onPick={setPicked}
          items={items}
          findings={findings}
          page={page}
          onPage={setPage}
          running={running}
          working={busy === "revise" || busy === "deslop"}
          progress={progress}
          onRead={() => { if (page) void run([page]); }}
          onReadAll={() => void run(items.map((i) => i.path))}
          onStop={() => void stop()}
        />

        <Grip onPointerDown={onGrip(0)} onReset={resetCols} />

        <StateColumn
          pipeRun={pipeRun}
          openGate={openGate}
          lastApproved={lastApproved}
          onGate={(verb, gate) => void decideGate(verb, gate)}
          detail={detail ?? null}
          busy={busy}
          running={running}
          onApprove={(yes, force) => void approveProject(yes, force)}
          onResume={(a, b) => void resume(a, b)}
          onRevise={(deslop) => void revisePage(deslop)}
          items={items}
          allFindings={findings}
          here={items.find((i) => i.path === page) ?? null}
          pageName={pageName}
          queue={queue}
          counts={counts}
          filter={filter}
          onFilter={setFilter}
          at={current}
          onPick={(id) => setAtIndex(queue.findIndex((f) => f.id === id))}
        />

        <Grip onPointerDown={onGrip(1)} onReset={resetCols} />

        <PageColumn
          path={page}
          name={pageName}
          text={pageText}
          loading={pageLoading}
          findings={queue}
          current={current}
          onPick={(id) => setAtIndex(queue.findIndex((f) => f.id === id))}
          mode={mode}
          onMode={setMode}
          draft={draft}
          onDraft={setDraft}
          onSave={() => void savePage()}
          saving={saving}
          note={note}
          onNote={setNote}
          reviseBusy={reviseBusy}
          onRevise={() => { if (page) void reviseFile(page, note); }}
          history={historyOf(items.find((i) => i.path === page)?.audit ?? {})}
          busy={settling}
          onAccept={() => void settle("accepted")}
          onIgnore={() => void settle("ignored")}
        />

      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 1. what to read */

/** What both file views need to know about a file, worked out in one place. */
function fileFacts(item: Item, findings: ReadonlyArray<Finding>) {
  const state = fileState(item, findings);
  const open = findings.filter((f) => f.path === item.path && f.state === "open");
  const num = /^(\d{2,4})/.exec(item.name);
  return {
    dot: state.dot,
    note: state.note,
    open: open.length,
    blocking: open.filter((f) => f.severity === "blocking").length,
    num: num ? String(Number(num[1])).padStart(2, "0") : null,
    name: item.name.replace(/^\d+[_-]?/, "").replace(/\.md$/, "") || item.name,
    history: historyOf(item.audit),
  };
}

/** A date said the short way, or "never" when the thing has not happened. */
function when(iso?: string): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ScopeColumn({
  projects, picked, onPick, items, findings, page, onPage,
  running, working, progress, onRead, onReadAll, onStop,
}: {
  readonly projects: ReadonlyArray<Project>;
  readonly picked: { kind: string; id: string } | null;
  readonly onPick: (p: { kind: string; id: string }) => void;
  readonly items: ReadonlyArray<Item>;
  readonly findings: ReadonlyArray<Finding>;
  /** The one page being worked. This column exists to choose it. */
  readonly page: string | null;
  readonly onPage: (path: string) => void;
  readonly running: boolean;
  /** A pass this column did not start — a whole-production rewrite or de-AI. */
  readonly working: boolean;
  readonly progress: string | null;
  readonly onRead: () => void;
  readonly onReadAll: () => void;
  readonly onStop: () => void;
}) {
  const here = items.find((i) => i.path === page) ?? null;
  /* A list reads names in order; a field of tiles answers "which of these
     still needs work" at a glance. Which one you want is about the production,
     not the session, so the choice is kept. */
  const [view, setView] = useState<"list" | "tiles">(() => {
    try { return localStorage.getItem("quire.audit.files") === "tiles" ? "tiles" : "list"; }
    catch { return "list"; }
  });
  const chooseView = (v: "list" | "tiles") => {
    setView(v);
    try { localStorage.setItem("quire.audit.files", v); } catch { /* private mode */ }
  };

  /* The pages of the open work. A value rather than inline markup because
     it is rendered inside the work list, directly under the row it belongs
     to, and standalone when there is only one production. */
  const files = (
    <>
        {items.length === 0 ? (
          <p className="hint">Nothing finished in this one yet.</p>
        ) : view === "tiles" ? (
          /* Sheets, not cards. `.pg`/`.sheet` is the app's own page: paper at
             3:4 with the number set as a ghost folio in the corner, which is
             where a page number lives. It was already in the stylesheet and
             the audit column was drawing generic tiles beside it. */
          <div className="pgs">
            {items.map((item) => {
              const f = fileFacts(item, findings);
              return (
                <button
                  key={item.path}
                  type="button"
                  className="pg"
                  aria-current={page === item.path}
                  title={`${item.name} · ${f.note}${f.history ? ` · ${f.history}` : ""}`}
                  onClick={() => onPage(item.path)}
                >
                  <span className="sheet">
                    <span className="rule" />
                    {f.num ? <span className="folio">{f.num}</span> : null}
                    {/* Only where there is something to answer for. Twenty-one
                        sheets reading "never read" said one word twenty-one
                        times and buried the page that had findings. */}
                    {f.open > 0 ? (
                      <span className={f.blocking > 0 ? "pill pill-bad" : "pill pill-warn"}>{f.open}</span>
                    ) : null}
                  </span>
                  <span className="cap">
                    <span className={f.dot} title={f.note} />
                    <span className="trunc">{f.name}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rows">
            {items.map((item) => {
              const f = fileFacts(item, findings);
              return (
                <button
                  key={item.path}
                  type="button"
                  className="row"
                  style={{ padding: "8px 4px", width: "100%", textAlign: "left" }}
                  aria-current={page === item.path}
                  onClick={() => onPage(item.path)}
                >
                  {f.num ? <span className="num tnum" style={{ width: "1.9em" }}>{f.num}</span> : null}
                  <span className="grow">
                    <span className="name" style={{ fontSize: 14 }}>{f.name}</span>
                    <span className="meta">
                      {item.words.toLocaleString()} words · {f.note}
                      {f.history ? ` · ${f.history}` : ""}
                    </span>
                  </span>
                  {/* The count, not just that there is one: "3 open" and "1
                      open" are different amounts of work and the dot said the
                      same thing for both. */}
                  {f.open > 0 ? (
                    <span className={f.blocking > 0 ? "pill pill-bad" : "pill pill-warn"}>{f.open}</span>
                  ) : null}
                  <span className={f.dot} title={f.note} />
                </button>
              );
            })}
          </div>
        )}
    </>
  );

  return (
    <div className="panel panel-flush colpanel">
      <div className="panel-head" style={{ padding: "13px 16px" }}>
        <span className="grow" style={{ minWidth: 0 }}>
          <h3 className="h-panel">The pages</h3>
          <span className="dim" style={{ fontSize: 11 }}>
            {items.length} file{items.length === 1 ? "" : "s"} · one at a time
          </span>
        </span>
        <Seg
          value={view}
          onChange={chooseView}
          options={[{ value: "list", label: "List" }, { value: "tiles", label: "Tiles" }]}
        />
      </div>

      <div className="panel-body grows" style={{ padding: "6px 14px 10px" }}>
        {projects.length > 1 ? (
          <>
            <div className="label" style={{ padding: "8px 2px 6px" }}><span>The work</span></div>
            <div className="rows">
              {projects.map((p) => {
                const open = picked?.kind === p.kind && picked.id === p.id;
                return (
                  <Fragment key={`${p.kind}/${p.id}`}>
                    <button
                      type="button"
                      className="row row-work"
                      style={{ padding: "8px 4px" }}
                      aria-current={open}
                      onClick={() => onPick({ kind: p.kind, id: p.id })}
                    >
                      <TypeMark kind={p.kind} />
                      <span className="grow">
                        <span className="name" style={{ fontSize: 14 }}>{p.id}</span>
                        {/* The silhouette said the type already. Repeating the
                            word beside it is the labelling the styleguide
                            rules out. */}
                        <span className="meta">{p.files} files</span>
                      </span>
                    </button>
                    {/* The pages belong to the work above them, so they hang off
                        it rather than sitting under the whole list. With four
                        productions the files were below all four, and the one
                        you had open had already scrolled off the top. */}
                    {open ? <div className="work-files">{files}</div> : null}
                  </Fragment>
                );
              })}
            </div>
          </>
        ) : files}
      </div>
      <div className="panel-body" style={{ borderTop: "1px solid var(--line)", padding: "13px 16px" }}>
        <div className="rowflex" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <span className="dim" style={{ fontSize: 11 }}>
            {here ? `${here.words.toLocaleString()} words` : `${items.length} files`}
          </span>
          <span className="dim mono" style={{ fontSize: 11 }}>
            {estimate(here ? here.words : items.reduce((n, i) => n + i.words, 0))}
          </span>
        </div>
        {/* `running` covered a read started from this button and nothing else,
            so a whole-production rewrite — the longest, least reversible pass
            in the app — ran with no way to stop it and the button still
            offering to start another. Both use the same controller, so one
            Stop serves both. */}
        {running || working ? (
          <button type="button" className="btn btn-line" style={{ width: "100%", justifyContent: "center" }} onClick={onStop}>
            <span className="spin" />
            Stop
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              style={{ width: "100%", justifyContent: "center" }}
              disabled={!here}
              onClick={onRead}
            >
              <Icon name="play" size={15} />
              Read this page
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              style={{ width: "100%", justifyContent: "center", marginTop: 7 }}
              disabled={items.length === 0}
              onClick={onReadAll}
            >
              Read all {items.length}
            </button>
          </>
        )}
        <p className="hint" style={{ marginTop: 9 }}>
          {progress ?? "Findings from earlier runs stay until you settle them."}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------- 2. where the work stands */

/**
 * The middle column: what state this work is in, and what is open against it.
 *
 * The magazine had all of this and nothing else did — stages, gates that name
 * what is keeping them shut, a sign-off, a rewrite. The first attempt at
 * sharing it put the lot in a bar across the top of the screen, above all
 * three columns, which is not a column, is not where anyone is looking, and
 * cost the two reading panels most of their height.
 *
 * So it is the second column, above the queue it explains: the state of the
 * work and the list of things standing against it are one subject, and a
 * finding that blocks the sign-off now sits under the sign-off it blocks.
 */
function StateColumn({
  detail, busy, running, onApprove, onResume, onRevise,
  pipeRun, openGate, lastApproved, onGate,
  items, allFindings, here,
  pageName, queue, counts, filter, onFilter, at, onPick,
}: {
  readonly detail: Detail | null;
  readonly busy: string | null;
  /** Where the run itself stands, which the files on disk cannot say. */
  readonly pipeRun: PipelineRun | null;
  /** The gate waiting on a person right now, if one is. */
  readonly openGate: string | null;
  /** The most recent sign-off, which is the one an undo should take back. */
  readonly lastApproved: string | null;
  readonly onGate: (verb: "approve" | "withdraw", gate: string | null) => void;
  readonly running: boolean;
  readonly onApprove: (approve: boolean, force?: boolean) => void;
  readonly onResume: (from: string, stopAt: string) => void;
  readonly onRevise: (deslop: boolean) => void;
  /** Which whole-production rewrite is one press from running, if any. */
  /** Every file in this production, for the global tally. */
  readonly items: ReadonlyArray<Item>;
  /** Every finding on record. Filtered to this production before counting. */
  readonly allFindings: ReadonlyArray<Finding>;
  /** The one file being worked, for the per-page tally. */
  readonly here: Item | null;
  /** The page these findings belong to, said above them. */
  readonly pageName: string;
  readonly queue: ReadonlyArray<Finding>;
  readonly counts: Counts;
  readonly filter: Severity | "all";
  readonly onFilter: (f: Severity | "all") => void;
  readonly at: Finding | null;
  readonly onPick: (id: string) => void;
}) {
  const [from, setFrom] = useState<string>("write");
  const [stopAt, setStopAt] = useState<string>("audit");
  const [showState, setShowState] = useState(true);

  /* Said on the buttons, because both act on the whole production while
     sitting beside a column showing one page. */

  /*
   * The whole production, counted.
   *
   * Everything else on this screen is about one page, which is right — but a
   * screen that only ever says "8 findings on 0002.md" cannot answer whether
   * the book is nearly done. `allFindings` is every finding on record, across
   * every production, so it is narrowed to this one's files before anything
   * is added up.
   */
  const global = useMemo(() => {
    const paths = new Set(items.map((i) => i.path));
    const open = allFindings.filter((f) => paths.has(f.path) && f.state === "open");
    return {
      pages: items.length,
      read: items.filter((i) => i.audit.checked).length,
      signed: items.filter((i) => i.audit.approved).length,
      open: open.length,
      blocking: open.filter((f) => f.severity === "blocking").length,
      words: items.reduce((n, i) => n + i.words, 0),
      reads: items.reduce((n, i) => n + (i.audit.reads ?? 0), 0),
      revisions: items.reduce((n, i) => n + (i.audit.revisions ?? 0), 0),
      deslops: items.reduce((n, i) => n + (i.audit.deslops ?? 0), 0),
      notes: items.reduce((n, i) => n + (i.audit.notes ?? 0), 0),
    };
  }, [items, allFindings]);

  /* Whether anything has ever read this page. The difference between "clean"
     and "unexamined", which the findings list was not drawing. */
  const read = !!here?.audit.checked;

  const workflow = detail?.workflow ?? null;
  const signed = !!detail && detail.items.length > 0 && detail.items.every((i) => i.audit.approved);
  const auditGate = workflow?.gates.find((g) => g.name === "audit") ?? null;
  const blocked = auditGate ? !auditGate.canApprove : false;
  const held = workflow ? !workflow.done.can : false;

  const pills: ReadonlyArray<{ value: Severity; label: string; className: string; n: number }> = [
    { value: "blocking", label: "blocking", className: "pill pill-bad", n: counts.blocking },
    { value: "warning", label: "warnings", className: "pill pill-warn", n: counts.warning },
    { value: "note", label: "notes", className: "pill", n: counts.note },
  ];

  return (
    <div className="panel panel-flush colpanel">
      {/* ---------------------------------------------------------- status */}
      <div className="panel-head" style={{ padding: "13px 16px" }}>
        <span className="grow" style={{ minWidth: 0 }}>
          <h3 className="h-panel">Where it stands</h3>
          {workflow ? (
            <span
              className="rowflex"
              style={{
                gap: 6, fontSize: 11, marginTop: 2, alignItems: "flex-start",
                color: held ? "var(--bad)" : "var(--ok)",
              }}
            >
              <Icon name={held ? "alert" : "check"} size={12} />
              <span>
                {held
                  ? workflow.done.blockers[0]
                  : "Everything is clear — this can be called finished."}
              </span>
            </span>
          ) : (
            <span className="dim" style={{ fontSize: 11 }}>Pick something on the left.</span>
          )}
        </span>
        {workflow ? (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-expanded={showState}
            aria-label={showState ? "Hide the detail" : "Show the detail"}
            onClick={() => setShowState(!showState)}
          >
            <Icon name={showState ? "up" : "down"} size={13} />
          </button>
        ) : null}
      </div>

      {/* Everything under the head scrolls as one body. It used to be a stack
          of fixed blocks with only the queue allowed to grow, so on a short
          window the fixed part was taller than the column and the queue — the
          part you actually work — was given nothing. */}
      <div className="grows">

        {/* ------------------------------------------- the whole production */}
        <div className="panel-body" style={{ padding: "12px 16px" }}>
          <div className="label" style={{ marginBottom: 8 }}>
            <span>All {global.pages} page{global.pages === 1 ? "" : "s"}</span>
          </div>
          <div className="stats">
            <span><b>{global.read}/{global.pages}</b><em>read</em></span>
            <span>
              <b className={global.pages > 0 && global.signed === global.pages ? "is-ok" : ""}>
                {global.signed}/{global.pages}
              </b>
              <em>signed off</em>
            </span>
            <span><b className={global.open ? "is-bad" : "is-ok"}>{global.open}</b><em>open</em></span>
            <span><b className={global.blocking ? "is-bad" : ""}>{global.blocking}</b><em>blocking</em></span>
            <span><b>{global.words.toLocaleString()}</b><em>words</em></span>
          </div>
          <div className="stats" style={{ marginTop: 11 }}>
            <span><b>{global.reads}</b><em>reads</em></span>
            <span><b>{global.revisions}</b><em>rewrites</em></span>
            <span><b>{global.deslops}</b><em>de-AI</em></span>
            <span><b>{global.notes}</b><em>notes</em></span>
          </div>
        </div>

      {workflow && showState ? (
        <>
          {/* --------------------------------------------------- the run --
              Where the pipeline itself has stopped, and the one decision that
              restarts it. Everything below this panel is read off the files on
              disk; this is read off the run, and it is the only thing on the
              screen that knows a gate is open. */}
          {pipeRun ? (
            <div className="panel-body" style={{ padding: "10px 16px" }}>
              <div className="rowflex" style={{ gap: 8, fontSize: 12, alignItems: "baseline" }}>
                <span className="dim" style={{ fontSize: 11 }}>Run</span>
                <span className="mono grow" style={{ fontSize: 11.5 }}>{pipeRun.stage}</span>
                <span className={openGate ? "pill pill-warn" : "pill"}>
                  {openGate ? `${openGate} gate open` : pipeRun.status}
                </span>
              </div>
              {openGate ? (
                <div className="rowflex" style={{ gap: 7, marginTop: 9, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy !== null}
                    onClick={() => onGate("approve", openGate)}
                  >
                    <Icon name="check" size={13} />
                    {busy === "gate" ? "Signing off…" : `Sign off the ${openGate}`}
                  </button>
                  <span className="hint" style={{ fontSize: 11 }}>
                    Signing off starts whatever comes next. It can be withdrawn.
                  </span>
                </div>
              ) : lastApproved ? (
                <div className="rowflex" style={{ gap: 7, marginTop: 9 }}>
                  <button
                    type="button"
                    className="btn btn-line btn-sm"
                    disabled={busy !== null}
                    onClick={() => onGate("withdraw", lastApproved)}
                  >
                    <Icon name="x" size={13} />
                    {busy === "gate-undo" ? "Reopening…" : `Withdraw the ${lastApproved} sign-off`}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ------------------------------------------------------ stages */}
          <div className="panel-body" style={{ padding: "10px 16px" }}>
            <div className="stack-xs">
              {workflow.stages.map((s) => (
                <div
                  key={s.stage}
                  className="rowflex"
                  style={{ gap: 9, alignItems: "baseline", fontSize: 12 }}
                >
                  <span className={`st ${s.state === "done" ? "done" : s.state === "partial" ? "now" : ""}`}>
                    <i />
                  </span>
                  <span style={{ width: 68, fontWeight: 500 }}>{s.stage}</span>
                  <span className="grow dim" style={{ fontSize: 11.5 }}>{s.detail}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ------------------------------------------------------- gates */}
          <div className="panel-body" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
            <div className="stack-xs">
              {workflow.gates.map((g) => {
                /* The sign-off lives per file in the audit state for every kind
                   but a publication, so it is worked out here rather than the
                   server inventing an approval object for one. */
                const done = g.name === "copy" && detail && detail.kind !== "publication"
                  ? signed
                  : !!g.approved;
                return (
                  <div key={g.name} className="stack-xs">
                    <div className="rowflex" style={{ gap: 8, fontSize: 12 }}>
                      <span className="grow" style={{ fontWeight: 500 }}>{g.label}</span>
                      <span className={done ? "pill pill-ok" : "pill"}>
                        {done ? "approved" : "not approved"}
                      </span>
                    </div>
                    {g.blockers.map((b) => (
                      <span
                        key={b}
                        className="rowflex"
                        style={{ gap: 6, fontSize: 11, alignItems: "flex-start", color: "var(--bad)" }}
                      >
                        <span className="sev sev-bad" style={{ marginTop: 5 }} />
                        <span>{b}</span>
                      </span>
                    ))}
                    {g.warnings.map((w) => (
                      <span
                        key={w}
                        className="rowflex"
                        style={{ gap: 6, fontSize: 11, alignItems: "flex-start", color: "var(--ink-3)" }}
                      >
                        <span className="sev sev-warn" style={{ marginTop: 5 }} />
                        <span>{w}</span>
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---------------------------------------------- what you can do */}
          <div className="panel-body" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
            <div className="rowflex" style={{ gap: 7, flexWrap: "wrap" }}>
              {signed ? (
                <button
                  type="button"
                  className="btn btn-line btn-sm"
                  disabled={busy !== null}
                  onClick={() => onApprove(false)}
                >
                  <Icon name="x" size={13} />Withdraw the sign-off
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== null || blocked}
                  title={blocked ? "Clear what is listed above first." : undefined}
                  onClick={() => onApprove(true)}
                >
                  <Icon name="check" size={13} />
                  {busy === "approve" ? "Saving…" : "Sign off the writing"}
                </button>
              )}
              <button
                type="button"
                className="btn btn-line btn-sm"
                disabled={busy !== null || running || !here}
                title={here
                  ? `Reads ${pageName ?? "this page"} and rewrites what it finds, up to two rounds. The text as it stands is kept beside it as .pre-audit.`
                  : "Pick a page first."}
                onClick={() => onRevise(false)}
              >
                {busy === "revise" ? "Rewriting…" : "Audit & revise this page"}
              </button>
              <button
                type="button"
                className="btn btn-line btn-sm"
                disabled={busy !== null || running || !here}
                title={here
                  ? `Rewrites ${pageName ?? "this page"} to sound less machine-made. The text as it stands is kept beside it as .pre-audit.`
                  : "Pick a page first."}
                onClick={() => onRevise(true)}
              >
                {busy === "deslop" ? "Rewriting…" : "De-AI this page"}
              </button>
            </div>

            {/* The override, and only where there is something to override. It
                is deliberately not the same button as the sign-off: signing off
                over a contradiction is a different decision from signing off. */}
            {blocked && !signed ? (
              <button
                type="button"
                className="btn btn-bad btn-sm"
                style={{ marginTop: 8 }}
                disabled={busy !== null}
                onClick={() => onApprove(true, true)}
              >
                <Icon name="alert" size={13} />
                Sign off anyway, over {auditGate!.blockers.length} objection
                {auditGate!.blockers.length === 1 ? "" : "s"}
              </button>
            ) : null}

            {detail?.resumable ? (
              <div className="rowflex" style={{ gap: 7, marginTop: 9, flexWrap: "wrap" }}>
                <span className="label">Resume</span>
                <select
                  className="input"
                  style={{ width: "auto", padding: "5px 8px", fontSize: 12 }}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                >
                  {RESUME_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className="label">through</span>
                <select
                  className="input"
                  style={{ width: "auto", padding: "5px 8px", fontSize: 12 }}
                  value={stopAt}
                  onChange={(e) => setStopAt(e.target.value)}
                >
                  {RESUME_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== null || running}
                  onClick={() => onResume(from, stopAt)}
                >
                  <Icon name="play" size={13} />
                  {busy === "resume" ? "Starting…" : "Go"}
                </button>
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 9 }}>
                A {(detail?.kindLabel ?? "file").toLowerCase()} is written in one pass, so
                there is no stage to pick it up at. Rewriting is how it changes.
              </p>
            )}

            {workflow.lastError ? (
              <div className="fail" style={{ marginTop: 9, fontSize: 12 }}>
                <Icon name="alert" size={14} />
                <span>
                  The last run stopped
                  {workflow.lastError.stage ? ` during ${workflow.lastError.stage}` : ""}:{" "}
                  {workflow.lastError.message}
                </span>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* ------------------------------------------------------- this page */}
      {/* The same facts as above, for the one file open. "Rewritten three
          times and still wrong" is a per-page fact, and a production total
          cannot say it — nine rewrites spread over seventeen pages and nine
          rewrites of this one are the same number and a different problem. */}
      <div className="panel-body" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
        <div className="label" style={{ marginBottom: 8 }}>
          <span>{here ? `This page · ${pageName}` : "This page"}</span>
        </div>
        {here ? (
          <>
            <div className="stats">
              <span><b>{here.audit.reads ?? 0}</b><em>reads</em></span>
              <span><b>{here.audit.revisions ?? 0}</b><em>rewrites</em></span>
              <span><b>{here.audit.deslops ?? 0}</b><em>de-AI</em></span>
              <span><b>{here.audit.notes ?? 0}</b><em>notes</em></span>
              <span><b className={counts.open ? "is-bad" : "is-ok"}>{counts.open}</b><em>open</em></span>
            </div>
            <div className="rowflex" style={{ gap: 10, marginTop: 10, fontSize: 11 }}>
              <span className="dim">last read {when(here.audit.checked)}</span>
              <span className="dim">·</span>
              <span className="dim">last rewrite {when(here.audit.rewritten)}</span>
              <span className={here.audit.approved ? "pill pill-ok" : "pill"}>
                {here.audit.approved ? "signed off" : "not signed off"}
              </span>
            </div>
          </>
        ) : (
          <p className="hint">Pick a page on the left.</p>
        )}
      </div>

      {/* ---------------------------------------------------------- checks */}
      <div className="panel-head" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
        <span className="grow">
          <span className="rowflex" style={{ gap: 10, alignItems: "baseline" }}>
            <span className="numeral" style={{ fontSize: 24 }}>
              {String(counts.open).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>
              finding{counts.open === 1 ? "" : "s"}
            </span>
          </span>
          <span className="dim" style={{ fontSize: 11, display: "block", marginTop: 2, overflowWrap: "anywhere" }}>
            {pageName ? `on ${pageName}` : "pick a page on the left"}
          </span>
        </span>
        <span className="dim" style={{ fontSize: 11 }}>j / k</span>
      </div>

      <div className="panel-body" style={{ padding: "8px 12px 2px" }}>
        <div className="rowflex" style={{ gap: 6, flexWrap: "wrap" }}>
          {pills.map((p) => (
            <button
              key={p.value}
              type="button"
              className={p.className}
              aria-pressed={filter === p.value}
              onClick={() => onFilter(filter === p.value ? "all" : p.value)}
            >
              {p.n} {p.label}
            </button>
          ))}
          {counts.settled > 0 ? (
            <span className="pill pill-ok">{counts.settled} settled</span>
          ) : null}
        </div>
      </div>

      <div className="panel-body" style={{ padding: 8 }}>
        {/* Three states, not two. A page nobody has read and a page that was
            read and came back clean both used to say "Nothing is open", which
            is a claim about writing that had never been looked at.

            `read` alone was the wrong question, though: it means *you* pressed
            Read this page, and a production run raises findings of its own
            without ever setting it. Twelve real findings were counted in the
            header above and then hidden behind "nothing has looked at this
            page". Anything already found is listed, whoever found it. */}
        {!read && queue.length === 0 ? (
          <Empty icon="clock" title="Not read yet.">
            Nothing has looked at this page. Press <b>Read this page</b> on the left
            and whatever it finds will be listed here.
          </Empty>
        ) : queue.length === 0 ? (
          <Empty icon="check" title="Read, and nothing to answer for.">
            The last read went through this page and raised nothing.
          </Empty>
        ) : (
          queue.map((f) => {
            const settled = f.state !== "open";
            return (
              <button
                key={f.id}
                type="button"
                className={settled ? "finding settled" : "finding"}
                aria-current={at?.id === f.id}
                onClick={() => onPick(f.id)}
              >
                <span className="rowflex" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <span className={settled ? "sev sev-ok" : SEV_CLASS[f.severity]} />
                  <span className="grow">
                    <b>{f.title}</b>
                    <span className="cat">
                      {placeOf(f.path)} · {f.category}{f.section ? ` · ${f.section}` : ""}
                    </span>
                  </span>
                  {settled ? (
                    <span className="pill pill-ok">
                      {f.state === "accepted" ? "taken" : "left"}
                    </span>
                  ) : f.severity === "blocking" ? (
                    <span className="pill pill-bad">blocks</span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>

      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- 3. the page */

/**
 * The page itself, whole, with every finding marked in it.
 *
 * This column used to show one paragraph — the one the selected finding sat
 * in — so the screen whose job is judging a page could never show the page.
 * You approved writing you had not read, and a finding about the shape of the
 * whole thing had a single paragraph under it as evidence.
 *
 * Now it is the page: read it, hear it, mark every objection in it at once,
 * click a mark to bring that finding up, rewrite the lot with a sentence, or
 * take the pen and edit it yourself.
 */
function PageColumn({
  path, name, text, loading, findings, current, onPick,
  mode, onMode, draft, onDraft, onSave, saving,
  note, onNote, onRevise, reviseBusy,
  history, busy, onAccept, onIgnore,
}: {
  readonly path: string | null;
  readonly name: string;
  readonly text: string;
  readonly loading: boolean;
  readonly findings: ReadonlyArray<Finding>;
  readonly current: Finding | null;
  readonly onPick: (id: string) => void;
  readonly mode: "read" | "edit";
  readonly onMode: (m: "read" | "edit") => void;
  readonly draft: string;
  readonly onDraft: (t: string) => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly note: string;
  readonly onNote: (t: string) => void;
  readonly onRevise: () => void;
  readonly reviseBusy: boolean;
  readonly history: string;
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onIgnore: () => void;
}) {
  /* Above the early return: a hook cannot sit behind a condition. */
  const [full, setFull] = useState(false);

  /* Full screen is a way of editing this page, not a mode of its own. Leaving
     edit, or moving to a different page, closes it - otherwise the overlay
     stays up over prose it is no longer editing. */
  useEffect(() => {
    if (mode !== "edit") setFull(false);
  }, [mode, path]);

  if (!path) {
    return (
      <div className="dark crop" style={{ height: "100%", display: "grid", placeItems: "center", padding: 32 }}>
        <p className="muted" style={{ fontSize: 14, maxWidth: "42ch", textAlign: "center" }}>
          Pick a page on the left and it appears here whole, in the book&rsquo;s own
          type, with every objection marked in it.
        </p>
      </div>
    );
  }

  /* Whichever text is actually in front of you. */
  const pageText = mode === "edit" ? draft : text;

  return (
    <div className="dark crop colpanel" data-tabscope>
      <span className="disc dots dots-light" aria-hidden="true"
            style={{ width: 210, height: 210, right: -90, bottom: -104 }} />

      <div style={{ padding: "16px 22px 12px", position: "relative", flex: "none" }}>
        <div className="spread" style={{ alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="label">{placeOf(path)}</div>
            <h3 style={{ fontSize: 17, marginTop: 5, overflowWrap: "anywhere" }}>{name}</h3>
          </div>
          <div className="rowflex" style={{ gap: 9, flex: "none" }}>
            {/* The whole page, out of the app or read to you. They belong to
                the page, not to one mode of looking at it, so they sit with
                the page's own controls and act on whichever text is in front
                of you - the draft while you are editing, the file otherwise.
                Glyph only: this row already carries a count and a toggle. */}
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={!pageText.trim()}
              aria-label="Copy the whole page"
              title="Copy the whole page"
              onClick={() => {
                void navigator.clipboard
                  .writeText(pageText)
                  .then(() => toast("The page is on the clipboard."))
                  .catch(() => toast("Could not reach the clipboard."));
              }}
            >
              <Icon name="copy" size={15} />
            </button>
            <ReadAloud dark iconOnly text={pageText} label="Read the whole page" />
            <span className="pill">
              {findings.filter((f) => f.state === "open").length} open
            </span>
            <Seg
              value={mode}
              onChange={onMode}
              options={[{ value: "read", label: "Read" }, { value: "edit", label: "Edit" }]}
            />
          </div>
        </div>
      </div>

      {mode === "read" ? (
        <>
          <div className="grows" style={{ padding: "0 22px", position: "relative" }}>
            {loading ? (
              <p className="muted" style={{ fontSize: 14 }}>Opening the page…</p>
            ) : text ? (
              <MarkedText text={text} findings={findings} current={current} onPick={onPick} />
            ) : (
              <p className="muted" style={{ fontSize: 14 }}>
                This page has nothing in it yet.
              </p>
            )}
          </div>

          {/* The one you are on, and the two verdicts for it. Everything else
              about the page is above; this strip is about a single objection. */}
          {current ? (
            <div style={{
              padding: "13px 22px", position: "relative", flex: "none",
              borderTop: "1px solid var(--line-char)",
            }}>
              <div className="label" style={{ marginBottom: 5 }}>
                <span>{current.category}{current.severity === "blocking" ? " · blocks approval" : ""}</span>
              </div>
              <b style={{ fontSize: 14 }}>{current.title}</b>
              <p className="muted" style={{ fontSize: 13, marginTop: 5 }}>
                {current.fix ? `Proposes: ${current.fix}` : current.suggestion}
              </p>
              <div className="rowflex" style={{ gap: 8, marginTop: 10 }}>
                {current.fix ? (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={onAccept}>
                    <Icon name="check" size={14} />Accept the fix
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => onMode("edit")}>
                    <Icon name="pencil" size={14} />Write it yourself
                  </button>
                )}
                <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={onIgnore}>
                  Leave it
                </button>
                <ReadAloud
                  dark
                  text={current.start >= 0 ? text.slice(current.start, current.end) : text}
                  label={current.start >= 0 ? "Hear the sentence" : "Hear the page"}
                />
                <span className="grow" />
                <span className="kbd">A</span><span className="kbd">I</span>
              </div>
            </div>
          ) : null}

          {/* Rewrite the whole page from one sentence of instruction. The
              right padding clears the desktop shell's Settings button, which
              is fixed to that corner of the window and knows nothing about
              what the workbench has put under it. */}
          <div style={{
            padding: "12px 60px 16px 22px", position: "relative", flex: "none",
            borderTop: "1px solid var(--line-char)",
          }}>
            <div className="rowflex" style={{ gap: 8 }}>
              <input
                className="input grow"
                value={note}
                onChange={(e) => onNote(e.target.value)}
                placeholder="What is wrong with this page? It will be rewritten to fix it."
                onKeyDown={(e) => { if (e.key === "Enter" && note.trim() && !reviseBusy) onRevise(); }}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={!note.trim() || reviseBusy}
                onClick={onRevise}
              >
                {reviseBusy ? "Rewriting…" : "Revise the page"}
              </button>
            </div>
            {history ? (
              <p className="hint" style={{ marginTop: 7, color: "var(--on-char-2)" }}>
                So far: {history}.
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="grows" style={{ padding: "0 22px", position: "relative" }}>
            <div style={{
              border: "1.5px solid var(--vermilion)",
              borderRadius: "var(--r-card)",
              background: "var(--char-2)",
              padding: "14px 16px",
              height: "100%",
              display: "flex",
            }}>
              <textarea
                className="read-field"
                style={{ color: "var(--on-char)", "--rs": "15.5px", "--rm": "100%", flex: 1 } as React.CSSProperties}
                aria-label="Edit the page"
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
              />
            </div>
          </div>

          <div className="verdict" style={{ marginTop: 0, flex: "none" }}>
            <button type="button" className="btn" disabled={saving || !draft.trim()} onClick={onSave}>
              <Icon name="check" size={16} />
              {saving ? "Saving…" : "Save the page"}
            </button>
            <button type="button" className="btn btn-line" onClick={() => onMode("read")}>
              Cancel
            </button>
            {/* The column is a third of the window, and prose written in a
                third of a window reads like prose written in a third of a
                window. This is the same draft, given the whole screen. */}
            <button type="button" className="btn btn-line" onClick={() => setFull(true)}>
              <Icon name="grid" size={15} />
              Full screen
            </button>
            <span className="grow" />
            <span className="dim mono" style={{ fontSize: 11 }}>
              {draft.trim() ? draft.trim().split(/\s+/).length : 0} words
            </span>
          </div>

          <FullScreenEditor
            open={full}
            name={name}
            place={placeOf(path)}
            draft={draft}
            onDraft={onDraft}
            onSave={onSave}
            saving={saving}
            onClose={() => setFull(false)}
          />
        </>
      )}
    </div>
  );
}

/**
 * The page, edited with the whole window.
 *
 * A native `<dialog>` opened modally rather than a div pretending to be one:
 * the platform already gives the backdrop, the focus trap, Escape to close and
 * inertness for everything behind it, and a hand-rolled overlay has to earn
 * all four back and usually earns two.
 *
 * It edits the same `draft` the column does - no second copy of the text, so
 * there is no version to reconcile when it closes and no way to lose an edit
 * by closing the wrong one.
 */
function FullScreenEditor({
  open, name, place, draft, onDraft, onSave, saving, onClose,
}: {
  readonly open: boolean;
  readonly name: string;
  readonly place: string;
  readonly draft: string;
  readonly onDraft: (t: string) => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  /* showModal() is a method, not an attribute, so open/closed has to be driven
     imperatively or the element renders as an inert block in the flow. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dark fullscreen-edit"
      aria-label={`Edit ${name}`}
      /* Escape fires `cancel`, and the parent owns the open flag, so the state
         has to come back here or the dialog closes and React reopens it. */
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClose={onClose}
    >
      <div className="spread" style={{ alignItems: "flex-start", gap: 12, flex: "none" }}>
        <div style={{ minWidth: 0 }}>
          <div className="label">{place}</div>
          <h3 style={{ fontSize: 17, marginTop: 5, overflowWrap: "anywhere" }}>{name}</h3>
        </div>
        <div className="rowflex" style={{ gap: 9, flex: "none" }}>
          <ReadAloud dark iconOnly text={draft} label="Read the whole page" />
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-label="Leave full screen"
            title="Leave full screen"
            onClick={onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      </div>

      <div style={{
        border: "1.5px solid var(--vermilion)",
        borderRadius: "var(--r-card)",
        background: "var(--char-2)",
        padding: "16px 20px",
        flex: 1,
        minHeight: 0,
        display: "flex",
      }}>
        <textarea
          className="read-field"
          style={{ color: "var(--on-char)", "--rs": "16.5px", "--rm": "78ch", flex: 1 } as React.CSSProperties}
          aria-label="Edit the page"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
        />
      </div>

      <div className="verdict" style={{ marginTop: 0, flex: "none" }}>
        <button type="button" className="btn" disabled={saving || !draft.trim()} onClick={onSave}>
          <Icon name="check" size={16} />
          {saving ? "Saving…" : "Save the page"}
        </button>
        <button type="button" className="btn btn-line" onClick={onClose}>
          Done
        </button>
        <span className="grow" />
        <span className="dim mono" style={{ fontSize: 11 }}>
          {draft.trim() ? draft.trim().split(/\s+/).length : 0} words
        </span>
      </div>
    </dialog>
  );
}

/**
 * The page with every objection marked in it at once.
 *
 * One mark per finding, in file order, non-overlapping — a finding whose span
 * runs into the one before it is left unmarked rather than drawn in the wrong
 * place, which is the same rule the single-passage view used. The current one
 * is brighter than the rest so the queue and the page agree about where you
 * are, and clicking any mark moves the queue to it.
 */
function MarkedText({
  text, findings, current, onPick,
}: {
  readonly text: string;
  readonly findings: ReadonlyArray<Finding>;
  readonly current: Finding | null;
  readonly onPick: (id: string) => void;
}) {
  const parts: React.ReactNode[] = [];
  const located = findings
    .filter((f) => f.start >= 0 && f.end > f.start && f.end <= text.length)
    .sort((a, b) => a.start - b.start);

  let at = 0;
  for (const f of located) {
    if (f.start < at) continue; // overlaps the one before it; do not double-mark
    if (f.start > at) parts.push(text.slice(at, f.start));
    parts.push(
      <mark
        key={f.id}
        aria-current={current?.id === f.id}
        className={
          f.state !== "open" ? "m-ok"
            : f.severity === "blocking" ? "m-bad"
              : f.severity === "warning" ? "m-warn" : ""
        }
        onClick={() => onPick(f.id)}
        title={f.state === "open" ? f.title : `${f.title} — settled`}
      >
        {text.slice(f.start, f.end)}
      </mark>,
    );
    at = f.end;
  }
  if (at < text.length) parts.push(text.slice(at));

  return (
    <div
      className="read"
      style={{ color: "var(--on-char)", "--rs": "15.5px", "--rm": "62ch" } as React.CSSProperties}
    >
      <p style={{ whiteSpace: "pre-wrap" }}>{parts}</p>
    </div>
  );
}
