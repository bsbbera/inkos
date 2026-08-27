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
 * clicked to look at it would be the wrong way round.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileText, Loader2, RotateCw, ShieldCheck, Sparkles } from "lucide-react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface Target {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
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

const KIND_LABEL: Record<string, string> = {
  book: "Book",
  short: "Short",
  script: "Script",
  storyboard: "Storyboard",
  "interactive film": "Interactive film",
  publication: "Publication",
};

export function AuditPage({ theme, t }: { theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const zh = t("nav.myBooks") !== "My Books";
  const tr = (cn: string, en: string) => (zh ? cn : en);

  const [targets, setTargets] = useState<readonly Target[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [loading, setLoading] = useState(true);

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

  const run = async (mode: "report" | "revise" | "deslop") => {
    if (!selected) return;
    setBusy(mode);
    setError(null);
    setAudit(null);
    setProgress("");
    try {
      const res = await fetch("/api/v1/audit/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: selected,
          revise: mode === "revise",
          deslop: mode === "deslop",
        }),
      });
      const body = await res.json() as { audit?: Audit; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `audit failed (${res.status})`);
      setAudit(body.audit ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const warnings = audit?.findings.filter((f) => f.severity === "warning").length ?? 0;

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
            <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide} max-h-96 overflow-y-auto`}>
              {targets.map((target) => (
                <button
                  key={target.path}
                  onClick={() => { setSelected(target.path); setAudit(null); setError(null); }}
                  className={`w-full text-left p-3 flex items-center gap-3 ${
                    selected === target.path ? "bg-muted/60" : c.tableHover
                  }`}
                >
                  <FileText size={15} className="shrink-0 opacity-60" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm">{target.name}</span>
                    <span className={`block truncate text-xs ${c.muted}`}>{target.path}</span>
                  </span>
                  <span className={`text-xs shrink-0 ${c.muted}`}>
                    {KIND_LABEL[target.kind] ?? target.kind}
                    {" · ~"}
                    {target.words.toLocaleString()}
                    {tr(" 字", " words")}
                  </span>
                </button>
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
            {progress ? <p className={`text-xs ${c.muted}`}>{progress}</p> : null}
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
      </div>
    </div>
  );
}
