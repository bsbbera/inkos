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
import { useResizable } from "../hooks/use-resizable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import { useNewSSEMessages, type SSEMessage } from "../hooks/use-sse";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Image as ImageIcon,
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
 * These were `text-success`, `text-warning` and `text-destructive` — raw
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

/** A stage name, sentence case. An unmapped stage arrived as `fact-check`. */
const stageName = (stage: string) => {
  const said = say(STAGE_LABEL, stage);
  return said.charAt(0).toUpperCase() + said.slice(1);
};

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

/** A file name as a title, for the flatplan tile — `04-inside-this-issue.md`
 *  reads as "Inside this issue". */
function titleOf(name: string): string {
  const bare = name.replace(/\.[^.]+$/, "").replace(/^\d+[-_]/, "").replace(/[-_]+/g, " ").trim();
  return bare ? bare[0].toUpperCase() + bare.slice(1) : name;
}

/** Which of the flatplan's four states a file is in, for its bottom edge. */
function pgStateOf(item: Item): "checked" | "rewritten" | "signed" | "" {
  const a = item.audit;
  if (a?.approved) return "signed";
  if (a?.rewritten) return "rewritten";
  if (a?.checked) return "checked";
  return "";
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

  // Purely how the screen presents itself — none of these three touch a
  // route or a handler, so they default to whatever reads best and are free
  // to add without risking the logic above.
  const [fileView, setFileView] = useState<"tiles" | "list">("tiles");
  const [textSize, setTextSize] = useState<"sm" | "md" | "lg">("md");
  const [wide, setWide] = useState(false);
  /** Severity, as a filter. Empty means every severity, which is the default. */
  const [sevs, setSevs] = useState<ReadonlySet<string>>(new Set());

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

  // Both columns were fixed widths. The runtime patch used to grip every
  // <aside> on the page, so these two were draggable and stopped being so when
  // that patch was replaced by a hook wired to the two chat sidebars only.
  const nav = useResizable({ key: "quire-audit-nav", initial: 256, min: 200, max: 420, side: "end" });
  const editor = useResizable({ key: "quire-audit-editor", initial: 416, min: 320, max: 900, side: "start" });

  const sevOf = (s: string) =>
    s === "blocking" ? "blocking" : s === "warning" ? "warning" : "info";
  const counts = {
    blocking: shown.filter((f) => sevOf(f.severity) === "blocking").length,
    warning: shown.filter((f) => sevOf(f.severity) === "warning").length,
    info: shown.filter((f) => sevOf(f.severity) === "info").length,
  };
  const listed = sevs.size === 0 ? shown : shown.filter((f) => sevs.has(sevOf(f.severity)));
  const toggleSev = (s: string) =>
    setSevs((prev) => {
      const next = new Set(prev);
      if (!next.delete(s)) next.add(s);
      return next;
    });

  const doneStages = detail?.stages.filter(
    (s) => s.state === "done" || s.state === "complete",
  ).length ?? 0;

  return (
    <div className="aud flex-1 min-w-0 flex h-full min-h-0">
      {/* ═════════════════════════════════════════════════════ the tree ══ */}
      <nav
        className="aud-tree shrink-0 h-full overflow-y-auto"
        style={{ width: nav.width }}
        aria-label="Everything finished"
      >
        <div
          {...nav.gripProps}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the page list"
          className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize touch-none transition-colors hover:bg-primary/40 active:bg-primary"
        />

        <div className="tree-head">
          <span className="ring" aria-hidden="true"><ShieldCheck size={16} /></span>
          <h1>Audit</h1>
        </div>

        {loading ? (
          <Spinner label="Loading your work" />
        ) : error && groups.length === 0 ? (
          // Error and empty used to render together: a red box saying something
          // broke, beside a cheerful note saying you have finished nothing.
          <p className="quiet">Could not read your work — see the message beside this.</p>
        ) : groups.length === 0 ? (
          <p className="quiet">Nothing finished yet.</p>
        ) : (
          <div ref={treeRef} onKeyDown={onTreeKey}>
            {groups.map((g) => {
              const shut = shutKinds[g.kind] === true;
              return (
                <div className="grp" data-shut={shut ? "true" : "false"} key={g.kind}>
                  <button
                    data-row
                    aria-expanded={!shut}
                    onClick={() => setShutKinds((p) => ({ ...p, [g.kind]: !shut }))}
                  >
                    <ChevronDown className="chev" size={12} />
                    <span>{g.label}</span>
                    <span className="n mono">{g.rows.length}</span>
                  </button>

                  {shut ? null : (
                    <div className="kids">
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
                              className="proj"
                              aria-expanded={open}
                              aria-current={on ? "true" : "false"}
                              onClick={() => guarded(() => void openProject(p.kind, p.id))}
                              title={p.id}
                            >
                              {open
                                ? <ChevronDown className="chev" size={12} />
                                : <ChevronRight className="chev" size={12} />}
                              <span className="t">{p.id}</span>
                              <span className="n mono">{p.files}</span>
                            </button>

                            {/* The files live here rather than in a section of
                                their own beside the project. One navigator. */}
                            {open ? (
                              detail ? (
                                <>
                                  <div className="view" role="group" aria-label="How to show the pages">
                                    <button
                                      type="button"
                                      onClick={() => setFileView("tiles")}
                                      aria-pressed={fileView === "tiles"}
                                    >
                                      Flatplan
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setFileView("list")}
                                      aria-pressed={fileView === "list"}
                                    >
                                      List
                                    </button>
                                  </div>

                                  {fileView === "tiles" ? (
                                    <>
                                      <div className="plan">
                                        {detail.items.map((item) => {
                                          const n = pageNumberOf(item.name);
                                          return (
                                            <button
                                              key={item.path}
                                              type="button"
                                              className="pg"
                                              data-s={pgStateOf(item)}
                                              aria-current={file?.path === item.path ? "true" : "false"}
                                              onClick={() => guarded(() => void openFile(item))}
                                              title={`${item.name}${folderOf(item.path) ? ` · ${folderOf(item.path)}` : ""}`}
                                            >
                                              <span className="no">
                                                {n !== null ? String(n).padStart(2, "0") : "—"}
                                              </span>
                                              <span className="sl">{titleOf(item.name)}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                      <div className="plan-key">
                                        <span><i style={{ background: "var(--ok)" }} />checked</span>
                                        <span><i style={{ background: "var(--warn)" }} />rewritten</span>
                                        <span><i style={{ background: "var(--vermilion)" }} />signed off</span>
                                        <span><i style={{ background: "var(--line-soft)" }} />waiting</span>
                                      </div>
                                    </>
                                  ) : (
                                    <div>
                                      {detail.items.map((item) => (
                                        <button
                                          key={item.path}
                                          data-row
                                          className="file"
                                          aria-current={file?.path === item.path ? "true" : "false"}
                                          onClick={() => guarded(() => void openFile(item))}
                                          title={item.path}
                                        >
                                          {/*
                                            * Where each file has got to.
                                            *
                                            * Twenty-two rows that looked identical
                                            * whether they had been checked, rewritten
                                            * and signed off or never opened — so the
                                            * only record of how far you were through a
                                            * project was your own memory of it.
                                            */}
                                          <span className="fn">
                                            <span className={`dot dot-${pgStateOf(item) || "waiting"}`} />
                                            {item.name}
                                          </span>
                                          {/* Which folder it came from. Without this,
                                              final/chapters/0001.md and outline/0001.md
                                              are the same row printed twice. */}
                                          <span className="fp mono">{folderOf(item.path) || detail.id}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </>
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
      </nav>

      {/* ═════════════════════════════════════════════════════ the work ══ */}
      <main className="aud-work flex-1 min-w-0 h-full overflow-y-auto">
        <div className="topbar">
          <span className="sp" />
          <button
            type="button"
            className="btn btn-line btn-sm"
            onClick={() => setShowEditor((v) => !v)}
            aria-label={showEditor ? "Hide the editor" : "Show the editor"}
          >
            {showEditor ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            <span>{showEditor ? "Hide manuscript" : "Show manuscript"}</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="alarm">
            <AlertTriangle size={18} className="ico" />
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
                    className="btn btn-line btn-sm"
                    onClick={() => { const again = retry.act; clearError(); again(); }}
                  >
                    Try again
                  </button>
                ) : null}
                <button className="btn btn-quiet btn-sm" onClick={clearError}>Dismiss</button>
              </div>
            </div>
          </div>
        )}

        {!picked ? (
          <p className="quiet">
            Pick something on the left. Everything this app has finished is there,
            filed under what made it.
          </p>
        ) : !detail ? (
          <Spinner label="Loading this project" size={20} />
        ) : (
          <>
            {/* ── 1. Readiness ──────────────────────────────────────────
                One block answering the page's actual question, instead of a
                12px tally line, two approval boxes and a red banner that each
                held a third of the answer. */}
            <section className="ready" aria-labelledby="ready-h">
              <div className="ready-top">
                <div className="anchor">
                  <p className="frac">
                    <b>{tally.approved}</b><i>/</i><span className="of">{tally.total}</span>
                  </p>
                  <p className="lb">files signed off</p>
                  {detail.gates ? (
                    <p className="why">Copy cannot be approved until every file carries one.</p>
                  ) : null}
                </div>

                <div className="ready-id">
                  <h2 id="ready-h">{detail.title}</h2>
                  <p className="sub mono">{detail.subtitle}</p>

                  <div className="tally">
                    <div><b className="tnum">{tally.total}</b><span>files</span></div>
                    <div className={tally.checked ? "is-ok" : "is-idle"}>
                      <b className="tnum">{tally.checked}</b><span>checked</span>
                    </div>
                    <div className={tally.rewritten ? "is-warn" : "is-idle"}>
                      <b className="tnum">{tally.rewritten}</b><span>rewritten</span>
                    </div>
                    <div className={tally.approved ? "is-acc" : "is-idle"}>
                      <b className="tnum">{tally.approved}</b><span>signed off</span>
                    </div>
                    <div className="is-idle">
                      <b className="tnum">{tally.total - tally.approved}</b><span>waiting</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Copy and Design are not independent checkboxes; they are what
                  Build is waiting on, so the chain draws that link rather than
                  leaving it to a red banner underneath. */}
              {detail.gates ? (
                <div className="chain">
                  <Gate
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
                    title="Design"
                    approved={detail.gates.design.approved}
                    notes={detail.gates.design.blockers}
                    notesLabel="The design cannot be approved until:"
                    approvedLabel="Signed off with these still open:"
                    canApprove={detail.gates.design.canApprove}
                    busy={busy === "design"}
                    onToggle={(yes) => void publication("design", "Approving", "/approve", { what: "design", approve: yes })}
                  />
                  <div className="gate is-final">
                    <h3>Build</h3>
                    <div className="st">
                      <span className={`pill ${detail.gates.build.canBuild ? "pill-ok" : "pill-bad"}`}>
                        {detail.gates.build.canBuild
                          ? <><Check size={11} />Open</>
                          : <><Lock size={11} />Held</>}
                      </span>
                    </div>
                    {detail.gates.build.canBuild ? null : (
                      <ul className="blockers">
                        {detail.gates.build.blockers.map((b) => <li key={b}>{b}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            {/*
              * Everything this page says about work in progress, in one place a
              * screen reader is watching. There was no live region anywhere on
              * this screen, so a pass that took four minutes announced its
              * start, its progress, its finish and its failure to nobody.
              *
              * Sticky, because this column scrolls and a pass that runs for
              * minutes reported itself at the top of it — so the moment the
              * reader scrolled to the findings, the only proof the pass was
              * alive scrolled away with it.
              */}
            <div
              role="status"
              aria-live="polite"
              className="sticky top-0 z-20 space-y-2 empty:hidden"
              style={{ background: "color-mix(in oklab, var(--putty) 88%, transparent)" }}
            >
              {inflight ? (
                <div className="arrive">
                  <p className="hd">
                    <Loader2 size={13} className="animate-spin" style={{ color: "var(--vermilion)" }} />
                    <span className="flex-1 min-w-0 truncate">{progress ?? `${inflight.label}…`}</span>
                    <span className="mono" style={{ color: "var(--ink-3)" }}>{elapsed(inflight.at)}</span>
                    {runBusy ? (
                      <button className="btn btn-line btn-sm" onClick={() => void cancel()}>
                        <Square size={10} fill="currentColor" />Stop
                      </button>
                    ) : null}
                  </p>
                </div>
              ) : null}
              {note ? <p className="quiet" style={{ color: "var(--ok)" }}>{note}</p> : null}
              {image ? (
                // A render produced a picture and the reward for it was the path
                // it was written to, in green text.
                <img
                  src={image}
                  alt="The spread that was just rendered"
                  style={{ maxHeight: 260, borderRadius: "var(--r-card)", border: "1px solid var(--line)" }}
                />
              ) : null}
            </div>

            {/* ── 2. The run ────────────────────────────────────────────
                Seven stages were a three-column text table where the only
                thing separating "finished" from "not started" was the word.
                A run is a line; this draws the line. */}
            {detail.stages.length > 0 || detail.gates ? (
              <section className="run" aria-labelledby="run-h">
                <div className="run-head">
                  <h3 id="run-h">The run</h3>
                  {detail.stages.length > 0 ? (
                    <span className="label">{doneStages} of {detail.stages.length} finished</span>
                  ) : null}
                </div>

                {detail.stages.length > 0 ? (
                  <div className="track">
                    {detail.stages.map((s) => {
                      const tone = s.state === "running" ? "now"
                        : s.state === "failed" || s.state === "error" ? "bad"
                          : (s.state === "done" || s.state === "complete") ? "done" : "idle";
                      return (
                        <div key={s.stage} className={`stage ${tone}`}>
                          <span className="node" />
                          <span className="nm">{stageName(s.stage)}</span>
                          {/* The failure reason, when there is one, is the one
                              string anyone reading this wants. */}
                          <span className="dt" title={s.detail}>
                            {say(STATE_LABEL, s.state)}{s.detail ? ` · ${s.detail}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* The pictures and the document. Both are stages of the run
                    already, reached through `/resume` with a one-stage range,
                    so this is the same path the publication screen takes. */}
                {detail.gates ? (
                  <div className="make">
                    <button
                      className="btn"
                      disabled={running}
                      onClick={() => void publication("art", "Drawing", "/resume", { from: "art", stopAt: "art" })}
                    >
                      <ImageIcon size={14} />
                      {busy === "art" ? "Drawing…" : "Generate images"}
                    </button>
                    <button
                      className="btn btn-line"
                      disabled={running || page === null}
                      onClick={() => void publication("render", "Rendering", "/render", { page })}
                      title={page === null ? "Pick a numbered page on the left first" : `Render page ${page}`}
                    >
                      {busy === "render" ? "Rendering…" : `Render spread${page ? ` — p${page}` : ""}`}
                    </button>
                    <button
                      className="btn btn-line"
                      disabled={running || !detail.gates.build.canBuild}
                      onClick={() => void publication("build", "Building", "/resume", { from: "build", stopAt: "build" })}
                      title={detail.gates.build.canBuild ? "Build the PDF" : detail.gates.build.blockers.join("; ")}
                    >
                      <Play size={14} />
                      {busy === "build" ? "Building…" : "Build document"}
                    </button>
                    <p className="hint">
                      Building needs both gates open. Rendering a spread needs a numbered page
                      picked on the left.
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* ── 3. The bench ──────────────────────────────────────────
                The one dark surface on the page, because the picked file is
                the one thing being worked on. Safe and destructive actions are
                separated by a rule, and each group says what it does to disk. */}
            {!file ? (
              <p className="quiet">Pick a file on the left to check it.</p>
            ) : (
              <section className="bench" aria-labelledby="bench-h">
                <span
                  className="disc disc-fill"
                  aria-hidden="true"
                  style={{ width: 240, height: 240, right: -96, top: -118 }}
                />
                <span
                  className="disc disc-dots"
                  aria-hidden="true"
                  style={{ width: 96, height: 96, right: 34, bottom: -42, opacity: 0.3 }}
                />

                <div className="bench-head">
                  <div style={{ minWidth: 0 }}>
                    <h3 id="bench-h">{file.name}</h3>
                    <p className="path mono" title={file.path}>
                      {folderOf(file.path) || detail.id}
                      {current?.words ? ` · ${current.words.toLocaleString()} words` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className={`pill ${current?.audit?.checked ? "pill-ok" : ""}`}>
                      {current?.audit?.checked ? "Checked" : "Not checked"}
                    </span>
                    <span className={`pill ${approved ? "pill-ok" : ""}`}>
                      {approved ? "Signed off" : "Not signed off"}
                    </span>
                  </div>
                </div>

                <div className="acts">
                  <div className="act-grp">
                    <p className="label">Reports only · nothing on disk changes</p>
                    <div className="act-row">
                      <button
                        className={`btn${ran?.mode === "report" ? " btn-line" : ""}`}
                        disabled={runBusy || loadFailed}
                        onClick={() => guarded(() => void run("report"))}
                      >
                        {busy === "report"
                          ? "Checking…"
                          : ran?.mode === "report"
                            ? <><Check size={14} />Checked</>
                            : "Check it"}
                      </button>
                      <button
                        className={`btn ${approved ? "btn-line" : "btn-ok"}`}
                        disabled={busy !== null}
                        onClick={() => void approve(approved === null)}
                      >
                        {approved
                          ? <><Unlock size={14} />Withdraw sign-off</>
                          : <><Check size={14} />{busy === "approve" ? "Signing off…" : "Sign this off"}</>}
                      </button>
                    </div>
                  </div>

                  {/*
                    * These two write over the manuscript on disk, and they were
                    * the quiet secondary buttons while the harmless action above
                    * was the loud primary one. A ruled-off group with its own
                    * label fixes both the emphasis and the honesty.
                    */}
                  <div className="act-grp danger">
                    <p className="label">Rewrites the file · a copy is kept first</p>
                    <div className="act-row">
                      <button
                        className={`btn ${ran?.mode === "revise" ? "btn-line" : "btn-danger"}`}
                        disabled={runBusy || loadFailed || locked}
                        title={locked ? "This file is signed off. Withdraw the sign-off to rewrite it." : undefined}
                        onClick={() => guarded(() => void run("revise"), rewriteAsk("revise"))}
                      >
                        {busy === "revise"
                          ? "Rewriting…"
                          : ran?.mode === "revise"
                            ? <><Check size={14} />Rewritten</>
                            : "Check and rewrite"}
                      </button>
                      <button
                        className={`btn ${ran?.mode === "deslop" ? "btn-line" : "btn-danger"}`}
                        disabled={runBusy || loadFailed || locked}
                        title={locked ? "This file is signed off. Withdraw the sign-off to rewrite it." : undefined}
                        onClick={() => guarded(() => void run("deslop"), rewriteAsk("deslop"))}
                      >
                        {busy === "deslop"
                          ? "Rewriting…"
                          : ran?.mode === "deslop"
                            ? <><Check size={14} />Cleaned</>
                            : "Remove AI phrasing"}
                      </button>
                      {current?.backup ? (
                        <button
                          className="btn btn-line"
                          disabled={busy !== null || locked}
                          onClick={() => void restore()}
                          title={locked
                            ? "This file is signed off. Withdraw the sign-off to put an older copy back."
                            : "Put back the text from before the last rewrite"}
                        >
                          <RotateCcw size={13} />
                          {busy === "restore" ? "Putting it back…" : "Undo the rewrite"}
                        </button>
                      ) : null}
                    </div>
                    {/*
                      * What the two of them actually do. The difference was
                      * written down once, in a comment in `api/audit.ts`, where
                      * nobody using this could read it.
                      */}
                    <p className="small">
                      Rewriting acts on everything it finds. Removing AI phrasing acts only on prose
                      that reads machine-made and leaves a plot hole reported but untouched. Both
                      keep a copy of the file as it stands before they start.
                    </p>
                  </div>
                </div>

                {locked ? (
                  <p className="note lock">
                    <Lock size={12} />
                    Signed off — rewriting and undo are off for this file. Checking still works;
                    it changes nothing.
                  </p>
                ) : null}

                {current?.audit?.checked ? (
                  <p className="note">
                    Last checked {new Date(current.audit.checked).toLocaleString()}
                    {typeof current.audit.findings === "number"
                      ? ` · ${current.audit.findings} findings`
                      : ""}
                    {current.audit.rewritten
                      ? ` · rewritten ${new Date(current.audit.rewritten).toLocaleString()}`
                      : ""}
                  </p>
                ) : null}
              </section>
            )}

            {/* ── 4. Findings ───────────────────────────────────────────
                One list, not two. There were two, in the same card, with the
                same divider, chip and arrow — one holding this run's findings
                for one file and the other the project's findings on record —
                and nothing but a heading to tell them apart once you had
                scrolled past it. */}
            <section className="find" aria-labelledby="find-h">
              <div className="find-head">
                <h3 id="find-h">Findings</h3>
                <div className="seg">
                  <button
                    onClick={() => setScope("project")}
                    aria-pressed={scope === "project"}
                  >
                    This issue <span className="mono">{detail.findings.length}</span>
                  </button>
                  <button
                    onClick={() => setScope("file")}
                    disabled={!audit}
                    aria-pressed={scope === "file"}
                  >
                    Last check <span className="mono">{audit ? audit.findings.length : 0}</span>
                  </button>
                </div>

                {/* Severity, as a filter rather than a legend: thirty-six
                    findings are read by triaging them, and the two that block
                    the issue are the two worth seeing alone. */}
                <div className="filters">
                  <button
                    className="pill pill-bad"
                    aria-pressed={sevs.has("blocking")}
                    onClick={() => toggleSev("blocking")}
                  >
                    Blocking <span className="mono">{counts.blocking}</span>
                  </button>
                  <button
                    className="pill pill-warn"
                    aria-pressed={sevs.has("warning")}
                    onClick={() => toggleSev("warning")}
                  >
                    Warning <span className="mono">{counts.warning}</span>
                  </button>
                  <button
                    className="pill"
                    aria-pressed={sevs.has("info")}
                    onClick={() => toggleSev("info")}
                  >
                    Info <span className="mono">{counts.info}</span>
                  </button>
                </div>
              </div>

              {listed.length === 0 ? (
                <p className="f-empty">
                  {shown.length > 0
                    ? "Nothing at that severity — the filters above are narrowing this list."
                    : scope === "file"
                      ? `Nothing to fix in ${file?.name ?? "this file"}.`
                      : "Nothing on record for this project."}
                </p>
              ) : (
                listed.map((f, i) => (
                  // A colour stripe down the row's edge is the category's
                  // default for severity; a marker in its own gutter reads as
                  // fast and keeps the left edge straight across thirty rows.
                  <div key={`${f.category}-${i}`} className={`f-row sev-${sevOf(f.severity)}`}>
                    <span className="f-mark" aria-hidden="true" />
                    <div className="f-meta">
                      <span className="sev-word">{f.severity}</span>
                      <span className="f-cat">{f.category}</span>
                      {f.page !== null ? <span className="f-pg">p{f.page}</span> : null}
                    </div>
                    <p>{f.description}</p>
                    {f.suggestion ? (
                      /* The fix is the useful half, so it is set apart by a
                         rule in the accent rather than by an arrow glyph. */
                      <p className="f-fix">{f.suggestion}</p>
                    ) : null}
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════ the editor ══ */}
      {showEditor && (
        <aside
          className="aud-edit shrink-0 h-full overflow-y-auto"
          style={{ width: editor.width }}
          aria-label="Read and edit this file"
        >
          <div
            {...editor.gripProps}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the reading panel"
            className="absolute left-0 top-0 z-20 h-full w-1 cursor-col-resize touch-none transition-colors hover:bg-primary/40 active:bg-primary"
          />

          <div className="edit-head">
            <h3>Manuscript</h3>
            <button
              className={`btn btn-sm${dirty ? "" : " btn-line"}`}
              disabled={!file || !dirty || loadFailed || locked || busy !== null}
              onClick={() => void save()}
            >
              <Save size={13} />
              {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>

          {!file ? (
            <p className="quiet">Pick a file to edit it here.</p>
          ) : loadingText ? (
            <Spinner label="Opening the file" />
          ) : loadFailed ? (
            <div className="alarm">
              <AlertTriangle size={16} className="ico" />
              <div className="space-y-2">
                <p>This file would not open, so there is nothing here to edit.</p>
                <button className="btn btn-line btn-sm" onClick={() => void openFile(file)}>
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="fname mono">{file.name}</p>

              {/* How the manuscript is set — three sizes and a measure, because
                  this panel is read for hours and a fixed size is somebody
                  else's eyesight. */}
              <div className="setting">
                <div className="steps" role="group" aria-label="Text size">
                  <button type="button" className="s1" aria-pressed={textSize === "sm"} aria-label="Small" onClick={() => setTextSize("sm")}>A</button>
                  <button type="button" className="s2" aria-pressed={textSize === "md"} aria-label="Medium" onClick={() => setTextSize("md")}>A</button>
                  <button type="button" className="s3" aria-pressed={textSize === "lg"} aria-label="Large" onClick={() => setTextSize("lg")}>A</button>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm wide"
                  aria-pressed={wide}
                  onClick={() => setWide((w) => !w)}
                >
                  {wide ? "Standard width" : "Full width"}
                </button>
              </div>

              {/*
                * A signed-off file is not typed into by accident.
                *
                * "Approved" meant nothing to the editor before: the textarea was
                * as writable as any other, so the sign-off was a note to self
                * rather than a state of the work. Reopening is one click and a
                * confirmation, and it lasts only as long as this visit.
                */}
              {approved ? (
                <div className={locked ? "arrive" : "alarm"}>
                  <p className="hd">
                    {locked ? <Lock size={12} /> : <Unlock size={12} />}
                    {locked
                      ? `Signed off ${new Date(approved.at).toLocaleString()}${approved.by ? ` by ${approved.by}` : ""}. Read-only.`
                      : `Reopened. This file was signed off ${new Date(approved.at).toLocaleString()} — saving replaces the approved text.`}
                  </p>
                  {locked ? (
                    <button
                      className="btn btn-line btn-sm"
                      onClick={() => setPending({
                        act: () => setUnlocked((set) => new Set(set).add(file.path)),
                        title: "Reopen an approved file?",
                        message: `${file.name} was signed off ${new Date(approved.at).toLocaleString()}${approved.by ? ` by ${approved.by}` : ""}. Editing it replaces the text that was approved.`,
                        confirmLabel: "Reopen for editing",
                        cancelLabel: "Leave it closed",
                      })}
                    >
                      Reopen for editing
                    </button>
                  ) : null}
                </div>
              ) : null}

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
                <div role="status" aria-live="polite" className="arrive">
                  <p className="hd">
                    {runBusy
                      ? <Loader2 size={12} className="animate-spin" style={{ color: "var(--vermilion)" }} />
                      : <Check size={12} style={{ color: "var(--ok)" }} />}
                    {runBusy
                      ? busy === "report" ? "Checking — nothing is being rewritten" : "Rewriting, section by section"
                      : `${sections.length} section${sections.length === 1 ? "" : "s"} rewritten`}
                  </p>
                  {sections.length > 0 ? (
                    <ul>
                      {sections.map((heading, i) => (
                        <li key={`${heading}-${i}`}>
                          <Check size={11} />
                          <span className="min-w-0 break-words">{heading}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      {busy === "report"
                        ? "A report pass never changes the text, so nothing will land here."
                        : "Nothing has landed yet — the first section takes the longest."}
                    </p>
                  )}
                  {streamed ? (
                    <p>
                      The text beside this was replaced {streamed.count === 1 ? "once" : `${streamed.count} times`}.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/*
                * Prose, not configuration. This is where a novelist reads what
                * the model just rewrote, and it was 12px monospace with the
                * spellchecker off and no way to save from the keyboard.
                */}
              <div
                className="sheet"
                data-wide={wide ? "true" : "false"}
                style={{
                  "--size": textSize === "sm" ? "13.5px" : textSize === "lg" ? "17.5px" : "15px",
                  "--lead": textSize === "lg" ? "1.7" : "1.76",
                } as unknown as React.CSSProperties}
              >
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
                aria-label={`Edit ${file.name}`}
              />
              </div>

              <div className="foot">
                <span className="mono">
                  {text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString()} words` : "empty"}
                  {page !== null ? ` · p${page}` : ""}
                </span>
                <span className="dirty mono" data-unsaved={dirty ? "true" : "false"}>
                  {dirty ? "unsaved — Ctrl+S" : "saved"}
                </span>
              </div>
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
      <Loader2 size={size} className="animate-spin" style={{ color: "var(--vermilion)" }} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * One approval, as a link in the chain rather than a card of its own.
 *
 * Lifted from PublicationDetail's GateCard rather than imported, because that
 * one is not exported and this file should not be the reason it becomes part
 * of that screen's public surface.
 */
function Gate({
  title, approved, notes, notesLabel, approvedLabel, canApprove, busy, onToggle,
}: {
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
    <div className={`gate${approved ? " is-open" : ""}`}>
      <h3>{title}</h3>
      <div className="st">
        <span className={`pill ${approved ? "pill-ok" : "pill-warn"}`}>
          {approved ? "Approved" : "Not approved"}
        </span>
        <button
          className={`btn btn-sm ${approved ? "btn-line" : "btn-ok"}`}
          style={{ marginLeft: "auto" }}
          disabled={busy || (!approved && !canApprove)}
          onClick={() => onToggle(!approved)}
        >
          {approved
            ? <><X size={13} />Withdraw</>
            : <><Check size={13} />{busy ? "Approving…" : "Approve"}</>}
        </button>
      </div>

      {approved ? (
        <p className="when">
          {new Date(approved.at).toLocaleString()}
          {/* Who signed this off was carried in the type and rendered nowhere,
              which made an approval unattributable. */}
          {approved.by ? ` · by ${approved.by}` : ""}
        </p>
      ) : null}

      {/*
        * Warnings stay after the sign-off.
        *
        * Copy can be approved over its warnings on purpose — that is what
        * `canApprove` being true regardless is for. Hiding them the instant
        * someone does destroys the record of what they chose to overrule.
        */}
      {notes.length > 0 ? (
        <>
          <p className="when">{approved ? approvedLabel : notesLabel}</p>
          <ul className="blockers">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      ) : null}
    </div>
  );
}
