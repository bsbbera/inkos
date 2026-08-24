/**
 * External MCP servers, exposed to the agent as ordinary tools.
 *
 * A CLI model reaches these itself — it is an agent runtime with its own tool
 * loop and its own MCP client. An API or offline model has neither, so
 * without this an Ollama or Anthropic model in the same workbench would have
 * strictly fewer tools than a CLI model, for no reason the user could see.
 *
 * Discovery, process supervision and the JSON-RPC transport all live in
 * Quire's shim already, so this only calls that over HTTP rather than
 * starting a second copy of it.
 */
import type { TSchema } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const shimBase = () => `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`;

interface McpServerInfo {
  readonly enabled?: boolean;
}

interface McpToolInfo {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

const EMPTY_SCHEMA = { type: "object", properties: {} } as unknown as TSchema;

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined };
}

/**
 * Tool names are namespaced by server. Two MCP servers offering a `search`
 * tool is normal, and an un-namespaced collision would silently route every
 * call to whichever was registered last.
 */
const toolName = (server: string, tool: string) =>
  `mcp_${server}_${tool}`.replace(/[^A-Za-z0-9_]/g, "_");

export async function createExternalMcpTools(
  { timeoutMs = 5000 }: { readonly timeoutMs?: number } = {},
): Promise<AgentTool[]> {
  let servers: Record<string, McpServerInfo>;
  try {
    const res = await fetch(`${shimBase()}/mcp/servers`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    servers = ((await res.json()) as { servers?: Record<string, McpServerInfo> }).servers ?? {};
  } catch {
    // No shim, or it is still starting. Tools are an enhancement here, never a
    // precondition: the session must run with whatever else it has.
    return [];
  }

  const names = Object.entries(servers)
    .filter(([, info]) => info?.enabled !== false)
    .map(([name]) => name);

  // Servers are contacted in parallel and independently: one that hangs or is
  // misconfigured must not keep the others out of the session.
  const perServer = await Promise.all(names.map(async (server) => {
    try {
      const res = await fetch(
        `${shimBase()}/mcp/tools?server=${encodeURIComponent(server)}`,
        { signal: AbortSignal.timeout(timeoutMs * 4) },
      );
      if (!res.ok) return [];
      const tools = ((await res.json()) as { tools?: McpToolInfo[] }).tools ?? [];
      return tools.map((tool) => buildTool(server, tool));
    } catch {
      return [];
    }
  }));

  return perServer.flat();
}

function buildTool(server: string, tool: McpToolInfo): AgentTool {
  return {
    name: toolName(server, tool.name),
    label: `${server}: ${tool.name}`,
    description: tool.description ?? `${tool.name} (via the ${server} MCP server)`,
    // The MCP schema is already JSON Schema, which is what reaches the model.
    // It is not TypeBox-constructed, so it carries none of TypeBox's symbols
    // and has to be cast rather than converted.
    parameters: (tool.inputSchema as TSchema | undefined) ?? EMPTY_SCHEMA,
    async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const res = await fetch(`${shimBase()}/mcp/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ server, tool: tool.name, args: params ?? {} }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          `${server}/${tool.name} failed: ${(body as { error?: string }).error ?? res.status}`,
        );
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
}
