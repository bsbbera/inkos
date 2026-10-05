import { useEffect, useMemo, useState } from "react";
import { cjk } from "@streamdown/cjk";
import { AlertCircle, Loader2, Pencil, Save, X } from "../ui/glyphs";
import { Streamdown } from "streamdown";
import { fetchJson } from "../../hooks/use-api";
import { tr } from "../../lib/app-language";
import { useChatStore } from "../../store/chat";

import { Spinner } from "../ui/working";
import { Failed, Loading, Empty } from "../ui/states";
interface ProjectArtifactPayload {
  readonly path: string;
  readonly content: string;
  readonly contentType: string;
  readonly size: number;
}

const streamdownPlugins = { cjk };

function encodeArtifactPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function displayName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function isJsonArtifact(path: string, contentType: string): boolean {
  return path.endsWith(".json") || contentType.includes("application/json");
}

export function ProjectArtifactDrawer() {
  const path = useChatStore((s) => s.projectArtifactPath);
  const close = useChatStore((s) => s.closeProjectArtifact);
  const [payload, setPayload] = useState<ProjectArtifactPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    setEditing(false);
    void fetchJson<ProjectArtifactPayload>(`/project/artifacts/${encodeArtifactPath(path)}`)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setDraft(data.content);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const previewContent = useMemo(() => {
    if (!payload) return "";
    return isJsonArtifact(payload.path, payload.contentType) ? formatJson(payload.content) : payload.content;
  }, [payload]);

  if (!path) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await fetchJson<{ ok: boolean; size: number }>(`/project/artifacts/${encodeArtifactPath(path)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      setPayload({
        path,
        content: draft,
        contentType: payload?.contentType ?? "text/markdown; charset=utf-8",
        size: result.size,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-background/35 backdrop-blur-xs">
      <button
        type="button"
        aria-label={tr("关闭生成物预览", "Close artifact preview")}
        className="absolute inset-0 cursor-default"
        onClick={close}
      />
      <aside className="relative flex h-full w-[min(760px,calc(100vw-24px))] flex-col border-l border-border/55 bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border/45 px-6 py-5">
          <div className="min-w-0">
            <div className="text-body font-medium uppercase tracking-widest text-muted-foreground/65">
              {tr("生成物", "Artifact")}
            </div>
            <h2 className="mt-1 truncate text-h3 font-semibold text-foreground">
              {displayName(path)}
            </h2>
            <p className="mt-1 break-all text-body leading-5 text-muted-foreground/70">
              {path}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {payload && !editing && (
              <button
                type="button"
                onClick={() => {
                  setDraft(payload.content);
                  setEditing(true);
                }}
                className="btn btn-line inline-flex items-center gap-2"
              >
                <Pencil size={15} />
                {tr("编辑", "Edit")}
              </button>
            )}
            {editing && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(payload?.content ?? "");
                    setEditing(false);
                  }}
                  disabled={saving}
                  className="btn btn-line"
                >
                  {tr("取消", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="btn inline-flex items-center gap-2"
                >
                  {saving ? <Spinner /> : <Save size={15} />}
                  {tr("保存", "Save")}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={close}
              className="btn btn-quiet btn-icon"
              data-esc
              aria-label={tr("关闭", "Close")}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-6 mt-4"><Failed what="Could not open this file." detail={error} /></div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <Loading what={tr("正在读取生成物…", "Reading this file…")} />
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              className="input min-h-full w-full resize-none font-mono"
            />
          ) : payload ? (
            isJsonArtifact(payload.path, payload.contentType) ? (
              <pre className="well mono whitespace-pre-wrap break-words">
                {previewContent}
              </pre>
            ) : (
              <article className="prose prose-neutral dark:prose-invert max-w-none text-lead leading-8 prose-headings:font-semibold prose-h1:text-h2 prose-h2:text-h3 prose-h3:text-lead prose-p:my-4 prose-li:my-1 prose-pre:whitespace-pre-wrap">
                <Streamdown plugins={streamdownPlugins} mode="static">
                  {previewContent}
                </Streamdown>
              </article>
            )
          ) : (
            <Empty compact icon="eye" title={tr("这个文件没有可预览的内容。", "This file has nothing to show as a preview.")} />
          )}
        </div>
      </aside>
    </div>
  );
}
