/**
 * Web search + URL fetch utilities.
 *
 * searchWeb(): Tavily API search (requires TAVILY_API_KEY env var).
 * fetchUrl(): Fetch a specific URL and return plain text.
 */

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface WebSearchOptions {
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
  /** Which service answers. Absent means Tavily, which is what this was. */
  readonly provider?: "tavily" | "brave" | "custom";
}

/**
 * Search the web via Tavily API.
 * Requires TAVILY_API_KEY environment variable.
 * Throws if key is not set — caller should catch and fall back to regular chat.
 */
export async function searchWeb(
  query: string,
  maxResults = 5,
  options: WebSearchOptions = {},
): Promise<ReadonlyArray<SearchResult>> {
  if (options.provider === "brave") return searchBrave(query, maxResults, options);
  const apiKey = options.apiKey
    || (options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined)
    || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(`${options.apiKeyEnv ?? "TAVILY_API_KEY"} not set. Configure Studio research search or set the env var to enable web search.`);
  }

  const endpoint = options.baseUrl?.trim() || "https://api.tavily.com/search";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

/**
 * Fetch a URL and return its text content.
 * HTML is stripped to plain text. Output is truncated to maxChars.
 */
export async function fetchUrl(url: string, maxChars = 8000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html, application/json, text/plain",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (contentType.includes("html")) {
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
  }

  return text.slice(0, maxChars);
}

/**
 * Search the web via Brave's Search API.
 *
 * Second provider rather than only Tavily: a research stage that can only run
 * on one vendor's key is a research stage most machines cannot run at all.
 * Brave takes its key in a header and pages differently, which is the whole
 * reason this is its own function instead of a base-URL swap.
 */
async function searchBrave(
  query: string,
  maxResults: number,
  options: WebSearchOptions,
): Promise<ReadonlyArray<SearchResult>> {
  const apiKey = options.apiKey
    || (options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined)
    || process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw new Error(`${options.apiKeyEnv ?? "BRAVE_API_KEY"} not set. Configure Studio research search or set the env var to enable web search.`);
  }

  const base = options.baseUrl?.trim() || "https://api.search.brave.com/res/v1/web/search";
  const url = `${base}?q=${encodeURIComponent(query)}&count=${Math.max(1, Math.min(20, maxResults))}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Brave search failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    // Brave returns its snippets with <strong> around the matched terms.
    snippet: (r.description ?? "").replace(/<[^>]*>/g, ""),
  }));
}
