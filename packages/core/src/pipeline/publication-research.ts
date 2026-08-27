/**
 * Research for a publication: search first, then read what came back.
 *
 * The stage this replaces asked the model what it remembered and stored the
 * answer. It cited nothing because there was nothing to cite, and a page could
 * state a figure no one had ever checked. Here the model writes the queries and
 * reads the results, but every claim that survives carries the URL it came from.
 *
 * Work is per pillar rather than per issue. One blob of research for a whole
 * issue meant every page got the same context and drifted towards the same few
 * facts; a pillar's own slice is what its pages actually need.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { type SearchResult } from "../utils/web-search.js";
import {
  keySource,
  mcpSearchSources,
  searchAllSources,
  RESULTS_PER_SOURCE,
  type SearchSource,
} from "../utils/search-sources.js";
import { ResearchSearchConfigSchema } from "../models/project.js";
import { retrieveMaterials } from "../materials/retrieve.js";

/** What a page can actually use: a claim, and where it came from. */
export interface Finding {
  readonly claim: string;
  readonly kind: "fact" | "figure" | "quote" | "anecdote" | "comparison" | "date";
  readonly sourceUrl: string;
  readonly sourceTitle: string;
}

export interface PillarResearch {
  readonly pillar: string;
  readonly queries: ReadonlyArray<string>;
  readonly findings: ReadonlyArray<Finding>;
  readonly sources: ReadonlyArray<{ url: string; title: string }>;
}

export interface ResearchReport {
  readonly title: string;
  readonly thesis: string;
  readonly pillars: Record<string, PillarResearch>;
  /** Which service answered, so a thin issue can be explained later. */
  readonly searchedWith: string;
  readonly searchedAt: string;
}

/** Model call, same shape the runner already uses. */
export type AskJson = (prompt: string, label: string) => Promise<Record<string, unknown>>;

/* ------------------------------------------------------------------ search */

export interface SearchSettings {
  readonly provider: "tavily" | "brave" | "custom";
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
}

/**
 * Every search service this machine could use, best first.
 *
 * Configuration wins over environment, because a user who filled the field in
 * Studio means it. Both are tried: an issue should not fail because the key
 * lives in the other place.
 */
