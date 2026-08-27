/**
 * Audit anything already written.
 *
 * The checks were only ever reachable from the run that produced the thing —
 * a publication had its own page, and every other artifact had two buttons on
 * a chat card that went away with the conversation. Work finished last week,
 * or written before the audit existed, could not be checked at all.
 *
 * So this lists what is in the workspace and runs the same passes over any of
 * it. Report is the default: rewriting someone's finished story because they
 * clicked to look at it would be the wrong way round. And a finding is only
 * worth reading beside the text it is about, so the text is here too, and
 * editable — the previous version listed findings and left the user to go and
 * find the file themselves.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2,
  RotateCw, Save, ShieldCheck, Sparkles,
} from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface Target {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly kindLabel?: string;
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

export function AuditPage({ theme, t }: { theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const zh = t("nav.myBooks") !== "My Books";
  const tr = (cn: string, en: string) => (zh ? cn : en);

  const [targets, setTargets] = useState<readonly Target[]>([]);
  const [selected, setSelected] = useState<Target | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // The text itself, so a finding can be acted on without leaving the screen.
  const [text, setText] = useState<string>("");
  const [savedText, setSavedText] = useState<string>("");
  const [loadingText, setLoadingText] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/audit/targets");
      const body = await res.json() as { targets?: Target[] };
      setTargets(body.targets ?? []);
    } catch {
      setError(tr("找不到可审校的作品。", "Could not read the workspace."));
    } finally {
      setLoading(false);
    }
    // tr is derived from t and stable enough for this; the list is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Group by production, so a workspace of eighty files reads as a shelf. */
  const groups = useMemo(() => {
    const byKind = new Map<string, { label: string; items: Target[] }>();
    for (const target of targets) {
      const label = target.kindLabel ?? target.kind;
      const group = byKind.get(target.kind) ?? { label, items: [] };
      group.items.push(target);
      byKind.set(target.kind, group);
    }
    return [...byKind.entries()];
  }, [targets]);

  const openTarget = useCallback(async (target: Target) => {
    setSelected(target);
    setAudit(null);
    setError(null);
    setSaved(null);
    setLoadingText(true);
    setText("");
    try {
      const res = await fetch(`/api/v1/project/artifacts/${target.path.split("/").map(encodeURIComponent).join("/")}`);
      if (!res.ok) throw new Error(`could not open the file (${res.status})`);
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
      const res = await fetch(
        `/api/v1/project/artifacts/${selected.path.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: text }),
        },
      );
      if (!res.ok) throw new Error(`could not save (${res.status})`);
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
        body: JSON.stringify({
          path: selected.path,
          revise: mode === "revise",
          deslop: mode === "deslop",
        }),
      });
      const body = await res.json() as { audit?: Audit; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `audit failed (${res.status})`);
      setAudit(body.audit ?? null);
      // Both revising passes rewrite the file underneath us, so what is on
      // screen is now the previous draft. Showing it as editable would let a
      // save quietly undo the pass the user just asked for.
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
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8 space-y-8">
        <header className="space-y-2">
          <h1 className="font-serif text-3xl flex items-center gap-3">
            <ShieldCheck size={26} />
            {tr("审校", "Audit")}
          </h1>
          <p className={`text-sm ${c.muted}`}>
            {tr(
              "对任何已经写好的作品运行同一套检查，包括在审校功能出现之前写的。默认只报告，不改动原文。",
              "Run the same checks over anything already written, including work finished before the checks existed. Reports by default and changes nothing unless you ask it to.",
            )}
          </p>
        </header>

        {/* ------------------------------------------------------- the work */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-serif text-xl">
              {tr("作品", "Your work")}
              <span className={`ml-2 text-sm ${c.muted}`}>{targets.length}</span>
            </h2>
            <button
              onClick={() => void load()}
              disabled={loading}
              className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
            >
              <RotateCw size={14} className="inline mr-1.5 -mt-0.5" />
              {tr("刷新", "Refresh")}
            </button>
          </div>

          {loading ? (
            <p className={`text-sm ${c.muted}`}>
              <Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />
              {tr("正在读取工作区…", "Reading the workspace…")}
            </p>
          ) : targets.length === 0 ? (
            <p className={`text-sm ${c.muted}`}>
              {tr(
                "工作区里还没有可以审校的成稿。",
                "Nothing finished in the workspace yet. Anything a production writes shows up here.",
              )}
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map(([kind, group]) => (
                <div key={kind} className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
                  <button
                    onClick={() => setCollapsed((s) => ({ ...s, [kind]: !s[kind] }))}
                    className={`w-full px-3 py-2 flex items-center gap-2 text-sm ${c.tableHover}`}
                  >
                    {collapsed[kind] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span className="font-medium">{group.label}</span>
                    <span className={`text-xs ${c.muted}`}>{group.items.length}</span>
                  </button>
                  {collapsed[kind] ? null : (
                    <div className={`divide-y ${c.tableDivide} max-h-72 overflow-y-auto`}>
                      {group.items.map((target) => (
                        <button
                          key={target.path}
                          onClick={() => void openTarget(target)}
                          className={`w-full text-left p-3 flex items-center gap-3 ${
                            selected?.path === target.path ? "bg-muted/60" : c.tableHover
                          }`}
                        >
                          <FileText size={15} className="shrink-0 opacity-60" />
                          <span className="flex-1 min-w-0">
                            <span className="block truncate text-sm">{target.name}</span>
                            <span className={`block truncate text-xs ${c.muted}`}>{target.path}</span>
                          </span>
                          <span className={`text-xs shrink-0 ${c.muted}`}>
                            ~{target.words.toLocaleString()}
                            {tr(" 字", " words")}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ----------------------------------------------------- the checks */}
        {selected ? (
          <section className="space-y-3">
            <h2 className="font-serif text-xl">{tr("检查", "Check it")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={busy !== null}
                onClick={() => void run("report")}
                className={`px-4 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
              >
                {busy === "report"
                  ? <><Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />{tr("审校中…", "Auditing…")}</>
                  : tr("审校（只报告）", "Audit — report only")}
              </button>
              <button
                disabled={busy !== null}
                onClick={() => void run("revise")}
                className={`px-4 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
              >
                {busy === "revise"
                  ? <><Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />{tr("修订中…", "Revising…")}</>
                  : tr("审校并修订", "Audit & revise")}
              </button>
              <button
                disabled={busy !== null}
                onClick={() => void run("deslop")}
                className={`px-4 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
              >
                {busy === "deslop"
                  ? <><Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />{tr("处理中…", "Rewriting…")}</>
                  : <><Sparkles size={14} className="inline mr-1.5 -mt-0.5" />{tr("去 AI 味", "De-AI pass")}</>}
              </button>
            </div>
            <p className={`text-xs ${c.muted}`}>
              {tr(
                "修订之前会把原文另存一份在同一目录下。",
                "Both revising passes keep the text as it stood in a file beside it before they touch anything.",
              )}
            </p>
          </section>
        ) : null}

        {error ? (
          <p className="text-sm text-amber-500">
            <AlertTriangle size={14} className="inline mr-1.5 -mt-0.5" />
            {error}
          </p>
        ) : null}

        {/* --------------------------------------------------- the findings */}
        {audit ? (
          <section className="space-y-3">
            <h2 className="font-serif text-xl">
              {tr("结果", "Findings")}
              <span className={`ml-2 text-sm ${c.muted}`}>
                {audit.findings.length}
                {warnings ? tr(`，其中 ${warnings} 条需要处理`, ` · ${warnings} worth acting on`) : ""}
                {audit.rounds ? tr(`　${audit.rounds} 轮修订`, ` · ${audit.rounds} revise rounds`) : ""}
              </span>
            </h2>
            {audit.findings.length === 0 ? (
              <p className="text-sm text-emerald-500">{tr("没有发现问题。", "Nothing to flag.")}</p>
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

        {/* -------------------------------------------------------- the text */}
        {selected ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-serif text-xl">
                {tr("原文", "The text")}
                <span className={`ml-2 text-sm ${c.muted}`}>{selected.name}</span>
              </h2>
              <div className="flex items-center gap-3">
                {saved && !dirty ? (
                  <span className="text-xs text-emerald-500">{tr(`已保存 ${saved}`, `Saved ${saved}`)}</span>
                ) : null}
                <button
                  onClick={() => void save()}
                  disabled={!dirty || busy !== null || loadingText}
                  className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
                >
                  {busy === "save"
                    ? <Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />
                    : <Save size={14} className="inline mr-1.5 -mt-0.5" />}
                  {tr("保存", "Save")}
                </button>
              </div>
            </div>
            {loadingText ? (
              <p className={`text-sm ${c.muted}`}>
                <Loader2 size={14} className="inline mr-1.5 -mt-0.5 animate-spin" />
                {tr("正在打开…", "Opening…")}
              </p>
            ) : (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className={`w-full h-96 p-3 rounded-lg font-mono text-sm leading-relaxed border ${c.cardStatic} bg-transparent`}
              />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
