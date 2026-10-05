/**
 * An article and the pages it points to, archived as research.
 *
 * `ingestMaterial` takes one page. A timeline article is mostly a list of
 * links, and the facts a magazine needs sit on the pages behind them, so one
 * page was never the unit a person meant when they said "use this article".
 *
 * The article is read once, cut where the person said to stop, and every link
 * inside the part that is kept is archived as its own material, one `.md` per
 * page, for the research stage to find. Pages are fetched one at a time: this
 * runs against someone else's site.
 */
import { ingestMaterial, type MaterialAsset, type MaterialPurpose } from "./ingest.js";

export interface CrawlInput {
  readonly url: string;
  /**
   * The heading the crawl ends with. Its own section is kept, up to the next
   * heading of the same or a higher level; everything after is dropped.
   */
  readonly stopAt?: string;
  /** Pages in total, the article included. */
  readonly maxPages?: number;
  readonly purpose?: MaterialPurpose;
  readonly signal?: AbortSignal;
  readonly onProgress?: (message: string) => void;
}

export interface CrawlResult {
  readonly article: MaterialAsset;
  readonly pages: ReadonlyArray<MaterialAsset>;
  readonly failed: ReadonlyArray<{ readonly url: string; readonly error: string }>;
  /** Links found past `maxPages`, left alone and named so it is not silent. */
  readonly skipped: number;
}

export const CRAWL_MAX_PAGES = 100;

export interface CrawlDeps {
  readonly fetch?: typeof fetch;
  /** Pause between pages. */
  readonly pauseMs?: number;
}

export async function ingestLinkedPages(
  projectRoot: string,
  input: CrawlInput,
  deps: CrawlDeps = {},
): Promise<CrawlResult> {
  const fetchImpl = deps.fetch ?? fetch;
  const max = Math.max(1, Math.min(CRAWL_MAX_PAGES, input.maxPages ?? CRAWL_MAX_PAGES));
  const purpose = input.purpose ?? "research";
  const say = (message: string) => input.onProgress?.(message);

  say(`Reading the article`);
  const response = await fetchImpl(input.url, {
    headers: { "User-Agent": "Quire research", Accept: "text/html" },
    signal: input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`the article did not load: ${response.status} ${response.statusText}`);
  const html = await response.text();

  const body = articleBody(html);
  const kept = input.stopAt ? cutAfterSection(body, input.stopAt) : body;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();

  const article = await ingestMaterial(projectRoot, {
    sourceKind: "url",
    url: input.url,
    html: kept,
    purpose,
    ...(title ? { title } : {}),
  });

  const links = linksIn(kept, input.url);
  const take = links.slice(0, max - 1);
  const pages: MaterialAsset[] = [];
  const failed: Array<{ url: string; error: string }> = [];

  for (const [i, link] of take.entries()) {
    input.signal?.throwIfAborted();
    say(`page ${i + 1} of ${take.length}: ${link}`);
    try {
      pages.push(await ingestMaterial(projectRoot, { sourceKind: "url", url: link, purpose }, { fetch: fetchImpl }));
    } catch (error) {
      // One dead link is not a reason to lose the other ninety-nine.
      failed.push({ url: link, error: error instanceof Error ? error.message : String(error) });
    }
    if (deps.pauseMs !== 0 && i < take.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, deps.pauseMs ?? 400));
    }
  }

  say(`${pages.length + 1} pages saved${failed.length ? `, ${failed.length} failed` : ""}`);
  return { article, pages, failed, skipped: Math.max(0, links.length - take.length) };
}

/**
 * The article, not the site around it: `<article>`, else `<main>`, else the body.
 *
 * Menus, footers, sidebars and tracking tags go first. A page with neither
 * `<article>` nor `<main>` falls back to the whole body, and just8mm.com's did:
 * its menu and a ClickCease tag were archived as research (pricing, order form).
 */
export function articleBody(html: string): string {
  // ponytail: regex strip, a nav nested in a nav leaves its tail; a DOM parser if that bites
  const bare = html.replace(/<(script|noscript|style|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, "");
  for (const tag of ["article", "main"]) {
    const found = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(bare);
    if (found?.[1]) return found[1];
  }
  return /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(bare)?.[1] ?? bare;
}

/**
 * Everything up to the end of the named section.
 *
 * A heading that is not there is an error, not a reason to keep the whole
 * page: the person drew a line, and crawling past it would archive pages they
 * said they did not want.
 */
export function cutAfterSection(html: string, stopAt: string): string {
  const want = plain(stopAt);
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const at = headings.findIndex((h) => plain(h[2] ?? "").includes(want));
  if (at < 0) throw new Error(`no heading on the page reads "${stopAt}"`);
  const level = Number(headings[at]![1]);
  const next = headings.slice(at + 1).find((h) => Number(h[1]) <= level);
  return next?.index !== undefined ? html.slice(0, next.index) : html;
}

const SKIP_HOSTS = /(^|\.)(facebook|twitter|x|pinterest|linkedin|instagram|reddit|whatsapp|t)\.(com|me|co)$/i;
const SKIP_FILES = /\.(png|jpe?g|gif|webp|svg|mp4|mov|zip)(\?|$)/i;

/** Every page the kept part links to, in reading order, once each. */
export function linksIn(html: string, base: string): string[] {
  const self = withoutHash(base);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(decode(match[1]!), base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (SKIP_HOSTS.test(url.hostname) || SKIP_FILES.test(url.pathname)) continue;
    const key = withoutHash(url.href);
    if (key === self || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function withoutHash(href: string): string {
  const url = new URL(href);
  url.hash = "";
  return url.href;
}

function plain(fragment: string): string {
  return decode(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().toLowerCase();
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&#x27;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
