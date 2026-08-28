/**
 * Check finished work, from the work rather than from a file list.
 *
 * The first version of this screen listed every auditable `.md` on disk and let
 * you check one. That was the shape of `runStoryAudit`, not the shape of the
 * work: a magazine is one issue of sixteen pages, a short is one story spread
 * over sixty-four files, and neither is a row in a list of paths.
 *
 * So the unit is the project. `/api/v1/audit/projects` groups the same targets
 * by production and project, and `/api/v1/audit/project/:kind/:id` returns the
 * derived view: stages read off whatever run state that production keeps, its
 * findings, and its files.
 *
 * One tree, not two lists. The files used to sit in a section of their own in
 * the middle, which meant the screen carried a navigator on the left and a
 * second navigator beside the thing you were reading — four columns wide by the
 * time the app's own sidebar was counted, and nothing but the app's sidebar
 * could be folded away. Kind, project and file are three levels of the same
 * question, so they are three levels of the same tree, and every level folds.
 * The middle is then only the project, and the editor can be put away when it
 * is not wanted.
 *
 * The two other things a finished issue needs are here rather than only on the
 * publication screen: the pictures (ComfyUI, the `art` stage) and the document
 * (Affinity, the `build` stage). Both already existed behind `/resume`, which
 * takes a stage range — no new route, just the two the audit screen was missing.
 *
 * What this screen got wrong for a long time, all of it the same mistake in
 * different places: it never said what it was doing.
 *
 *   - Three columns scrolled as one, so reading a finding scrolled the sentence
 *     it was about off the screen.
 *   - Every `Make` button was fire-and-forget. The route returns before the
 *     work starts, the events it broadcasts were not in the client's allowlist,
 *     and `busy` cleared in milliseconds — so a build that was running looked
 *     exactly like a build that had never begun, and clicking again earned a
 *     409 rendered as a stack trace.
 *   - A rewriting pass took minutes, could not be stopped, and could not be
 *     undone, though the pass has written `<name>.pre-audit.md` before touching
 *     a word since the day it was written.
 *   - The confirmation dialog guarded unsaved typing and left the finished
 *     manuscript unguarded, which is the wrong way round.
 *   - Nothing on it announced anything to a screen reader.
 *
 * English only, deliberately. This page used to call a `tr()` helper gated on
 * `t("nav.myBooks") !== "My Books"`, and the English string for that key is
 * "My Works" — so the comparison was true forever and every label rendered in
 * Chinese whatever the app was set to. PublicationDetail, the screen this one
 * is meant to match, carries no translations either.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";
import { useNewSSEMessages, type SSEMessage } from "../hooks/use-sse";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, FileText, Image as ImageIcon,
  Lock, Loader2, PanelRightClose, PanelRightOpen, Play, RotateCcw, Save,
  ShieldCheck, Square, Unlock, X,
} from "lucide-react";

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
}

interface Item {
  readonly path: string;
  readonly name: string;
  readonly words: number;
  readonly modified: string;
  /** What has been done to this file, and whether it is signed off. */
  readonly audit?: FileAudit;
  /** A `.pre-audit` copy exists, so the last rewrite can be undone. */
  readonly backup?: boolean;
}

