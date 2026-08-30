import { fetchJson, useApi, postApi } from "../hooks/use-api";
import { useEffect, useMemo, useState, useRef } from "react";
import { useServiceStore } from "../store/service";
import type { SSEMessage } from "../hooks/use-sse";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { deriveActiveBookIds, shouldRefetchBookCollections } from "../hooks/use-book-activity";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  Plus,
  BarChart2,
  Zap,
  Clock,
  CheckCircle2,
  AlertCircle,
  MoreVertical,
  ChevronRight,
  Flame,
  Trash2,
  Settings,
  Download,
  FileInput,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
  readonly language?: string;
  readonly fanficMode?: string;
}

interface Nav {
  toBook: (id: string) => void;
  toBookSettings: (id: string) => void;
  toAnalytics: (id: string) => void;
  toBookCreate: () => void;
  toServices: () => void;
}

function BookMenu({ bookId, bookTitle, nav, t, onDelete, onOpenChange }: {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly nav: Nav;
  readonly t: TFunction;
  readonly onDelete: () => void;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenRaw] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenRaw(next);
    onOpenChange?.(next);
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleDelete = async () => {
    setConfirmDelete(false);
    setOpen(false);
    await fetchJson(`/books/${bookId}`, { method: "DELETE" });
    onDelete();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-3 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 hover:-translate-y-px active:translate-y-0 active:scale-[0.985] transition-all cursor-pointer"
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-xl shadow-lg shadow-primary/5 py-1 z-50 fade-in">
          <button
            onClick={() => { setOpen(false); nav.toBookSettings(bookId); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
          >
            <Settings size={14} className="text-muted-foreground" />
            {t("book.settings")}
          </button>
          <a
            href={`/api/v1/books/${bookId}/export?format=txt`}
            download
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
          >
            <Download size={14} className="text-muted-foreground" />
            {t("book.export")}
          </a>
          <div className="border-t border-border/50 my-1" />
          <button
            onClick={() => { setOpen(false); setConfirmDelete(true); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
            {t("book.deleteBook")}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t("book.deleteBook")}
        message={`${t("book.confirmDelete")}\n\n"${bookTitle}"`}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function Dashboard({ nav, sse, theme, t }: { nav: Nav; sse: { messages: ReadonlyArray<SSEMessage> }; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [menuOpenBookId, setMenuOpenBookId] = useState<string | null>(null);
  const { data, loading, error, refetch } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const writingBooks = useMemo(() => deriveActiveBookIds(sse.messages), [sse.messages]);
  const serviceStoreServices = useServiceStore((s) => s.services);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  useEffect(() => { void fetchServices(); }, [fetchServices]);
  const hasServices = serviceStoreServices.some((s) => s.connected);

  const logEvents = sse.messages.filter((m) => m.event === "log").slice(-8);
  const progressEvent = sse.messages.filter((m) => m.event === "llm:progress").slice(-1)[0];

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!recent) return;
    if (shouldRefetchBookCollections(recent)) {
      refetch();
    }
  }, [refetch, sse.messages]);

  if (loading) return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading the library">
      {[0, 1, 2].map((i) => (
        <div key={i} className="paper-sheet rounded-2xl p-8 grid gap-3">
          <div className="q-skel h-8 w-1/3" />
          <div className="q-skel h-4 w-2/3" />
          <div className="q-skel h-4 w-1/4" />
        </div>
      ))}
      <span className="sr-only">Gathering manuscripts</span>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 bg-destructive/5 border border-destructive/20 rounded-2xl">
      <AlertCircle className="text-destructive mb-4" size={32} />
      <h2 className="text-lg font-semibold text-destructive">Failed to load library</h2>
      <p className="text-sm text-muted-foreground mt-1">{error}</p>
    </div>
  );

  if (!data?.books.length) {
    return (
      /*
        This screen is mostly empty by definition, so what fills it is the
        aurora rather than an ornament. There used to be a decorative disc here
        with the icon inside it at 20% opacity on a 5% ground - invisible, and
        standing in for content it did not have. Removing it lets the serif
        line be the largest thing on the screen, which is what it is for.

        The button keeps its own hover scale but drops `transition-all`, which
        animated every property including colour on its own timing and fought
        the 120ms the rest of the app moves at.
      */
      <div className="flex min-h-[70vh] items-center justify-center fade-in">
        {/* A disc only reads as geometry when an edge cuts it. This was a bare
            flex column before, so the discs floated loose in the page. The card
            is the edge they stop at. */}
        <div className="q-crop w-full max-w-2xl rounded-3xl border border-border/60 bg-card px-10 py-14 shadow-md sm:px-14">
          <span className="q-disc q-disc-fill" aria-hidden="true"
                style={{ width: 300, height: 300, right: -110, top: -120, opacity: .13 }} />
          <span className="q-disc q-disc-stroke" aria-hidden="true"
                style={{ width: 150, height: 150, right: -46, top: -30, opacity: .45 }} />
          <span className="q-disc q-disc-dots text-primary" aria-hidden="true"
                style={{ width: 116, height: 116, left: -34, bottom: -40, opacity: .5 }} />

          <div className="relative">
            <h2 className="text-[2.75rem] font-semibold leading-[1.04] tracking-[-0.04em] text-foreground">
              {t("dash.noBooks")}
            </h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
              {t("dash.createFirst")}
            </p>
            <button
              onClick={nav.toBookCreate}
              className="q-row group mt-10 flex w-full items-center gap-4 border-t border-border/60 pt-6 text-left"
            >
              <span className="q-arrow" aria-hidden="true">
                <Plus size={18} />
              </span>
              <span className="text-base font-semibold tracking-[-0.02em] text-foreground">
                {t("nav.newBook")}
              </span>
              <ChevronRight size={18} className="q-row-act ml-auto text-primary" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {!hasServices && (
        <div className="rounded-lg border border-border/60 bg-card px-5 py-4 mb-8 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">还没有配置 AI 模型</div>
            <div className="text-xs text-muted-foreground mt-0.5">配好一个服务商才能开始创作</div>
          </div>
          <button
            onClick={nav.toServices}
            className="px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shrink-0"
          >
            去配置
          </button>
        </div>
      )}
      <div className="flex items-end justify-between border-b border-border/40 pb-8">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.035em] mb-2">{t("dash.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("dash.subtitle")}</p>
        </div>
        <button
          onClick={nav.toBookCreate}
          className="group flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground shadow-md transition-[transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out-quart)] hover:-translate-y-px hover:shadow-lg active:translate-y-0 active:scale-[0.985]"
        >
          <Plus size={16} />
          {t("nav.newBook")}
        </button>
      </div>

      <div className="grid gap-6">
        {data.books.map((book, index) => {
          const isWriting = writingBooks.has(book.id);
          const staggerClass = `stagger-${Math.min(index + 1, 5)}`;
          return (
            <div
              key={book.id}
              className={`paper-sheet group relative rounded-2xl fade-in q-crop transition-[transform,box-shadow] duration-[var(--dur-med)] ease-[var(--ease-out-quart)] hover:-translate-y-1 hover:shadow-lg ${staggerClass} ${menuOpenBookId === book.id ? "z-50" : ""}`}
            >
              {/* Alternating geometry, so a shelf of books does not repeat the
                  same card three times. Keyed on index, so it is stable. */}
              <span
                className={`q-disc ${index % 3 === 0 ? "q-disc-fill" : index % 3 === 1 ? "q-disc-dots" : "q-disc-stroke"} transition-transform duration-[var(--dur-med)] ease-[var(--ease-out-quart)] group-hover:scale-110`}
                aria-hidden="true"
                style={index % 3 === 1
                  ? { width: 104, height: 104, right: 18, bottom: -30, opacity: .5 }
                  : { width: 132, height: 132, right: -44, top: -46, opacity: index % 3 === 0 ? .16 : .55 }}
              />
              <div className="relative p-8 flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-3 mb-3">
                    {/* The chapter count is the number that matters on this
                        card, so it is set as one instead of hidden in a row of
                        metadata behind an icon that said nothing. */}
                    <span className="q-numeral text-3xl tabular-nums shrink-0">
                      {String(book.chaptersWritten).padStart(2, "0")}
                    </span>
                    <button
                      onClick={() => nav.toBook(book.id)}
                      className="text-2xl font-semibold tracking-[-0.03em] hover:text-primary transition-colors text-left truncate block"
                    >
                      {book.title}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-[13px] text-muted-foreground font-medium">
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-secondary/50">
                      <span className="uppercase tracking-wider">{book.genre}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} />
                      <span>{book.chaptersWritten} {t("dash.chapters")}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${
                        book.status === "active" ? "bg-success" :
                        book.status === "paused" ? "bg-warning" :
                        "bg-muted-foreground"
                      }`} />
                      <span>{
                        book.status === "active" ? t("book.statusActive") :
                        book.status === "paused" ? t("book.statusPaused") :
                        book.status === "outlining" ? t("book.statusOutlining") :
                        book.status === "completed" ? t("book.statusCompleted") :
                        book.status === "dropped" ? t("book.statusDropped") :
                        book.status
                      }</span>
                    </div>
                    {book.language === "en" && (
                      <span className="px-1.5 py-0.5 rounded border border-primary/20 text-primary text-[10px] font-bold">EN</span>
                    )}
                    {book.fanficMode && (
                      <span className="flex items-center gap-1 text-primary">
                        <Zap size={12} />
                        <span className="italic">{book.fanficMode}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-6">
                  <button
                    onClick={async () => {
                      try { await postApi(`/books/${book.id}/write-next`); }
                      catch (e) { alert(e instanceof Error ? e.message : "Write failed"); }
                    }}
                    disabled={isWriting}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-sm ${
                      isWriting
                        ? "bg-primary/20 text-primary cursor-wait animate-pulse"
                        : "bg-secondary text-foreground transition-[transform,box-shadow,background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out-quart)] hover:bg-primary hover:text-primary-foreground hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.985]"
                    }`}
                  >
                    {isWriting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                        {t("dash.writing")}
                      </>
                    ) : (
                      <>
                        <Zap size={16} />
                        {t("dash.writeNext")}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => nav.toAnalytics(book.id)}
                    className="p-3 rounded-xl bg-secondary text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 hover:shadow-md hover:-translate-y-px active:translate-y-0 active:scale-[0.985] transition-all border border-border/50 shadow-sm"
                    title={t("dash.stats")}
                  >
                    <BarChart2 size={18} />
                  </button>
                  <BookMenu
                    bookId={book.id}
                    bookTitle={book.title}
                    nav={nav}
                    t={t}
                    onDelete={() => refetch()}
                    onOpenChange={(isOpen) => setMenuOpenBookId(isOpen ? book.id : null)}
                  />
                </div>
              </div>

              {/* Enhanced progress indicator */}
              {isWriting && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-secondary overflow-hidden">
                   <div className="h-full bg-primary w-1/3 animate-[progress_2s_ease-in-out_infinite]" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modern writing progress panel */}
      {writingBooks.size > 0 && logEvents.length > 0 && (
        <div className="glass-panel rounded-2xl p-8 border-primary/20 bg-primary/[0.02] shadow-2xl shadow-primary/5 fade-in">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <Flame size={18} className="animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-primary"> Manuscript Foundry</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Real-time LLM generation tracking</p>
              </div>
            </div>
            {progressEvent && (
              <div className="flex items-center gap-4 text-xs font-bold text-primary px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
                <div className="flex items-center gap-2">
                  <Clock size={12} />
                  <span>{Math.round(((progressEvent.data as { elapsedMs?: number })?.elapsedMs ?? 0) / 1000)}s</span>
                </div>
                <div className="w-px h-3 bg-primary/20" />
                <div className="flex items-center gap-2">
                  <Zap size={12} />
                  <span>{((progressEvent.data as { totalChars?: number })?.totalChars ?? 0).toLocaleString()} Chars</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 font-mono text-xs bg-black/5 dark:bg-black/20 p-6 rounded-xl border border-border/50 max-h-[200px] overflow-y-auto scrollbar-thin">
            {logEvents.map((msg, i) => {
              const d = msg.data as { tag?: string; message?: string };
              return (
                <div key={i} className="flex gap-3 leading-relaxed animate-in fade-in slide-in-from-left-2 duration-300">
                  <span className="text-primary/60 font-bold shrink-0">[{d.tag}]</span>
                  <span className="text-muted-foreground">{d.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
