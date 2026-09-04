/*
 * The chapter. Mocks 06 (read) and 07 (judge).
 *
 * One screen, not two: the verdict bar appears on the same card when the
 * chapter is at the gate. Reading it and deciding on it are the same sitting,
 * and a separate review screen meant reading the prose twice.
 *
 * Charcoal, because this is the work itself. Everything around it stays putty.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchJson, useApi, postApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import type { ChapterSummary } from "../shared/contracts";
import { ChapterWorkspacePanel } from "../components/ChapterWorkspacePanel";
import { Icon } from "../components/ui/icon";
import { toast } from "../components/ui/vermilion";
import { READING_SIZES, useReadingPrefs } from "../hooks/use-reading-prefs";

interface ChapterData {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

interface Nav {
  readonly toBook: (id: string) => void;
  readonly toAudit: () => void;
  readonly toChapter: (bookId: string, chapterNumber: number) => void;
}

/** The title is the first h1 in the file; the rest is the prose. */
export function splitChapter(content: string, chapterNumber: number) {
  const lines = content.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  return {
    title: titleLine?.replace(/^#\s*/, "").trim() || `Chapter ${chapterNumber}`,
    body: lines.filter((l) => l !== titleLine).join("\n").trim(),
  };
}

export function ChapterReader({
  bookId,
  chapterNumber,
  nav,
  t,
}: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly nav: Nav;
  readonly t: TFunction;
}) {
  const { data, loading, error, refetch } = useApi<ChapterData>(
    `/books/${bookId}/chapters/${chapterNumber}`,
  );
  /* The prose comes from one route and everything true *about* it - status,
     word count, findings - from the book's chapter index. */
  const { data: book, refetch: refetchBook } = useApi<{
    book: { title: string };
    chapters: readonly ChapterSummary[];
  }>(`/books/${bookId}`);

  const { prefs, set, vars } = useReadingPrefs();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);

  const meta = book?.chapters.find((ch) => ch.number === chapterNumber);
  const atTheGate = meta?.status === "ready-for-review";

  // A chapter switched under the reader must not keep the previous one's edit.
  useEffect(() => {
    setEditing(false);
    setDraft("");
    setNote("");
  }, [bookId, chapterNumber]);

  const { title, body } = useMemo(
    () => splitChapter(data?.content ?? "", chapterNumber),
    [data?.content, chapterNumber],
  );
  const paragraphs = useMemo(() => body.split(/\n\n+/).filter(Boolean), [body]);

  if (loading && !data) {
    return (
      <div className="empty">
        <span className="spin" />
        <h3>{t("reader.openingManuscript")}</h3>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fail">
        <div>
          <b>That chapter would not open.</b>
          <p style={{ marginTop: 4 }}>{error}</p>
          <button type="button" className="btn btn-line btn-sm" style={{ marginTop: 10 }}
                  onClick={() => nav.toBook(bookId)}>
            Back to the book
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const save = async () => {
    setSaving(true);
    try {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      setEditing(false);
      refetch();
      setWorkspaceRevision((r) => r + 1);
      toast("Saved.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const decide = async (verdict: "approve" | "reject") => {
    setBusy(true);
    try {
      await postApi(
        `/books/${bookId}/chapters/${chapterNumber}/${verdict}`,
        verdict === "reject" && note.trim() ? { note: note.trim() } : undefined,
      );
      toast(
        verdict === "approve"
          ? `Chapter ${chapterNumber} approved.`
          : `Chapter ${chapterNumber} sent back with your note.`,
      );
      refetchBook();
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : `Could not ${verdict} that chapter.`);
    } finally {
      setBusy(false);
    }
  };

  const findings = meta?.auditIssueCount ?? 0;

  return (
    <div className="wrap-read">
      <div className="dark crop" style={{ paddingBottom: editing ? 0 : 30 }}>
        <span className="disc dots dots-light" style={{ width: 230, height: 230, left: -96, bottom: -110 }} />
        <span className="disc stroke" style={{ width: 132, height: 132, right: -58, top: -62, opacity: 0.45 }} />

        <div className="readhead">
          <div className="grow">
            <h2 className="dual" style={{ fontSize: 27.5 }}>
              <span className="provenance">
                {[book?.book.title, meta ? `${meta.wordCount.toLocaleString()} words` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {title}
            </h2>
          </div>
          <div className="numeral" style={{ fontSize: 68 }}>
            {String(chapterNumber).padStart(2, "0")}
          </div>
        </div>

        {/* The reading bar. Size, measure and leading belong to the reader,
            and the values persist per person, not per book. */}
        <div className="readbar">
          <div className="ctl">
            <span>Size</span>
            <div className="seg">
              {READING_SIZES.map((px, i) => (
                <button
                  key={px}
                  type="button"
                  aria-pressed={prefs.size === px}
                  aria-label={["Small", "Medium", "Large"][i]}
                  style={{ fontSize: [11, 14, 17][i] }}
                  onClick={() => set("size", px)}
                >
                  A
                </button>
              ))}
            </div>
          </div>
          <div className="ctl">
            <label htmlFor="rm">Measure</label>
            <input
              className="slider"
              id="rm"
              type="range"
              min={46}
              max={86}
              value={prefs.measure}
              onChange={(e) => set("measure", Number(e.target.value))}
            />
          </div>
          <div className="ctl">
            <label htmlFor="rl">Leading</label>
            <input
              className="slider"
              id="rl"
              type="range"
              min={140}
              max={210}
              value={prefs.leading}
              onChange={(e) => set("leading", Number(e.target.value))}
            />
          </div>
          <div className="grow" />
          {meta ? <span className="pill">{meta.status}</span> : null}
          {findings > 0 ? (
            <button type="button" className="pill pill-warn" onClick={nav.toAudit}>
              {findings} finding{findings === 1 ? "" : "s"}
            </button>
          ) : null}
          {editing ? (
            <>
              <button type="button" className="btn btn-sm" disabled={saving} onClick={() => void save()}>
                {saving ? <span className="spin" /> : <Icon name="check" size={14} />}
                {saving ? t("book.saving") : t("book.save")}
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing(false)}>
                {t("reader.preview")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => {
                setDraft(data.content);
                setEditing(true);
              }}
            >
              <Icon name="pencil" size={14} />
              {t("reader.edit")}
            </button>
          )}
        </div>

        <div style={{ padding: "26px 26px 0" }}>
          {editing ? (
            <textarea
              className="read-field"
              style={{ ...vars, minHeight: "60vh" } as React.CSSProperties}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          ) : (
            <div className="read" style={{ ...vars, color: "var(--on-char)" } as React.CSSProperties}>
              {paragraphs.map((para, i) => (
                <p key={i} className={i === 0 ? "lead" : undefined}>
                  {para}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* The verdict bar. Sticky to the card, not the page: approving never
            means scrolling back up to find the control. Only drawn when there
            is actually a decision to make. */}
        {atTheGate && !editing ? (
          <div className="verdict">
            <button type="button" className="btn" disabled={busy} onClick={() => void decide("approve")}>
              <Icon name="check" size={16} />
              {t("reader.approve")}
            </button>
            <button
              type="button"
              className="btn btn-line"
              disabled={busy}
              onClick={() => void decide("reject")}
            >
              {note.trim() ? "Reject with this note" : "Reject"}
            </button>
            <span className="grow" />
            <span className="muted" style={{ fontSize: 11 }}>
              Approving settles the chapter and starts chapter {chapterNumber + 1}.
            </span>
          </div>
        ) : null}
      </div>

      <div className="rowflex" style={{ justifyContent: "space-between", marginTop: 16 }}>
        <span className="hint">
          Reading settings are yours, not the book’s. They follow you into every chapter.
        </span>
        <div className="rowflex">
          {chapterNumber > 1 ? (
            <button type="button" className="btn btn-quiet btn-sm"
                    onClick={() => nav.toChapter(bookId, chapterNumber - 1)}>
              <Icon name="chevL" size={15} />
              Chapter {chapterNumber - 1}
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet btn-sm"
                  onClick={() => nav.toChapter(bookId, chapterNumber + 1)}>
            Chapter {chapterNumber + 1}
            <Icon name="chevR" size={15} />
          </button>
        </div>
      </div>

      {/* The note is the instruction for the rewrite, so it is written rather
          than chosen from a list of reasons. Only shown when it can be used. */}
      {atTheGate ? (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3 className="h-panel">If you reject it</h3>
          <p className="note" style={{ fontSize: 14 }}>
            The note is the instruction for the rewrite. The draft stays on disk either way.
          </p>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="reject-note">What is wrong with it</label>
            <textarea
              className="input"
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="The limp swapped legs. Chapter 3 has it on the left."
            />
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <ChapterWorkspacePanel
          key={`${chapterNumber}-${workspaceRevision}`}
          bookId={bookId}
          chapterNumber={chapterNumber}
          t={t}
          onChapterChanged={refetch}
          onChapterDeleted={() => nav.toBook(bookId)}
        />
      </div>
    </div>
  );
}
