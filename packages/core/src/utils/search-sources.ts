/**
 * Every way this machine can search, as one list.
 *
 * Search was three unrelated things. `searchWeb` called Tavily or Brave
 * directly from pipeline code, so the model could not reach it and could not
 * decide when to use it. MCP servers offering a search tool were handed to the
 * model in chat and were invisible to every pipeline. And a model that browses
 * on its own account was detected by one hardcoded provider name.
 *
 * They are the same question — who can answer this query — so they are one
 * list here, and every one of them is asked. First-provider-wins was the old
 * rule and it meant a configured Brave key never ran while Tavily answered,
 * which is a strange thing to do to a fact check.
 */
import { searchWeb, type SearchResult } from "./web-search.js";

const shimBase = () => `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`;

/** How many results to take from each source unless the caller says otherwise. */
export const RESULTS_PER_SOURCE = 5;

export interface SearchSource {
  /** Stable, human-readable, and recorded on every claim this source supports. */
  readonly id: string;
  readonly kind: "key" | "mcp";
  run(query: string, limit: number): Promise<ReadonlyArray<SearchResult>>;
}

export interface KeySearchSettings {
  readonly provider: "tavily" | "brave" | "custom";
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
}

export interface SourcedResult extends SearchResult {
  /** Which source produced it, kept so a claim can name where it came from. */
  readonly source: string;
}

export interface SearchSweep {
  readonly results: ReadonlyArray<SourcedResult>;
  /** Sources that answered, in the order they were asked. */
  readonly answered: ReadonlyArray<string>;
  /** Sources that were asked and did not answer, with the reason. */
  readonly failures: ReadonlyArray<string>;
}

/* --------------------------------------------------------------- key search */

export function keySource(settings: KeySearchSettings): SearchSource {
  return {
    id: settings.provider,
    kind: "key",
    run: (query, limit) => searchWeb(query, limit, {
      provider: settings.provider,
      ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
      ...(settings.apiKeyEnv ? { apiKeyEnv: settings.apiKeyEnv } : {}),
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
    }),
  };
}

/* --------------------------------------------------------------- mcp search */

interface McpToolInfo {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: { readonly properties?: Record<string, unknown> };
}

/**
 * Does this MCP tool look like a web search?
 *
 * Name and description only. An MCP server declares no category, so the
 * alternative is a hardcoded list of server names — which would have to grow
 * every time the user installs one, and would have missed the Tavily and Brave
 * MCP servers they already had running.
 */
const LOOKS_LIKE_SEARCH = /\b(web[_-]?search|search[_-]?web|search|find|lookup|query)\b/i;
const NOT_A_WEB_SEARCH = /\b(file|code|repo|memory|vector|embedding|local|disk|grep|symbol)\b/i;

function isWebSearchTool(tool: McpToolInfo): boolean {
  const text = `${tool.name} ${tool.description ?? ""}`;
  if (NOT_A_WEB_SEARCH.test(text)) return false;
  return LOOKS_LIKE_SEARCH.test(tool.name);
}

/** The parameter that takes the query string, whatever this server calls it. */
function queryParam(tool: McpToolInfo): string {
  const props = Object.keys(tool.inputSchema?.properties ?? {});
  return props.find((p) => /^(query|q|search|keyword|term|text|prompt)$/i.test(p)) ?? props[0] ?? "query";
}

