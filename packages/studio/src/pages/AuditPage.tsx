/**
 * Audit anything already written.
 *
 * The checks were only ever reachable from the run that produced the thing —
 * a publication had its own page, and every other artifact had two buttons on
 * a chat card that went away with the conversation. Work finished last week,
 * or written before the audit existed, could not be checked at all.
 *
 * Three columns, because that is what the work actually is: pick a file, read
 * what the checks said about it, fix it. The first version was one long scroll
 * of eighty-four filenames with the text nowhere in sight, which made the
 * findings something to read rather than something to act on.
 *
 * English only, like PublicationDetail beside it. The first version carried its
 * own zh/en switch keyed off a translated string that had been reworded, so the
 * comparison never matched and the whole screen rendered in Chinese regardless
 * of the language chosen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2,
  RotateCw, Save, ShieldCheck, Sparkles,
} from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import { useColors } from "../hooks/use-colors";

interface Target {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly kindLabel?: string;
  readonly project?: string;
  readonly words: number;
  readonly modified: string;
}

interface Finding {
  readonly section: string;
  readonly severity: string;
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

interface Audit {
  readonly at: string;
  readonly path: string;
  readonly findings: readonly Finding[];
  readonly rounds: number;
}

/**
 * A folder, exactly as it is on disk.
 *
 * Built from each file's own path rather than from a fixed two levels of
 * grouping, because the depth is not fixed: a short's chapters sit three
 * directories below `shorts/`, a storyboard's files sit one. Guessing a depth
 * put sixty-four files in a single flat list under one heading.
 */
interface Node {
  name: string;
  path: string;
  children: Node[];
  files: Target[];
}

function emptyNode(name: string, path: string): Node {
  return { name, path, children: [], files: [] };
}

function insert(root: Node, dirs: readonly string[], target: Target): void {
  let node = root;
  for (const dir of dirs) {
    let next = node.children.find((child) => child.name === dir);
    if (!next) {
      next = emptyNode(dir, `${node.path}/${dir}`);
      node.children.push(next);
    }
    node = next;
  }
  node.files.push(target);
}

/**
 * Fold away a directory that only ever contains one directory.
 *
 * `the-lamp-room > final > chapters` is three clicks to reach one list. On
 * disk that nesting is real; on screen it is three headings that say nothing
 * the one below them does not.
 */
function collapseSingles(node: Node): Node {
  const children = node.children.map(collapseSingles);
  if (children.length === 1 && node.files.length === 0) {
    const only = children[0]!;
    return { ...only, name: `${node.name}/${only.name}` };
  }
  return { ...node, children };
}

function countFiles(node: Node): number {
  return node.files.length + node.children.reduce((n, child) => n + countFiles(child), 0);
}

/**
 * One directory and everything under it.
 *
 * Folders are open by default: the point of the screen is to see what is there,
 * and a workspace that opens fully closed looks empty.
 */
