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
import { Num } from "../components/ui/num";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TypeMark } from "../components/TypeMark";
import type { SSEMessage } from "../hooks/use-sse";
import { fetchJson, useApi } from "../hooks/use-api";
import { useNewSSEMessages } from "../hooks/use-sse";
import { Icon } from "../components/ui/icon";
import { Spinner } from "../components/ui/working";
import { RunError } from "../components/ui/run-error";
import { Empty, Failed, Loading } from "../components/ui/states";
import { Seg, toast, useQueueKeys } from "../components/ui/vermilion";
import { copyText } from "../lib/clipboard";
import { PicturesStrip } from "../components/PicturesStrip";
import { SettingCard } from "../components/SettingCard";
import { Verdict } from "../components/Verdict";
import {
  Grip, ReadAloud, ReadingSize, STAGE_CLASS, useColumns, useReadingSize, type Workflow,
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
  /* Restyle passes over this file, and whose voice the last one used. */
  readonly restyles?: number;
  readonly voice?: string;
  /* How far it reads from that voice, before and after the last pass. */
  readonly voiceDistance?: number;
  readonly voiceDistanceBefore?: number;
}

/** "read 4x, rewritten twice" - said only where there is something to say. */
function historyOf(a: FileAudit): string {
  const parts: string[] = [];
  if (a.reads) parts.push(`read ${a.reads}×`);
  if (a.revisions) parts.push(`rewritten ${a.revisions}×`);
  if (a.deslops) parts.push(`de-AI ${a.deslops}×`);
  if (a.notes) parts.push(`${a.notes} note${a.notes === 1 ? "" : "s"}`);
  // Named, not counted, because whose voice it is answers the question and a
  // number does not: "styled 2×" says nothing a reader wanted to know.
  if (a.restyles) parts.push(a.voice ? `in ${a.voice}'s voice` : `styled ${a.restyles}×`);
  return parts.join(" · ");
}

/**
 * Whether a voice has actually reached this file.
 *
 * The Style screen could say a work had a guide and nothing could say a page
 * had been through it - and a restyle leaves signed-off files alone, so those
 * are different facts about the same book.
 */
export function voiceOf(a: FileAudit): string | null {
  if (!a.restyles) return null;
  const name = a.voice ? `in ${a.voice}'s voice` : "restyled";
  // The measured move, when there is one. "0.31 → 0.12" is the honest answer
  // to "did it work", which a name alone cannot give (05 §3).
  if (a.voiceDistance === undefined) return name;
  const after = a.voiceDistance.toFixed(2);
  return a.voiceDistanceBefore === undefined
    ? `${name} · ${after} away`
    : `${name} · ${a.voiceDistanceBefore.toFixed(2)} → ${after}`;
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

/* The registry's gate names, in the words a person approving them uses. */
const GATE_WORDS: Readonly<Record<string, string>> = {
  content: "Writing", design: "Pictures", build: "Build",
};

type Severity ="blocking" | "warning" | "note";

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
  readonly state: "open" | "accepted" | "ignored" | "fixed";
  readonly para: number;
  readonly start: number;
  readonly end: number;
}

/** One reader-map run: per simulated reader, attention paragraph by paragraph. */
interface ReaderRun {
  readonly at: string | null;
  readonly maps: ReadonlyArray<{
    readonly persona: string;
    readonly label: string;
    readonly points: ReadonlyArray<{
      readonly para: number;
      readonly attention: number;
      readonly reason: string;
      readonly wouldStopHere: boolean;
    }>;
  }>;
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
  /*
   * A verdict is about the text that was read, not about the file name.
   *
   * "Clean" survived every rewrite that happened after the check: restyle it,
   * revise it, retype it by hand, and the dot stayed green because `checked`
   * was still set. The date of the last rewrite is the thing that says
   * otherwise, and it is already on record - it was simply never compared.
   * Deliberately not a fifth colour: this is the un-read state, which is what
   * a file nobody has read *in its current form* actually is.
   */
  if (item.audit.rewritten && item.audit.checked && item.audit.rewritten > item.audit.checked) {
    return { dot: "dot dot-never", note: "changed since last read" };
  }
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

  /* The gates this kind of work has at all, read off the registry. Shown
     whether or not a run exists: a gate that appears only while it is open
     is a gate nobody knows is coming. */
  const { data: registry } = useApi<{ productions: ReadonlyArray<{
    readonly id: string;
    readonly pipeline?: { readonly gates?: readonly string[]; readonly design?: readonly string[]; readonly build?: readonly string[] };
  }> }>("/productions");
  const declared = registry?.productions.find((p) => p.id === picked?.kind)?.pipeline ?? null;

  /* A book and a storybook are drawn per chapter or spread; everything else
     is one unit, which is what their runners already record. */
  const workUnits = () => picked?.kind === "book" || picked?.kind === "storybook"
    ? Math.max(1, items.filter((i) => unitOf(i) !== null).length)
    : 1;

