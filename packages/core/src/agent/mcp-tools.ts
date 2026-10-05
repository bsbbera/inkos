/**
 * The user's MCP servers, reachable from a session without carrying them all.
 *
 * Every enabled server stays on, but its tools are not handed to the model up
 * front. They used to be: two PowerPoint servers alone are ~250k tokens of
 * schema, past most models' context window, so every request failed before it
 * was sent. The model gets two small tools instead — find what it needs, then
 * call it — the way Claude Code defers MCP tools. Calls still go through the
 * shim and are executed by this host, never inside a CLI's own loop.
 */
import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const shimBase = () => `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`;

export interface McpToolInfo {
  readonly server: string;
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

async function enabledServers(timeoutMs: number): Promise<string[]> {
  try {
    const res = await fetch(`${shimBase()}/mcp/servers`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const servers = ((await res.json()) as { servers?: Record<string, { enabled?: boolean }> }).servers ?? {};
    return Object.entries(servers).filter(([, info]) => info?.enabled !== false).map(([name]) => name);
  } catch {
    // No shim, or it is still starting. Tools are an enhancement, never a
    // precondition: the session runs with whatever else it has.
    return [];
  }
}

// Servers are asked in parallel and independently: one that hangs must not
// keep the others' tools out of a search.
async function toolsOf(servers: ReadonlyArray<string>, timeoutMs: number): Promise<McpToolInfo[]> {
  const per = await Promise.all(servers.map(async (server) => {
    try {
      const res = await fetch(
        `${shimBase()}/mcp/tools?server=${encodeURIComponent(server)}`,
        { signal: AbortSignal.timeout(timeoutMs * 4) },
      );
      if (!res.ok) return [];
      const tools = ((await res.json()) as { tools?: Array<Omit<McpToolInfo, "server">> }).tools ?? [];
      return tools.map((tool) => ({ ...tool, server }));
    } catch {
      return [];
    }
  }));
  return per.flat();
}

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "use", "tool"]);
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w));

/** Tools whose name or description share words with the request, best first. */
export function rankMcpTools(tools: ReadonlyArray<McpToolInfo>, query: string, limit = 8): McpToolInfo[] {
  const asked = new Set(words(query));
  if (!asked.size) return [];
  return tools
    .map((tool) => {
      const name = new Set(words(`${tool.server} ${tool.name}`));
      const said = new Set(words(tool.description ?? ""));
      let score = 0;
      for (const w of asked) score += (name.has(w) ? 3 : 0) + (said.has(w) ? 1 : 0);
      return { tool, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.tool);
}

const FindParams = Type.Object({
  need: Type.String({ description: "A few words for what you want to do, e.g. \"add a slide\" or \"render the scene\"." }),
});
const CallParams = Type.Object({
  server: Type.String({ description: "The server, as mcp_find returned it." }),
  tool: Type.String({ description: "The tool name, as mcp_find returned it." }),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "The tool's inputs." })),
});

export async function createExternalMcpTools(
  { timeoutMs = 5000 }: { readonly timeoutMs?: number } = {},
): Promise<AgentTool[]> {
  const servers = await enabledServers(timeoutMs);
  if (!servers.length) return [];

  const find: AgentTool<typeof FindParams> = {
    name: "mcp_find",
    label: "Find a connected tool",
    description: `Find a tool on the user's connected MCP servers (${servers.join(", ")}). `
      + "Returns the few tools that match and the inputs each takes; run one with mcp_call.",
    parameters: FindParams,
    async execute(_id: string, params: Static<typeof FindParams>) {
      const found = rankMcpTools(await toolsOf(servers, timeoutMs), params.need);
      if (!found.length) return textResult(`No connected tool matches "${params.need}". Servers: ${servers.join(", ")}.`);
      return textResult(found.map((t) =>
        `${t.server} / ${t.name}: ${t.description ?? ""}\ninputs: ${JSON.stringify(t.inputSchema ?? {})}`).join("\n\n"));
    },
  };

  const call: AgentTool<typeof CallParams> = {
    name: "mcp_call",
    label: "Run a connected tool",
    description: "Run one tool on a connected MCP server. Find it with mcp_find first.",
    parameters: CallParams,
    async execute(_id: string, params: Static<typeof CallParams>) {
      const res = await fetch(`${shimBase()}/mcp/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ server: params.server, tool: params.tool, args: params.arguments ?? {} }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`${params.server}/${params.tool} failed: ${(body as { error?: string }).error ?? res.status}`);
      }
      // MCP returns content blocks; the text ones are what the model can read.
      const content = (body as { content?: Array<{ type?: string; text?: string }> }).content;
      if (Array.isArray(content)) {
        const text = content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("\n");
        return textResult(text || JSON.stringify(body));
      }
      return textResult(JSON.stringify(body));
    },
  };

  return [find, call] as unknown as AgentTool[];
}
