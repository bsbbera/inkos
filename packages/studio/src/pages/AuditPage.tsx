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
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, FileText, Image as ImageIcon,
  Loader2, PanelRightClose, PanelRightOpen, Play, Save, ShieldCheck, X,
} from "lucide-react";

interface Project {
  readonly kind: string;
  readonly kindLabel: string;
  readonly id: string;
  readonly files: number;
  readonly words: number;
  readonly modified: string;
}

interface Item {
  readonly path: string;
  readonly name: string;
  readonly words: number;
  readonly modified: string;
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

const STATE_TONE: Record<string, string> = {
  done: "text-emerald-500",
  complete: "text-emerald-500",
  partial: "text-amber-500",
  "needs-review": "text-amber-500",
  failed: "text-red-500",
};

const SEVERITY_TONE: Record<string, string> = {
  warning: "text-amber-500",
  blocking: "text-red-500",
};

const SELECTED = "bg-primary/10 text-primary";

const artifact = (path: string) =>
  `/api/v1/project/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;

/** The page number a publication file carries in its name, for a spread render. */
function pageNumberOf(name: string): number | null {
  const m = /^(\d+)[-_]/.exec(name);
  return m ? Number(m[1]) : null;
}

export function AuditPage({
  theme, sse,
}: { theme: Theme; sse: { messages: ReadonlyArray<SSEMessage> } }) {
  const c = useColors(theme);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Everything folds. `false` is the default for a kind, `true` for a project,
  // so the tree opens showing what you have rather than every file you own.
  const [shutKinds, setShutKinds] = useState<Record<string, boolean>>({});
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [showEditor, setShowEditor] = useState(true);

  const [picked, setPicked] = useState<{ kind: string; id: string } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [file, setFile] = useState<Item | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loadingText, setLoadingText] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // The live rewrite writes into the editor, so it must not land on top of
  // something the user typed and has not saved. `dirty` is derived, so the
  // listener reads it through a ref rather than re-subscribing on every keystroke.
  const stateRef = useRef({ path: "", dirty: false });
  stateRef.current = { path: file?.path ?? "", dirty: text !== saved };

  useNewSSEMessages(sse.messages, useCallback((message: SSEMessage) => {
    const data = message.data as {
      path?: string; message?: string; markdown?: string; state?: string;
    } | null;
    if (!data?.path || data.path !== stateRef.current.path) return;
    if (message.event === "audit:progress" && data.message) setProgress(data.message);
    if (message.event === "audit:run" && data.state !== "start") setProgress(null);
    if (message.event === "audit:text" && typeof data.markdown === "string" && !stateRef.current.dirty) {
      setText(data.markdown);
      setSaved(data.markdown);
    }
  }, []));

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/audit/projects");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setProjects(body.projects ?? []);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

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

  const loadProject = useCallback(async (kind: string, id: string) => {
    try {
      const res = await fetch(
        `/api/v1/audit/project/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setDetail(body);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, []);

  const openProject = useCallback(async (kind: string, id: string) => {
    const key = `${kind}/${id}`;
    const already = picked?.kind === kind && picked.id === id;
    setOpenProjects((p) => ({ ...p, [key]: already ? !p[key] : true }));
    if (already) return;
    setPicked({ kind, id });
    setDetail(null);
    setFile(null);
    setAudit(null);
    setText("");
    setSaved("");
    setError(null);
    setNote(null);
    await loadProject(kind, id);
  }, [loadProject, picked]);

  const openFile = useCallback(async (item: Item) => {
    setFile(item);
    setAudit(null);
    setLoadingText(true);
    setError(null);
    try {
      const res = await fetch(artifact(item.path));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setText(body.content ?? "");
      setSaved(body.content ?? "");
    } catch (e) {
      setError(String((e as Error).message));
      setText("");
      setSaved("");
    } finally {
      setLoadingText(false);
    }
  }, []);

  const save = async () => {
    if (!file) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(artifact(file.path), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSaved(text);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  /** Anything that runs against the publication as a whole, on its own routes. */
  const publication = async (key: string, path: string, body: unknown) => {
    if (!picked) return;
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(
        `/api/v1/publications/${encodeURIComponent(picked.id)}${path}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      if (out.image) setNote(`Rendered to ${out.image}`);
      await loadProject(picked.kind, picked.id);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  const run = async (mode: "report" | "revise" | "deslop") => {
    if (!file) return;
    setBusy(mode);
    setError(null);
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
      setAudit(body.audit ?? null);
      // A revise pass rewrites the file, so the editor beside it is now stale.
      if (mode !== "report") await openFile(file);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  const dirty = text !== saved;
  const page = file ? pageNumberOf(file.name) : null;

  return (
    <div className="flex gap-6 items-start">
      {/* ---------------------------------------------- kind, project, file */}
      <aside className="w-64 shrink-0 space-y-4">
        <h1 className="font-serif text-2xl flex items-center gap-2">
          <ShieldCheck size={20} className="text-primary" />Audit
        </h1>

        {loading ? (
          <Loader2 size={18} className="animate-spin text-primary" />
        ) : groups.length === 0 ? (
          <p className={`text-sm ${c.muted}`}>Nothing finished yet.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const shut = shutKinds[g.kind] === true;
              return (
                <div key={g.kind}>
                  <button
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
                        const open = openProjects[key] === true;
                        return (
                          <div key={p.id}>
                            <button
                              onClick={() => void openProject(p.kind, p.id)}
                              className={`w-full flex items-center gap-1 px-1.5 py-1.5 rounded text-sm ${
                                on ? SELECTED : c.tableHover
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
                            {open && on ? (
                              detail ? (
                                <div className="ml-3 pl-2 border-l border-border space-y-0.5 mt-0.5">
                                  {detail.items.map((item) => (
                                    <button
                                      key={item.path}
                                      onClick={() => void openFile(item)}
                                      className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs ${
                                        file?.path === item.path ? SELECTED : c.tableHover
                                      }`}
                                      title={item.path}
                                    >
                                      <FileText size={11} className="shrink-0 opacity-60" />
                                      <span className="flex-1 text-left truncate">{item.name}</span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <Loader2 size={12} className="animate-spin text-primary ml-5 my-1" />
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
      <div className="flex-1 min-w-0 space-y-6">
        {error && (
          <div className={`flex items-start gap-3 border rounded-lg p-4 text-sm ${c.error}`}>
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <p className="font-mono text-xs break-all">{error}</p>
          </div>
        )}

        {!picked ? (
          <p className={`text-sm ${c.muted}`}>
            Pick something on the left. Everything this app has finished is there,
            filed under what made it.
          </p>
        ) : !detail ? (
          <Loader2 size={20} className="animate-spin text-primary" />
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-serif text-3xl truncate">{detail.title}</h2>
                <p className={`mt-1 text-xs ${c.muted}`}>{detail.subtitle}</p>
              </div>
              <button
                onClick={() => setShowEditor((v) => !v)}
                className={`px-3 py-1.5 text-sm rounded-lg shrink-0 ${c.btnSecondary}`}
              >
                {showEditor
                  ? <><PanelRightClose size={14} className="inline mr-1.5 -mt-0.5" />Hide editor</>
                  : <><PanelRightOpen size={14} className="inline mr-1.5 -mt-0.5" />Show editor</>}
              </button>
            </div>

            {note ? <p className="text-sm text-emerald-500">{note}</p> : null}

            {detail.gates ? (
              <>
                <section className="grid gap-4 md:grid-cols-2">
                  <Gate
                    c={c}
                    title="Copy"
                    approved={detail.gates.copy.approved}
                    notes={detail.gates.copy.warnings}
                    notesLabel="Worth knowing before you sign this off:"
                    canApprove
                    busy={busy === "copy"}
                    onToggle={(yes) => void publication("copy", "/approve", { what: "copy", approve: yes })}
                  />
                  <Gate
                    c={c}
                    title="Design"
                    approved={detail.gates.design.approved}
                    notes={detail.gates.design.blockers}
                    notesLabel="The design cannot be approved until:"
                    canApprove={detail.gates.design.canApprove}
                    busy={busy === "design"}
                    onToggle={(yes) => void publication("design", "/approve", { what: "design", approve: yes })}
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
                      disabled={busy !== null}
                      onClick={() => void publication("art", "/resume", { from: "art", stopAt: "art" })}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
                    >
                      <ImageIcon size={14} className="inline mr-1.5 -mt-0.5" />
                      {busy === "art" ? "Drawing…" : "Generate images (ComfyUI)"}
                    </button>
                    <button
                      disabled={busy !== null || page === null}
                      onClick={() => void publication("render", "/render", { page })}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                      title={page === null ? "Pick a numbered page on the left first" : `Render page ${page}`}
                    >
                      {busy === "render" ? "Rendering…" : `Render spread (Affinity)${page ? ` — p${page}` : ""}`}
                    </button>
                    <button
                      disabled={busy !== null || !detail.gates.build.canBuild}
                      onClick={() => void publication("build", "/resume", { from: "build", stopAt: "build" })}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                      title={detail.gates.build.canBuild ? "Build the PDF" : detail.gates.build.blockers.join("; ")}
                    >
                      <Play size={14} className="inline mr-1.5 -mt-0.5" />
                      {busy === "build" ? "Building…" : "Build document (Affinity)"}
                    </button>
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
                      <span className="w-24 font-medium truncate">{s.stage}</span>
                      <span className={`w-24 text-xs ${STATE_TONE[s.state] ?? c.muted}`}>{s.state}</span>
                      <span className={`flex-1 text-xs truncate ${c.muted}`}>{s.detail}</span>
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
                  <p className={`text-xs font-mono break-all ${c.muted}`}>{file.path}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy !== null}
                      onClick={() => void run("report")}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
                    >
                      {busy === "report" ? "Checking…" : "Audit — report only"}
                    </button>
                    <button
                      disabled={busy !== null}
                      onClick={() => void run("revise")}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                    >
                      {busy === "revise" ? "Revising…" : "Audit & revise"}
                    </button>
                    <button
                      disabled={busy !== null}
                      onClick={() => void run("deslop")}
                      className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                    >
                      {busy === "deslop" ? "Rewriting…" : "De-AI pass"}
                    </button>
                  </div>
                  {audit ? (
                    audit.findings.length === 0 ? (
                      <p className="text-sm text-emerald-500">Nothing to fix in this file.</p>
                    ) : (
                      <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide} max-h-64 overflow-y-auto`}>
                        {audit.findings.map((f, i) => (
                          <div key={i} className="p-3 text-sm">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${c.code}`}>{f.category}</span>
                              <span className={`text-xs ${SEVERITY_TONE[f.severity] ?? c.muted}`}>
                                {f.severity}
                              </span>
                            </div>
                            <p className="mt-1.5">{f.description}</p>
                            {f.suggestion ? <p className={`mt-1 text-xs ${c.muted}`}>→ {f.suggestion}</p> : null}
                          </div>
                        ))}
                      </div>
                    )
                  ) : null}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-xl">
                Findings
                <span className={`ml-2 text-sm ${c.muted}`}>{detail.findings.length}</span>
              </h3>
              {detail.findings.length === 0 ? (
                <p className={`text-sm ${c.muted}`}>
                  Nothing on record for this project.
                </p>
              ) : (
                <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide} max-h-80 overflow-y-auto`}>
                  {detail.findings.map((f, i) => (
                    <div key={i} className="p-3 text-sm">
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
        <aside className="w-[26rem] shrink-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-serif text-xl">Edit</h3>
            <button
              disabled={!file || !dirty || busy !== null}
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
            <Loader2 size={18} className="animate-spin text-primary" />
          ) : (
            <>
              <p className={`text-xs truncate ${c.muted}`}>{file.name}</p>
              {progress ? (
                <p className="text-xs text-amber-500 flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />{progress}
                </p>
              ) : null}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className={`w-full h-[36rem] px-3 py-2 text-xs font-mono rounded resize-none ${c.input}`}
              />
            </>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * One approval. Lifted from PublicationDetail's GateCard rather than imported,
 * because that one is not exported and this file should not be the reason it
 * becomes part of that screen's public surface.
 */
function Gate({
  c, title, approved, notes, notesLabel, canApprove, busy, onToggle,
}: {
  c: Record<string, string>;
  title: string;
  approved: Approval | null;
  notes: readonly string[];
  notesLabel: string;
  canApprove: boolean;
  busy: boolean;
  onToggle: (approve: boolean) => void;
}) {
  return (
    <div className={`border ${c.cardStatic} rounded-lg p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-lg">{title}</h3>
        <span className={`text-xs ${approved ? "text-emerald-500" : c.muted}`}>
          {approved ? `approved ${new Date(approved.at).toLocaleDateString()}` : "not approved"}
        </span>
      </div>

      {!approved && notes.length > 0 ? (
        <div className={`text-xs ${c.muted} space-y-1`}>
          <p>{notesLabel}</p>
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
