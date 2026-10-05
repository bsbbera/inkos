import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { articleBody, cutAfterSection, ingestLinkedPages, linksIn } from "../materials/crawl.js";

const ARTICLE = `<html><head><title>A timeline</title></head><body>
<nav><a href="/shop">Shop</a></nav>
<article>
  <h2>Early Photography</h2>
  <p>See <a href="https://example.org/niepce">Niepce</a> and <a href="/daguerre#top">Daguerre</a>.</p>
  <h3>Plates</h3>
  <p><a href="/daguerre">Daguerre again</a> <a href="https://twitter.com/share">share</a></p>
  <h2>Camera Advancements: Box Cameras</h2>
  <p><a href="/box">Box camera</a></p>
  <h2>Colour</h2>
  <p><a href="/colour">Autochrome</a></p>
</article>
</body></html>`;

const PAGE = (name: string) => `<html><head><title>${name}</title></head><body><p>About ${name}.</p></body></html>`;

function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url === "https://site.test/timeline" ? ARTICLE : PAGE(url.split("/").pop() ?? "page");
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
}

let root = "";
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "quire-crawl-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("an article and the pages it links to", () => {
  it("keeps the named section and stops at the next heading of its level", () => {
    const kept = cutAfterSection(ARTICLE, "camera advancements");
    expect(kept).toContain("Box camera");
    expect(kept).not.toContain("Autochrome");
  });

  it("reads a page with no <article> without its menu, footer or tracking tag", () => {
    const body = articleBody(`<body><noscript><a href="https://www.clickcease.com">x</a></noscript>
      <nav><a href="/pricing/">Pricing</a></nav><h1>Timeline</h1><p><a href="/niepce">Niepce</a></p>
      <footer><a href="/order-form">Order</a></footer></body>`);
    expect(linksIn(body, "https://site.test/timeline")).toEqual(["https://site.test/niepce"]);
  });

  it("refuses a stop heading that is not on the page", () => {
    expect(() => cutAfterSection(ARTICLE, "Polaroids of the moon")).toThrow(/no heading/);
  });

  it("lists each page once, in reading order, without share buttons or self-links", () => {
    const links = linksIn(cutAfterSection(ARTICLE, "Camera Advancements"), "https://site.test/timeline");
    expect(links).toEqual([
      "https://site.test/shop",
      "https://example.org/niepce",
      "https://site.test/daguerre",
      "https://site.test/box",
    ]);
  });

  it("archives one research .md per page, the article included, within the limit", async () => {
    const seen: string[] = [];
    const result = await ingestLinkedPages(root, {
      url: "https://site.test/timeline",
      stopAt: "Camera Advancements",
      maxPages: 3,
      onProgress: (m) => seen.push(m),
    }, { fetch: fakeFetch(), pauseMs: 0 });

    expect(result.failed).toEqual([]);
    expect(result.pages).toHaveLength(2);
    // The nav's /shop link is outside <article>, so three links remain and
    // the limit of three pages (article + two) leaves one behind.
    expect(result.skipped).toBe(1);
    expect(result.article.purpose).toBe("research");
    const saved = await readFile(join(root, result.pages[0]!.markdownPath), "utf-8");
    expect(saved).toContain("source: https://example.org/niepce");
    const article = await readFile(join(root, result.article.markdownPath), "utf-8");
    expect(article).toContain("Box camera");
    expect(article).not.toContain("Autochrome");
    expect(seen.some((m) => m.startsWith("page 1 of 2"))).toBe(true);
  });
});
