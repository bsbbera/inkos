/**
 * Check what was written against what can be found.
 *
 * There was no such pass anywhere. The research stage is honest about where a
 * claim came from — it drops anything whose URL was not in the results it
 * supplied — but that only means a claim was *read* somewhere, never that it is
 * right. Nothing checked a figure the page invented while writing, and the
 * audit caught some of it afterwards by accident, on prose, sixteen pages late.
 *
 * Shared rather than per-production on purpose. It takes text and a set of
 * search sources; nothing here knows what a magazine is. A production that
 * declares it does not need checking never calls it, which is the right answer
 * for fiction: a novel's claims are not supposed to be verifiable.
 */
import { searchAllSources, RESULTS_PER_SOURCE, type SearchSource } from "../utils/search-sources.js";

export type AskJson = (prompt: string, label: string) => Promise<Record<string, unknown>>;

export interface CheckableClaim {
  /** The sentence as written, so a finding can quote it back. */
  readonly claim: string;
  /** Where in the artifact it sits — a page number, a chapter, a path. */
  readonly where: string;
  /** What the artifact says it rests on, if anything. */
  readonly citedSource?: string;
}

export type Verdict = "supported" | "unsupported" | "contradicted" | "unverifiable";

export interface FactFinding {
  readonly where: string;
  readonly claim: string;
  readonly verdict: Verdict;
  /** Why, in one sentence a person can act on. */
  readonly note: string;
  /** What was actually found, so the user can go and look. */
  readonly sources: ReadonlyArray<string>;
}

export interface FactCheckResult {
  readonly at: string;
  readonly findings: ReadonlyArray<FactFinding>;
  readonly checked: number;
  /** Sources that answered during the run, for the report. */
  readonly searchedWith: ReadonlyArray<string>;
}

/** A verdict worth showing the user. The other two are noise on their own. */
export function isProblem(finding: FactFinding): boolean {
  return finding.verdict === "unsupported" || finding.verdict === "contradicted";
}

const EXTRACT = (text: string, where: string) => `
Below is a piece of finished writing. List only the statements in it that a
fact-checker could actually check: figures, dates, named people and their
attributions, quantities, records, firsts, and direct quotes.

Do NOT list opinions, descriptions, metaphors, or anything whose truth is a
matter of taste. Do not list a statement twice. If the passage contains nothing
checkable, return an empty list — that is a real answer and a common one.

PASSAGE (${where}):
${text}

Reply as JSON only:
{"claims": [{"claim": "the statement, quoted as written", "cited_source": "the URL or source it cites, or empty"}]}
`.trim();

const VERIFY = (blocks: ReadonlyArray<{ claim: CheckableClaim; evidence: string }>) => `
Below are statements from a piece of writing, each with what a web search
returned for it. Judge every one of them.

Decide, using only the evidence given for that statement:
- "supported"     — the evidence says this, or says something close enough that
                    the statement is fair.
- "contradicted"  — the evidence says something different. This is the serious one.
- "unsupported"   — the evidence does not address the statement at all. A specific
                    figure nothing can confirm belongs here.
- "unverifiable"  — the statement is not the kind of thing a search can settle.

Do not use your own recollection. If the evidence is silent, the answer is
"unsupported", not "supported". Judge each statement only against its own
evidence block.

${blocks.map(({ claim, evidence }, i) => `
--- STATEMENT ${i + 1} ---
"${claim.claim}"
${claim.citedSource ? `It cites: ${claim.citedSource}` : "It cites nothing."}

EVIDENCE FOR STATEMENT ${i + 1}:
${evidence}
`).join("\n")}

Reply as JSON only, one entry per statement, in the same order:
{"verdicts": [{"n": 1,
               "verdict": "supported|contradicted|unsupported|unverifiable",
               "note": "one sentence saying why, naming the number or name that differs if one does",
               "sources": ["the urls from the evidence that decided it"]}]}
`.trim();

const VERDICTS = ["supported", "unsupported", "contradicted", "unverifiable"] as const;

function readVerdict(value: unknown): Verdict {
  const v = String(value ?? "");
  return (VERDICTS as ReadonlyArray<string>).includes(v) ? v as Verdict : "unverifiable";
}

/**
 * Run promises a few at a time.
 *
 * Every claim needs its own search and they do not depend on each other, so
 * running them one after another spent the whole stage waiting. Bounded rather
 * than unbounded: a page can carry a dozen claims and firing a dozen
 * simultaneous searches at a rate-limited API is how a key gets throttled.
 */