function Folder({ node, depth, c, open, setOpen, selected, onPick }: {
  node: Node;
  depth: number;
  c: ReturnType<typeof useColors>;
  open: Record<string, boolean>;
  setOpen: (fn: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  selected: string | null;
  onPick: (target: Target) => void;
}) {
  return (
    <div className={depth > 0 ? "ml-3" : ""}>
      {node.children.map((child) => {
        const shut = open[child.path] === false;
        return (
          <div key={child.path}>
            <button
              onClick={() => setOpen((s) => ({ ...s, [child.path]: !(s[child.path] ?? true) }))}
              className={`w-full px-2 py-1 flex items-center gap-1.5 rounded-lg text-xs ${c.tableHover}`}
            >
              {shut ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className={`flex-1 text-left truncate ${c.muted}`}>{child.name}</span>
              <span className={c.muted}>{countFiles(child)}</span>
            </button>
            {shut ? null : (
              <Folder
                node={child}
                depth={depth + 1}
                c={c}
                open={open}
                setOpen={setOpen}
                selected={selected}
                onPick={onPick}
              />
            )}
          </div>
        );
      })}

      {node.files.map((target) => (
        <button
          key={target.path}
          onClick={() => onPick(target)}
          title={target.path}
          className={`w-full px-2 py-1.5 flex items-center gap-2 rounded-lg text-left text-sm ${
            selected === target.path ? "bg-primary/10 text-primary" : c.tableHover
          }`}
        >
          <FileText size={13} className="shrink-0 opacity-60" />
          <span className="flex-1 truncate">{target.name}</span>
        </button>
      ))}
    </div>
  );
}

export function AuditPage({ theme }: { theme: Theme }) {
  const c = useColors(theme);

  const [targets, setTargets] = useState<readonly Target[]>([]);
  const [selected, setSelected] = useState<Target | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [loadingText, setLoadingText] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/audit/targets");
      const body = await res.json() as { targets?: Target[] };
      setTargets(body.targets ?? []);
    } catch {
      setError("Could not read the workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tree = useMemo(() => {
    const byKind = new Map<string, { label: string; root: Node }>();
    for (const target of targets) {
      const group = byKind.get(target.kind)
        ?? { label: target.kindLabel ?? target.kind, root: emptyNode(target.kind, target.kind) };
      // The first segment is the production's own directory, which the heading
      // already says, so it is not repeated inside.
      const segments = target.path.split("/");
      insert(group.root, segments.slice(1, -1), target);
      byKind.set(target.kind, group);
    }
    return [...byKind.values()].map((group) => ({
      label: group.label,
      root: collapseSingles(group.root),
      count: countFiles(group.root),
    }));
  }, [targets]);

  const openTarget = useCallback(async (target: Target) => {
    setSelected(target);
    setAudit(null);
    setError(null);
    setSaved(null);
    setLoadingText(true);
    setText("");
    try {
      const url = `/api/v1/project/artifacts/${target.path.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not open this file (${res.status}).`);
      const body = await res.json() as { content?: string };
      setText(body.content ?? "");
      setSavedText(body.content ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingText(false);
    }
  }, []);

  const save = async () => {
    if (!selected) return;
    setBusy("save");
    setError(null);
    try {
      const url = `/api/v1/project/artifacts/${selected.path.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) throw new Error(`Could not save (${res.status}).`);
      setSavedText(text);
      setSaved(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const run = async (mode: "report" | "revise" | "deslop") => {
    if (!selected) return;
    setBusy(mode);
    setError(null);
    setAudit(null);
    try {
      const res = await fetch("/api/v1/audit/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selected.path, revise: mode === "revise", deslop: mode === "deslop" }),
      });
      const body = await res.json() as { audit?: Audit; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `The audit failed (${res.status}).`);
      setAudit(body.audit ?? null);
      // Both revising passes rewrite the file underneath us, so what is on
      // screen is now the previous draft. Leaving it editable would let a save
      // quietly undo the pass just asked for.
      if (mode !== "report") await openTarget(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const warnings = audit?.findings.filter((f) => f.severity === "warning").length ?? 0;
  const dirty = text !== savedText;

  return (
    <div className="flex-1 flex min-h-0">
      {/* ------------------------------------------------------------- files */}
      <aside className={`w-72 shrink-0 border-r ${c.tableDivide} flex flex-col min-h-0`}>
        <div className="p-4 flex items-center justify-between gap-2">
          <h2 className="font-serif text-lg flex items-center gap-2">
            <ShieldCheck size={18} />
            Audit
          </h2>
          <button
            onClick={() => void load()}
            disabled={loading}
            className={`px-2 py-1 text-xs rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
          >
            <RotateCw size={12} className="inline -mt-0.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <p className={`px-2 text-sm ${c.muted}`}>
              <Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />
              Reading the workspace…
            </p>
          ) : targets.length === 0 ? (
            <p className={`px-2 text-sm ${c.muted}`}>
              Nothing finished yet. Anything a production writes shows up here.
            </p>
          ) : tree.map((group) => {
            const shut = open[group.label] === false;
            return (
              <div key={group.label} className="mb-1">
                <button
                  onClick={() => setOpen((s) => ({ ...s, [group.label]: !(s[group.label] ?? true) }))}
                  className={`w-full px-2 py-1.5 flex items-center gap-1.5 rounded-lg text-sm ${c.tableHover}`}
                >
                  {shut ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="font-medium flex-1 text-left truncate">{group.label}</span>
                  <span className={`text-xs ${c.muted}`}>{group.count}</span>
                </button>
                {shut ? null : (
                  <Folder
                    node={group.root}
                    depth={0}
                    c={c}
                    open={open}
                    setOpen={setOpen}
                    selected={selected?.path ?? null}
                    onPick={(target) => void openTarget(target)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ------------------------------------------------------------ checks */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center p-8">
            <p className={`text-sm text-center max-w-sm ${c.muted}`}>
              Pick something on the left. The same checks a run does on its own
              output run here on anything already written, however long ago.
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto p-8 space-y-8">
            <div>
              <h1 className="font-serif text-3xl flex items-center gap-3">
                <ShieldCheck size={26} className="text-primary shrink-0" />
                <span className="truncate">{selected.name}</span>
              </h1>
              <p className={`mt-2 text-xs font-mono ${c.muted}`}>{selected.path}</p>
              <p className={`mt-1 text-xs ${c.muted}`}>
                {selected.kindLabel ?? selected.kind}
                {selected.project ? ` · ${selected.project}` : ""}
                {" · ~"}{selected.words.toLocaleString()} words
              </p>
            </div>

            {error ? (
              <div className={`flex items-start gap-3 border rounded-lg p-4 text-sm ${c.error}`}>
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <p className="font-mono text-xs">{error}</p>
              </div>
            ) : null}

            <section className="space-y-3">
              <h2 className="font-serif text-xl">Checks</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={busy !== null}
                  onClick={() => void run("report")}
                  className={`px-4 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
                >
                  {busy === "report"
                    ? <><Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />Auditing…</>
                    : "Audit — report only"}
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() => void run("revise")}
                  className={`px-4 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                >
                  {busy === "revise"
                    ? <><Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />Revising…</>
                    : "Audit & revise"}
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() => void run("deslop")}
                  className={`px-4 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                >
                  {busy === "deslop"
                    ? <><Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />Rewriting…</>
                    : <><Sparkles size={14} className="inline mr-1.5 -mt-0.5" />De-AI pass</>}
                </button>
              </div>
              <p className={`text-xs ${c.muted}`}>
                Report only changes nothing. Both revising passes keep the text as
                it stands in a file beside it before they touch anything.
              </p>
            </section>

            {audit ? (
              <section className="space-y-3">
                <h2 className="font-serif text-xl">
                  Findings
                  <span className={`ml-2 text-sm ${c.muted}`}>
                    {audit.findings.length}
                    {warnings ? ` · ${warnings} worth acting on` : ""}
                    {audit.rounds ? ` · ${audit.rounds} revise rounds` : ""}
                  </span>
                </h2>
                {audit.findings.length === 0 ? (
                  <p className="text-sm text-emerald-500">Nothing to flag.</p>
                ) : (
                  <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide}`}>
                    {audit.findings.map((f, i) => (
                      <div key={i} className="p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${c.code}`}>{f.category}</span>
                          <span className={`text-xs ${f.severity === "warning" ? "text-amber-500" : c.muted}`}>
                            {f.severity}
                          </span>
                          {f.section ? <span className={`text-xs ${c.muted}`}>{f.section}</span> : null}
                        </div>
                        <p className="mt-1.5">{f.description}</p>
                        {f.suggestion ? <p className={`mt-1 text-xs ${c.muted}`}>→ {f.suggestion}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        )}
      </div>

      {/* -------------------------------------------------------------- edit */}
      {selected ? (
        <aside className={`w-[26rem] shrink-0 border-l ${c.tableDivide} flex flex-col min-h-0`}>
          <div className="p-4 flex items-center justify-between gap-2">
            <h2 className="font-serif text-lg">
              Edit
              {dirty ? <span className="ml-2 text-xs text-amber-500">unsaved</span> : null}
              {saved && !dirty ? <span className="ml-2 text-xs text-emerald-500">saved {saved}</span> : null}
            </h2>
            <button
              onClick={() => void save()}
              disabled={!dirty || busy !== null || loadingText}
              className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
            >
              {busy === "save"
                ? <Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />
                : <Save size={14} className="inline mr-1.5 -mt-0.5" />}
              Save
            </button>
          </div>
          <div className="flex-1 min-h-0 px-4 pb-4">
            {loadingText ? (
              <p className={`text-sm ${c.muted}`}>
                <Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />
                Opening…
              </p>
            ) : (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className={`w-full h-full p-3 rounded-lg font-mono text-xs leading-relaxed resize-none border ${c.cardStatic} bg-transparent`}
              />
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
