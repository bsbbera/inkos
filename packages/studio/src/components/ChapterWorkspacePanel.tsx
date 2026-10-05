import { useEffect, useState } from "react";
import {
  History,
  Lightbulb,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "./ui/glyphs";
import type { TFunction } from "../hooks/use-i18n";
import { fetchJson, useApi } from "../hooks/use-api";
import { ask } from "./ConfirmDialog";

import { Spinner } from "./ui/working";
import { Failed, Loading } from "./ui/states";
interface ChapterVersion {
  readonly id: string;
  readonly source: "manual" | "agent" | "revision" | "regeneration" | "restore";
  readonly createdAt: string;
  readonly characterCount: number;
}

interface ChapterWorkspace {
  readonly chapterNumber: number;
  readonly brief: string;
  readonly plan: string | null;
  readonly versions: ReadonlyArray<ChapterVersion>;
  readonly canDelete: boolean;
}

interface VersionContent {
  readonly content: string;
}

interface InspirationResult {
  readonly card: string;
}

type BusyAction = "save" | "rewrite" | "inspiration" | "restore" | "delete" | null;

export function ChapterWorkspacePanel({
  bookId,
  chapterNumber,
  t,
  onChapterChanged,
  onChapterDeleted,
}: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly t: TFunction;
  readonly onChapterChanged: () => void;
  readonly onChapterDeleted: () => void;
}) {
  const path = `/books/${bookId}/chapters/${chapterNumber}/workspace`;
  const { data, loading, error, refetch } = useApi<ChapterWorkspace>(path);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [inspiration, setInspiration] = useState("");
  const [versionPreview, setVersionPreview] = useState<{ id: string; content: string } | null>(null);

  useEffect(() => {
    if (data) setBrief(data.brief);
  }, [data]);

  const runAction = async (action: Exclude<BusyAction, null>, task: () => Promise<void>) => {
    setBusy(action);
    setNotice("");
    setActionError("");
    try {
      await task();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const saveBrief = () => runAction("save", async () => {
    await fetchJson(`${path}/brief`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    await refetch();
    setNotice(t("reader.saved"));
  });

  const rewrite = () => runAction("rewrite", async () => {
    await fetchJson(`/books/${bookId}/rewrite/${chapterNumber}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    await Promise.all([refetch(), Promise.resolve(onChapterChanged())]);
    setNotice(t("reader.rewriteComplete"));
  });

  const drawInspiration = () => runAction("inspiration", async () => {
    const result = await fetchJson<InspirationResult>(`${path}/inspiration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    setInspiration(result.card);
  });

  const previewVersion = async (versionId: string) => {
    setActionError("");
    try {
      const result = await fetchJson<VersionContent>(
        `/books/${bookId}/chapters/${chapterNumber}/versions/${versionId}`,
      );
      setVersionPreview({ id: versionId, content: result.content });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (!(await ask({ title: "Restore this version?", message: t("reader.restoreConfirm"), confirmLabel: "Restore" }))) return;
    void runAction("restore", async () => {
      await fetchJson(
        `/books/${bookId}/chapters/${chapterNumber}/versions/${versionId}/restore`,
        { method: "POST" },
      );
      setVersionPreview(null);
      await Promise.all([refetch(), Promise.resolve(onChapterChanged())]);
      setNotice(t("reader.restoreComplete"));
    });
  };

  const deleteChapter = async () => {
    if (!(await ask({ title: "Delete the latest chapter?", message: t("reader.deleteChapterConfirm"), confirmLabel: "Delete", danger: true }))) return;
    void runAction("delete", async () => {
      await fetchJson(`/books/${bookId}/chapters/${chapterNumber}`, { method: "DELETE" });
      onChapterDeleted();
    });
  };

  const addInspirationToBrief = () => {
    setBrief((current) => [current.trim(), inspiration.trim()].filter(Boolean).join("\n\n"));
    setNotice("");
  };

  return (
    <section className="panel space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-serif font-semibold text-foreground">
            <Sparkles size={19} className="text-primary" />
            {t("reader.workspace")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("reader.workspaceHint")}</p>
        </div>
        {data?.canDelete && (
          <button
            type="button"
            onClick={deleteChapter}
            disabled={busy !== null}
            className="btn btn-bad btn-sm inline-flex items-center justify-center gap-2"
          >
            <Trash2 size={14} />
            {t("reader.deleteChapter")}
          </button>
        )}
      </header>

      {loading && !data ? (
        <Loading what="Reading this chapter…" />
      ) : (
        <>
          <label className="block space-y-2">
            <span className="text-sm font-bold text-foreground">{t("reader.chapterBrief")}</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={t("reader.chapterBriefPlaceholder")}
              rows={5}
              className="input w-full resize-y"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveBrief()}
              disabled={busy !== null}
              className="btn btn-line btn-sm inline-flex items-center gap-2"
            >
              <Save size={14} />
              {t("reader.saveBrief")}
            </button>
            <button
              type="button"
              onClick={() => void rewrite()}
              disabled={busy !== null}
              className="btn btn-sm inline-flex items-center gap-2"
            >
              {busy === "rewrite" ? <Spinner /> : <RefreshCw size={14} />}
              {busy === "rewrite" ? t("reader.rewriting") : t("reader.rewriteFromBrief")}
            </button>
            <button
              type="button"
              onClick={() => void drawInspiration()}
              disabled={busy !== null}
              className="btn btn-line btn-sm inline-flex items-center gap-2"
            >
              <Lightbulb size={14} />
              {busy === "inspiration" ? t("reader.drawing") : t("reader.inspiration")}
            </button>
          </div>
        </>
      )}

      {(error || actionError) && (
        <Failed what="That did not work." detail={error || actionError} />
      )}
      {notice && (
        <div className="pass block text-sm">
          {notice}
        </div>
      )}

      {inspiration && (
        <article className="notice">
          <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{inspiration}</div>
          <button
            type="button"
            onClick={addInspirationToBrief}
            className="btn btn-quiet btn-sm mt-3"
          >
            <Lightbulb size={13} />
            {t("reader.addToBrief")}
          </button>
        </article>
      )}

      <details className="well">
        <summary className="cursor-pointer label">
          {t("reader.generatedPlan")}
        </summary>
        <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-muted-foreground">
          {data?.plan || t("reader.noPlan")}
        </pre>
      </details>

      <div className="space-y-3">
        <h3 className="label flex items-center gap-2">
          <History size={15} className="text-primary" />
          {t("reader.versionHistory")}
        </h3>
        {data?.versions.length ? (
          <div className="space-y-2">
            {data.versions.map((version) => (
              <div
                key={version.id}
                className="well flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="text-xs text-muted-foreground">
                  <span className="font-bold text-foreground">{version.source}</span>
                  <span className="mx-2 text-border">·</span>
                  {new Date(version.createdAt).toLocaleString()}
                  <span className="mx-2 text-border">·</span>
                  {version.characterCount.toLocaleString()} {t("reader.characters")}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void previewVersion(version.id)}
                    className="btn btn-quiet btn-sm"
                  >
                    {t("reader.viewVersion")}
                  </button>
                  <button
                    type="button"
                    onClick={() => restoreVersion(version.id)}
                    disabled={busy !== null}
                    className="btn btn-line btn-sm"
                  >
                    <RotateCcw size={13} />
                    {t("reader.restoreVersion")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("reader.noVersions")}</p>
        )}
      </div>

      {versionPreview && (
        <div className="well">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-serif text-sm leading-7 text-foreground/90">
            {versionPreview.content}
          </pre>
        </div>
      )}
    </section>
  );
}
