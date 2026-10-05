import { RunError } from "../components/ui/run-error";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { Num } from "../components/ui/num";
import { useArrivals } from "../hooks/use-arrivals";
import { vtName } from "../lib/view-transition";
import { toast, toastError } from "../components/ui/vermilion";
import { useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { useColors } from "../hooks/use-colors";
import { deriveBookActivity, shouldRefetchBookView } from "../hooks/use-book-activity";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GateCard, WorkflowBar, type Workflow } from "../components/workflow";
import {
  ChevronLeft,
  Zap,
  FileText,
  CheckCheck,
  BarChart2,
  Download,
  Search,
  Wand2,
  Eye,
  Database,
  Check,
  X,
  ShieldCheck,
  RotateCcw,
  RefreshCw,
  Sparkles,
  Trash2,
  Save,
  Hand,
  Settings2
} from "../components/ui/glyphs";

import { Spinner, Working } from "../components/ui/working";
import { Failed } from "../components/ui/states";
const NO_CHAPTERS: ReadonlyArray<ChapterMeta> = [];

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
}

interface BookData {
  readonly book: {
    readonly id: string;
    readonly title: string;
    readonly genre: string;
    readonly status: string;
    readonly chapterWordCount: number;
    readonly targetChapters?: number;
    readonly language?: string;
    readonly fanficMode?: string;
  };
  readonly chapters: ReadonlyArray<ChapterMeta>;
  readonly nextChapter: number;
}

type ReviseMode = "spot-fix" | "polish" | "rewrite" | "rework" | "anti-detect";
type ExportFormat = "txt" | "md" | "epub";
type BookStatus = "active" | "paused" | "outlining" | "completed" | "dropped";

interface Nav {
  toDashboard: () => void;
  toChapter: (bookId: string, num: number) => void;
  toAnalytics: (bookId: string) => void;
  toTruth: (bookId: string) => void;
}

function translateChapterStatus(status: string, t: TFunction): string {
  const map: Record<string, () => string> = {
    "ready-for-review": () => t("chapter.readyForReview"),
    "approved": () => t("chapter.approved"),
    "drafted": () => t("chapter.drafted"),
    "needs-revision": () => t("chapter.needsRevision"),
    "imported": () => t("chapter.imported"),
    "audit-failed": () => t("chapter.auditFailed"),
  };
  return map[status]?.() ?? status;
}

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  "ready-for-review": { color: "text-warning bg-warning/10", icon: <Eye size={12} /> },
  approved: { color: "text-success bg-success/10", icon: <Check size={12} /> },
  drafted: { color: "text-muted-foreground bg-muted/20", icon: <FileText size={12} /> },
  "needs-revision": { color: "text-destructive bg-destructive/10", icon: <RotateCcw size={12} /> },
  imported: { color: "text-(--ink-2) bg-(--putty-2)", icon: <Download size={12} /> },
};

