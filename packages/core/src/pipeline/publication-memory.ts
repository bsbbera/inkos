/**
 * What an issue remembers about itself.
 *
 * Books have had memory since the beginning: `memory-retrieval.ts` selects the
 * summaries, hooks and facts a chapter needs and hands the writer a slice
 * rather than the whole book. Publications had nothing. Every page was written
 * cold, and the two places that needed recall faked it by truncation — the
 * writer got 140 characters of every page already written, the auditor got 200,
 * and at forty pages both are a wall of fragments nobody can use.
 *
 * A publication is another work unit, so it gets the same treatment. What it
 * does not get is the temporal layer: `MemoryDB` tracks a fact's validity
 * across chapters because a character's state changes and page 13 does not
 * invalidate what page 12 established. So the part that transfers is the part
 * underneath both — `LocalSearchIndex`, the BM25 kernel book memory already
 * retrieves through — indexed per issue, over the pages written so far and the
 * research they were written from.
 *
 * The index is a projection. `publication.json` stays authoritative, the
 * database is rebuilt from it on every open, and deleting it costs nothing.
 */

import { join } from "node:path";

import { LocalSearchIndex, type SearchDocument, type SearchHit } from "../retrieval/local-search.js";
import type { ResearchReport } from "./publication-research.js";
import type { PublicationIssue, PublicationPage } from "./publication-runner.js";

const SCOPE = "publication";

/** How many written pages an issue may have before recall beats listing them all. */
export const RECALL_THRESHOLD = 12;

const flat = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Everything on a page that another page could collide with. */
const pageText = (page: PublicationPage) =>
  [
    page.premise,
    page.deck,
    page.pullQuote,
    page.body,
    (page.furniture ?? []).map((f) => f.text).join("\n"),
  ].filter(Boolean).join("\n");

/** The door a page came in through — the thing two pages must not share. */
export const openingOf = (page: PublicationPage) =>
  flat(page.body).slice(0, 140);

export interface RecalledPage {
  readonly n: number;
  readonly title: string;
  readonly opening: string;
}

export interface RecalledFinding {
  readonly claim: string;
  readonly kind: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
}

/**
 * Every research claim in an issue, whichever shape it was stored in.
 *
 * The current stage writes `{pillars: {origin: {findings: [{claim, kind,
 * sourceUrl, sourceTitle}]}}}`. Both issues actually in the workspace predate
 * it and store `{origin: [{fact, who, when, why_it_matters}]}` — no wrapper, no
 * URLs, different keys. `findingsFor` only reads the new shape, so those issues
 * have been getting no research context at all, and indexing only the new shape
 * would carry that gap forward into recall.
 */
function researchFindings(
  research: Record<string, unknown> | null | undefined,
): Array<RecalledFinding & { pillar: string }> {
  if (!research) return [];
  const out: Array<RecalledFinding & { pillar: string }> = [];

  const modern = (research as unknown as ResearchReport).pillars;
  if (modern && typeof modern === "object") {
    for (const [pillar, slice] of Object.entries(modern)) {
      for (const f of slice?.findings ?? []) {
        out.push({
          pillar,
          claim: f.claim,
          kind: f.kind,
          sourceTitle: f.sourceTitle,
          sourceUrl: f.sourceUrl,
        });
      }
    }
    return out;
  }

  for (const [pillar, value] of Object.entries(research)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const claim = flat(e.claim ?? e.fact);
      if (!claim) continue;
      out.push({
        pillar,
        claim: [claim, flat(e.why_it_matters)].filter(Boolean).join(" "),
        kind: String(e.kind ?? "fact"),
        // The old shape recorded who and when instead of a citation. That is
        // what attribution has to be checked against, so it is what is kept.
        sourceTitle: [flat(e.who), flat(e.when)].filter(Boolean).join(", ") || pillar,
        sourceUrl: flat(e.sourceUrl ?? e.source ?? ""),
      });
    }
  }
  return out;
}

export class PublicationMemory {
  private readonly index: LocalSearchIndex;

  constructor(issueDir: string) {
    this.index = new LocalSearchIndex(join(issueDir, "memory.db"));
  }

  /**
   * Rebuild the index from the issue as it now stands.
   *
   * `replaceScope` content-hashes, so a page that has not changed is not
   * re-tokenised and a page that was deleted leaves.
   */
  record(issue: PublicationIssue): void {
    const documents: SearchDocument[] = [];

    for (const page of issue.pages) {
      if (!isPageWritten(page)) continue;
      documents.push({
        id: `page-${page.n}`,
        scope: SCOPE,
        kind: "page",
        source: `p${page.n}`,
        title: `p${page.n} ${page.title}`,
        body: pageText(page),
        metadata: {
          n: page.n,
          title: page.title,
          section: page.section,
          pillar: page.pillar,
          opening: openingOf(page),
        },
      });
    }

    researchFindings(issue.research).forEach((finding, i) => {
      documents.push({
        id: `finding-${finding.pillar}-${i}`,
        scope: SCOPE,
        kind: "finding",
        source: finding.sourceUrl,
        title: finding.sourceTitle,
        body: finding.claim,
        metadata: { ...finding },
      });
    });

    this.index.replaceScope(SCOPE, documents);
  }

  /** Pages already written that bear on this one, nearest first. */
  pages(query: string, exclude: number, limit = 8): RecalledPage[] {
    return this.hits(query, "page", limit + 1)
      .map((hit) => ({
        n: Number(hit.metadata?.n ?? 0),
        title: String(hit.metadata?.title ?? hit.title),
        opening: String(hit.metadata?.opening ?? ""),
      }))
      .filter((page) => page.n !== exclude)
      .slice(0, limit);
  }

  /** Research findings that bear on this page, wherever their pillar filed them. */
  findings(query: string, limit = 8): RecalledFinding[] {
    return this.hits(query, "finding", limit).map((hit) => ({
      claim: String(hit.metadata?.claim ?? hit.body),
      kind: String(hit.metadata?.kind ?? "fact"),
      sourceTitle: String(hit.metadata?.sourceTitle ?? hit.title),
      sourceUrl: String(hit.metadata?.sourceUrl ?? hit.source),
    }));
  }

  private hits(query: string, kind: string, limit: number): SearchHit[] {
    const q = flat(query);
    if (!q) return [];
    // A malformed FTS query must not take a write stage down with it: no
    // recall is a thinner page, a thrown error is no page at all.
    try {
      return this.index.search(q, { scope: SCOPE, kinds: [kind], limit });
    } catch {
      return [];
    }
  }

  close(): void {
    this.index.close();
  }
}

/**
 * Whether a page counts as written.
 *
 * One predicate, because two of them disagreed on screen: the sidebar counted
 * a body that merely existed, the detail page counted one with words in it, and
 * the same issue read 16/16 in one place and 12/16 in the other. Existence is
 * the right test — a plate page is written when it has an empty body, because
 * an empty body is what a plate is.
 */
export function isPageWritten(page: PublicationPage): boolean {
  return page.body !== null && page.body !== undefined;
}