export async function searchProviders(projectRoot: string): Promise<SearchSettings[]> {
  const out: SearchSettings[] = [];
  const seen = new Set<string>();
  const add = (s: SearchSettings) => {
    const key = `${s.provider}:${s.baseUrl ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  try {
    const raw = JSON.parse(
      await readFile(`${projectRoot}/inkos.json`, "utf-8"),
    ) as Record<string, unknown>;
    const cfg = ResearchSearchConfigSchema.parse(raw.researchSearch ?? {});
    if (cfg.enabled && (cfg.apiKey || cfg.apiKeyEnv)) {
      add({
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        apiKeyEnv: cfg.apiKeyEnv,
        baseUrl: cfg.baseUrl,
      });
    }
  } catch { /* no config, or unreadable: the env vars below may still serve */ }

  if (process.env.TAVILY_API_KEY) add({ provider: "tavily" });
  if (process.env.BRAVE_API_KEY) add({ provider: "brave" });
  return out;
}

/**
 * Every source this machine has: keys and enabled MCP servers alike.
 *
 * MCP was invisible here. A user with the Tavily MCP server running and no
 * TAVILY_API_KEY was told to go and configure search, while the thing that
 * could answer sat enabled in the same app.
 */
export async function allSearchSources(projectRoot: string): Promise<SearchSource[]> {
  const keys = (await searchProviders(projectRoot)).map(keySource);
  return [...keys, ...await mcpSearchSources()];
}

/**
 * The user's own attachments, as search results.
 *
 * Same shape as a web hit so the extraction prompt needs no second branch and
 * the URL check that drops invented claims still applies. `material:<id>` is
 * the identifier when a file has no URL of its own, which is most of them.
 */
async function materialResults(
  projectRoot: string,
  queries: ReadonlyArray<string>,
): Promise<SearchResult[]> {
  const byUrl = new Map<string, SearchResult>();
  for (const query of queries) {
    let hits: Awaited<ReturnType<typeof retrieveMaterials>>;
    try {
      hits = await retrieveMaterials(projectRoot, { query, purpose: "research", limit: 5 });
    } catch {
      // No material store, or an unreadable one. The web results stand.
      return [...byUrl.values()];
    }
    for (const hit of hits) {
      const url = hit.source?.startsWith("http") ? hit.source : `material:${hit.id}`;
      if (byUrl.has(url)) continue;
      byUrl.set(url, {
        title: `Your own material — ${hit.title}`,
        url,
        snippet: hit.excerpt,
      });
    }
  }
  return [...byUrl.values()];
}

/* ------------------------------------------------------------------- cache */

const keyOf = (query: string) => createHash("sha1").update(query).digest("hex").slice(0, 16);

type Cache = Record<string, { query: string; provider: string; results: SearchResult[] }>;

async function readCache(path: string): Promise<Cache> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(await readFile(path, "utf-8")) as Cache; } catch { return {}; }
}

async function writeCache(path: string, cache: Cache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2), "utf-8");
}

/* ------------------------------------------------------------------- stage */

const QUERY_PROMPT = (subject: string, angle: string, pillars: string[]) => `
You are planning research for a publication about: ${subject}
${angle ? `The angle is: ${angle}` : ""}

For each pillar below, write 3 web search queries that would surface specific,
checkable material — figures, dates, named people, comparisons, first-hand
accounts. Not general overviews. A query that would return an encyclopedia
summary is a wasted query.

PILLARS: ${pillars.join(", ")}

Reply as JSON only:
{"title": "...", "thesis": "one sentence", "queries": {"<pillar>": ["q1","q2","q3"]}}
`.trim();

const EXTRACT_PROMPT = (pillar: string, subject: string, results: SearchResult[]) => `
Below are research results about "${subject}", for the pillar "${pillar}".

Anything titled "Your own material" was supplied by the editor. It outranks
everything else here: where it disagrees with a web result, it is right, and a
claim it supports is worth more than one only the web supports.

Pull out every specific, usable claim. A claim is usable if a reader would
find it interesting and a fact-checker could verify it. Skip anything vague,
promotional, or already obvious.

Every claim MUST carry the exact source_url of the result it came from. Do not
merge two results into one claim. Do not state anything the results do not say
— if the results are thin, return fewer claims. An empty list is a valid answer
and a far better one than an invented fact.

kind is one of: fact, figure, quote, anecdote, comparison, date

RESULTS:
${results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join("\n\n")}

Reply as JSON only:
{"findings": [{"claim": "...", "kind": "fact", "source_url": "..."}]}
`.trim();

/**
 * Research one issue: queries from the model, results from the web, claims
 * back from the model with a URL attached to each.
 */
export async function researchPublication(args: {
  readonly projectRoot: string;
  readonly cachePath: string;
  readonly subject: string;
  readonly angle?: string | undefined;
  readonly pillars: ReadonlyArray<string>;
  readonly ask: AskJson;
  readonly onProgress?: (message: string) => void;
  /** Supplied by a caller that already resolved them; discovered otherwise. */
  readonly sources?: ReadonlyArray<SearchSource>;
}): Promise<ResearchReport> {
  const sources = args.sources ?? await allSearchSources(args.projectRoot);
  // Material the editor attached is research too. Refusing to run because no
  // search key is set, while their own PDF sits archived in the project, is
  // the stage telling them their sources do not count.
  const hasOwnMaterial = (await materialResults(args.projectRoot, [args.subject])).length > 0;
  if (!sources.length && !hasOwnMaterial) {
    throw new Error(
      "no web search is configured, so this issue would be written from memory alone. "
      + "Enable a search MCP server, or set a Tavily or Brave key in Project Settings "
      + "→ research search, or the TAVILY_API_KEY / BRAVE_API_KEY environment variable.",
    );
  }

  const pillars = [...args.pillars];
  const plan = await args.ask(
    QUERY_PROMPT(args.subject, args.angle ?? "", pillars),
    "research:queries",
  );
  const planned = (plan.queries ?? {}) as Record<string, unknown>;

  const cache = await readCache(args.cachePath);
  const out: Record<string, PillarResearch> = {};
  const answeredBy = new Set<string>();

  for (const pillar of pillars) {
    const queries = (Array.isArray(planned[pillar]) ? planned[pillar] as unknown[] : [])
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, 3);
    // A pillar the model forgot still deserves research, so fall back to the
    // plainest query rather than leaving those pages with nothing.
    if (!queries.length) queries.push(`${args.subject} ${pillar}`);

    const results: SearchResult[] = [];
    for (const query of queries) {
      args.onProgress?.(`searching: ${query}`);
      const key = keyOf(query);
      const hit = cache[key];
      if (hit) {
        results.push(...hit.results);
        continue;
      }
      if (!sources.length) continue;
      const sweep = await searchAllSources(sources, query, RESULTS_PER_SOURCE);
      if (!sweep.results.length) {
        // Only fatal with nothing else to work from. With the editor's own
        // material in hand, a dead search provider is a thinner issue, not a
        // stopped one.
        if (!hasOwnMaterial) {
          throw new Error(`every search source failed for "${query}" — ${sweep.failures.join("; ")}`);
        }
        args.onProgress?.(`search failed for "${query}" — ${sweep.failures.join("; ")}`);
        continue;
      }
      for (const id of sweep.answered) answeredBy.add(id);
      cache[key] = {
        query,
        provider: sweep.answered.join(", "),
        results: sweep.results.map(({ title, url, snippet }) => ({ title, url, snippet })),
      };
      results.push(...sweep.results);
    }
    await writeCache(args.cachePath, cache);

    // What the user gave us, on the same footing as what the web returned.
    //
    // The prompts have always told the model that the editor's own material
    // outranks its research. Nothing ever put that material in front of it:
    // ingest_material archived the PDF, retrieve_material could find it, and
    // this stage called neither. An attached source was archived and ignored.
    const ownMaterial = await materialResults(args.projectRoot, queries);
    if (ownMaterial.length) {
      args.onProgress?.(`${pillar}: ${ownMaterial.length} excerpts from your own material`);
    }

    // Same URL from three queries is one source, and repeating it in the
    // prompt only costs context and biases the model towards it. The user's
    // own material comes first, so it survives the dedupe when the web
    // returns the same page.
    const unique = [...new Map([...ownMaterial, ...results].map((r) => [r.url, r])).values()];
    const extracted = unique.length
      ? await args.ask(EXTRACT_PROMPT(pillar, args.subject, unique), `research:${pillar}`)
      : { findings: [] };

    const byUrl = new Map(unique.map((r) => [r.url, r]));
    const findings: Finding[] = [];
    for (const raw of (extracted.findings ?? []) as Array<Record<string, unknown>>) {
      const url = String(raw.source_url ?? "").trim();
      const source = byUrl.get(url);
      // A claim whose URL is not one of the results we supplied was not read
      // off them. Dropping it is the whole point of doing this at all.
      if (!source) continue;
      const claim = String(raw.claim ?? "").trim();
      if (!claim) continue;
      findings.push({
        claim,
        kind: KINDS.has(String(raw.kind)) ? String(raw.kind) as Finding["kind"] : "fact",
        sourceUrl: url,
        sourceTitle: source.title,
      });
    }

    out[pillar] = {
      pillar,
      queries,
      findings,
      sources: unique.map((r) => ({ url: r.url, title: r.title })),
    };
    args.onProgress?.(`${pillar}: ${findings.length} findings from ${unique.length} sources`);
  }

  return {
    title: String(plan.title ?? args.subject),
    thesis: String(plan.thesis ?? ""),
    pillars: out,
    searchedWith: [...answeredBy].join(", ") || "cache",
    searchedAt: new Date().toISOString(),
  };
}

const KINDS = new Set(["fact", "figure", "quote", "anecdote", "comparison", "date"]);

/** The research a single page should see: its own pillar, as readable text. */
export function findingsFor(
  report: ResearchReport | null | undefined,
  pillar: string,
  limit = 24,
): string {
  const slice = report?.pillars?.[pillar];
  if (!slice || !slice.findings.length) return "";
  return slice.findings.slice(0, limit)
    .map((f) => `- (${f.kind}) ${f.claim}\n  source: ${f.sourceTitle} — ${f.sourceUrl}`)
    .join("\n");
}