  /* Any gate, any time. A sign-off is a record; nothing waits on it. */
  const decideGate = async (verb: "approve" | "withdraw", gate: string) => {
    if (!picked) return;
    await act("gate", () => fetchJson(
      `/productions/${picked.kind}/${encodeURIComponent(picked.id)}/gates/${gate}/${verb}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ totalUnits: workUnits() }) },
    ), verb === "approve" ? "Signed off." : "Sign-off withdrawn.");
    await refetchPipeline();
  };

  /*
   * Start the pictures (or the build, for a type with none) for work written
   * before runs existed. A new work gets there on its own; this one has no run
   * to carry it, so this makes one and walks it on.
   */
  const startNext = async () => {
    if (!picked) return;
    await act("start", () => fetchJson(
      `/productions/${picked.kind}/${encodeURIComponent(picked.id)}/content-ready`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ totalUnits: workUnits() }) },
    ), "Started.");
    await refetchPipeline();
  };

  const { data: findingData, refetch: refetchFindings } =
    useApi<{ findings: ReadonlyArray<Finding>; counts: Counts }>("/findings");
  const findings = useMemo(() => findingData?.findings ?? [], [findingData]);

  /* Two windows on one book must not disagree about what is still open. */
  useNewSSEMessages(sse.messages, useCallback((m: SSEMessage) => {
    /* `audit:state` means a file's record moved: a rewrite landed, a sign-off
       was given or taken back. The findings were refetched and the file list
       was not, so a restyle that rewrote fourteen chapters left every one of
       them still reading as it did before until the screen was reloaded. */
    if (m.event === "findings:changed" || m.event === "audit:state") {
      void Promise.all([refetchFindings(), refetchDetail(), refetchProjects()]);
    }
  }, [refetchFindings, refetchDetail, refetchProjects]));

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

  /*
   * Sign off the page on screen, and only that page.
   *
   * This called the project route, which loops every file in the work - so
   * signing the one page you had read signed the twenty-one you had not. A
   * publication still signs its copy on the issue, which is where that
   * approval lives.
   */
  const approvePage = (yes: boolean) => {
    if (!picked || !detail || !page) return;
    const path = picked.kind === "publication"
      ? `/publications/${encodeURIComponent(picked.id)}/approve`
      : "/audit/approve";
    const body = picked.kind === "publication"
      ? { what: "copy", approve: yes }
      : { path: page, approve: yes };
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

  /*
   * The voice this work carries, and which of its files a restyle may touch.
   *
   * Asked of the server rather than worked out here: the plan is what keeps a
   * restyle off the outline, the sales blurb and the style guide itself, and a
   * screen that decided for itself which files were prose would eventually
   * disagree with the job that does the rewriting.
   */
  const { data: stylePlan, refetch: refetchStylePlan } = useApi<{
    files: ReadonlyArray<string>; hasStyle: boolean; voice?: string;
  }>(picked ? `/productions/${picked.kind}/${encodeURIComponent(picked.id)}/restyle/plan` : "");
  const [restyling, setRestyling] = useState(false);

  const restylePage = useCallback(async (whole: boolean) => {
    if (!picked) return;
    if (!whole && !page) return;
    setRestyling(true);
    try {
      const out = await fetchJson<{ files: number }>(
        `/productions/${picked.kind}/${encodeURIComponent(picked.id)}/restyle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(whole ? {} : { paths: [page] }),
        },
      );
      const voice = stylePlan?.voice ? ` in ${stylePlan.voice}'s voice` : "";
      toast(out.files === 1
        ? `Rewriting this page${voice}. The rail shows it; stopping is on the run screen.`
        : `Rewriting ${out.files} pages${voice}. Signed-off pages are left alone.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    setRestyling(false);
  }, [picked, page, stylePlan?.voice]);

  /* A rewrite lands as `audit:text`; the panel showing that text redraws. */
  useNewSSEMessages(sse.messages, useCallback((m: SSEMessage) => {
    /* A voice given to this work on the Style screen changes what the restyle
       buttons here are offering to do, so the plan is asked again. */
    if (m.event === "style:complete") { void refetchStylePlan(); return; }
    if (m.event !== "audit:text") return;
    const d = (m.data ?? {}) as { path?: string };
    if (d.path && d.path === page) void refetchPage();
  }, [page, refetchPage, refetchStylePlan]));

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

  /* The reader map for this page (19 §5c): where simulated readers drift. */
  const [readerRun, setReaderRun] = useState<ReaderRun | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    setReaderRun(null);
    if (!page) return;
    fetchJson<ReaderRun>(`/audit/reader?path=${encodeURIComponent(page)}`)
      .then(setReaderRun)
      .catch(() => setReaderRun(null));
  }, [page]);
  /* One tint per paragraph: the coldest reader there, and what they said. */
  const heat = useMemo(() => {
    const out = new Map<number, { attention: number; reason: string; stop: boolean }>();
    for (const map of readerRun?.maps ?? []) {
      for (const p of map.points) {
        const was = out.get(p.para);
        const stop = p.wouldStopHere || !!was?.stop;
        if (!was || p.attention < was.attention) {
          out.set(p.para, { attention: p.attention, reason: `${map.label}: ${p.reason}`, stop });
        } else if (stop !== was.stop) {
          out.set(p.para, { ...was, stop });
        }
      }
    }
    return out;
  }, [readerRun]);
  const runReader = useCallback(async () => {
    if (!page) return;
    setReading(true);
    toast("Two readers are reading this page…");
    try {
      const out = await fetchJson<ReaderRun & { cold: number }>("/audit/reader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: page }),
      });
      setReaderRun(out);
      toast(out.cold
        ? `${out.cold} passage${out.cold === 1 ? "" : "s"} where a reader drifts, marked on the page.`
        : "Nobody drifted. Nothing marked.");
      await refetchFindings();
    } catch (e) {
      toast(e instanceof Error ? e.message : "The readers could not finish.");
    } finally {
      setReading(false);
    }
  }, [page, refetchFindings]);

  /* The writer rewrites the marked words, and only them. */
  const rewrite = useCallback(async () => {
    if (!current) return;
    setSettling(true);
    toast("The writer is rewriting that passage…");
    try {
      await fetchJson(`/findings/${current.id}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      toast("Rewritten. Restore puts the old words back.");
      await Promise.all([refetchFindings(), refetchPage()]);
      setAtIndex(0);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not take.");
    } finally {
      setSettling(false);
    }
  }, [current, refetchFindings, refetchPage]);

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
      {/* No title strip. It said the name of the work and how many files it
          has, which is the row you clicked in the queue to get here and the
          count printed at the top of the queue - three copies of one fact
          across the top of the screen, costing every column the height. The
          work you are in is the one lit up on the left. */}
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
          onGate={(verb, gate) => void decideGate(verb, gate)}
          detail={detail ?? null}
          busy={busy}
          running={running}
          onApprove={(yes) => void approvePage(yes)}
          declared={declared}
          onStart={() => void startNext()}
          onResume={(a, b) => void resume(a, b)}
          onRevise={(deslop) => void revisePage(deslop)}
          onRestyle={(whole) => void restylePage(whole)}
          voice={stylePlan?.voice ?? null}
          restyling={restyling}
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
          onRewrite={() => void rewrite()}
          heat={heat}
          reading={reading}
          onReader={() => void runReader()}
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
                  className="row py-2 px-1 w-full text-left"
                  aria-current={page === item.path}
                  onClick={() => onPage(item.path)}
                >
                  {f.num ? <span className="num tnum">{f.num}</span> : null}
                  <span className="grow">
                    <span className="name text-body">{f.name}</span>
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
      {/* "The pages", and a count of them, above a list of pages with a count
          on every work in it. The only thing in this row that says anything
          is the toggle, so the row is the toggle. */}
      <div className="panel-head panel-head-thin">
        <span className="grow trunc min-w-0">
          {picked ? (
            <span className="rowflex gap-2 min-w-0">
              <span className="trunc text-body font-semibold" title={picked.id}>
                {titleOf(picked.id)}
              </span>
              <span className="dim text-cap flex-none">
                {items.length} file{items.length === 1 ? "" : "s"}
              </span>
            </span>
          ) : null}
        </span>
        <Seg
          compact
          value={view}
          onChange={chooseView}
          options={[
            { value: "list", label: "List", icon: "list" },
            { value: "tiles", label: "Tiles", icon: "grid" },
          ]}
        />
      </div>

      <div className="panel-body grows px-3.5 pt-1.5 pb-2.5">
        {projects.length > 1 ? (
          <>
            {/* No "The work" heading, and no row for the work you are already
                in - its name is in the head above, and its pages are the grid
                below. What is left here is the other works, which is what the
                list is for: getting to one of them. */}
            <div className="rows">
              {projects.map((p) => {
                const open = picked?.kind === p.kind && picked.id === p.id;
                if (open) return <Fragment key={`${p.kind}/${p.id}`}>{files}</Fragment>;
                return (
                  <Fragment key={`${p.kind}/${p.id}`}>
                    <button
                      type="button"
                      className="row row-work py-2 px-1"
                      aria-current={open}
                      onClick={() => onPick({ kind: p.kind, id: p.id })}
                    >
                      <TypeMark kind={p.kind} />
                      <span className="grow">
                        <span className="name text-body" title={p.id}>
                          {titleOf(p.id)}
                        </span>
                        {/* The silhouette said the type already. Repeating the
                            word beside it is the labelling the styleguide
                            rules out. */}
                        <span className="meta">{p.files} files</span>
                      </span>
                    </button>

                  </Fragment>
                );
              })}
            </div>
          </>
        ) : files}
      </div>
      <div className="panel-body border-t border-t-(--line) py-3.5 px-4">
        <div className="rowflex justify-between mb-2.5">
          <span className="dim text-cap">
            {here ? `${here.words.toLocaleString()} words` : `${items.length} files`}
          </span>
          <span className="dim mono text-cap">
            {estimate(here ? here.words : items.reduce((n, i) => n + i.words, 0))}
          </span>
        </div>
        {/* `running` covered a read started from this button and nothing else,
            so a whole-production rewrite — the longest, least reversible pass
            in the app — ran with no way to stop it and the button still
            offering to start another. Both use the same controller, so one
            Stop serves both. */}
        {running || working ? (
          <button type="button" className="btn btn-line w-full justify-center" onClick={onStop}>
            <Spinner />
            Stop
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn w-full justify-center"
              disabled={!here}
              onClick={onRead}
            >
              <Icon name="play" size={15} />
              Read this page
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm w-full justify-center mt-2"
              disabled={items.length === 0}
              onClick={onReadAll}
            >
              Read all {items.length}
            </button>
          </>
        )}
        <p className="hint mt-2.5">
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
/** The unit a page is: the first run of digits in its file name, as `refFromPath` reads it. */
function unitOf(item: Item | null): number | null {
  const digits = item ? /(\d+)/.exec(item.name.replace(/\.[^.]+$/, "")) : null;
  const n = digits ? Number(digits[1]) : 0;
  return n >= 1 ? n : null;
}