export function BookDetail({
  bookId,
  nav,
  theme,
  t,
  sse,
}: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  sse: { messages: ReadonlyArray<SSEMessage> };
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<BookData>(`/books/${bookId}`);
  /* Derived server-side from the chapter index and the findings store, so it
     cannot drift from either the way a stored status string does. */
  const { data: flow } = useApi<{ workflow: Workflow }>(`/books/${bookId}/workflow`);
  const workflow = flow?.workflow ?? null;
  const [writeRequestPending, setWriteRequestPending] = useState(false);
  const [draftRequestPending, setDraftRequestPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [rewritingChapters, setRewritingChapters] = useState<ReadonlyArray<number>>([]);
  const [revisingChapters, setRevisingChapters] = useState<ReadonlyArray<number>>([]);
  const [syncingChapters, setSyncingChapters] = useState<ReadonlyArray<number>>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsWordCount, setSettingsWordCount] = useState<number | null>(null);
  const [settingsTargetChapters, setSettingsTargetChapters] = useState<number | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<BookStatus | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("txt");
  const [exportApprovedOnly, setExportApprovedOnly] = useState(false);
  const [bookActionPending, setBookActionPending] = useState<string | null>(null);
  // Auto (pipeline self-reviews) vs manual (write the draft and stop; you
  // run audit / revise / approve as checkpoint actions). This is scoped to
  // the current book, with project-level mode as the inherited default.
  const [reviewMode, setReviewMode] = useState<"auto" | "manual">("auto");
  useEffect(() => {
    void fetchJson<{ mode?: string }>(`/books/${encodeURIComponent(bookId)}/chapter-review-mode`)
      .then((r) => setReviewMode(r.mode === "manual" ? "manual" : "auto"))
      .catch(() => undefined);
  }, [bookId]);
  const activity = useMemo(() => deriveBookActivity(sse.messages, bookId), [bookId, sse.messages]);
  const writing = writeRequestPending || activity.writing;
  const drafting = draftRequestPending || activity.drafting;
  const latestPersistedChapter = data ? data.nextChapter - 1 : 0;

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;

    const data = recent.data as { bookId?: string } | null;
    if (data?.bookId !== bookId) return;

    if (recent.event === "write:start") {
      setWriteRequestPending(false);
      return;
    }

    if (recent.event === "draft:start") {
      setDraftRequestPending(false);
      return;
    }

    if (shouldRefetchBookView(recent, bookId)) {
      setWriteRequestPending(false);
      setDraftRequestPending(false);
      refetch();
    }
  }, [bookId, refetch, sse.messages]);

  const handleWriteNext = async () => {
    setWriteRequestPending(true);
    try {
      await postApi(`/books/${bookId}/write-next`);
    } catch (e) {
      setWriteRequestPending(false);
      toastError(e, "Could not start the next chapter.");
    }
  };

  const handleDraft = async () => {
    setDraftRequestPending(true);
    try {
      await postApi(`/books/${bookId}/draft`);
    } catch (e) {
      setDraftRequestPending(false);
      toastError(e, "Could not start the draft.");
    }
  };

  const handleToggleReviewMode = async () => {
    const next = reviewMode === "manual" ? "auto" : "manual";
    setReviewMode(next);
    try {
      await fetchJson(`/books/${encodeURIComponent(bookId)}/chapter-review-mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
    } catch {
      setReviewMode(reviewMode); // revert on failure
    }
  };

  const handleDeleteBook = async () => {
    setConfirmDeleteOpen(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/books/${bookId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `${res.status}`);
      }
      nav.toDashboard();
    } catch (e) {
      toastError(e, "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const handleRewrite = async (chapterNum: number) => {
    const brief = window.prompt(
      data?.book.language === "en"
        ? "Optional rewrite brief for this run only. Leave blank to use existing focus."
        : "可选：输入这次重写要遵循的补充想法。留空则沿用现有 focus。",
      "",
    );
    if (brief === null) return;
    setRewritingChapters((prev) => [...prev, chapterNum]);
    try {
      await fetchJson(`/books/${bookId}/rewrite/${chapterNum}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brief.trim() || undefined }),
      });
      refetch();
    } catch (e) {
      toastError(e, "Rewrite failed.");
    } finally {
      setRewritingChapters((prev) => prev.filter((n) => n !== chapterNum));
    }
  };

  const handleRevise = async (chapterNum: number, mode: ReviseMode) => {
    const brief = window.prompt(
      data?.book.language === "en"
        ? "Optional revise brief for this run only. Leave blank to use existing focus."
        : "可选：输入这次修订要遵循的补充想法。留空则沿用现有 focus。",
      "",
    );
    if (brief === null) return;
    setRevisingChapters((prev) => [...prev, chapterNum]);
    try {
      await fetchJson(`/books/${bookId}/revise/${chapterNum}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, brief: brief.trim() || undefined }),
      });
      refetch();
    } catch (e) {
      toastError(e, "Revision failed.");
    } finally {
      setRevisingChapters((prev) => prev.filter((n) => n !== chapterNum));
    }
  };

  const handleSync = async (chapterNum: number) => {
    const brief = window.prompt(
      data?.book.language === "en"
        ? "Optional sync brief for interpreting the edited chapter body. Leave blank to sync directly from the text."
        : "可选：输入这次同步时要遵循的补充说明。留空则直接按正文同步。",
      "",
    );
    if (brief === null) return;
    setSyncingChapters((prev) => [...prev, chapterNum]);
    try {
      await fetchJson(`/books/${bookId}/resync/${chapterNum}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brief.trim() || undefined }),
      });
      refetch();
    } catch (e) {
      toastError(e, "Sync failed.");
    } finally {
      setSyncingChapters((prev) => prev.filter((n) => n !== chapterNum));
    }
  };

  const handleSaveSettings = async () => {
    if (!data) return;
    setSavingSettings(true);
    try {
      const body: Record<string, unknown> = {};
      if (settingsWordCount !== null) body.chapterWordCount = settingsWordCount;
      if (settingsTargetChapters !== null) body.targetChapters = settingsTargetChapters;
      if (settingsStatus !== null) body.status = settingsStatus;
      await fetchJson(`/books/${bookId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      refetch();
    } catch (e) {
      toastError(e, "Save failed.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleApproveAll = async () => {
    if (!data) return;
    const reviewable = data.chapters.filter((ch) => ch.status === "ready-for-review");
    let failed = 0;
    for (const chapter of reviewable) {
      try {
        await postApi(`/books/${bookId}/chapters/${chapter.number}/approve`);
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      toast(`${failed}/${reviewable.length} approve(s) failed`, "bad");
    }
    refetch();
  };

  const runBookAction = async (key: string, action: () => Promise<string>) => {
    setBookActionPending(key);
    try {
      toast(await action());
      refetch();
    } catch (e) {
      toastError(e, "Action failed.");
    } finally {
      setBookActionPending(null);
    }
  };

  const handleEvaluate = async () => {
    await runBookAction("eval", async () => {
      const result = await fetchJson<{
        qualityScore: number;
        totalChapters: number;
        totalWords: number;
        auditPassRate: number;
        avgAiTellDensity: number;
        hookResolveRate: number;
      }>(`/books/${bookId}/eval`);
      return [
        `${t("book.evaluate")}: ${result.qualityScore}/100`,
        `${t("dash.chapters")}: ${result.totalChapters}`,
        `${t("book.words")}: ${result.totalWords.toLocaleString()}`,
        `Audit: ${result.auditPassRate}%`,
        `AI tells: ${result.avgAiTellDensity}/1k`,
        `Hooks: ${result.hookResolveRate}%`,
      ].join("\n");
    });
  };

  const handleConsolidate = async () => {
    await runBookAction("consolidate", async () => {
      const result = await fetchJson<{ archivedVolumes?: number; retainedChapters?: number }>(`/books/${bookId}/consolidate`, {
        method: "POST",
      });
      return data?.book.language === "en"
        ? `Consolidated ${result.archivedVolumes ?? 0} volume(s). Retained ${result.retainedChapters ?? 0} recent chapter summaries.`
        : `已归并 ${result.archivedVolumes ?? 0} 个卷摘要，保留最近 ${result.retainedChapters ?? 0} 条章节摘要。`;
    });
  };

  const handleReviseFoundation = async () => {
    const feedback = window.prompt(
      data?.book.language === "en"
        ? "Foundation revision feedback. This rewrites the book foundation, not chapter body."
        : "输入重修基础设定的反馈。此操作会重写基础设定，不直接改正文。",
      "",
    );
    if (!feedback?.trim()) return;
    await runBookAction("revise-foundation", async () => {
      await fetchJson(`/books/${bookId}/foundation/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      return data?.book.language === "en" ? "Foundation revised." : "基础设定已重修。";
    });
  };

  const handlePlan = async () => {
    const context = window.prompt(
      data?.book.language === "en"
        ? "Optional planning context for the next chapter."
        : "可选：下一章规划补充说明。",
      "",
    );
    if (context === null) return;
    await runBookAction("plan", async () => {
      const result = await fetchJson<{ chapterNumber?: number; title?: string }>(`/books/${bookId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: context.trim() || undefined }),
      });
      return data?.book.language === "en"
        ? `Planned chapter ${result.chapterNumber ?? "?"}: ${result.title ?? ""}`
        : `已计划第 ${result.chapterNumber ?? "?"} 章：${result.title ?? ""}`;
    });
  };

  const handleCompose = async () => {
    const context = window.prompt(
      data?.book.language === "en"
        ? "Optional compose context for the next chapter."
        : "可选：下一章组装补充说明。",
      "",
    );
    if (context === null) return;
    await runBookAction("compose", async () => {
      const result = await fetchJson<{ chapterNumber?: number; title?: string }>(`/books/${bookId}/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: context.trim() || undefined }),
      });
      return data?.book.language === "en"
        ? `Composed chapter ${result.chapterNumber ?? "?"}: ${result.title ?? ""}`
        : `已组装第 ${result.chapterNumber ?? "?"} 章：${result.title ?? ""}`;
    });
  };

  const handleRepairState = async (chapterNum: number) => {
    await runBookAction(`repair-state-${chapterNum}`, async () => {
      await fetchJson(`/books/${bookId}/repair-state/${chapterNum}`, { method: "POST" });
      return data?.book.language === "en" ? `Chapter ${chapterNum} state repaired.` : `第 ${chapterNum} 章状态已修复。`;
    });
  };

  const chapterRows = useArrivals(data?.chapters ?? NO_CHAPTERS, (c) => String(c.number));

  if (loading) return (
    <div className="space-y-8" aria-busy="true">
      <div className="space-y-3 border-b border-border/40 pb-8">
        <div className="skel h-10 w-2/5" />
        <div className="skel h-4 w-1/3" />
      </div>
      <div className="skel h-32 w-full rounded-2xl" />
      <div className="skel h-64 w-full rounded-2xl" />
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );

  if (error) return <Failed what="This book would not open." detail={error} />;
  if (!data) return null;

  const { book, chapters } = data;
  const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount ?? 0), 0);
  const reviewCount = chapters.filter((ch) => ch.status === "ready-for-review").length;

  const currentWordCount = settingsWordCount ?? book.chapterWordCount;
  const currentTargetChapters = settingsTargetChapters ?? book.targetChapters ?? 0;
  const currentStatus = settingsStatus ?? (book.status as BookStatus);

  const exportHref = `/api/v1/books/${bookId}/export?format=${exportFormat}${exportApprovedOnly ? "&approvedOnly=true" : ""}`;

  return (
    <div className="space-y-8 fade-in">
      {/* Breadcrumbs */}
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border/40 pb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="h-page">{book.title}</h1>
            {book.language === "en" && (
              <span className="pill text-primary text-cap font-bold">EN</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground font-medium">
            <span className="pill">{book.genre}</span>
            <div className="flex items-center gap-1.5">
              <FileText size={14} />
              <span><Num value={chapters.length} /> {t("dash.chapters")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap size={14} />
              <span><Num value={totalWords} /> {t("book.words")}</span>
            </div>
            {book.fanficMode && (
              <span className="flex items-center gap-1 text-primary">
                <Sparkles size={12} />
                <span>fanfic:{book.fanficMode}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleWriteNext}
            disabled={writing || drafting}
            className="btn"
          >
            {writing ? <Spinner /> : <Zap size={16} />}
            {writing ? t("dash.writing") : t("book.writeNext")}
          </button>
          <button
            onClick={handleDraft}
            disabled={writing || drafting}
            className="btn btn-line"
          >
            {drafting ? <Spinner /> : <Wand2 size={16} />}
            {drafting ? t("book.drafting") : t("book.draftOnly")}
          </button>
          <button
            onClick={handleToggleReviewMode}
            title={reviewMode === "manual"
              ? "手动审查：写完即停，由你点 审稿/修订/通过（更快、更可控）。点此切回自动。"
              : "自动审查：写完自动审校并按需重写（更省心，但更慢）。点此切到手动·写完即停。"}
            className="btn btn-line"
          >
            {reviewMode === "manual" ? <Hand size={16} /> : <Settings2 size={16} />}
            {reviewMode === "manual" ? "审查：手动·写完即停" : "审查：自动"}
          </button>
          <button
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={deleting}
            className="btn btn-bad"
          >
            {deleting ? <Spinner /> : <Trash2 size={16} />}
            {deleting ? <><Spinner /> {t("book.deleteBook")}</> : t("book.deleteBook")}
          </button>
        </div>
      </div>

      {(writing || drafting || activity.lastError) && (
        activity.lastError ? (
          <RunError message={activity.lastError} />
        ) : (
          <div className="notice">
            <Working kind="writing" label={writing ? t("book.pipelineWriting") : t("book.pipelineDrafting")} />
          </div>
        )
      )}

      {/*
       * Where this book has got to, and what is holding the next decision.
       *
       * A magazine has had stages and named gate blockers since Phase 4; a
       * book had twelve chapter status strings and nothing that turned them
       * into an answer. The approve route already refuses over a finding that
       * contradicts the book - this is where that is said before the button is
       * pressed rather than as a 409 after it.
       */}
      {workflow ? (
        <WorkflowBar workflow={workflow} label="be called finished">
          <div className="cols cols-2">
            {workflow.gates.map((g) => (
              <GateCard
                key={g.name}
                gate={g}
                /* Only the copy gate is a decision a person makes here. The
                   audit gate is cleared by settling findings on the audit
                   screen, so a button on it would be a button that lies. */
                onApprove={g.name === "copy" && reviewCount > 0 ? handleApproveAll : undefined}
              />
            ))}
          </div>
        </WorkflowBar>
      ) : null}

      {/* Tool Strip */}
      <div className="flex flex-wrap items-center gap-2 py-1">
          {reviewCount > 0 && (
            <button
              onClick={handleApproveAll}
              className="btn btn-sm"
            >
              <CheckCheck size={14} />
              {t("book.approveAll")} ({reviewCount})
            </button>
          )}
          <button
            onClick={() => nav.toTruth(bookId)}
            className="btn btn-line text-xs"
          >
            <Database size={14} />
            {t("book.truthFiles")}
          </button>
          <button
            onClick={() => nav.toAnalytics(bookId)}
            className="btn btn-line text-xs"
          >
            <BarChart2 size={14} />
            {t("book.analytics")}
          </button>
          <button
            onClick={handleEvaluate}
            disabled={bookActionPending === "eval"}
            className="btn btn-line text-xs disabled:opacity-50"
          >
            <Search size={14} />
            {bookActionPending === "eval" ? <><Spinner /> {t("book.evaluate")}</> : t("book.evaluate")}
          </button>
          <button
            onClick={handleConsolidate}
            disabled={bookActionPending === "consolidate"}
            className="btn btn-line text-xs disabled:opacity-50"
          >
            <Database size={14} />
            {bookActionPending === "consolidate" ? <><Spinner /> {t("book.consolidate")}</> : t("book.consolidate")}
          </button>
          <button
            onClick={handleReviseFoundation}
            disabled={bookActionPending === "revise-foundation"}
            className="btn btn-line text-xs disabled:opacity-50"
          >
            <Sparkles size={14} />
            {bookActionPending === "revise-foundation" ? <><Spinner /> {t("book.reviseFoundation")}</> : t("book.reviseFoundation")}
          </button>
          <button
            onClick={handlePlan}
            disabled={bookActionPending === "plan"}
            className="btn btn-line text-xs disabled:opacity-50"
          >
            <FileText size={14} />
            {bookActionPending === "plan" ? <><Spinner /> {t("book.planNext")}</> : t("book.planNext")}
          </button>
          <button
            onClick={handleCompose}
            disabled={bookActionPending === "compose"}
            className="btn btn-line text-xs disabled:opacity-50"
          >
            <Wand2 size={14} />
            {bookActionPending === "compose" ? <><Spinner /> {t("book.composeNext")}</> : t("book.composeNext")}
          </button>
          <div className="flex items-center gap-2">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              className="input w-auto py-1.5 px-2.5 text-small text-muted-foreground"
            >
              <option value="txt">TXT</option>
              <option value="md">MD</option>
              <option value="epub">EPUB</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={exportApprovedOnly}
                onChange={(e) => setExportApprovedOnly(e.target.checked)}
                className="rounded border-border/50"
              />
              {t("book.approvedOnly")}
            </label>
            <button
              onClick={async () => {
                try {
                  const data = await fetchJson<{ path?: string; chapters?: number }>(`/books/${bookId}/export-save`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ format: exportFormat, approvedOnly: exportApprovedOnly }),
                  });
                  toast(`${t("common.exportSuccess")}: ${data.path} (${data.chapters} ${t("dash.chapters")})`);
                } catch (e) {
                  toastError(e, "Export failed.");
                }
              }}
              className="btn btn-line text-xs"
            >
              <Download size={14} />
              {t("book.export")}
            </button>
          </div>
      </div>

      {/* Book Settings */}
      <div className="panel">
        <h2 className="label mb-4">{t("book.settings")}</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="label">{t("create.wordsPerChapter")}</label>
            <input
              type="number"
              value={currentWordCount}
              onChange={(e) => setSettingsWordCount(Number(e.target.value))}
              className="input w-32"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="label">{t("create.targetChapters")}</label>
            <input
              type="number"
              value={currentTargetChapters}
              onChange={(e) => setSettingsTargetChapters(Number(e.target.value))}
              className="input w-32"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="label">{t("book.status")}</label>
            <select
              value={currentStatus}
              onChange={(e) => setSettingsStatus(e.target.value as BookStatus)}
              className="input"
            >
              <option value="active">{t("book.statusActive")}</option>
              <option value="paused">{t("book.statusPaused")}</option>
              <option value="outlining">{t("book.statusOutlining")}</option>
              <option value="completed">{t("book.statusCompleted")}</option>
              <option value="dropped">{t("book.statusDropped")}</option>
            </select>
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="btn flex items-center gap-2"
          >
            {savingSettings ? <Spinner /> : <Save size={14} />}
            {savingSettings ? t("book.saving") : t("book.save")}
          </button>
        </div>
      </div>

      {/* Chapters Table */}
      <div className="panel panel-flush overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                <th className="label text-left px-6 py-4 w-16">#</th>
                <th className="label text-left px-6 py-4">{t("book.manuscriptTitle")}</th>
                <th className="label text-left px-6 py-4 w-28">{t("book.words")}</th>
                <th className="label text-left px-6 py-4 w-36">{t("book.status")}</th>
                <th className="label text-right px-6 py-4">{t("book.curate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {chapterRows.map(({ item: ch, motion }) => {
                return (
                <tr key={ch.number} className={`group hover:bg-primary/[0.02] transition-colors${motion ? ` ${motion}` : ""}`}>
                  <td className="px-6 py-4 text-muted-foreground/60 font-mono text-xs">{ch.number.toString().padStart(2, '0')}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => nav.toChapter(bookId, ch.number)}
                      style={vtName(`${bookId}-ch${ch.number}`)}
                      className="title text-lg font-medium hover:text-primary transition-colors text-left"
                    >
                      {ch.title || t("chapter.label").replace("{n}", String(ch.number))}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground font-medium tabular-nums text-xs"><Num value={ch.wordCount ?? 0} /></td>
                  <td className="px-6 py-4">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-cap font-bold uppercase tracking-tight ${STATUS_CONFIG[ch.status]?.color ?? "bg-muted text-muted-foreground"}`}>
                      {STATUS_CONFIG[ch.status]?.icon}
                      {translateChapterStatus(ch.status, t)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {ch.status === "ready-for-review" && (
                        <>
                          <button
                            onClick={async () => {
                              try { await postApi(`/books/${bookId}/chapters/${ch.number}/approve`); refetch(); }
                              catch (e) { toastError(e, "Approve failed."); }
                            }}
                            className="btn btn-quiet btn-icon"
                            title={t("book.approve")}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={async () => {
                              try { await postApi(`/books/${bookId}/chapters/${ch.number}/reject`); refetch(); }
                              catch (e) { toastError(e, "Reject failed."); }
                            }}
                            className="btn btn-bad"
                            title={t("book.reject")}
                          >
                            <X size={14} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={async () => {
                          try {
                            const auditResult = await fetchJson<{ passed?: boolean; issues?: unknown[] }>(`/books/${bookId}/audit/${ch.number}`, { method: "POST" });
                            toast(auditResult.passed ? "Audit passed" : `Audit found ${auditResult.issues?.length ?? 0} issues`, auditResult.passed ? undefined : "bad");
                            refetch();
                          } catch (e) {
                            toastError(e, "Audit failed.");
                          }
                        }}
                        className="btn btn-quiet btn-icon"
                        title={t("book.audit")}
                      >
                        <ShieldCheck size={14} />
                      </button>
                      <button
                        onClick={() => handleRewrite(ch.number)}
                        disabled={rewritingChapters.includes(ch.number)}
                        className="btn btn-quiet btn-icon"
                        title={t("book.rewrite")}
                      >
                        {rewritingChapters.includes(ch.number)
                          ? <Spinner />
                          : <RotateCcw size={14} />}
                      </button>
                      <button
                        onClick={() => handleSync(ch.number)}
                        disabled={syncingChapters.includes(ch.number) || ch.number !== latestPersistedChapter}
                        className="btn btn-quiet btn-icon"
                        title={data?.book.language === "en" ? "Sync truth/state from edited chapter" : "根据已编辑章节同步 truth/state"}
                      >
                        {syncingChapters.includes(ch.number)
                          ? <Spinner />
                          : <RefreshCw size={14} />}
                      </button>
                      {ch.status === "state-degraded" && (
                        <button
                          onClick={() => handleRepairState(ch.number)}
                          disabled={bookActionPending === `repair-state-${ch.number}`}
                          className="btn btn-quiet btn-icon"
                          title={t("book.repairState")}
                        >
                          {bookActionPending === `repair-state-${ch.number}`
                            ? <Spinner />
                            : <Settings2 size={14} />}
                        </button>
                      )}
                      <select
                        disabled={revisingChapters.includes(ch.number)}
                        value=""
                        onChange={(e) => {
                          const mode = e.target.value as ReviseMode;
                          if (mode) handleRevise(ch.number, mode);
                        }}
                        className="input w-auto py-1.5 px-2.5 text-small text-muted-foreground"
                        title="Revise with AI"
                      >
                        <option value="" disabled>{revisingChapters.includes(ch.number) ? `${t("book.curate")}…` : t("book.curate")}</option>
                        <option value="spot-fix">{t("book.spotFix")}</option>
                        <option value="polish">{t("book.polish")}</option>
                        <option value="rewrite">{t("book.rewrite")}</option>
                        <option value="rework">{t("book.rework")}</option>
                        <option value="anti-detect">{t("book.antiDetect")}</option>
                      </select>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {chapters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="glyph w-12 h-12 mb-4">
               <FileText size={20} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm italic font-serif text-muted-foreground">
              {t("book.noChapters")}
            </p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t("book.deleteBook")}
        message={t("book.confirmDelete")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleDeleteBook}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
