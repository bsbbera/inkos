import { useState, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Node,
  type Edge,
  type ReactFlowProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useApi, fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import { tr } from "../lib/app-language";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { layoutStoryGraph } from "../lib/story-flow-layout";
import { moveNodeDelta, addNodeDelta, genNodeId, addChoiceDelta, removeChoicesDelta, removeNodeDelta, genChoiceId } from "../lib/story-editor-deltas";
import type { StoryGraph } from "@actalk/quire-core/interactive-film/graph-schema";
import { Failed, Loading, ErrorLine } from "../components/ui/states";

interface Nav {
  toDashboard: () => void;
  toFilm: (id: string) => void;
}

// v12: define Node type with data shape, then use NodeProps<StoryNode>
type StoryNode = Node<{ label: string; nodeType: string }, "story">;
type StoryEdge = Edge;

const TYPE_COLOR: Record<string, string> = {
  start: "bg-success/15 border-success/50",
  branch: "bg-warning/15 border-warning/50",
  ending: "bg-(--bad)/15 border-(--bad)/50",
  merge: "bg-(--putty-2) border-(--ink-2)/50",
  explore: "bg-primary/15 border-primary/50",
  normal: "bg-muted border-border",
};

const TYPE_MINIMAP_COLOR: Record<string, string> = {
  start: "var(--ok)",
  branch: "var(--warn)",
  ending: "var(--bad)",
  merge: "var(--ink-2)",
  explore: "var(--vermilion)",
  normal: "var(--ink-3)",
};

function StoryFlowNode({ id, data }: NodeProps<StoryNode>) {
  const cls = TYPE_COLOR[data.nodeType] ?? TYPE_COLOR.normal;
  return (
    <div
      data-testid={`flow-node-${id}`}
      className={`well text-small ${cls} w-50 h-22.5 py-2 px-3 box-border overflow-hidden`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-medium line-clamp-2 leading-tight">{data.label}</div>
      <div className="opacity-60 text-xs mt-1">{data.nodeType}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// Module-level constant so nodeTypes reference is stable across renders
const nodeTypes = { story: StoryFlowNode };

function dfsForwardPath(
  startId: string,
  graph: StoryGraph,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>([startId]);
  const edgeIds = new Set<string>();
  const stack = [startId];
  const visited = new Set<string>([startId]);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  while (stack.length > 0) {
    const curr = stack.pop()!;
    const node = nodeMap.get(curr);
    if (!node) continue;
    for (const choice of node.choices) {
      edgeIds.add(`${node.id}->${choice.id}`);
      if (!visited.has(choice.targetNodeId)) {
        visited.add(choice.targetNodeId);
        nodeIds.add(choice.targetNodeId);
        stack.push(choice.targetNodeId);
      }
    }
  }

  return { nodeIds, edgeIds };
}

export default function FlowView({
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
  const { data: graph, loading, error, refetch } = useApi<StoryGraph>(
    `/projects/${projectId}/story-graph`,
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<StoryNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<StoryEdge>([]);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Re-seed controlled state whenever graph data changes (e.g. after refetch)
  useEffect(() => {
    if (!graph) return;
    const layout = layoutStoryGraph(graph);
    setRfNodes(layout.nodes as StoryNode[]);
    setRfEdges(layout.edges);
  }, [graph, setRfNodes, setRfEdges]);

  const hoveredPath = useMemo(() => {
    if (!hoveredNodeId || !graph) return null;
    return dfsForwardPath(hoveredNodeId, graph);
  }, [hoveredNodeId, graph]);

  const endingNodeIds = useMemo(() => {
    if (!graph) return new Set<string>();
    return new Set(graph.nodes.filter((n) => n.type === "ending").map((n) => n.id));
  }, [graph]);

  // Derived nodes with hover-path opacity + glow; stable structure keeps RF happy
  const displayNodes = useMemo(() => {
    return rfNodes.map((node) => {
      if (!hoveredPath) return { ...node, style: {} };
      const onPath = hoveredPath.nodeIds.has(node.id);
      return {
        ...node,
        style: {
          opacity: onPath ? 1 : 0.2,
          ...(onPath ? { boxShadow: "0 0 0 2px var(--vermilion)" } : {}),
        },
      };
    });
  }, [rfNodes, hoveredPath]);

  // Derived edges with semantic color + path animation
  const displayEdges = useMemo(() => {
    return rfEdges.map((edge) => {
      const isEnding = endingNodeIds.has(edge.target);
      const onPath = hoveredPath ? hoveredPath.edgeIds.has(edge.id) : false;
      const offPath = hoveredPath !== null && !onPath;

      const baseStroke = isEnding ? "var(--warn)" : "var(--ink-3)";
      const stroke = onPath ? "var(--vermilion)" : baseStroke;

      const rawLabel = typeof edge.label === "string" ? edge.label : "";
      const label = rawLabel.length > 14 ? rawLabel.slice(0, 14) + "…" : rawLabel;

      return {
        ...edge,
        label,
        animated: onPath,
        style: {
          stroke,
          strokeWidth: onPath ? 2.5 : 1.5,
          opacity: offPath ? 0.2 : 1,
        },
        labelStyle: { fontSize: 10, fill: "currentColor", opacity: offPath ? 0.2 : 0.7 },
      };
    });
  }, [rfEdges, endingNodeIds, hoveredPath]);

  const stats = useMemo(() => {
    if (!graph) return null;
    const total = graph.nodes.length;
    const branch = graph.nodes.filter((n) => n.choices.length > 1).length;
    const ending = graph.nodes.filter((n) => n.type === "ending").length;
    const deadEnd = graph.nodes.filter((n) => n.type !== "ending" && n.choices.length === 0).length;
    return { total, branch, ending, deadEnd };
  }, [graph]);

  const post = async (body: { delta: unknown }) => {
    setEditError(null);
    try {
      await fetchJson(`/projects/${projectId}/story-graph/delta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await refetch();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    }
  };

  // Drag is always-on; editing gate removed so repositioning works in read mode too
  const onNodeDragStop: NonNullable<ReactFlowProps<StoryNode, StoryEdge>["onNodeDragStop"]> = async (_evt, node) => {
    if (!graph) return;
    const orig = graph.nodes.find((g) => g.id === node.id);
    if (!orig) return;
    await post(moveNodeDelta(orig, Math.round(node.position.x), Math.round(node.position.y)));
  };

  const onConnect = async (conn: { source: string | null; target: string | null }) => {
    if (!editing || !graph || !conn.source || !conn.target) return;
    if (conn.source === conn.target) return;
    const src = graph.nodes.find((g) => g.id === conn.source);
    if (!src) return;
    await post(addChoiceDelta(src, { id: genChoiceId(), text: tr("新选项", "New choice"), targetNodeId: conn.target }));
  };

  const onNodesDelete = async (deleted: Array<{ id: string }>) => {
    if (!editing) return;
    for (const d of deleted) await post(removeNodeDelta(d.id));
  };

  const onEdgesDelete = async (deleted: Array<{ id: string }>) => {
    if (!editing || !graph) return;
    const bySource = new Map<string, string[]>();
    for (const e of deleted) {
      const [source, choiceId] = e.id.split("->"); // layout edge id format: ${node.id}->${choice.id}
      if (source && choiceId) {
        const list = bySource.get(source) ?? [];
        list.push(choiceId);
        bySource.set(source, list);
      }
    }
    for (const [source, choiceIds] of bySource) {
      const src = graph.nodes.find((g) => g.id === source);
      if (src) await post(removeChoicesDelta(src, choiceIds));
    }
  };

  const onAddNode = async () => {
    await post(
      addNodeDelta({
        id: genNodeId(),
        type: "normal",
        title: tr("新节点", "New node"),
        choices: [],
        position: { x: 80, y: 80 },
      } as never),
    );
  };

  if (loading) return <Loading what="Reading the story flow…" />;
  if (error) return <Failed what="Could not open the story flow." detail={error} />;
  if (!graph) return null;

  return (
    <div className="flex flex-col h-full p-5 gap-3" data-testid="flow-view">
      <div className="flex items-center gap-3 text-sm shrink-0">
        {!embedded && (
          <button
            onClick={() => nav.toFilm(projectId)}
            className={c.link}
            data-testid="flow-back"
          >
            ← {t("bread.film")}
          </button>
        )}
        <span data-testid="flow-title">{graph.title || projectId}</span>
        <button
          data-testid="flow-edit-toggle"
          onClick={() => setEditing((v) => !v)}
          className="btn btn-line btn-sm ml-auto"
        >
          {editing ? tr("完成编辑", "Done editing") : tr("编辑", "Edit")}
        </button>
        {editing && (
          <button
            data-testid="flow-add-node"
            onClick={onAddNode}
            className="btn btn-line btn-sm"
          >
            {tr("加节点", "Add node")}
          </button>
        )}
      </div>
      {editError && (
        <div data-testid="flow-edit-error"><ErrorLine>{editError}</ErrorLine></div>
      )}
      {stats && (
        <div
          data-testid="flow-stats"
          className="well flex items-center gap-4 shrink-0"
        >
          <span>{tr("总节点", "Nodes")} {stats.total}</span>
          <span>{tr("分支", "Branches")} {stats.branch}</span>
          <span>{tr("结局", "Endings")} {stats.ending}</span>
          <span>{tr("死路", "Dead ends")} {stats.deadEnd}</span>
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block w-5 h-0.5 rounded-sm bg-(--ink-3)" />
              {tr("默认", "Default")}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-5 h-0.5 rounded-sm bg-(--warn)" />
              {tr("结局边", "Ending edge")}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-5 h-0.5 rounded-sm bg-(--vermilion)" />
              {tr("悬停路径", "Hover path")}
            </span>
          </span>
        </div>
      )}
      <div className="well p-0 flex-1 min-h-0">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          colorMode={theme === "dark" ? "dark" : "light"}
          nodesDraggable={true}
          nodesConnectable={editing}
          elementsSelectable={editing}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onNodeMouseEnter={(_evt, node) => setHoveredNodeId(node.id)}
          onNodeMouseLeave={() => setHoveredNodeId(null)}
          deleteKeyCode={editing ? ["Delete", "Backspace"] : null}
        >
          <Background />
          <Controls />
          <MiniMap
            nodeColor={(node) =>
              TYPE_MINIMAP_COLOR[(node.data as { nodeType: string }).nodeType] ??
              TYPE_MINIMAP_COLOR.normal
            }
            nodeBorderRadius={4}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