function mcpSource(server: string, tool: McpToolInfo): SearchSource {
  const param = queryParam(tool);
  return {
    id: `${server}/${tool.name}`,
    kind: "mcp",
    async run(query, limit) {
      const res = await fetch(`${shimBase()}/mcp/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          server,
          tool: tool.name,
          args: { [param]: query, ...limitArg(tool, limit) },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => ({})) as {
        error?: string;
        content?: Array<{ type?: string; text?: string }>;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const text = (body.content ?? [])
        .filter((c) => c?.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      return parseMcpResults(text, limit);
    },
  };
}

/** Pass a result count only if the server actually takes one. */
function limitArg(tool: McpToolInfo, limit: number): Record<string, number> {
  const props = Object.keys(tool.inputSchema?.properties ?? {});
  const name = props.find((p) => /^(count|limit|max_?results|num_?results|top_?k|n)$/i.test(p));
  return name ? { [name]: limit } : {};
}

/**
 * Turn an MCP server's reply into results.
 *
 * MCP has no result schema, so servers answer however they like: some return
 * JSON in a text block, some return Markdown links, some return prose. JSON
 * first, then URLs found in the text, then nothing — reporting nothing beats
 * handing a fact check something that was never a search result.
 */
export function parseMcpResults(text: string, limit: number): ReadonlyArray<SearchResult> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : (parsed as { results?: unknown[]; data?: unknown[] })?.results
        ?? (parsed as { data?: unknown[] })?.data;
    if (Array.isArray(rows)) {
      const out = rows.flatMap((row) => {
        const r = row as Record<string, unknown>;
        const url = String(r.url ?? r.link ?? r.href ?? "");
        if (!url.startsWith("http")) return [];
        return [{
          title: String(r.title ?? r.name ?? url),
          url,
          snippet: String(r.snippet ?? r.description ?? r.content ?? r.text ?? ""),
        }];
      });
      if (out.length) return out.slice(0, limit);
    }
  } catch { /* not JSON: the text scan below is the fallback, not an error */ }

  // Markdown links first, so a titled result keeps its title.
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const md = /\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
  for (const m of trimmed.matchAll(md)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ title: m[1], url: m[2], snippet: "" });
  }
  const bare = /(?<![(\]])\bhttps?:\/\/[^\s)<>"']+/g;
  for (const m of trimmed.matchAll(bare)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push({ title: m[0], url: m[0], snippet: "" });
  }
  return out.slice(0, limit);
}

/**
 * Every MCP server the user has enabled that offers something search-shaped.
 *
 * Never throws: no shim, a shim still starting, or a server that will not list
 * its tools all mean "no MCP search here", and a research run has other
 * sources.
 */
export async function mcpSearchSources(timeoutMs = 5000): Promise<SearchSource[]> {
  let servers: Record<string, { enabled?: boolean }>;
  try {
    const res = await fetch(`${shimBase()}/mcp/servers`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    servers = ((await res.json()) as { servers?: Record<string, { enabled?: boolean }> }).servers ?? {};
  } catch {
    return [];
  }

  const names = Object.entries(servers)
    .filter(([, info]) => info?.enabled !== false)
    .map(([name]) => name);

  const perServer = await Promise.all(names.map(async (server) => {
    try {
      const res = await fetch(
        `${shimBase()}/mcp/tools?server=${encodeURIComponent(server)}`,
        { signal: AbortSignal.timeout(timeoutMs * 4) },
      );
      if (!res.ok) return [];
      const tools = ((await res.json()) as { tools?: McpToolInfo[] }).tools ?? [];
      return tools.filter(isWebSearchTool).map((tool) => mcpSource(server, tool));
    } catch {
      return [];
    }
  }));

  return perServer.flat();
}

/* ------------------------------------------------------------------- sweep */

/**
 * Ask every source, keep everything, deduplicate by URL.
 *
 * Two sources returning the same page is agreement, not duplication, so the
 * first mention wins and the second is dropped rather than stacked. Sources
 * are asked in parallel: a slow MCP server should cost the sweep its own
 * latency, not the sum of everything before it.
 */
export async function searchAllSources(
  sources: ReadonlyArray<SearchSource>,
  query: string,
  perSource = RESULTS_PER_SOURCE,
): Promise<SearchSweep> {
  if (sources.length === 0) {
    return { results: [], answered: [], failures: ["no search source is configured"] };
  }

  const settled = await Promise.all(sources.map(async (source) => {
    try {
      const results = await source.run(query, perSource);
      return { source, results: results.slice(0, perSource), error: null as string | null };
    } catch (error) {
      return { source, results: [], error: error instanceof Error ? error.message : String(error) };
    }
  }));

  const results: SourcedResult[] = [];
  const answered: string[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();

  for (const { source, results: rows, error } of settled) {
    if (error) { failures.push(`${source.id}: ${error}`); continue; }
    if (rows.length === 0) { failures.push(`${source.id}: no results`); continue; }
    answered.push(source.id);
    for (const row of rows) {
      if (seen.has(row.url)) continue;
      seen.add(row.url);
      results.push({ ...row, source: source.id });
    }
  }

  return { results, answered, failures };
}
