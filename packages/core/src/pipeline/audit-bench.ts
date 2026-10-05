/**
 * The bench: passages a change to the criteria must not break (19 §5.4).
 *
 * A pack is editable, which means it is breakable. Loosen a threshold to stop
 * one annoying finding and the check that caught a real contradiction goes
 * quiet too, and nobody notices until a book ships with it. So a handful of
 * frozen passages are kept per type — some known-bad, with the categories that
 * must still be caught, some known-good, with the categories that must stay
 * silent — and every pack version runs against them before it is trusted.
 *
 * Cases are seeded from the person's own settled findings, which is what makes
 * the bench theirs rather than a vendor's idea of quality: a finding they
 * accepted is a passage that should be caught, one they ignored is a passage
 * that should not be.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isSuppressed, type ResolvedAuditPack } from "./audit-pack.js";
import {
  buildStoryAuditPrompt, languageOf, parseStoryFindings, ruleFindings, splitSections,
  type StoryAskFn, type StoryFinding,
} from "./story-audit.js";

export interface BenchCase {
  readonly id: string;
  /** Production type this passage belongs to, so a bench run can be per type. */
  readonly type: string;
  readonly text: string;
  /** Categories that must be found. A case with none is a known-good passage. */
  readonly catches?: ReadonlyArray<string>;
  /** Categories that must NOT be found. */
  readonly allows?: ReadonlyArray<string>;
  /** Where it came from, so a bad case can be traced back and deleted. */
  readonly from?: string;
}

export interface BenchResult {
  readonly id: string;
  readonly ok: boolean;
  /** Expected and not found — the check went quiet. */
  readonly missed: ReadonlyArray<string>;
  /** Found and not wanted — the check got noisy. */
  readonly spurious: ReadonlyArray<string>;
  readonly found: ReadonlyArray<string>;
}

export interface BenchRun {
  readonly at: string;
  readonly packs: ReadonlyArray<string>;
  readonly results: ReadonlyArray<BenchResult>;
  readonly ok: boolean;
}

const benchDir = (root: string): string => join(root, "audit", "bench");

export async function readBench(root: string, type?: string): Promise<BenchCase[]> {
  let names: string[] = [];
  try {
    names = (await readdir(benchDir(root))).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: BenchCase[] = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(await readFile(join(benchDir(root), name), "utf-8")) as BenchCase;
      if (!raw?.id || typeof raw.text !== "string" || !raw.text.trim()) continue;
      if (type && raw.type && raw.type !== type) continue;
      out.push(raw);
    } catch { /* a broken case is skipped, never fatal */ }
  }
  return out;
}

export async function writeBenchCase(root: string, one: BenchCase): Promise<void> {
  await mkdir(benchDir(root), { recursive: true });
  const safe = one.id.replace(/[^a-z0-9-]+/gi, "-").slice(0, 64);
  await writeFile(join(benchDir(root), `${safe}.json`), `${JSON.stringify(one, null, 2)}\n`, "utf-8");
}

/** A category matches an expectation by exact name or by family. */
const hits = (found: ReadonlyArray<string>, want: string): boolean =>
  found.some((c) => c === want || c.startsWith(`${want}/`));

/**
 * Run one pack against the bench.
 *
 * Without `ask` only the checks that need no model run — word lists,
 * thresholds, anachronism, drift. That is deliberate: those are what a pack
 * edit usually moves, it costs nothing, and a guard nobody can afford to run
 * is not a guard. Pass `ask` to include the model pass when a custom dimension
 * is what changed.
 */
export async function runBench(
  cases: ReadonlyArray<BenchCase>,
  pack: ResolvedAuditPack,
  ask?: StoryAskFn,
): Promise<BenchRun> {
  const results: BenchResult[] = [];
  for (const one of cases) {
    const sections = splitSections(one.text);
    const language = languageOf(one.text);
    let findings: StoryFinding[] = ruleFindings(sections, language, undefined, undefined, pack);
    if (ask) {
      for (const [index, section] of sections.entries()) {
        const out = await ask(
          buildStoryAuditPrompt(section, index, sections.length, language, pack),
          `bench-${one.id}-${index + 1}`,
        );
        findings.push(...parseStoryFindings(out, section.heading));
      }
    }
    findings = findings.filter((f) => !isSuppressed(pack, f.category));
    const found = [...new Set(findings.map((f) => f.category))];
    const missed = (one.catches ?? []).filter((want) => !hits(found, want));
    const spurious = (one.allows ?? []).filter((want) => hits(found, want));
    results.push({ id: one.id, ok: !missed.length && !spurious.length, missed, spurious, found });
  }
  return {
    at: new Date().toISOString(),
    packs: pack.packs,
    results,
    ok: results.every((r) => r.ok),
  };
}

/** One line a person can read off a bench run, for the warning before activation. */
export function benchSummary(run: BenchRun): string {
  const bad = run.results.filter((r) => !r.ok);
  if (!bad.length) return `All ${run.results.length} bench passages still judged the same way.`;
  const quiet = bad.filter((r) => r.missed.length).length;
  const noisy = bad.filter((r) => r.spurious.length).length;
  const parts = [
    quiet ? `${quiet} passage${quiet === 1 ? "" : "s"} no longer caught` : "",
    noisy ? `${noisy} now flagged that should not be` : "",
  ].filter(Boolean);
  return `${parts.join(", ")} — out of ${run.results.length}.`;
}

/**
 * Turn settled findings into bench cases.
 *
 * An accepted finding is a passage that must keep being caught; an ignored one
 * is a passage that must stop being flagged. The paragraph is stored, not the
 * whole file, so the bench stays small and a case keeps meaning something
 * after the book moves on.
 */
export function benchFromSettled(
  settled: ReadonlyArray<{
    readonly id: string;
    readonly path: string;
    readonly category: string;
    readonly state: string;
    readonly quote: string;
    readonly paragraph: string;
  }>,
  type: string,
): BenchCase[] {
  const out: BenchCase[] = [];
  for (const f of settled) {
    const text = f.paragraph.trim();
    if (text.length < 80) continue;
    const wanted = f.state === "accepted" || f.state === "fixed";
    out.push({
      id: f.id,
      type,
      text,
      ...(wanted ? { catches: [f.category] } : { allows: [f.category] }),
      from: f.path,
    });
  }
  return out;
}
