import { useState } from "react";
import { useApi, fetchJson, buildApiUrl } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import { tr } from "../lib/app-language";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { StoryGraph, StoryNode } from "@actalk/quire-core/interactive-film/graph-schema";
import { AnalysisPanel } from "../components/film/AnalysisPanel";
import { Failed, Loading } from "../components/ui/states";

interface Nav {
  toDashboard: () => void;
  toPlay: (id: string) => void;
  toFlow: (id: string) => void;
  toFilmAuthor: (id: string) => void;
}

export function buildProjectExportDownloadUrl(projectId: string): string | null {
  return buildApiUrl(`/projects/${encodeURIComponent(projectId)}/export`);
}

export function StoryGraphTree({
  projectId,
  nav,
  theme,
  t,
  embedded = false,
}: {
  projectId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
  embedded?: boolean;
}) {
  const c = useColors(theme);
  const { data: graph, loading, error, refetch } = useApi<StoryGraph>(`/projects/${projectId}/story-graph`);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  if (loading) return <Loading what="Reading the story…" />;
  if (error) return <Failed what="Could not open the story." detail={error} />;
  if (!graph) return null;
  const exportUrl = buildProjectExportDownloadUrl(projectId);

  const genImage = async (nodeId: string) => {
    setGeneratingId(nodeId);
    setSaveError(null);
    try {
      await fetchJson(`/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/image`, { method: "POST" });
      await refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingId(null);
    }
  };

  const saveNode = async (node: StoryNode) => {
    setSavingId(node.id);
    setSaveError(null);
    try {
      await fetchJson(`/projects/${projectId}/story-graph/delta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: { nodes: { upsert: [node] } } }),
      });
      await refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="film-tree">
      {!embedded && (
        <div className="flex items-center gap-3 text-sm">
          <button onClick={nav.toDashboard} className={c.link} data-testid="film-back">
            ← {t("bread.books")}
          </button>
          <span className={c.muted}>/</span>
          <span data-testid="film-title">{graph.title || projectId}</span>
          <button
            onClick={() => nav.toPlay(projectId)}
            className="btn btn-sm ml-auto"
            data-testid="film-play"
          >
            {tr("试玩", "Play")} →
          </button>
          <button
            onClick={() => nav.toFlow(projectId)}
            className="btn btn-line btn-sm"
            data-testid="open-flow"
          >
            {tr("流程图", "Flow")} →
          </button>
          <button
            onClick={() => nav.toFilmAuthor(projectId)}
            className="btn btn-line btn-sm"
            data-testid="open-authoring"
          >
            {tr("AI 对话创作", "AI chat authoring")} →
          </button>
          {exportUrl && (
            <a
              href={exportUrl}
              download
              className="btn btn-line btn-sm no-underline"
              data-testid="film-export-package"
            >
              {tr("导出整包", "Export package")}
            </a>
          )}
        </div>
      )}

      <AnalysisPanel projectId={projectId} theme={theme} />

      {saveError && (
        <div data-testid="film-save-error"><Failed what={tr("保存失败。", "Not saved.")} detail={saveError} /></div>
      )}

      {graph.worldAnchor && (
        <div className="well" data-testid="film-world">
          <div className={c.muted}>{tr("世界锚点", "World anchor")}</div>
          <div>{tr("核心：", "Core: ")}{graph.worldAnchor.storyCore}</div>
          <div>{tr("主题：", "Theme: ")}{graph.worldAnchor.theme} · {tr("题材：", "Genre: ")}{graph.worldAnchor.genre}</div>
        </div>
      )}

      <div className="space-y-3" data-testid="film-nodes">
        {graph.nodes.map((node) => (
          <NodeEditor
            key={node.id}
            node={node}
            saving={savingId === node.id}
            onSave={saveNode}
            generating={generatingId === node.id}
            onGenerateImage={genImage}
            colors={c}
          />
        ))}
      </div>
    </div>
  );
}

function NodeEditor({
  node,
  saving,
  onSave,
  generating,
  onGenerateImage,
  colors,
}: {
  node: StoryNode;
  saving: boolean;
  onSave: (n: StoryNode) => void;
  generating: boolean;
  onGenerateImage: (nodeId: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [scene, setScene] = useState(node.sceneDesc);
  const dirty = scene !== node.sceneDesc;

  return (
    <div className="well" data-testid={`film-node-${node.id}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="pill">{node.type}</span>
        <span>{node.title || node.id}</span>
      </div>
      {node.imageSlot?.assetRef && (
        <img
          data-testid={`node-image-${node.id}`}
          src={buildApiUrl('/project/files/' + node.imageSlot.assetRef.split('/').map(encodeURIComponent).join('/')) ?? undefined}
          alt=""
          className="w-32 rounded mb-2"
          loading="lazy"
        />
      )}
      <textarea
        data-testid={`film-scene-${node.id}`}
        className="input mt-2 w-full"
        value={scene}
        onChange={(e) => setScene(e.target.value)}
      />
      {node.dialogue.length > 0 && (
        <div className="mt-2 space-y-1">
          {node.dialogue.map((l, i) => (
            <div key={i} className="text-xs">
              <span className={colors.accent}>{l.speaker}{tr("：", ": ")}</span>
              {l.text}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button
          data-testid={`film-save-${node.id}`}
          disabled={!dirty || saving}
          onClick={() => onSave({ ...node, sceneDesc: scene })}
          className="btn btn-sm"
        >
          {saving ? tr("保存中…", "Saving…") : tr("保存", "Save")}
        </button>
        <button
          data-testid={`gen-image-${node.id}`}
          disabled={generating}
          onClick={() => onGenerateImage(node.id)}
          className="btn btn-line btn-sm"
        >
          {generating ? tr("生成中…", "Generating…") : tr("生成配图", "Generate image")}
        </button>
      </div>
    </div>
  );
}