async function inBatches<T, R>(
  items: ReadonlyArray<T>,
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(run)));
  }
  return out;
}

/**
 * Check one passage.
 *
 * Claims are extracted by the model and verified one at a time. One search per
 * claim is the cost, which is why `limit` exists and why a production declares
 * whether it wants this at all.
 */
export async function factCheck(args: {
  readonly text: string;
  readonly where: string;
  readonly ask: AskJson;
  readonly sources: ReadonlyArray<SearchSource>;
  /** Most claims to check from this passage. Beyond it, the rest are skipped. */
  readonly limit?: number;
  readonly onProgress?: (message: string) => void;
}): Promise<FactCheckResult> {
  const at = new Date().toISOString();
  if (!args.text.trim() || args.sources.length === 0) {
    return { at, findings: [], checked: 0, searchedWith: [] };
  }

  const extracted = await args.ask(EXTRACT(args.text, args.where), `factcheck:extract:${args.where}`);
  const claims: CheckableClaim[] = ((extracted.claims ?? []) as Array<Record<string, unknown>>)
    .flatMap((raw) => {
      const claim = String(raw.claim ?? "").trim();
      if (!claim) return [];
      const cited = String(raw.cited_source ?? "").trim();
      return [{ claim, where: args.where, ...(cited ? { citedSource: cited } : {}) }];
    })
    .slice(0, args.limit ?? 12);

  if (claims.length === 0) {
    return { at, findings: [], checked: 0, searchedWith: [] };
  }
  args.onProgress?.(`${args.where}: checking ${claims.length} claims`);

  const searchedWith = new Set<string>();

  // Search every claim first, several at a time. These do not depend on each
  // other and running them in sequence was most of the stage's wall time.
  const sweeps = await inBatches(claims, 4, async (claim) => ({
    claim,
    sweep: await searchAllSources(args.sources, claim.claim, RESULTS_PER_SOURCE),
  }));

  const findings: FactFinding[] = [];
  const toJudge: Array<{ claim: CheckableClaim; evidence: string }> = [];

  for (const { claim, sweep } of sweeps) {
    for (const id of sweep.answered) searchedWith.add(id);
    if (sweep.results.length === 0) {
      // The search failing is not the writing being wrong, and saying so would
      // send the user to rewrite a page that may well be correct.
      findings.push({
        where: claim.where,
        claim: claim.claim,
        verdict: "unverifiable",
        note: `nothing could be searched for this — ${sweep.failures.join("; ")}`,
        sources: [],
      });
      continue;
    }
    toJudge.push({
      claim,
      evidence: sweep.results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
        .join("\n\n"),
    });
  }

  if (toJudge.length) {
    // One call for the passage, not one per claim. Per-claim cost about thirty
    // seconds each, which put a sixteen-page issue out of reach entirely.
    const answer = await args.ask(VERIFY(toJudge), `factcheck:verify:${args.where}`);
    const rows = (answer.verdicts ?? []) as Array<Record<string, unknown>>;
    toJudge.forEach(({ claim }, i) => {
      // Match on the stated index where the model gave one, because a model
      // that drops an entry would otherwise shift every verdict after it onto
      // the wrong claim — silently, and in the direction of a false verdict.
      const row = rows.find((r) => Number(r.n) === i + 1) ?? rows[i] ?? {};
      findings.push({
        where: claim.where,
        claim: claim.claim,
        verdict: readVerdict(row.verdict),
        note: String(row.note ?? ""),
        sources: Array.isArray(row.sources) ? row.sources.map(String) : [],
      });
    });
  }

  return { at, findings, checked: claims.length, searchedWith: [...searchedWith] };
}

/** The findings as something a person reads, problems first. */
export function factCheckReport(result: FactCheckResult): string {
  const problems = result.findings.filter(isProblem);
  if (result.checked === 0) return "Nothing checkable in this text.";
  const head = `${result.checked} claims checked · ${problems.length} worth acting on`;
  if (problems.length === 0) return `${head}\nNothing contradicted or unsupported.`;
  return [
    head,
    "",
    ...problems.map((f) => [
      `${f.where} — ${f.verdict}`,
      `  "${f.claim}"`,
      f.note ? `  ${f.note}` : "",
      f.sources.length ? `  ${f.sources.join("\n  ")}` : "",
    ].filter(Boolean).join("\n")),
  ].join("\n");
}