function StateColumn({
  detail, busy, running, onApprove, onResume, onRevise,
  onRestyle, voice, restyling,
  pipeRun, onGate, declared, onStart,
  items, allFindings, here,
  pageName, queue, counts, filter, onFilter, at, onPick,
}: {
  readonly detail: Detail | null;
  /** The gates and stages the registry declares for this kind of work. */
  readonly declared: { readonly gates?: readonly string[]; readonly design?: readonly string[]; readonly build?: readonly string[] } | null;
  /** Start the next stage of work written before runs existed. */
  readonly onStart: () => void;
  readonly busy: string | null;
  /** Where the run itself stands, which the files on disk cannot say. */
  readonly pipeRun: PipelineRun | null;
  readonly onGate: (verb: "approve" | "withdraw", gate: string) => void;
  readonly running: boolean;
  readonly onApprove: (approve: boolean, force?: boolean) => void;
  readonly onResume: (from: string, stopAt: string) => void;
  readonly onRevise: (deslop: boolean) => void;
  /** Put the prose through the work's voice: this page, or all of it. */
  readonly onRestyle: (whole: boolean) => void;
  /** What that voice is called. Null when this work has not been given one. */
  readonly voice: string | null;
  /** Whether a restyle is in flight, so the buttons can say so. */
  readonly restyling: boolean;
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
      /* Files carrying a voice, not restyle passes. "Nine restyles" over
         fourteen chapters and nine chapters restyled are the same number and
         a different answer to "is this book in that voice yet". */
      styled: items.filter((i) => i.audit.restyles).length,
      voice: items.find((i) => i.audit.voice)?.audit.voice ?? null,
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
  /* The sign-off button acts on the page on screen, so it is this page's
     approval and this page's contradictions that decide it - not the other
     twenty-one's. A publication signs its copy on the issue, all at once. */
  const perIssue = detail?.kind === "publication";
  const pageSigned = perIssue ? signed : !!here?.audit.approved;
  const objections = perIssue ? auditGate?.blockers.length ?? 0 : counts.blocking;
  const blocked = perIssue ? (auditGate ? !auditGate.canApprove : false) : counts.blocking > 0;
  const held = workflow ? !workflow.done.can : false;

  const pills: ReadonlyArray<{ value: Severity; label: string; className: string; n: number }> = [
    { value: "blocking", label: "blocking", className: "pill pill-bad", n: counts.blocking },
    { value: "warning", label: "warnings", className: "pill pill-warn", n: counts.warning },
    { value: "note", label: "notes", className: "pill", n: counts.note },
  ];

  return (
    <div className="panel panel-flush colpanel">
      {/* ---------------------------------------------------------- status */}
      <div className="panel-head py-3.5 px-4">
        <span className="grow min-w-0">
          <h3 className="h-panel">Where it stands</h3>
          {workflow ? (
            <span
              className="rowflex gap-1.5 text-cap mt-0.5 items-start"
              style={{ color: held ? "var(--bad)" : "var(--ok)" }}
            >
              <Icon name={held ? "alert" : "check"} size={12} />
              <span>
                {held
                  ? workflow.done.blockers[0]
                  : "Everything is clear — this can be called finished."}
              </span>
            </span>
          ) : (
            <span className="dim text-cap">Pick something on the left.</span>
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
        <div className="panel-body py-3 px-4">
          <div className="label mb-2">
            <span>All {global.pages} page{global.pages === 1 ? "" : "s"}</span>
          </div>
          {/* The figures and the four stages are one block, not two stacked
              ones. They answer the same question - where is this - and stacking
              them pushed the gate, the buttons and the findings a whole panel
              further down for no reason but the order they were written in. */}
          <div className="statusrow">
          <div className="statusrow-figures">
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
            <span><b><Num value={global.words} /></b><em>words</em></span>
          </div>
          <div className="stats mt-3">
            <span><b><Num value={global.reads} /></b><em>reads</em></span>
            <span><b><Num value={global.revisions} /></b><em>rewrites</em></span>
            <span><b><Num value={global.deslops} /></b><em>de-AI</em></span>
            <span><b><Num value={global.notes} /></b><em>notes</em></span>
            {global.styled > 0 ? (
              <span>
                <b className={global.styled === global.pages ? "is-ok" : ""}>
                  {global.styled}/{global.pages}
                </b>
                <em>{global.voice ? `in ${global.voice}'s voice` : "styled"}</em>
              </span>
            ) : null}
          </div>
          </div>
          {workflow ? (
            <div className="statusrow-stages stack-xs">
              {workflow.stages.map((st) => (
                <div
                  key={st.stage}
                  className="rowflex gap-2 items-baseline text-small"
                >
                  <span className={`st ${STAGE_CLASS[st.state] ?? ""}`}>
                    <i />
                  </span>
                  <span className="w-13 font-medium">{st.stage}</span>
                  <span className="grow dim trunc text-cap" title={st.detail}>
                    {st.detail}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          </div>
        </div>

        {/* The world this is set in, beside the manuscript: reading it and
            correcting it are the two things anyone does with it (22 §5). */}
        {detail ? (
          <div className="panel-body py-3 px-4">
            <SettingCard type={detail.kind} id={detail.id} />
          </div>
        ) : null}
        {/* The print card used to sit here. It is a build-stage concern — trim,
            binding, spine, an upload folder — and this screen is for reading a
            work against its own rules. Putting it beside the manuscript meant
            the one gate on this page was the one nobody needs while reading,
            and the two that matter (design, build) were not on any page at all.
            The component and its routes are kept; nothing renders them until
            the build surface that owns them exists. See analysis/debt.md. */}

        {/* What has been drawn for this work — this page's first — beside the
            reading of it, and one verdict on the page itself (04 §7). */}
        {detail ? (
          <PicturesStrip kind={detail.kind} id={detail.id} {...(unitOf(here) !== null ? { unit: unitOf(here)! } : {})} />
        ) : null}
      {workflow && showState ? (
        <>
          {/* ------------------------------------------------------- gates */}
          <div className="panel-body py-2.5 px-4 border-t border-t-(--line)">
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
                    <div className="rowflex gap-2 text-small">
                      <span className="grow font-medium">{g.label}</span>
                      <span className={done ? "pill pill-ok" : "pill"}>
                        {done ? "approved" : "not approved"}
                      </span>
                    </div>
                    {g.blockers.map((b) => (
                      <span
                        key={b}
                        className="rowflex gap-1.5 text-cap items-start text-(--bad)"
                      >
                        <span className="sev sev-bad mt-1.5" />
                        <span>{b}</span>
                      </span>
                    ))}
                    {g.warnings.map((w) => (
                      <span
                        key={w}
                        className="rowflex gap-1.5 text-cap items-start text-(--ink-3)"
                      >
                        <span className="sev sev-warn mt-1.5" />
                        <span>{w}</span>
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---------------------------------------------- what you can do */}
          <div className="panel-body py-2.5 px-4 border-t border-t-(--line)">
            <div className="rowflex gap-2 flex-wrap">
              {pageSigned ? (
                <button
                  type="button"
                  className="btn btn-line btn-sm"
                  disabled={busy !== null || (!perIssue && !here)}
                  onClick={() => onApprove(false)}
                >
                  <Icon name="x" size={13} />
                  {perIssue ? "Withdraw the sign-off" : "Withdraw this page's sign-off"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== null || blocked || (!perIssue && !here)}
                  title={blocked ? "Clear the blocking findings on this page first." : undefined}
                  onClick={() => onApprove(true)}
                >
                  <Icon name="check" size={13} />
                  {busy === "approve" ? "Saving…" : perIssue ? "Sign off the writing" : "Sign off this page"}
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
              {/*
                * Restyle, beside the two rewrites it is not.
                *
                * Revise fixes faults and is free to change what happens on the
                * page; de-AI takes the machine out. Neither reads the style
                * guide at all, so either can quietly walk a restyled chapter
                * back out of its voice - which is the reason this belongs
                * here, one press from the passes that undo it, rather than on
                * another screen.
                */}
              {/*
                * Shown without a voice, not hidden.
                *
                * These were rendered only when the work already carried one,
                * which meant somebody who had saved a voice and not yet handed
                * it over went looking for a button that was not there and had
                * no way to learn why. A control that vanishes teaches nothing;
                * a disabled one that says what is missing does.
                */}
              <button
                type="button"
                className="btn btn-line btn-sm"
                disabled={busy !== null || running || restyling || !here || !voice}
                title={!voice
                  ? "This work has not been given a voice yet. Save one on the Style screen, then hand it to this work."
                  : here
                    ? `Rewrites ${pageName || "this page"} in ${voice}'s voice. Events, names and dialogue stay; only the prose changes. The text as it stands is kept beside it as .pre-audit.`
                    : "Pick a page first."}
                onClick={() => onRestyle(false)}
              >
                {restyling
                  ? "Rewriting…"
                  : voice
                    ? `Restyle this page in ${voice}'s voice`
                    : "Restyle this page — no voice yet"}
              </button>
              {voice ? (
                <button
                  type="button"
                  className="btn btn-line btn-sm"
                  disabled={busy !== null || running || restyling}
                  title={`Rewrites every page of this work in ${voice}'s voice. Signed-off pages are left alone.`}
                  onClick={() => onRestyle(true)}
                >
                  {restyling ? "Rewriting…" : "Restyle the whole story"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  title="Opens the Style screen, where a voice is saved and handed to a piece of work."
                  onClick={() => { window.location.hash = "#/style"; }}
                >
                  Give this work a voice
                </button>
              )}
            </div>

            {/* The override, and only where there is something to override. It
                is deliberately not the same button as the sign-off: signing off
                over a contradiction is a different decision from signing off. */}
            {blocked && !pageSigned ? (
              <button
                type="button"
                className="btn btn-bad btn-sm mt-2"
                disabled={busy !== null}
                onClick={() => onApprove(true, true)}
              >
                <Icon name="alert" size={13} />
                Sign off anyway, over {objections} objection
                {objections === 1 ? "" : "s"}
              </button>
            ) : null}

            {detail?.resumable ? (
              <div className="rowflex gap-2 mt-2.5 flex-wrap">
                <span className="label">Resume</span>
                <select
                  className="input w-auto py-1.5 px-2 text-small"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                >
                  {RESUME_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className="label">through</span>
                <select
                  className="input w-auto py-1.5 px-2 text-small"
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
              <p className="hint mt-2.5">
                A {(detail?.kindLabel ?? "file").toLowerCase()} is written in one pass, so
                there is no stage to pick it up at. Rewriting is how it changes.
              </p>
            )}

            {workflow.lastError ? (
              <div className="mt-2.5">
                <RunError
                  stage={workflow.lastError.stage}
                  message={workflow.lastError.message}
                  {...(workflow.lastError.stopped ? { stopped: true } : {})}
                  {...(workflow.lastError.at ? { at: workflow.lastError.at } : {})}
                  {...(detail?.resumable ? { later: {
                    id: `${detail.kind}:${detail.id}`,
                    label: detail.title,
                    url: `/api/v1/publications/${encodeURIComponent(detail.id)}/resume`,
                    body: { from: workflow.lastError.stage ?? from, stopAt },
                  } } : {})}
                />
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
      <div className="panel-body py-3 px-4 border-t border-t-(--line)">
        <div className="label mb-2">
          <span>{here ? `This page · ${pageName}` : "This page"}</span>
        </div>
        {here ? (
          <>
            <div className="stats">
              <span><b><Num value={here.audit.reads ?? 0} /></b><em>reads</em></span>
              <span><b><Num value={here.audit.revisions ?? 0} /></b><em>rewrites</em></span>
              <span><b><Num value={here.audit.deslops ?? 0} /></b><em>de-AI</em></span>
              <span><b><Num value={here.audit.notes ?? 0} /></b><em>notes</em></span>
              <span><b><Num value={here.audit.restyles ?? 0} /></b><em>styled</em></span>
              <span><b className={counts.open ? "is-bad" : "is-ok"}>{counts.open}</b><em>open</em></span>
            </div>
            <div className="rowflex gap-2.5 mt-2.5 text-cap">
              <span className="dim">last read {when(here.audit.checked)}</span>
              <span className="dim">·</span>
              <span className="dim">last rewrite {when(here.audit.rewritten)}</span>
              {voiceOf(here.audit) ? (
                <>
                  <span className="dim">·</span>
                  <span className="pill">{voiceOf(here.audit)}</span>
                </>
              ) : null}
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
      <div className="panel-head py-3 px-4 border-t border-t-(--line)">
        <span className="grow">
          <span className="rowflex gap-2.5 items-baseline">
            <span className="numeral text-h3">
              {String(counts.open).padStart(2, "0")}
            </span>
            <span className="text-body font-semibold">
              finding{counts.open === 1 ? "" : "s"}
            </span>
          </span>
          <span className="dim text-cap block mt-0.5 wrap-anywhere">
            {pageName ? `on ${pageName}` : "pick a page on the left"}
          </span>
        </span>
        <span className="dim text-cap">j / k</span>
      </div>

      <div className="panel-body px-3 pt-2 pb-0.5">
        <div className="rowflex gap-1.5 flex-wrap">
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

      <div className="panel-body p-2">
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
                <span className="rowflex gap-2 flex-nowrap">
                  <span className={settled ? "sev sev-ok" : SEV_CLASS[f.severity]} />
                  <span className="grow">
                    <b>{f.title}</b>
                    <span className="cat">
                      {placeOf(f.path)} · {f.category}{f.section ? ` · ${f.section}` : ""}
                    </span>
                  </span>
                  {settled ? (
                    <span className="pill pill-ok">
                      {f.state === "accepted" ? "taken" : f.state === "fixed" ? "rewritten" : "left"}
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

      {/* Your verdict and the stages, last: they are what you do once the
          page above has been read. */}
      {detail && here ? (
        <div className="panel-body py-3 px-4 border-t border-t-(--line)">
          <div className="label mb-2"><span>Your verdict on this page</span></div>
          <Verdict
            key={here.path}
            surface="content"
            refTo={{ type: detail.kind, id: detail.id, ...(unitOf(here) !== null ? { unit: unitOf(here)! } : {}) }}
            target={here.path}
            source="page"
          />
        </div>
      ) : null}

      {workflow && showState ? (
        <>
          {/* --------------------------------------------------- the run --
              Where the pipeline itself is. Everything above is read off the
              files on disk; this is read off the run. */}
          {pipeRun ? (
            <div className="panel-body py-2.5 px-4 border-t border-t-(--line)">
              <div className="rowflex gap-2 text-small items-baseline">
                <span className="dim text-cap">Run</span>
                <span className="mono grow text-cap">{pipeRun.stage}</span>
                <span className="pill">{pipeRun.status}</span>
              </div>
            </div>
          ) : null}

          {/* ------------------------------------------------ the three gates --
              Every gate this kind of work has, whether or not the run has got
              there, each one signable at any time. */}
          {declared?.gates?.length ? (
            <div className="panel-body py-2.5 px-4 border-t border-t-(--line)">
              <div className="stack-xs">
                {declared.gates.map((g) => {
                  const state = pipeRun?.gates[g]?.state ?? null;
                  const steps = g === "design"
                    ? `${(declared.design ?? []).join(" → ")} · ComfyUI / Canva`
                    : g === "build"
                      ? `${(declared.build ?? []).join(" → ")}${declared.build?.includes("layout") ? " · Affinity" : ""}`
                      : "the text, page by page";
                  return (
                    <div key={g} className="rowflex gap-2 text-small items-baseline">
                      <span className="w-16 font-medium">{GATE_WORDS[g] ?? g}</span>
                      <span className="grow dim trunc text-cap" title={steps}>{steps}</span>
                      <span className={
                        state === "approved" ? "pill pill-ok"
                          : state === "rejected" ? "pill pill-bad" : "pill"
                      }>
                        {state === "approved" ? "signed off"
                          : state === "waiting" ? "not signed"
                            : state === "rejected" ? "sent back" : "not reached"}
                      </span>
                      <button
                        type="button"
                        className="btn btn-line btn-sm"
                        disabled={busy !== null}
                        onClick={() => onGate(state === "approved" ? "withdraw" : "approve", g)}
                      >
                        {state === "approved" ? "Withdraw" : "Sign off"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {(!pipeRun || pipeRun.stage.startsWith("content.")) && declared.gates.length > 1 ? (
                <div className="rowflex gap-2 mt-2.5 flex-wrap">
                  <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={onStart}>
                    <Icon name="play" size={13} />
                    {busy === "start"
                      ? "Starting…"
                      : `Start ${(GATE_WORDS[declared.gates[1]!] ?? declared.gates[1]!).toLowerCase()}`}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

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
  history, busy, onAccept, onIgnore, onRewrite, heat, reading, onReader,
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
  readonly onRewrite: () => void;
  /** The reader map for this page, paragraph by paragraph. */
  readonly heat: Heat;
  readonly reading: boolean;
  readonly onReader: () => void;
}) {
  /* Above the early return: a hook cannot sit behind a condition. */
  const [full, setFull] = useState(false);
  /* Up here for the same reason. The editor is the same prose at the same size
     as the reader, so switching modes must not resize it under you. */
  const { chosen } = useReadingSize();

  /* Full screen is a way of editing this page, not a mode of its own. Leaving
     edit, or moving to a different page, closes it - otherwise the overlay
     stays up over prose it is no longer editing. */
  useEffect(() => {
    if (mode !== "edit") setFull(false);
  }, [mode, path]);

  if (!path) {
    return (
      <div className="dark crop h-full grid place-items-center p-8">
        <p className="muted text-body text-center max-w-narrow">
          Pick a page on the left and it appears here whole, in the book&rsquo;s own
          type, with every objection marked in it.
        </p>
      </div>
    );
  }

  /* Whichever text is actually in front of you. */
  const pageText = mode === "edit" ? draft : text;

  return (
    <div className="dark crop colpanel reads" data-tabscope>
      <span className="disc dots dots-light w-52.5 h-52.5 -right-22.5 -bottom-26" aria-hidden="true"
 />

      <div className="readhead relative flex-none">
        <div className="spread readcol items-start gap-3">
          <div className="min-w-0">
            <div className="label">{placeOf(path)}</div>
            {/* Truncates rather than breaking: `overflow-wrap: anywhere` put
                `0007.md` down the column one character per line as soon as the
                pane got narrow. A file name is one token. */}
            <h3 className="trunc text-lead mt-1.5" title={name}>{name}</h3>
          </div>
          {/* No `flex` here. It carried `none`, which is an inline style and
              so beat the container query that drops this row under the name
              when the pane is too narrow to hold both - so instead of
              wrapping, the row ran off the right edge of the panel. The
              stylesheet owns when it wraps. */}
          <div className="rowflex gap-2.5">
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
                void copyText(pageText).then((ok) => toast(
                  ok ? "The page is on the clipboard." : "Could not reach the clipboard.",
                ));
              }}
            >
              <Icon name="copy" size={15} />
            </button>
            <ReadAloud dark iconOnly text={pageText} label="Read the whole page" />
            {/* Where would a reader stop? Two simulated readers read the page
                and the paragraphs where they drift are tinted (19 §5c). */}
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={reading || !pageText.trim()}
              aria-label="Where would a reader stop?"
              title={reading ? "The readers are reading…" : "Where would a reader stop? Marks where attention falls"}
              onClick={onReader}
            >
              <Icon name="pulse" size={15} />
            </button>
            <ReadingSize dark />
            <span className="pill">
              {findings.filter((f) => f.state === "open").length} open
            </span>
            <Seg
              compact
              value={mode}
              onChange={onMode}
              options={[
                { value: "read", label: "Read", icon: "eye" },
                { value: "edit", label: "Edit", icon: "pencil" },
              ]}
            />
          </div>
        </div>
      </div>

      {mode === "read" ? (
        <>
          <div className="grows readbody relative">
            {loading ? (
              <p className="muted text-body">Opening the page…</p>
            ) : text ? (
              <MarkedText text={text} findings={findings} current={current} onPick={onPick} heat={heat} />
            ) : (
              <p className="muted text-body">
                This page has nothing in it yet.
              </p>
            )}
          </div>

          {/* The one you are on, and the two verdicts for it. Everything else
              about the page is above; this strip is about a single objection. */}
          {current ? (
            <div className="py-3.5 px-5.5 relative flex-none border-t border-t-(--line-char)">
              <div className="label mb-1.5">
                <span>{current.category}{current.severity === "blocking" ? " · blocks approval" : ""}</span>
              </div>
              <b className="text-body">{current.title}</b>
              <p className="muted text-small mt-1.5">
                {current.fix ? `Proposes: ${current.fix}` : current.suggestion}
              </p>
              <div className="rowflex gap-2 mt-2.5">
                {current.fix ? (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={onAccept}>
                    <Icon name="check" size={14} />Accept the fix
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => onMode("edit")}>
                    <Icon name="pencil" size={14} />Write it yourself
                  </button>
                )}
                {/* The third hand: the writer redoes only the marked words.
                    A finding about the whole page has none to mark. */}
                {current.quote ? (
                  <button
                    type="button"
                    className="btn btn-line btn-sm"
                    disabled={busy}
                    onClick={onRewrite}
                    title="The writer rewrites only the marked words"
                  >
                    Rewrite it
                  </button>
                ) : null}
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

          {/* Rewrite the whole page from one sentence of instruction. It
              stands on the same column as the prose above it - a bar that runs
              edge to edge under a centred manuscript is a fourth alignment in
              a panel that should have one. Clearing the desktop shell's fixed
              Settings button is the stylesheet's job now, and only at the
              widths where the column actually reaches that corner. */}
          <div className="revisebar">
            <div className="rowflex readcol gap-2">
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
              <p className="hint readcol mt-2 text-(--on-char-2)">
                So far: {history}.
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="grows readbody relative">
            <div className="readcol edit-frame py-3.5 px-4 h-full flex">
              <textarea
                className="read-field text-(--on-char) flex-1"
                /* No `--rm: 100%` here any more. Filling the column looked
                   like using the space and read as 34 characters a line in a
                   dragged-in column and 122 in a wide one; the stylesheet's
                   measure holds it near 75 either way. */
                style={{ ...(chosen ? { "--rs": `${chosen}px` } : {}) } as React.CSSProperties}
                aria-label="Edit the page"
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
              />
            </div>
          </div>

          {/* Save keeps its word because it writes to the manuscript and a
              person should be able to read what they are about to do. The
              other two are glyphs everyone already knows — an X closes, four
              corner brackets mean full screen — and spelling them out was
              three sentences of chrome under a page of prose. */}
          <div className="read-actions mt-0 flex-none">
            <button type="button" className="btn" disabled={saving || !draft.trim()} onClick={onSave}>
              <Icon name="check" size={16} />
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              aria-label="Discard these edits"
              title="Discard these edits"
              onClick={() => onMode("read")}
            >
              <Icon name="x" size={16} />
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              aria-label="Edit with the whole screen"
              title="Edit with the whole screen"
              onClick={() => setFull(true)}
            >
              <Icon name="expand" size={16} />
            </button>
            <span className="grow" />
            <span className="dim mono text-cap">
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
  /* The same preference the column reads, so turning the text up in one place
     turns it up in the other. Full screen used to be the one surface where the
     A buttons were not offered at all and the size could not be changed. */
  const { chosen } = useReadingSize();

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
      <div className="spread readcol items-start gap-3 flex-none">
        <div className="min-w-0">
          <div className="label">{place}</div>
          <h3 className="text-lead mt-1.5 wrap-anywhere">{name}</h3>
        </div>
        <div className="rowflex gap-2.5 flex-none">
          <ReadAloud dark iconOnly text={draft} label="Read the whole page" />
          <ReadingSize dark />
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

      <div className="readcol edit-frame py-4 px-5 flex-1 min-h-0 flex">
        <textarea
          className="read-field text-(--on-char) flex-1"
          /* `--rs: 16.5px` and `--rm: 78ch` were hardcoded here, which is why
             this editor rendered an identical 760px column of 16.5px type at
             1024px and at 3440px. The dialog is its own container now and
             sizes itself; only a chosen size overrides it. */
          style={{ ...(chosen ? { "--rs": `${chosen}px` } : {}) } as React.CSSProperties}
          aria-label="Edit the page"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
        />
      </div>

      {/* No "Done" beside Save. The header already carries a close, Escape
          already closes, and a second way out sitting next to the primary
          action only makes a person read both to find out which one keeps
          their work. */}
      <div className="read-actions mt-0 flex-none">
        <div className="rowflex readcol gap-2.5">
          <button type="button" className="btn" disabled={saving || !draft.trim()} onClick={onSave}>
            <Icon name="check" size={16} />
            {saving ? "Saving…" : "Save"}
          </button>
          <span className="grow" />
          <span className="dim mono text-cap">
            {draft.trim() ? draft.trim().split(/\s+/).length : 0} words
          </span>
        </div>
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
/**
 * A folder name, read as a title.
 *
 * Every creation is stored under a slug because a slug is a safe filename, and
 * the screen printed the slug: `the-lamp-room`, `the-kolam-drawn-at-dawn`.
 * That is the disk's business, not the reader's. File names are left alone
 * where they identify a file - only the name of a piece of work is dressed up,
 * and the slug stays in the tooltip so the folder is still findable.
 *
 * Small words stay small unless they open the title, which is the difference
 * between a title and a shouted one.
 */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of",
  "on", "or", "the", "to", "up", "via", "with",
]);

export function titleOf(slug: string): string {
  const words = slug.replace(/[_-]+/g, " ").trim().split(/[ ]+/).filter(Boolean);
  if (words.length === 0) return slug;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      // A word already carrying capitals is somebody's spelling, not a slug's.
      if (word !== lower && word !== word.toUpperCase()) return word;
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Below this a simulated reader is drifting (core `READER_COLD`). */
const COLD = 0.35;

/** Per paragraph, the coldest reader there and what they said. */
type Heat = ReadonlyMap<number, { readonly attention: number; readonly reason: string; readonly stop: boolean }>;

function MarkedText({
  text, findings, current, onPick, heat,
}: {
  readonly text: string;
  readonly findings: ReadonlyArray<Finding>;
  readonly current: Finding | null;
  readonly onPick: (id: string) => void;
  /** The reader map, when one has been run on this page. */
  readonly heat?: Heat;
}) {
  // Set once for the whole app, so the size survives moving between pages.
  const { chosen } = useReadingSize();
  const parts: React.ReactNode[] = [];
  const located = findings
    .filter((f) => f.start >= 0 && f.end > f.start && f.end <= text.length)
    .sort((a, b) => a.start - b.start);

  /* Paragraph by paragraph, numbered the way findings count them, so the
     reader map can tint the ones where attention fell. A mark stays inside
     its paragraph. */
  const blocks: Array<readonly [number, number]> = [];
  let from = 0;
  for (const m of text.matchAll(/\n\s*\n/g)) {
    blocks.push([from, m.index]);
    from = m.index + m[0].length;
  }
  blocks.push([from, text.length]);

  let next = 0;
  blocks.forEach(([a, b], para) => {
    if (para > 0) parts.push(text.slice(blocks[para - 1]![1], a));
    const inner: React.ReactNode[] = [];
    let at = a;
    while (next < located.length && located[next]!.start < b) {
      const f = located[next]!;
      next += 1;
      if (f.start < at) continue; // overlaps the one before it; do not double-mark
      const end = Math.min(f.end, b);
      if (f.start > at) inner.push(text.slice(at, f.start));
      inner.push(
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
          {text.slice(f.start, end)}
        </mark>,
      );
      at = end;
    }
    if (at < b) inner.push(text.slice(at, b));
    const h = heat?.get(para);
    parts.push(h && (h.attention < COLD || h.stop) ? (
      <span key={`p${para}`} className={h.stop ? "cold cold-stop" : "cold"} title={h.reason}>{inner}</span>
    ) : (
      <Fragment key={`p${para}`}>{inner}</Fragment>
    ));
  });

  return (
    <div
      className="read text-(--on-char)"
      /* The measure is the stylesheet's, not this element's. A `--rm: 66ch`
         used to be pinned here, which overrode it - and `66ch` in Literata is
         an 89-character line, so the manuscript ran that wide at every size no
         matter what the stylesheet said. */
      style={{ ...(chosen ? { "--rs": `${chosen}px` } : {}) } as React.CSSProperties}
    >
      <p className="whitespace-pre-wrap">{parts}</p>
    </div>
  );
}
