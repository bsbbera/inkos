/**
 * Check finished work, from the work rather than from a file list.
 *
 * The first version of this screen listed every auditable `.md` on disk and let
 * you check one. That was the shape of `runStoryAudit`, not the shape of the
 * work: a magazine is one issue of sixteen pages, a short is one story spread
 * over sixty-four files, and neither is a row in a list of paths. Opening a
 * publication from My Publications gave the whole issue — stages, findings,
 * pages — while opening the same issue here gave one page and no context.
 *
 * So the unit is the project. `/api/v1/audit/projects` groups the same targets
 * by production and project, and `/api/v1/audit/project/:kind/:id` returns the
 * derived view: stages read off whatever run state that production keeps, its
 * findings, and its files. The checks still run per file, because a file is
 * what they take — but the file is chosen inside the project you were already
 * looking at, and the editor sits beside it.
 *
 * English only, deliberately. This page used to call a `tr()` helper gated on
 * `t("nav.myBooks") !== "My Books"`, and the English string for that key is
 * "My Works" — so the comparison was true forever and every label rendered in
 * Chinese whatever the app was set to. PublicationDetail, the screen this one
 * is meant to match, carries no translations either.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";
import {
  AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2, Save, ShieldCheck,
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

interface Detail {
  readonly kind: string;
  readonly kindLabel: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly stages: ReadonlyArray<{ stage: string; state: string; detail: string }>;
  readonly findings: ReadonlyArray<Finding>;
  readonly items: ReadonlyArray<Item>;
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

export function AuditPage({ theme }: { theme: Theme }) {
  const c = useColors(theme);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [picked, setPicked] = useState<{ kind: string; id: string } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [file, setFile] = useState<Item | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loadingText, setLoadingText] = useState(false);

  useEffect(() => {
    void (async () => {
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
    })();
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
    setPicked({ kind, id });
    setDetail(null);
    setFile(null);
    setAudit(null);
    setText("");
    setSaved("");
    setError(null);
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

  return (
    <div className="flex gap-6 items-start">
      {/* -------------------------------------------------------- the work */}
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
              const shut = collapsed[g.kind] === true;
              return (
                <div key={g.kind}>
                  <button
                    onClick={() => setCollapsed((p) => ({ ...p, [g.kind]: !shut }))}
                    className={`w-full flex items-center gap-1.5 text-xs uppercase tracking-wide ${c.muted}`}
                  >
                    {shut ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="flex-1 text-left">{g.label}</span>
                    <span>{g.rows.length}</span>
                  </button>
                  {!shut && (
                    <div className="mt-1 space-y-0.5">
                      {g.rows.map((p) => {
                        const on = picked?.kind === p.kind && picked.id === p.id;
                        return (
                          <button
                            key={p.id}
                            onClick={() => void openProject(p.kind, p.id)}
                            className={`w-full text-left px-2 py-1.5 rounded text-sm truncate ${
                              on ? SELECTED : c.tableHover
                            }`}
                            title={p.id}
                          >
                            {p.id}
                            <span className={`ml-1.5 text-xs ${c.muted}`}>{p.files}</span>
                          </button>
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
            <div className="min-w-0">
              <h2 className="font-serif text-3xl truncate">{detail.title}</h2>
              <p className={`mt-1 text-xs ${c.muted}`}>{detail.subtitle}</p>
            </div>

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

            <section className="space-y-3">
              <h3 className="font-serif text-xl">
                Findings
                <span className={`ml-2 text-sm ${c.muted}`}>{detail.findings.length}</span>
              </h3>
              {detail.findings.length === 0 ? (
                <p className={`text-sm ${c.muted}`}>
                  Nothing on record for this project. Run a check on a file below.
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

            <section className="space-y-3">
              <h3 className="font-serif text-xl">
                Files
                <span className={`ml-2 text-sm ${c.muted}`}>{detail.items.length}</span>
              </h3>
              <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide} max-h-96 overflow-y-auto`}>
                {detail.items.map((item) => {
                  const on = file?.path === item.path;
                  return (
                    <div key={item.path}>
                      <button
                        onClick={() => void openFile(item)}
                        className={`w-full flex items-center gap-3 p-3 text-left text-sm ${
                          on ? SELECTED : c.tableHover
                        }`}
                      >
                        <FileText size={14} className="shrink-0 opacity-60" />
                        <span className="flex-1 truncate">{item.name}</span>
                        <span className={`text-xs shrink-0 ${c.muted}`}>~{item.words} words</span>
                      </button>

                      {on && (
                        <div className="px-3 pb-3 space-y-3">
                          <p className={`text-xs font-mono break-all ${c.muted}`}>{item.path}</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              disabled={busy !== null}
                              onClick={() => void run("report")}
                              className={`px-3 py-1.5 text-xs rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
                            >
                              {busy === "report" ? "Checking…" : "Audit — report only"}
                            </button>
                            <button
                              disabled={busy !== null}
                              onClick={() => void run("revise")}
                              className={`px-3 py-1.5 text-xs rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                            >
                              {busy === "revise" ? "Revising…" : "Audit & revise"}
                            </button>
                            <button
                              disabled={busy !== null}
                              onClick={() => void run("deslop")}
                              className={`px-3 py-1.5 text-xs rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
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
                                    {f.suggestion ? (
                                      <p className={`mt-1 text-xs ${c.muted}`}>→ {f.suggestion}</p>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>

      {/* -------------------------------------------------------- the edit */}
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
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className={`w-full h-[36rem] px-3 py-2 text-xs font-mono rounded resize-none ${c.input}`}
            />
          </>
        )}
      </aside>
    </div>
  );
}
