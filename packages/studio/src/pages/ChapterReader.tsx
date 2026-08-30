import { useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { ChapterWorkspacePanel } from "../components/ChapterWorkspacePanel";
import {
  ChevronLeft,
  Check,
  X,
  List,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Hash,
  Type,
  Clock,
  Pencil,
  Save,
  Eye,
} from "lucide-react";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function ChapterReader({ bookId, chapterNumber, nav, theme, t }: {
  bookId: string;
  chapterNumber: number;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);

  const handleStartEdit = () => {
    if (!data) return;
    setEditContent(data.content);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      setEditing(false);
      refetch();
      setWorkspaceRevision((revision) => revision + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return (
    <div className="flex flex-col items-center justify-center py-32 space-y-4">
      <div className="q-spin-ring" />
      <span className="text-sm text-muted-foreground">{t("reader.openingManuscript")}</span>
    </div>
  );

  if (error) return <div className="text-destructive p-8 bg-destructive/5 rounded-xl border border-destructive/20">Error: {error}</div>;
  if (!data) return null;

  // Split markdown content into title and body
  const lines = data.content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine?.replace(/^#\s*/, "") ?? `Chapter ${chapterNumber}`;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();

  const handleApprove = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/approve`);
      nav.toBook(bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed");
    }
  };

  const handleReject = async () => {
    try {
      await postApi(`/books/${bookId}/chapters/${chapterNumber}/reject`);
      nav.toBook(bookId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    }
  };

  const paragraphs = body.split(/\n\n+/).filter(Boolean);

  return (
    <div className="w-full space-y-10 fade-in">
      {/* Navigation & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <nav className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <button
            onClick={nav.toDashboard}
            className="hover:text-primary transition-colors flex items-center gap-1"
          >
            {t("bread.books")}
          </button>
          <span className="text-border">/</span>
          <button
            onClick={() => nav.toBook(bookId)}
            className="hover:text-primary transition-colors truncate max-w-[120px]"
          >
            {bookId}
          </button>
          <span className="text-border">/</span>
          <span className="text-foreground flex items-center gap-1">
            <Hash size={12} />
            {chapterNumber}
          </span>
        </nav>

        <div className="flex gap-2">
          <button
            onClick={() => nav.toBook(bookId)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground hover:bg-secondary/80 transition-all border border-border/50"
          >
            <List size={14} />
            {t("reader.backToList")}
          </button>

          {/* Edit / Preview toggle */}
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-xl hover:-translate-y-px active:translate-y-0 active:scale-[0.985] transition-all shadow-sm disabled:opacity-50"
              >
                {saving ? <div className="w-3.5 h-3.5 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Save size={14} />}
                {saving ? t("book.saving") : t("book.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-foreground transition-all border border-border/50"
              >
                <Eye size={14} />
                {t("reader.preview")}
              </button>
            </>
          ) : (
            <button
              onClick={handleStartEdit}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-secondary text-muted-foreground rounded-xl hover:text-primary hover:bg-primary/10 transition-all border border-border/50"
            >
              <Pencil size={14} />
              {t("reader.edit")}
            </button>
          )}

          <button
            onClick={handleApprove}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-success/10 text-success rounded-xl hover:bg-success hover:text-white transition-all border border-success/20 shadow-sm"
          >
            <CheckCircle2 size={14} />
            {t("reader.approve")}
          </button>
          <button
            onClick={handleReject}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-destructive/10 text-destructive rounded-xl hover:bg-destructive hover:text-white transition-all border border-destructive/20 shadow-sm"
          >
            <XCircle size={14} />
            {t("reader.reject")}
          </button>
        </div>
      </div>

      <ChapterWorkspacePanel
        key={`${chapterNumber}-${workspaceRevision}`}
        bookId={bookId}
        chapterNumber={chapterNumber}
        t={t}
        onChapterChanged={refetch}
        onChapterDeleted={() => nav.toBook(bookId)}
      />

      {/* Manuscript Sheet */}
      <div className="q-crop paper-sheet relative min-h-[80vh] rounded-3xl border border-border/60 p-8 shadow-md md:p-16 lg:p-24">
        {/* One disc, cut by the sheet's own corner. The old sheet drew two
            faint vertical hairlines to suggest paper; they read as rendering
            artefacts on an LCD, which is the opposite of the intent. */}
        <span className="q-disc q-disc-fill" aria-hidden="true"
              style={{ width: 340, height: 340, right: -150, top: -170, opacity: .09 }} />

        <header className="relative mb-14">
          {/* The chapter number is set as the page's numeral rather than
              hidden in a row of small caps under the title. */}
          <div className="flex items-baseline gap-4">
            <span className="q-numeral text-6xl md:text-7xl">
              {chapterNumber.toString().padStart(2, "0")}
            </span>
            <span className="q-label pb-1">{t("reader.manuscriptPage")}</span>
          </div>
          <h1 className="q-title mt-5 text-4xl md:text-5xl">
            {title}
          </h1>
          <div className="mt-8 h-px w-full bg-border/60" />
        </header>

        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="q-read mx-auto block min-h-[60vh] w-full resize-none rounded-xl border border-border/60 bg-transparent p-6"
            autoFocus
          />
        ) : (
          <article className="q-read relative mx-auto" style={{ "--read-size": "1.15rem" } as React.CSSProperties}>
            {paragraphs.map((para, i) => (
              /* The drop cap belongs to the chapter, not to every paragraph.
                 Set on all of them it stopped being an opening and became a
                 texture down the left margin. */
              <p
                key={i}
                className={i === 0
                  ? "first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:font-sans first-letter:text-[3.1em] first-letter:font-semibold first-letter:leading-[.78] first-letter:text-primary"
                  : undefined}
              >
                {para}
              </p>
            ))}
          </article>
        )}

        <footer className="relative mt-24 flex flex-col items-center gap-6 border-t border-border/40 pt-12 text-center">
          <div className="flex items-center gap-2">
             <span className="q-pill">
               <Type size={13} aria-hidden="true" />
               {body.length.toLocaleString()} {t("reader.characters")}
             </span>
             <span className="q-pill">
               <Clock size={13} aria-hidden="true" />
               {Math.ceil(body.length / 500)} {t("reader.minRead")}
             </span>
          </div>
          <p className="q-label">{t("reader.endOfChapter")}</p>
        </footer>
      </div>

      {/* Footer Navigation */}
      <div className="flex justify-between items-center py-8">
        {chapterNumber > 1 ? (
          <button
            onClick={() => nav.toBook(bookId)}
            className="q-btn q-btn-quiet group"
          >
            <RotateCcw size={16} className="group-hover:-rotate-45 transition-transform" />
            {t("reader.chapterList")}
          </button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