interface Finding {
  readonly page: number | null;
  readonly severity: string;
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

interface Approval { readonly at: string; readonly by: string }

interface Gates {
  readonly copy: { approved: Approval | null; warnings: readonly string[] };
  readonly design: { approved: Approval | null; blockers: readonly string[]; canApprove: boolean };
  readonly build: { canBuild: boolean; blockers: readonly string[] };
}

interface Detail {
  readonly kind: string;
  readonly kindLabel: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly stages: ReadonlyArray<{ stage: string; state: string; detail: string }>;
  readonly findings: ReadonlyArray<Finding>;
  readonly items: ReadonlyArray<Item>;
  /** Publications only. Nothing else is signed off in two halves. */
  readonly gates?: Gates;
}

interface Audit {
  readonly findings: ReadonlyArray<{
    readonly category: string;
    readonly severity: string;
    readonly description: string;
    readonly suggestion: string;
  }>;
}

/**
 * Severity, through the theme rather than around it.
 *
 * These were `text-emerald-500`, `text-amber-500` and `text-red-500` — raw
 * palette that does not move between parchment and obsidian, and amber on the
 * light card measures about 1.9:1, which is not a severity indicator so much as
 * a rumour of one. `--success` and `--warning` are new; `--destructive` was
 * always there and this file was not using it.
 */
const STATE_TONE: Record<string, string> = {
  done: "text-success",
  complete: "text-success",
  running: "text-primary",
  partial: "text-warning",
  "needs-review": "text-warning",
  failed: "text-destructive",
  error: "text-destructive",
};

const SEVERITY_TONE: Record<string, string> = {
  warning: "text-warning",
  blocking: "text-destructive",
};

/** Run-state words as a person would say them. `s.state` is an enum off disk. */
const STATE_LABEL: Record<string, string> = {
  done: "finished",
  complete: "finished",
  running: "running",
  partial: "part-way",
  "needs-review": "needs a look",
  failed: "failed",
  error: "failed",
  pending: "not started",
  idle: "not started",
};

/** Stage names as a person would say them. Unknown stages keep their own name. */
const STAGE_LABEL: Record<string, string> = {
  art: "Pictures",
  build: "Document",
  write: "Writing",
  outline: "Outline",
  audit: "Checks",
  revise: "Rewrite",
  layout: "Layout",
  research: "Research",
  publish: "Publishing",
};

const say = (map: Record<string, string>, key: string) =>
  map[key] ?? key.replace(/[-_]/g, " ");

const SELECTED = "bg-primary/10 text-primary";

/**
 * A pass that has already run on the open file.
 *
 * Quiet, and unmistakably not the same button it was a minute ago: the point is
 * that a finished check should not look identical to one nobody has clicked.
 */
const DONE = "bg-success/10 text-success border border-success/30";

const artifact = (path: string) =>
  `/api/v1/project/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;

/** The page number a publication file carries in its name, for a spread render. */
function pageNumberOf(name: string): number | null {
  const m = /^(\d+)[-_]/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * The part of a path that says which stage of the work a file belongs to —
 * `final/chapters`, `outline`, `reviews` — relative to its own project.
 */
function folderOf(path: string): string {
  const parts = path.split("/");
  // drop the production directory, the project directory, and the filename
  return parts.slice(2, -1).join("/");
}

/** `2m 41s`, for a pass whose only other progress report is a spinner. */
function elapsed(sinceMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - sinceMs) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * What the tree was showing last time this screen was open.
 *
 * Kind, project and file selection were component state, so navigating to Chat
 * and back dropped all of it and the whole path had to be clicked again. Module
 * scope, not localStorage: this should survive a route change, not a restart,
 * because a project that has since been deleted should not be waiting here.
 */
const remembered: {
  shutKinds: Record<string, boolean>;
  openProjects: Record<string, boolean>;
  picked: { kind: string; id: string } | null;
  showEditor: boolean;
} = { shutKinds: {}, openProjects: {}, picked: null, showEditor: true };

/** A held action, and the words to ask about it with. */
interface Pending {
  readonly act: () => void;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

export function AuditPage({
  theme, sse,
}: { theme: Theme; sse: { messages: ReadonlyArray<SSEMessage> } }) {
  const c = useColors(theme);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ readonly act: () => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);

  // Everything folds. `false` is the default for a kind, `true` for a project,
  // so the tree opens showing what you have rather than every file you own.
  const [shutKinds, setShutKinds] = useState<Record<string, boolean>>(remembered.shutKinds);
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>(remembered.openProjects);
  const [showEditor, setShowEditor] = useState(remembered.showEditor);

  const [picked, setPicked] = useState<{ kind: string; id: string } | null>(remembered.picked);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [file, setFile] = useState<Item | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [scope, setScope] = useState<"file" | "project">("project");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  /**
   * An action held back until the user has answered for it.
   *
   * This guarded one thing — unsaved typing about to be replaced — and left the
   * more valuable artifact unguarded: `Rewrite` and `Remove AI phrasing` write
   * over the finished chapter on disk, and on a file the user had not just
   * typed into they did it with no question asked at all. Both now ask, and so
   * does switching projects, which blanked the editor without a word.
   */
  const [pending, setPending] = useState<Pending | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  /** The long-running thing, if there is one, and when it started. */
  const [inflight, setInflight] = useState<{ key: string; label: string; at: number } | null>(null);
  /**
   * The pass that last finished on the open file.
   *
   * Three buttons sat identical before a run and identical after it, so a
   * finished check looked exactly like one that had never been clicked and the
   * only way to tell was to remember.
   */
  const [ran, setRan] = useState<{ mode: string; findings: number } | null>(null);
  /**
   * How much rewritten text has landed in the editor, and when the last piece
   * did.
   *
   * The rewrite has streamed each finished section into the panel since it was
   * written, and the panel gave no sign of it: the text simply differed at some
   * point, which from the reader's chair is indistinguishable from nothing
   * happening for four minutes and then a reload.
   */
  const [streamed, setStreamed] = useState<{ count: number; at: number } | null>(null);
  /**
   * The headings rewritten so far, in the order they landed.
   *
   * This is the stream as a person can watch it. `audit:text` carries the whole
   * document each time, so applying it is invisible — the text differs at some
   * point, minutes apart, which reads as a reload. A section name appearing is
   * something happening.
   */
  const [sections, setSections] = useState<readonly string[]>([]);
  /**
   * Approved files the reader has deliberately reopened, this visit.
   *
   * Not persisted: reopening is a decision about the next few minutes, not a
   * property of the file, and it should not outlive the screen.
   */
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set());
  const [, setTick] = useState(0);

  useEffect(() => { remembered.shutKinds = shutKinds; }, [shutKinds]);
  useEffect(() => { remembered.openProjects = openProjects; }, [openProjects]);
  useEffect(() => { remembered.picked = picked; }, [picked]);
  useEffect(() => { remembered.showEditor = showEditor; }, [showEditor]);

  // One second, only while something is running: the elapsed time beside a
  // minutes-long pass is the only thing on screen that proves it is still alive.
  useEffect(() => {
    if (!inflight) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [inflight]);

  const fail = useCallback((e: unknown, again?: () => void) => {
    setError(String((e as Error).message ?? e));
    setRetry(again ? { act: again } : null);
  }, []);

  const clearError = useCallback(() => { setError(null); setRetry(null); }, []);

  // The live rewrite writes into the editor, so it must not land on top of
  // something the user typed and has not saved. `dirty` is derived, so the
  // listener reads it through a ref rather than re-subscribing on every keystroke.
  const stateRef = useRef({ path: "", dirty: false, projectId: "" });
  stateRef.current = {
    path: file?.path ?? "",
    dirty: text !== saved,
    projectId: picked?.id ?? "",
  };

  const loadProject = useCallback(async (kind: string, id: string) => {
    try {
      const res = await fetch(
        `/api/v1/audit/project/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setDetail(body);
    } catch (e) {
      fail(e, () => void loadProject(kind, id));
    }
  }, [fail]);

  // The SSE listener must be able to refresh the project it is watching without
  // re-subscribing every time the selection changes.
  const reload = useRef<() => void>(() => {});
  reload.current = () => { if (picked) void loadProject(picked.kind, picked.id); };

  useNewSSEMessages(sse.messages, useCallback((message: SSEMessage) => {
    const data = message.data as {
      path?: string; id?: string; message?: string; markdown?: string;
      state?: string; stage?: string; heading?: string;
    } | null;
    if (!data) return;

    /**
     * Publication events are keyed by issue id, not by path — which is why the
     * old handler, which returned early unless `data.path` matched the open
     * file, threw every single one of them away.
     */
    if (message.event.startsWith("publication:")) {
      if (!data.id || data.id !== stateRef.current.projectId) return;
      if (message.event === "publication:event" && data.stage) {
        setProgress(say(STAGE_LABEL, data.stage));
      }
      if (message.event === "publication:run") {
        if (data.state === "start") return;
        setBusy(null);
        setInflight(null);
        setProgress(null);
        if (data.state === "error" && data.message) setError(data.message);
        reload.current();
      }
      if (message.event === "publication:issue") reload.current();
      return;
    }

    if (!data.path || data.path !== stateRef.current.path) return;
    if (message.event === "audit:progress" && data.message) setProgress(data.message);
    if (message.event === "audit:run" && data.state !== "start") setProgress(null);
    if (message.event === "audit:text" && typeof data.markdown === "string" && !stateRef.current.dirty) {
      setText(data.markdown);
      setSaved(data.markdown);
      setStreamed((s) => ({ count: (s?.count ?? 0) + 1, at: Date.now() }));
    }
    if (message.event === "audit:section" && typeof data.heading === "string") {
      // A chapter file is often one unheaded section, so the heading arrives
      // empty. Counting them is still the honest signal — "the second piece has
      // landed" is a fact, "untitled section" is not information.
      const heading = data.heading.trim();
      setSections((list) => [...list, heading || `Part ${list.length + 1}`]);
    }
    // The tree's marks live in a file the server writes, so a run that changes
    // them has to say so.
    if (message.event === "audit:state") reload.current();
  }, []));

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/audit/projects");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setProjects(body.projects ?? []);
    } catch (e) {
      fail(e, () => void loadProjects());
    } finally {
      setLoading(false);
    }
  }, [fail]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  // Whatever was open last time this screen was mounted.
  useEffect(() => {
    if (remembered.picked) void loadProject(remembered.picked.kind, remembered.picked.id);
    // Deliberately once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const byKind = new Map<string, { label: string; rows: Project[] }>();
    for (const p of projects) {
      const g = byKind.get(p.kind) ?? { label: p.kindLabel, rows: [] };
      g.rows.push(p);
      byKind.set(p.kind, g);
    }
    return [...byKind.entries()].map(([kind, g]) => ({
      kind,
      label: g.label,
      rows: [...g.rows].sort((a, b) => b.modified.localeCompare(a.modified)),
    }));
  }, [projects]);

  const openProject = useCallback(async (kind: string, id: string) => {
    const key = `${kind}/${id}`;
    const already = picked?.kind === kind && picked.id === id;
    setOpenProjects((p) => ({ ...p, [key]: already ? !p[key] : true }));
    if (already) return;
    setPicked({ kind, id });
    setDetail(null);
    setFile(null);
    setAudit(null);
    setRan(null);
    setStreamed(null);
    setSections([]);
    setScope("project");
    setText("");
    setSaved("");
    setLoadFailed(false);
    clearError();
    setNote(null);
    setImage(null);
    await loadProject(kind, id);
  }, [clearError, loadProject, picked]);

  const openFile = useCallback(async (item: Item) => {
    setFile(item);
    setAudit(null);
    setRan(null);
    setStreamed(null);
    setSections([]);
    setScope("project");
    setLoadingText(true);
    setLoadFailed(false);
    clearError();
    try {
      const res = await fetch(artifact(item.path));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setText(body.content ?? "");
      setSaved(body.content ?? "");
    } catch (e) {
      // An empty editor used to be the only sign of this, which is
      // indistinguishable from an empty file — and typing one character into it
      // and saving would write one character over a real chapter.
      setLoadFailed(true);
      setText("");
      setSaved("");
      fail(e, () => void openFile(item));
    } finally {
      setLoadingText(false);
    }
  }, [clearError, fail]);

  const save = async () => {
    if (!file || loadFailed) return;
    setBusy("save");
    clearError();
    try {
      const res = await fetch(artifact(file.path), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // The server refuses to write over an approved file unless it is told
        // the caller means it. Reopening the file here is that.
        body: JSON.stringify({ content: text, force: unlocked.has(file.path) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSaved(text);
    } catch (e) {
      fail(e, () => void save());
    } finally {
      setBusy(null);
    }
  };

  /**
   * Anything that runs against the publication as a whole, on its own routes.
   *
   * `/resume` answers `{started: true}` before the work begins, so this cannot
   * clear `busy` when the POST returns — doing that is what made every one of
   * these buttons look like it had done nothing. The SSE handler above clears
   * it when `publication:run` reports done or error.
   */
  const publication = async (key: string, label: string, path: string, body: unknown) => {
    if (!picked) return;
    setBusy(key);
    clearError();
    setNote(null);
    setImage(null);
    setInflight({ key, label, at: Date.now() });
    try {
      const res = await fetch(
        `/api/v1/publications/${encodeURIComponent(picked.id)}${path}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      const out = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Not a failure. It means the thing the user just asked for is already
        // happening, which is status, and it used to render as a stack trace.
        setNote(String(out.error ?? "Already running."));
        return;
      }
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      if (out.image) {
        setImage(artifact(String(out.image)));
        setNote("Spread rendered.");
      }
      // A render answers with its result rather than streaming, so nothing else
      // is coming for it.
      if (out.image || out.started !== true) {
        setBusy(null);
        setInflight(null);
        await loadProject(picked.kind, picked.id);
      }
    } catch (e) {
      setBusy(null);
      setInflight(null);
      fail(e, () => void publication(key, label, path, body));
    }
  };

  const RUN_LABEL: Record<string, string> = {
    report: "Checking",
    revise: "Rewriting",
    deslop: "Removing AI phrasing",
  };

  const run = async (mode: "report" | "revise" | "deslop") => {
    if (!file || loadFailed) return;
    setBusy(mode);
    setRan(null);
    setStreamed(null);
    setSections([]);
    clearError();
    setInflight({ key: mode, label: RUN_LABEL[mode] ?? mode, at: Date.now() });
    try {
      const res = await fetch("/api/v1/audit/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: file.path,
          revise: mode === "revise",
          deslop: mode === "deslop",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.cancelled) {
        setNote("Stopped. Nothing further was changed.");
        return;
      }
      setAudit(body.audit ?? null);
      setRan({ mode, findings: body.audit?.findings?.length ?? 0 });
      setScope("file");
      // A revise pass rewrites the file, so the editor beside it is now stale —
      // and the project listing is too, because the pass has just left a
      // `.pre-audit` copy that the Undo button reads.
      if (mode !== "report") {
        await openFile(file);
        if (picked) await loadProject(picked.kind, picked.id);
      }
    } catch (e) {
      fail(e, () => void run(mode));
    } finally {
      setBusy(null);
      setInflight(null);
    }
  };

  /** Stop the pass now. The server holds the AbortController it was missing. */
  const cancel = async () => {
    if (!file) return;
    try {
      await fetch("/api/v1/audit/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: file.path }),
      });
    } catch { /* the run finishing on its own is not a failure to report */ }
  };

  /** Put back the copy the rewriting pass took before it changed anything. */
  const restore = async () => {
    if (!file) return;
    setBusy("restore");
    clearError();
    try {
      const res = await fetch("/api/v1/audit/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: file.path }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setText(body.content ?? "");
      setSaved(body.content ?? "");
      setAudit(null);
      setRan(null);
      setNote("The text from before the rewrite is back.");
    } catch (e) {
      fail(e, () => void restore());
    } finally {
      setBusy(null);
    }
  };

  /** Sign the open file off, or take the sign-off back. */
  const approve = async (yes: boolean) => {
    if (!file) return;
    setBusy("approve");
    clearError();
    try {
      const res = await fetch("/api/v1/audit/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: file.path, approve: yes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // Approving locks the editor again, so a reopen from before it should
      // not survive.
      setUnlocked((set) => {
        const next = new Set(set);
        next.delete(file.path);
        return next;
      });
      setNote(yes ? "Signed off." : "Sign-off withdrawn.");
      if (picked) await loadProject(picked.kind, picked.id);
    } catch (e) {
      fail(e, () => void approve(yes));
    } finally {
      setBusy(null);
    }
  };

  const dirty = text !== saved;
  const page = file ? pageNumberOf(file.name) : null;
  const running = inflight !== null;
  const runBusy = busy === "report" || busy === "revise" || busy === "deslop";

  /*
   * The open file as the project currently reports it, rather than as it was
   * when it was clicked. `file` is a snapshot from the tree; the marks on it
   * change under a run, and reading them off `detail` keeps them true.
   */
  const current = detail?.items.find((i) => i.path === file?.path);
  const approved = current?.audit?.approved ?? null;
  const locked = approved !== null && !unlocked.has(file?.path ?? "");

  /** How far through the project the reader is, in one line. */
  const tally = useMemo(() => {
    const items = detail?.items ?? [];
    return {
      total: items.length,
      checked: items.filter((i) => i.audit?.checked).length,
      rewritten: items.filter((i) => i.audit?.rewritten).length,
      approved: items.filter((i) => i.audit?.approved).length,
    };
  }, [detail]);

  /** Ask, then run `act` — or run it now if there is nothing to warn about. */
  const guarded = (act: () => void, ask?: Partial<Pending>) => {
    const needed = dirty || ask?.message !== undefined;
    if (!needed) { act(); return; }
    setPending({
      act,
      title: ask?.title ?? "Unsaved changes",
      message: dirty
        ? `Your edits to ${file?.name ?? "this file"} have not been saved. Continuing replaces them, and they cannot be recovered.`
        : ask?.message ?? "",
      confirmLabel: ask?.confirmLabel ?? "Discard and continue",
      cancelLabel: ask?.cancelLabel ?? "Keep editing",
    });
  };

  /** The words for a pass that writes over the manuscript on disk. */
  const rewriteAsk = (mode: "revise" | "deslop"): Partial<Pending> => ({
    title: mode === "revise" ? "Rewrite this file?" : "Remove AI phrasing?",
    message: `${file?.name ?? "This file"} will be rewritten in place. A copy of the text as it stands is kept beside it as ${file?.name?.replace(/(\.[^.]+)$/, ".pre-audit$1") ?? "a .pre-audit copy"}, and Undo below puts it back.`,
    confirmLabel: mode === "revise" ? "Rewrite it" : "Remove it",
    cancelLabel: "Leave it alone",
  });

  /** Arrow keys walk the tree, which was mouse-only in every direction. */
  const treeRef = useRef<HTMLDivElement>(null);
  const onTreeKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ?? [],
    );
    const here = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[e.key === "ArrowDown" ? here + 1 : here - 1];
    if (next) { e.preventDefault(); next.focus(); }
  };

  const shown: ReadonlyArray<Finding> = scope === "file"
    ? (audit?.findings ?? []).map((f) => ({ ...f, page: null }))
    : (detail?.findings ?? []);

  return (
    <div className="flex-1 min-w-0 flex gap-6 h-full min-h-0 px-6 py-8 md:px-10">
      {/* ---------------------------------------------- kind, project, file */}
      <aside className="w-64 shrink-0 h-full overflow-y-auto pr-1 space-y-4">
        <h1 className="font-serif text-2xl flex items-center gap-2">
          <ShieldCheck size={20} className="text-primary" />Audit
        </h1>

        {loading ? (
          <Spinner label="Loading your work" />
        ) : error && groups.length === 0 ? (
          // Error and empty used to render together: a red box saying something
          // broke, beside a cheerful note saying you have finished nothing.
          <p className={`text-sm ${c.muted}`}>Could not read your work — see the message beside this.</p>
        ) : groups.length === 0 ? (
          <p className={`text-sm ${c.muted}`}>Nothing finished yet.</p>
        ) : (
          <div className="space-y-3" ref={treeRef} onKeyDown={onTreeKey}>
            {groups.map((g) => {
              const shut = shutKinds[g.kind] === true;
              return (
                <div key={g.kind}>
                  <button
                    data-row
                    aria-expanded={!shut}
                    onClick={() => setShutKinds((p) => ({ ...p, [g.kind]: !shut }))}
                    className={`w-full flex items-center gap-1.5 text-xs uppercase tracking-wide ${c.muted}`}
                  >
                    {shut ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="flex-1 text-left">{g.label}</span>
                    <span>{g.rows.length}</span>
                  </button>

                  {!shut && (
                    <div className="mt-1 space-y-0.5">
                      {g.rows.map((p) => {
                        const key = `${p.kind}/${p.id}`;
                        const on = picked?.kind === p.kind && picked.id === p.id;
                        // The files show on `open && on`, so the chevron has to
                        // say the same thing. It read `open` alone, which meant
                        // a project you had moved away from kept an open
                        // chevron over nothing, and clicking it to see the files
                        // folded it instead.
                        const open = openProjects[key] === true && on;
                        return (
                          <div key={p.id}>
                            <button
                              data-row
                              aria-expanded={open}
                              onClick={() => guarded(() => void openProject(p.kind, p.id))}
                              className={`w-full flex items-center gap-1 px-1.5 py-1.5 rounded text-sm ${
                                on ? `${SELECTED} hover:bg-primary/15` : c.tableHover
                              }`}
                              title={p.id}
                            >
                              {open ? <ChevronDown size={12} className="shrink-0" />
                                : <ChevronRight size={12} className="shrink-0" />}
                              <span className="flex-1 text-left truncate">{p.id}</span>
                              <span className={`text-xs shrink-0 ${c.muted}`}>{p.files}</span>
                            </button>

                            {/* The files live here rather than in a section of
                                their own beside the project. One navigator. */}
                            {open ? (
                              detail ? (
                                <div className="ml-3 pl-2 border-l border-border space-y-0.5 mt-0.5">
                                  {detail.items.map((item) => (
                                    <button
                                      key={item.path}
                                      data-row
                                      onClick={() => guarded(() => void openFile(item))}
                                      className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs ${
                                        file?.path === item.path
                                          ? `${SELECTED} hover:bg-primary/15`
                                          : c.tableHover
                                      }`}
                                      title={item.path}
                                    >
                                      <FileText size={11} className="shrink-0 opacity-60" />
                                      <span className="flex-1 min-w-0 text-left">
                                        <span className="block truncate">{item.name}</span>
                                        {/* Which folder it came from. Without this,
                                            final/chapters/0001.md and outline/0001.md
                                            are the same row printed twice. */}
                                        {folderOf(item.path) ? (
                                          <span className={`block truncate text-[11px] ${c.muted}`}>
                                            {folderOf(item.path)}
                                          </span>
                                        ) : null}
                                      </span>
                                      {/*
                                        * Where each file has got to.
                                        *
                                        * Twenty-two rows that looked identical
                                        * whether they had been checked, rewritten
                                        * and signed off or never opened — so the
                                        * only record of how far you were through a
                                        * project was your own memory of it.
                                        */}
                                      <FileMarks item={item} c={c} />
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <Spinner label="Loading files" className="ml-5 my-1" size={12} />
                              )
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {/* --------------------------------------------- the project itself */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto pr-1 space-y-6">
        {error && (
          <div role="alert" className={`flex items-start gap-3 border rounded-lg p-4 text-sm ${c.error}`}>
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            {/*
              * This was `font-mono text-xs break-all` — the visual grammar of a
              * stack trace, applied to sentences the server writes for people
              * ("this artifact is already being audited"). Body copy, and a way
              * out of it.
              */}
            <div className="flex-1 min-w-0 space-y-2">
              <p className="break-words">{error}</p>
              <div className="flex items-center gap-2">
                {retry ? (
                  <button
                    onClick={() => { const again = retry.act; clearError(); again(); }}
                    className={`px-2.5 py-1 text-xs rounded-lg ${c.btnSecondary}`}
                  >
                    Try again
                  </button>
                ) : null}
                <button
                  onClick={clearError}
                  className={`px-2.5 py-1 text-xs rounded-lg ${c.btnSecondary}`}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {!picked ? (
          <p className={`text-sm ${c.muted}`}>
            Pick something on the left. Everything this app has finished is there,
            filed under what made it.
          </p>
        ) : !detail ? (
          <Spinner label="Loading this project" size={20} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-serif text-3xl truncate">{detail.title}</h2>
                <p className={`mt-1 text-xs ${c.muted}`}>{detail.subtitle}</p>
                <p className="mt-1 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={c.muted}>{tally.total} files</span>
                  <span className={tally.checked ? "text-success" : c.muted}>
                    {tally.checked} checked
                  </span>
                  <span className={tally.rewritten ? "text-warning" : c.muted}>
                    {tally.rewritten} rewritten
                  </span>
                  <span className={tally.approved ? "text-primary" : c.muted}>
                    {tally.approved} signed off
                  </span>
                  {tally.total - tally.approved > 0 ? (
                    <span className={c.muted}>
                      {tally.total - tally.approved} still waiting
                    </span>
                  ) : null}
                </p>
              </div>
              <button
                onClick={() => setShowEditor((v) => !v)}
                aria-label={showEditor ? "Hide the editor" : "Show the editor"}
                className={`px-3 py-1.5 text-sm rounded-lg shrink-0 ${c.btnSecondary}`}
              >
                {showEditor
                  ? <><PanelRightClose size={14} className="inline mr-1.5 -mt-0.5" />Hide editor</>
                  : <><PanelRightOpen size={14} className="inline mr-1.5 -mt-0.5" />Show editor</>}
              </button>
            </div>

            {/*
              * Everything this page says about work in progress, in one place a
              * screen reader is watching. There was no live region anywhere on
              * this screen, so a pass that took four minutes announced its
              * start, its progress, its finish and its failure to nobody.
              */}
            {/*
              * Sticky, because it was not.
              *
              * This column scrolls, and a pass that runs for minutes reported
              * itself at the top of it — so the moment the reader scrolled down
              * to the findings, the only proof the pass was alive scrolled away
              * with it, and the screen looked exactly as idle as before.
              */}
            <div
              role="status"
              aria-live="polite"
              className="sticky top-0 z-20 -mx-1 px-1 py-1 space-y-2 empty:hidden bg-background/85 backdrop-blur-sm"
            >
              {inflight ? (
                <div className={`flex items-center gap-3 border rounded-lg px-4 py-3 text-sm ${c.cardStatic}`}>
                  <Loader2 size={16} className="animate-spin text-primary shrink-0" />
                  <span className="flex-1 min-w-0 truncate">
                    {progress ?? `${inflight.label}…`}
                  </span>
                  <span className={`text-xs tabular-nums ${c.muted}`}>{elapsed(inflight.at)}</span>
                  {runBusy ? (
                    <button
                      onClick={() => void cancel()}
                      className={`px-2.5 py-1 text-xs rounded-lg ${c.btnSecondary}`}
                    >
                      <Square size={11} className="inline mr-1 -mt-0.5" fill="currentColor" />
                      Stop
                    </button>
                  ) : null}
                </div>
              ) : null}
              {note ? <p className="text-sm text-success">{note}</p> : null}
              {image ? (
                // A render produced a picture and the reward for it was the path
                // it was written to, in green text.
                <img
                  src={image}
                  alt="The spread that was just rendered"
                  className="max-h-64 rounded-lg border border-border"
                />
              ) : null}
            </div>

            {detail.gates ? (
              <>
                <section className="grid gap-4 md:grid-cols-2">
                  <Gate
                    c={c}
                    title="Copy"
                    approved={detail.gates.copy.approved}
                    notes={detail.gates.copy.warnings}
                    notesLabel="Worth knowing before you sign this off:"
                    approvedLabel="Signed off with these still open:"
                    canApprove
                    busy={busy === "copy"}
                    onToggle={(yes) => void publication("copy", "Approving", "/approve", { what: "copy", approve: yes })}
                  />
                  <Gate
                    c={c}
                    title="Design"
                    approved={detail.gates.design.approved}
                    notes={detail.gates.design.blockers}
                    notesLabel="The design cannot be approved until:"
                    approvedLabel="Signed off with these still open:"
                    canApprove={detail.gates.design.canApprove}
                    busy={busy === "design"}
                    onToggle={(yes) => void publication("design", "Approving", "/approve", { what: "design", approve: yes })}
                  />
                </section>
                <div className={`border rounded-lg p-4 text-sm ${detail.gates.build.canBuild ? c.info : c.error}`}>
                  {detail.gates.build.canBuild
                    ? "Both gates are open — this issue can be built."
                    : `Build is held: ${detail.gates.build.blockers.join("; ")}.`}
                </div>

                {/* The pictures and the document. Both are stages of the run
                    already, reached through `/resume` with a one-stage range,
                    so this is the same path the publication screen takes. */}
                <section className="space-y-3">
                  <h3 className="font-serif text-xl">Make</h3>
                  <div className={`border ${c.cardStatic} rounded-lg p-4 flex flex-wrap items-center gap-2`}>
                    <button
                      disabled={running}
                      onClick={() => void publication("art", "Drawing", "/resume", { from: "art", stopAt: "art" })}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
                    >
                      <ImageIcon size={14} className="inline mr-1.5 -mt-0.5" />
                      {busy === "art" ? "Drawing…" : "Generate images (ComfyUI)"}
                    </button>
                    <button
                      disabled={running || page === null}
                      onClick={() => void publication("render", "Rendering", "/render", { page })}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                      title={page === null ? "Pick a numbered page on the left first" : `Render page ${page}`}
                    >
                      {busy === "render" ? "Rendering…" : `Render spread (Affinity)${page ? ` — p${page}` : ""}`}
                    </button>
                    <button
                      disabled={running || !detail.gates.build.canBuild}
                      onClick={() => void publication("build", "Building", "/resume", { from: "build", stopAt: "build" })}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                      title={detail.gates.build.canBuild ? "Build the PDF" : detail.gates.build.blockers.join("; ")}
                    >
                      <Play size={14} className="inline mr-1.5 -mt-0.5" />
                      {busy === "build" ? "Building…" : "Build document (Affinity)"}
                    </button>
                    {page === null ? (
                      <p className={`w-full text-xs ${c.muted}`}>
                        Rendering a spread needs a numbered page — pick one like
                        <code className="mx-1">03-feature.md</code> on the left.
                      </p>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}

            {detail.stages.length > 0 && (
              <section className="space-y-3">
                <h3 className="font-serif text-xl">Stages</h3>
                <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide}`}>
                  {detail.stages.map((s) => (
                    <div key={s.stage} className="flex items-center gap-3 p-3 text-sm">
                      <span className="w-24 font-medium truncate">{say(STAGE_LABEL, s.stage)}</span>
                      <span className={`w-28 text-xs ${STATE_TONE[s.state] ?? c.muted}`}>
                        {say(STATE_LABEL, s.state)}
                      </span>
                      {/* The clipped half of this is usually the failure reason,
                          which is the one string anyone reading it wants. */}
                      <span className={`flex-1 text-xs truncate ${c.muted}`} title={s.detail}>
                        {s.detail}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* The checks act on one file, which is what runStoryAudit takes. */}
            <section className="space-y-3">
              <h3 className="font-serif text-xl">Checks</h3>
              {!file ? (
                <p className={`text-sm ${c.muted}`}>Pick a file on the left to check it.</p>
              ) : (
                <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
                  <p className={`text-xs truncate ${c.muted}`} title={file.path}>
                    {file.name}
                    {folderOf(file.path) ? ` · ${folderOf(file.path)}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={runBusy || loadFailed}
                      onClick={() => guarded(() => void run("report"))}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                        ran?.mode === "report" ? DONE : c.btnPrimary
                      }`}
                    >
                      {busy === "report"
                        ? "Checking…"
                        : ran?.mode === "report"
                          ? <><Check size={14} className="inline mr-1.5 -mt-0.5" />Checked</>
                          : "Check it — change nothing"}
                    </button>
                    {/*
                      * These two write over the manuscript on disk, and they
                      * were `btnSecondary` while the harmless one above was
                      * `btnPrimary` — the safe action shouting and the two
                      * destructive ones whispering.
                      */}
                    <button
                      disabled={runBusy || loadFailed || locked}
                      title={locked ? "This file is signed off. Withdraw the sign-off to rewrite it." : undefined}
                      onClick={() => guarded(() => void run("revise"), rewriteAsk("revise"))}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                        ran?.mode === "revise" ? DONE : c.btnDanger
                      }`}
                    >
                      {busy === "revise"
                        ? "Rewriting…"
                        : ran?.mode === "revise"
                          ? <><Check size={14} className="inline mr-1.5 -mt-0.5" />Rewritten</>
                          : "Check and rewrite"}
                    </button>
                    <button
                      disabled={runBusy || loadFailed || locked}
                      title={locked ? "This file is signed off. Withdraw the sign-off to rewrite it." : undefined}
                      onClick={() => guarded(() => void run("deslop"), rewriteAsk("deslop"))}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                        ran?.mode === "deslop" ? DONE : c.btnDanger
                      }`}
                    >
                      {busy === "deslop"
                        ? "Rewriting…"
                        : ran?.mode === "deslop"
                          ? <><Check size={14} className="inline mr-1.5 -mt-0.5" />Cleaned</>
                          : "Remove AI phrasing"}
                    </button>
                    {current?.backup ? (
                      <button
                        disabled={busy !== null || locked}
                        onClick={() => void restore()}
                        className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                        title={locked
                          ? "This file is signed off. Withdraw the sign-off to put an older copy back."
                          : "Put back the text from before the last rewrite"}
                      >
                        <RotateCcw size={14} className="inline mr-1.5 -mt-0.5" />
                        {busy === "restore" ? "Putting it back…" : "Undo the rewrite"}
                      </button>
                    ) : null}
                    <button
                      disabled={busy !== null}
                      onClick={() => void approve(approved === null)}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                        approved ? c.btnSecondary : c.btnSuccess
                      }`}
                    >
                      {approved
                        ? <><Unlock size={14} className="inline mr-1.5 -mt-0.5" />Withdraw sign-off</>
                        : <><Check size={14} className="inline mr-1.5 -mt-0.5" />{busy === "approve" ? "Signing off…" : "Sign this off"}</>}
                    </button>
                  </div>

                  {locked ? (
                    <p className="text-xs flex items-center gap-1.5 text-primary">
                      <Lock size={12} className="shrink-0" />
                      Signed off — rewriting and undo are off for this file. Checking still works;
                      it changes nothing.
                    </p>
                  ) : null}

                  {current?.audit?.checked ? (
                    <p className={`text-xs ${c.muted}`}>
                      Last checked {new Date(current.audit.checked).toLocaleString()}
                      {typeof current.audit.findings === "number"
                        ? ` · ${current.audit.findings} findings`
                        : ""}
                      {current.audit.rewritten
                        ? ` · rewritten ${new Date(current.audit.rewritten).toLocaleString()}`
                        : ""}
                    </p>
                  ) : null}

                  {/*
                    * What the three of them actually do. The difference between
                    * the last two was written down once, in a comment in
                    * `api/audit.ts`, where nobody using this could read it.
                    */}
                  <p className={`text-xs ${c.muted}`}>
                    Checking reports and changes nothing. Rewriting acts on everything
                    it finds; removing AI phrasing acts only on prose that reads
                    machine-made and leaves a plot hole reported but untouched. Both
                    keep a copy of the file as it stands before they start.
                  </p>
                </div>
              )}
            </section>

            {/*
              * One findings list, not two.
              *
              * There were two, in the same card, with the same divider, chip and
              * arrow, one holding this run's findings for one file and the other
              * the project's findings on record — and nothing but a heading to
              * tell them apart once you had scrolled past it.
              */}
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <h3 className="font-serif text-xl">Findings</h3>
                <div className={`flex rounded-lg border ${c.cardStatic} p-0.5 text-xs`}>
                  <button
                    onClick={() => setScope("project")}
                    aria-pressed={scope === "project"}
                    className={`px-2.5 py-1 rounded-md ${scope === "project" ? SELECTED : c.muted}`}
                  >
                    {detail.title} ({detail.findings.length})
                  </button>
                  <button
                    onClick={() => setScope("file")}
                    disabled={!audit}
                    aria-pressed={scope === "file"}
                    className={`px-2.5 py-1 rounded-md disabled:opacity-40 ${scope === "file" ? SELECTED : c.muted}`}
                  >
                    {audit ? `Last check (${audit.findings.length})` : "Last check"}
                  </button>
                </div>
              </div>

              {shown.length === 0 ? (
                <p className={`text-sm ${scope === "file" ? "text-success" : c.muted}`}>
                  {scope === "file"
                    ? `Nothing to fix in ${file?.name ?? "this file"}.`
                    : "Nothing on record for this project."}
                </p>
              ) : (
                <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide}`}>
                  {shown.map((f, i) => (
                    <div key={`${f.category}-${i}`} className="p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${c.code}`}>{f.category}</span>
                        <span className={`text-xs ${SEVERITY_TONE[f.severity] ?? c.muted}`}>{f.severity}</span>
                        {f.page !== null ? <span className={`text-xs ${c.muted}`}>p{f.page}</span> : null}
                      </div>
                      <p className="mt-1.5">{f.description}</p>
                      {f.suggestion ? <p className={`mt-1 text-xs ${c.muted}`}>→ {f.suggestion}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* -------------------------------------------------------- the edit */}
      {showEditor && (
        <aside className="w-[26rem] shrink-0 h-full overflow-y-auto pr-1 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-serif text-xl">Edit</h3>
            <button
              disabled={!file || !dirty || loadFailed || locked || busy !== null}
              onClick={() => void save()}
              className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
            >
              <Save size={14} className="inline mr-1.5 -mt-0.5" />
              {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>

          {!file ? (
            <p className={`text-sm ${c.muted}`}>Pick a file to edit it here.</p>
          ) : loadingText ? (
            <Spinner label="Opening the file" />
          ) : loadFailed ? (
            <div className={`border rounded-lg p-4 text-sm space-y-2 ${c.error}`}>
              <p>This file would not open, so there is nothing here to edit.</p>
              <button
                onClick={() => void openFile(file)}
                className={`px-2.5 py-1 text-xs rounded-lg ${c.btnSecondary}`}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <p className={`text-xs truncate ${c.muted}`}>{file.name}</p>

              {/*
                * A signed-off file is not typed into by accident.
                *
                * "Approved" meant nothing to the editor before: the textarea
                * was as writable as any other, so the sign-off was a note to
                * self rather than a state of the work. Reopening is one click
                * and a confirmation, and it lasts only as long as this visit.
                */}
              {approved ? (
                <div className={`border rounded-lg p-3 text-xs space-y-2 ${locked ? c.info : c.error}`}>
                  <p className="flex items-center gap-1.5">
                    {locked ? <Lock size={12} /> : <Unlock size={12} />}
                    {locked
                      ? `Signed off ${new Date(approved.at).toLocaleString()}${approved.by ? ` by ${approved.by}` : ""}. Read-only.`
                      : `Reopened. This file was signed off ${new Date(approved.at).toLocaleString()} — saving replaces the approved text.`}
                  </p>
                  {locked ? (
                    <button
                      onClick={() => setPending({
                        act: () => setUnlocked((set) => new Set(set).add(file.path)),
                        title: "Reopen an approved file?",
                        message: `${file.name} was signed off ${new Date(approved.at).toLocaleString()}${approved.by ? ` by ${approved.by}` : ""}. Editing it replaces the text that was approved.`,
                        confirmLabel: "Reopen for editing",
                        cancelLabel: "Leave it closed",
                      })}
                      className={`px-2.5 py-1 rounded-lg ${c.btnSecondary}`}
                    >
                      Reopen for editing
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/*
                * Proof the rewrite is landing here.
                *
                * The pass has streamed each finished section into this panel
                * since it was written, and nothing said so — the text just
                * differed at some point, which reads as a reload rather than as
                * work arriving.
                */}
              {/*
                * The rewrite as it arrives.
                *
                * The pass has streamed the whole document into the textarea
                * after every section since it was written, and nothing about
                * that is watchable: two identical-looking swaps, minutes apart,
                * with the changed sentences wherever they happen to be in a
                * scrolled box. A section landing is an event; this says so.
                */}
              {runBusy || sections.length > 0 ? (
                <div
                  role="status"
                  aria-live="polite"
                  className={`border rounded-lg p-3 text-xs space-y-2 ${c.cardStatic}`}
                >
                  <p className="flex items-center gap-1.5 font-medium">
                    {runBusy ? <Loader2 size={12} className="animate-spin text-primary" /> : <Check size={12} className="text-success" />}
                    {runBusy
                      ? busy === "report" ? "Checking — nothing is being rewritten" : "Rewriting, section by section"
                      : `${sections.length} section${sections.length === 1 ? "" : "s"} rewritten`}
                  </p>
                  {sections.length > 0 ? (
                    <ul className="space-y-1">
                      {sections.map((heading, i) => (
                        <li key={`${heading}-${i}`} className="flex items-start gap-1.5">
                          <Check size={11} className="text-success shrink-0 mt-0.5" />
                          <span className="min-w-0 break-words">{heading}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={c.muted}>
                      {busy === "report"
                        ? "A report pass never changes the text, so nothing will land here."
                        : "Nothing has landed yet — the first section takes the longest."}
                    </p>
                  )}
                  {streamed ? (
                    <p className={c.muted}>
                      The text beside this was replaced {streamed.count === 1 ? "once" : `${streamed.count} times`}.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {progress ? (
                <p role="status" aria-live="polite" className="text-xs text-warning flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />{progress}
                </p>
              ) : null}
              {/*
                * Prose, not configuration. This is where a novelist reads what
                * the model just rewrote, and it was 12px monospace with the
                * spellchecker off and no way to save from the keyboard.
                */}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                    e.preventDefault();
                    if (dirty && busy === null) void save();
                  }
                }}
                spellCheck
                readOnly={locked}
                aria-label={file ? `Edit ${file.name}` : "Edit the selected file"}
                className={`w-full h-[36rem] px-3 py-2 text-sm leading-7 rounded resize-y ${c.input} ${
                  locked ? "opacity-70 cursor-not-allowed" : ""
                }`}
              />
              <p className={`text-xs ${c.muted}`}>
                {text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString()} words` : "empty"}
                {dirty ? " · unsaved — Ctrl+S to save" : " · saved"}
              </p>
            </>
          )}
        </aside>
      )}

      <ConfirmDialog
        open={pending !== null}
        variant="danger"
        title={pending?.title ?? ""}
        message={pending?.message ?? ""}
        confirmLabel={pending?.confirmLabel ?? "Continue"}
        cancelLabel={pending?.cancelLabel ?? "Cancel"}
        onConfirm={() => { const held = pending; setPending(null); held?.act(); }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

/**
 * How far one file has got, in the width of three characters.
 *
 * Checked, rewritten, signed off — the three facts the tree had no room for
 * and no way to know, so every row looked like every other row.
 */
function FileMarks({ item, c }: { item: Item; c: Record<string, string> }) {
  const a = item.audit;
  if (!a?.checked && !a?.rewritten && !a?.approved) return null;
  const said = [
    a.checked ? `checked ${new Date(a.checked).toLocaleDateString()}` : "",
    a.rewritten ? "rewritten" : "",
    a.approved ? "signed off" : "",
  ].filter(Boolean).join(" · ");
  return (
    <span className="shrink-0 flex items-center gap-0.5" title={said} aria-label={said}>
      {a.approved
        ? <Lock size={10} className="text-primary" />
        : a.checked ? <Check size={10} className="text-success" /> : null}
      {a.rewritten ? <RotateCcw size={10} className="text-warning" /> : null}
      {!a.approved && !a.checked ? <span className={`text-[10px] ${c.muted}`}>·</span> : null}
    </span>
  );
}

/**
 * A spinner that says what it is waiting for.
 *
 * Five bare `Loader2`s on this page announced nothing at all, on a screen whose
 * slowest operations are the ones worth announcing.
 */
function Spinner({
  label, size = 18, className = "",
}: { label: string; size?: number; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center ${className}`}>
      <Loader2 size={size} className="animate-spin text-primary" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * One approval. Lifted from PublicationDetail's GateCard rather than imported,
 * because that one is not exported and this file should not be the reason it
 * becomes part of that screen's public surface.
 */
function Gate({
  c, title, approved, notes, notesLabel, approvedLabel, canApprove, busy, onToggle,
}: {
  c: Record<string, string>;
  title: string;
  approved: Approval | null;
  notes: readonly string[];
  notesLabel: string;
  approvedLabel: string;
  canApprove: boolean;
  busy: boolean;
  onToggle: (approve: boolean) => void;
}) {
  return (
    <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-lg">{title}</h3>
        <span className={`text-xs text-right ${approved ? "text-success" : c.muted}`}>
          {approved ? (
            <>
              approved {new Date(approved.at).toLocaleString()}
              {/* Who signed this off was carried in the type and rendered
                  nowhere, which made an approval unattributable. */}
              {approved.by ? <span className={`block ${c.muted}`}>by {approved.by}</span> : null}
            </>
          ) : "not approved"}
        </span>
      </div>

      {/*
        * Warnings stay after the sign-off.
        *
        * Copy can be approved over its warnings on purpose — that is what
        * `canApprove` being true regardless is for. Hiding them the instant
        * someone does destroys the record of what they chose to overrule.
        */}
      {notes.length > 0 ? (
        <div className={`text-xs ${c.muted} space-y-1`}>
          <p>{approved ? approvedLabel : notesLabel}</p>
          <ul className="list-disc pl-4">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      ) : null}

      <button
        disabled={busy || (!approved && !canApprove)}
        onClick={() => onToggle(!approved)}
        className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
          approved ? c.btnSecondary : c.btnSuccess
        }`}
      >
        {approved
          ? <><X size={14} className="inline mr-1.5 -mt-0.5" />Withdraw</>
          : <><Check size={14} className="inline mr-1.5 -mt-0.5" />{busy ? "Approving…" : `Approve ${title.toLowerCase()}`}</>}
      </button>
    </div>
  );
}
