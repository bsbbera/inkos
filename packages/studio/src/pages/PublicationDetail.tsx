/**
 * One publication issue, as a place rather than a chat transcript.
 *
 * A publication was reachable only through the chat that made it: the stages
 * it had been through, the findings the audit left, and the two approvals the
 * build gates read all existed on disk with nothing on screen showing them.
 * The consequence was not cosmetic — `designApproved` had no surface anywhere
 * in the app, so the build gate could never be opened by anyone, and a run
 * that stopped after `write` was finished for good.
 *
 * Read-first, act-second. Everything shown here is derived from the issue
 * file, so a page opened after a tool changed something out from under it is
 * right rather than stale.
 */
import { useCallback, useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import {
  AlertTriangle, BookOpen, Check, Image as ImageIcon, Loader2, Play, RotateCw, X,
} from "lucide-react";

type Stage = "research" | "plan" | "write" | "audit" | "art" | "build";

interface Finding {
  readonly page: number;
  readonly severity: string;
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

interface Page {
  readonly n: number;
  readonly title: string;
  readonly type: string;
  readonly density: string;
  readonly body: string | null;
  readonly words?: number;
  readonly image?: string | null;
}

interface Issue {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly subject: string;
  readonly thesis: string;
  readonly status: string;
  readonly notes?: string;
  readonly pages: readonly Page[];
  readonly audit?: { at: string; findings: readonly Finding[]; rounds?: number } | null;
  readonly build?: { pdf?: string | null };
}

interface Approval { readonly at: string; readonly by: string }

interface Detail {
  readonly issue: Issue;
  readonly stages: ReadonlyArray<{ stage: Stage; state: string; detail: string }>;
  readonly gates: {
    readonly copy: { approved: Approval | null; warnings: readonly string[] };
    readonly design: { approved: Approval | null; blockers: readonly string[]; canApprove: boolean };
    readonly build: { canBuild: boolean; blockers: readonly string[] };
  };
  readonly running: boolean;
}

interface Nav { toDashboard: () => void }

const STAGES: readonly Stage[] = ["research", "plan", "write", "audit", "art", "build"];

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

const STATE_TONE: Record<string, string> = {
  done: "text-emerald-500",
  partial: "text-amber-500",
  pending: "text-muted-foreground",
};

export function PublicationDetail({
  issueId, nav, theme, t,
}: { issueId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [from, setFrom] = useState<Stage>("write");
  const [stopAt, setStopAt] = useState<Stage>("audit");
  const [openPage, setOpenPage] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Record<number, string>>({});

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
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        {error
          ? <div className={`border rounded-lg p-4 text-sm ${c.error}`}>{error}</div>
          : <Loader2 size={24} className="animate-spin text-primary" />}
      </div>
    );
  }

  const { issue, gates, stages } = data;
  const findings = issue.audit?.findings ?? [];
  const api = `/api/v1/publications/${encodeURIComponent(issue.id)}`;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="truncate">{issue.title || issue.subject}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl flex items-center gap-3">
            <BookOpen size={28} className="text-primary shrink-0" />
            <span className="truncate">{issue.title || issue.subject}</span>
          </h1>
          <p className={`mt-2 text-sm ${c.muted}`}>{issue.thesis}</p>
          <p className={`mt-1 text-xs ${c.muted}`}>
            {issue.type} · {issue.pages.length} pages · {issue.status}
            {data.running ? " · running" : ""}
          </p>
        </div>
        <button onClick={() => void load()} className={`px-4 py-2 text-sm rounded-lg shrink-0 ${c.btnSecondary}`}>
          <RotateCw size={14} className="inline mr-1.5 -mt-0.5" />Refresh
        </button>
      </div>

      {error && (
        <div className={`flex items-start gap-3 border rounded-lg p-4 text-sm ${c.error}`}>
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p className="font-mono text-xs">{error}</p>
        </div>
      )}

      {/* ------------------------------------------------------------ gates */}
      <section className="grid gap-4 md:grid-cols-2">
        <GateCard
          c={c}
          title="Copy"
          approved={gates.copy.approved}
          notes={gates.copy.warnings}
          notesLabel="Worth knowing before you sign this off:"
          canApprove
          busy={busy === "copy"}
          onToggle={(yes) => act("copy", () => post(`${api}/approve`, { what: "copy", approve: yes }))}
        />
        <GateCard
          c={c}
          title="Design"
          approved={gates.design.approved}
          notes={gates.design.blockers}
          notesLabel="The design cannot be approved until:"
          canApprove={gates.design.canApprove}
          busy={busy === "design"}
          onToggle={(yes) => act("design", () => post(`${api}/approve`, { what: "design", approve: yes }))}
        />
      </section>

      <div className={`border rounded-lg p-4 text-sm ${gates.build.canBuild ? c.info : c.error}`}>
        {gates.build.canBuild
          ? "Both gates are open — this issue can be built."
          : `Build is held: ${gates.build.blockers.join("; ")}.`}
      </div>

      {/* ----------------------------------------------------------- stages */}
      <section className="space-y-3">
        <h2 className="font-serif text-xl">Stages</h2>
        <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide}`}>
          {stages.map((s) => (
            <div key={s.stage} className="flex items-center gap-3 p-3 text-sm">
              <span className="w-20 font-medium">{s.stage}</span>
              <span className={`w-16 text-xs ${STATE_TONE[s.state] ?? c.muted}`}>{s.state}</span>
              <span className={`flex-1 text-xs ${c.muted}`}>{s.detail}</span>
            </div>
          ))}
        </div>

        <div className={`border ${c.cardStatic} rounded-lg p-4 flex flex-wrap items-center gap-3`}>
          <span className={`text-xs ${c.muted}`}>Resume from</span>
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value as Stage)}
            className={`px-2 py-1.5 text-sm rounded ${c.input}`}
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className={`text-xs ${c.muted}`}>through</span>
          <select
            value={stopAt}
            onChange={(e) => setStopAt(e.target.value as Stage)}
            className={`px-2 py-1.5 text-sm rounded ${c.input}`}
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            disabled={data.running || busy !== null}
            onClick={() => void act("resume", () => post(`${api}/resume`, { from, stopAt }))}
            className={`px-4 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
          >
            <Play size={14} className="inline mr-1.5 -mt-0.5" />
            {data.running ? "Running…" : "Resume"}
          </button>
          <span className={`text-xs ${c.muted}`}>
            A run that stopped part-way picks up here.
          </span>
        </div>
      </section>

      {/* --------------------------------------------------------- findings */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-serif text-xl">
            Audit
            {issue.audit ? <span className={`ml-2 text-sm ${c.muted}`}>
              {findings.length} findings
              {issue.audit.rounds ? ` · ${issue.audit.rounds} revise rounds` : " · not revised"}
            </span> : null}
          </h2>
          <div className="flex gap-2 shrink-0">
            <button
              disabled={busy !== null || data.running}
              onClick={() => void act("audit", () => post(`${api}/audit`, { revise: true }))}
              className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
            >
              {busy === "audit" ? "Auditing…" : "Audit & revise"}
            </button>
            <button
              disabled={busy !== null || data.running}
              onClick={() => void act("deslop", () => post(`${api}/audit`, { deslop: true }))}
              className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
            >
              {busy === "deslop" ? "Rewriting…" : "De-AI pass"}
            </button>
          </div>
        </div>

        {!issue.audit ? (
          <p className={`text-sm ${c.muted}`}>This issue has never been audited.</p>
        ) : findings.length === 0 ? (
          <p className="text-sm text-emerald-500">Nothing left to fix.</p>
        ) : (
          <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide} max-h-96 overflow-y-auto`}>
            {findings.map((f, i) => (
              <div key={i} className="p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${c.code}`}>{f.category}</span>
                  <span className={`text-xs ${f.severity === "warning" ? "text-amber-500" : c.muted}`}>
                    {f.severity}
                  </span>
                </div>
                <p className="mt-1.5">{f.description}</p>
                <p className={`mt-1 text-xs ${c.muted}`}>→ {f.suggestion}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ pages */}
      <section className="space-y-3">
        <h2 className="font-serif text-xl">Pages</h2>
        <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide}`}>
          {issue.pages.map((p) => {
            const open = openPage === p.n;
            const pageFindings = findings.filter((f) => f.page === p.n).length;
            return (
              <div key={p.n}>
                <button
                  onClick={() => { setOpenPage(open ? null : p.n); setNote(""); }}
                  className={`w-full flex items-center gap-3 p-3 text-left text-sm ${c.tableHover}`}
                >
                  <span className={`w-8 text-xs ${c.muted}`}>p{p.n}</span>
                  <span className="flex-1 truncate">{p.title}</span>
                  {p.image ? <ImageIcon size={14} className="text-emerald-500 shrink-0" /> : null}
                  {pageFindings ? (
                    <span className="text-xs text-amber-500 shrink-0">{pageFindings}</span>
                  ) : null}
                  <span className={`text-xs shrink-0 ${p.body ? c.muted : "text-muted-foreground/50"}`}>
                    {p.body ? `${p.words ?? 0} words` : "unwritten"}
                  </span>
                </button>

                {open && (
                  <div className="px-3 pb-4 space-y-3">
                    {p.body ? (
                      <p className={`text-xs whitespace-pre-wrap max-h-40 overflow-y-auto ${c.muted}`}>
                        {p.body}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={busy !== null}
                        onClick={() => void act(`render-${p.n}`, async () => {
                          const out = await post(`${api}/render`, { page: p.n });
                          if (out.image) setPreview((prev) => ({ ...prev, [p.n]: out.image }));
                          else throw new Error(out.error || "the spread could not be rendered");
                        })}
                        className={`px-3 py-1.5 text-xs rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
                      >
                        {busy === `render-${p.n}` ? "Rendering…" : "Render spread"}
                      </button>
                      {preview[p.n] ? (
                        <span className={`text-xs self-center font-mono ${c.muted}`}>{preview[p.n]}</span>
                      ) : null}
                    </div>

                    {/* A note here is not a comment field. It becomes a finding
                        and goes through the same revise pass the audit uses. */}
                    <div className="flex gap-2">
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="What is wrong with this page? It will be rewritten to fix it."
                        className={`flex-1 px-3 py-1.5 text-xs rounded ${c.input}`}
                      />
                      <button
                        disabled={!note.trim() || busy !== null}
                        onClick={() => void act(`note-${p.n}`, async () => {
                          await post(`${api}/feedback`, { page: p.n, note });
                          setNote("");
                        })}
                        className={`px-3 py-1.5 text-xs rounded-lg disabled:opacity-50 ${c.btnPrimary}`}
                      >
                        {busy === `note-${p.n}` ? "Revising…" : "Revise page"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {issue.build?.pdf ? (
        <section className="space-y-2">
          <h2 className="font-serif text-xl">Artifact</h2>
          <p className={`text-xs font-mono ${c.muted}`}>{issue.build.pdf}</p>
        </section>
      ) : null}
    </div>
  );
}

function GateCard({
  c, title, approved, notes, notesLabel, canApprove, busy, onToggle,
}: {
  c: ReturnType<typeof useColors>;
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
        <h3 className="font-medium">{title}</h3>
        {approved ? (
          <span className="text-xs text-emerald-500 flex items-center gap-1">
            <Check size={14} />approved {new Date(approved.at).toLocaleDateString()}
          </span>
        ) : (
          <span className={`text-xs ${c.muted}`}>not approved</span>
        )}
      </div>

      {notes.length > 0 && (
        <div className={`text-xs ${c.muted} space-y-1`}>
          <p>{notesLabel}</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}

      {approved ? (
        <button
          disabled={busy}
          onClick={() => onToggle(false)}
          className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
        >
          <X size={14} className="inline mr-1.5 -mt-0.5" />Revoke
        </button>
      ) : (
        <button
          disabled={busy || !canApprove}
          onClick={() => onToggle(true)}
          className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${c.btnSuccess}`}
          title={canApprove ? undefined : "Fix what is listed above first."}
        >
          <Check size={14} className="inline mr-1.5 -mt-0.5" />
          {busy ? "Saving…" : `Approve ${title.toLowerCase()}`}
        </button>
      )}
    </div>
  );
}
