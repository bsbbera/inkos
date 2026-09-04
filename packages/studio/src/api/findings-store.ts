/**
 * Findings, kept until somebody settles them.
 *
 * Every check in this app has been write-only: a run produced findings, the
 * route returned them in its response, and the moment that response scrolled
 * away they were gone. Run the audit twice and you got the same six complaints
 * twice, with no memory of the four you had already decided about. There was
 * nowhere to say "yes, fix that one" or "no, leave it".
 *
 * So findings live on disk beside the work, and a run merges into what is
 * there rather than replacing it. The rules that matter:
 *
 * - A settled finding stays settled. Re-running a check may not resurrect what
 *   somebody already dismissed.
 * - An open finding for a file the run re-read and no longer reports is gone —
 *   the words it was about have changed.
 * - Findings for files a run did not read are not touched by it.
 *
 * One JSON file rather than a table, for the same reason `audit-state.json` is
 * one: this is tens of entries for work a person is reading by hand, and it
 * should be readable and repairable by whoever owns the workspace.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applyFix, applyParagraph, blocksApproval, countBySeverity, mergeFindings, paragraphOf,
  safeChildPath, type Finding, type FindingState,
} from "@actalk/quire-core";

export interface FindingsFile {
  readonly version: 1;
  readonly findings: ReadonlyArray<Finding>;
}

const EMPTY: FindingsFile = { version: 1, findings: [] };

export function findingsPath(root: string): string {
  return join(root, ".quire", "findings.json");
}

export async function readFindings(root: string): Promise<ReadonlyArray<Finding>> {
  try {
    const parsed = JSON.parse(await readFile(findingsPath(root), "utf-8")) as FindingsFile;
    // A hand-edited file that lost its shape must not take the screen with it.
    return Array.isArray(parsed?.findings) ? parsed.findings : EMPTY.findings;
  } catch {
    return EMPTY.findings;
  }
}

export async function writeFindings(
  root: string,
  findings: ReadonlyArray<Finding>,
): Promise<void> {
  const file = findingsPath(root);
  await mkdir(dirname(file), { recursive: true });
  const body: FindingsFile = { version: 1, findings };
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, "utf-8");
}

/** Fold one run's findings into the record and keep what was already settled. */
export async function recordRun(
  root: string,
  fresh: ReadonlyArray<Finding>,
  pathsRead: ReadonlyArray<string>,
): Promise<ReadonlyArray<Finding>> {
  const merged = mergeFindings(await readFindings(root), fresh, pathsRead);
  await writeFindings(root, merged);
  return merged;
}

/** Everything still open that would stop this file being signed off. */
export function blockersFor(
  findings: ReadonlyArray<Finding>,
  path: string,
): ReadonlyArray<Finding> {
  return findings.filter((f) => f.path === path && blocksApproval(f));
}

export type SettleOutcome =
  | { readonly ok: true; readonly finding: Finding; readonly wrote: boolean }
  | { readonly ok: false; readonly reason: "no-such-finding" | "no-fix" | "drifted" | "empty" };

/**
 * Settle one finding, and write the file when settling it means changing words.
 *
 * Three moves, and only the first one touches prose:
 *
 * - `accepted` with text — the reviewer's own wording, or the proposal — puts
 *   those words where the quote was.
 * - `ignored` records the decision and leaves the file exactly as it is.
 * - `open` puts a finding back in the queue without undoing anything; taking
 *   words back out is what the pre-audit copy is for.
 *
 * The span stored on the finding is a hint. `applyFix` verifies the quote is
 * still there and re-finds it if something else moved it, and refuses rather
 * than writing to the wrong place when the words are gone — which is the
 * honest answer, since the thing the finding was about no longer exists.
 */
export async function settleFinding(
  root: string,
  id: string,
  state: FindingState,
  text?: string,
  /**
   * What the text stands for.
   *
   * Accepting a proposal swaps the quoted words. A reviewer writing it
   * themselves is handed the whole paragraph, because a span with nothing
   * round it is not something anyone can write inside — so what comes back is
   * a paragraph, and replacing only the quote with it would leave the rest of
   * the old sentence welded onto both ends.
   */
  scope: "quote" | "paragraph" = "quote",
): Promise<SettleOutcome> {
  const findings = await readFindings(root);
  const finding = findings.find((f) => f.id === id);
  if (!finding) return { ok: false, reason: "no-such-finding" };

  let wrote = false;
  if (state === "accepted") {
    const replacement = (text ?? finding.fix ?? "").trim();
    // Accepting is a promise that the words change. A finding with neither a
    // proposal nor a typed replacement cannot keep it, and saying so beats
    // marking it done and leaving the prose untouched.
    if (!replacement) return { ok: false, reason: "no-fix" };

    const absolute = safeChildPath(root, finding.path);
    const markdown = await readFile(absolute, "utf-8");
    const out = scope === "paragraph"
      ? applyParagraph(markdown, finding, replacement)
      : applyFix(markdown, finding, replacement);
    if (!out.ok) {
      return { ok: false, reason: out.reason === "empty" ? "empty" : out.reason === "no-span" ? "no-fix" : "drifted" };
    }
    await writeFile(absolute, out.markdown, "utf-8");
    wrote = true;
  }

  const settled: Finding = {
    ...finding,
    state,
    ...(state === "open"
      ? { settledAt: undefined, settledText: undefined }
      : { settledAt: new Date().toISOString() }),
    ...(state === "accepted" && text?.trim() ? { settledText: text.trim() } : {}),
  };
  await writeFindings(root, findings.map((f) => (f.id === id ? settled : f)));
  return { ok: true, finding: settled, wrote };
}

/**
 * A finding with the paragraph it sits in, for the panel that shows it.
 *
 * The span is recomputed against the file as it stands rather than trusted,
 * because anything written since the check moved it — and a highlight over the
 * wrong words is worse than no highlight.
 */
export interface FindingPassage {
  readonly finding: Finding;
  /** The whole paragraph, so the sentence has its context. */
  readonly paragraph: string;
  /** Offsets of the quote *within* `paragraph`, or -1 when it could not be found. */
  readonly markStart: number;
  readonly markEnd: number;
}

export async function readPassage(
  root: string,
  finding: Finding,
): Promise<FindingPassage> {
  try {
    const markdown = await readFile(safeChildPath(root, finding.path), "utf-8");
    const paragraph = paragraphOf(markdown, finding);
    const at = paragraph.indexOf(finding.quote);
    return {
      finding,
      paragraph,
      markStart: finding.quote && at !== -1 ? at : -1,
      markEnd: finding.quote && at !== -1 ? at + finding.quote.length : -1,
    };
  } catch {
    // The file was deleted or renamed out from under the record. The finding
    // is still worth showing; the passage is simply not there any more.
    return { finding, paragraph: "", markStart: -1, markEnd: -1 };
  }
}

export { countBySeverity };
