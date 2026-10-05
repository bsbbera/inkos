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
  applyFix, applyParagraph, blocksApproval, buildFindingRewritePrompt, countBySeverity,
  languageOf, locate, locateQuote, mergeFindings, paragraphOf, paragraphSpan, relocate, rewriteDrops,
  safeChildPath, type Finding, type FindingState, type ReaderMap, type RewriteScope,
  type StoryAskFn,
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
  const existing = await readFindings(root);
  // The reader map's findings and an editor's notes belong to their own
  // sources. An audit re-reading the file did not raise them, and must not
  // take them away for that.
  const notTheAudits = (f: Finding) => f.category.startsWith("reader/") || f.category.startsWith("feedback/");
  const merged = [
    ...mergeFindings(existing.filter((f) => !notTheAudits(f)), fresh, pathsRead),
    ...existing.filter(notTheAudits),
  ];
  await writeFindings(root, merged);
  return merged;
}

/**
 * A person's verdict on a page, filed where the checks land (04 §7).
 *
 * "Redo — too long" on a chapter card used to be a comment nothing read. As a
 * finding it sits in the same queue as the audit's, and "Rewrite it" acts on
 * it like any other.
 */
export async function addNoteFinding(
  root: string,
  path: string,
  note: string,
  cause: ReadonlyArray<string>,
): Promise<Finding> {
  const markdown = await readFile(safeChildPath(root, path), "utf-8").catch(() => "");
  const said = note.trim() || cause.join(", ");
  const finding = locate({
    path,
    severity: "warning",
    category: `feedback/${cause[0]?.replace(/[^a-z]+/gi, "-").toLowerCase() || "editor"}`,
    title: said.length > 80 ? `${said.slice(0, 77)}…` : said,
    description: `${said}${note.trim() && cause.length ? ` (${cause.join(", ")})` : ""}`,
    suggestion: "Do what the editor asked, and change nothing else.",
  }, markdown);
  const findings = await readFindings(root);
  await writeFindings(root, [...findings.filter((f) => f.id !== finding.id), finding]);
  return finding;
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

export type RewriteOutcome =
  | {
    readonly ok: true;
    readonly finding: Finding;
    /** The file before and after, for the backup and the screen. */
    readonly original: string;
    readonly markdown: string;
  }
  | {
    readonly ok: false;
    readonly reason: "no-such-finding" | "no-span" | "drifted" | "empty" | "unsafe";
    readonly detail?: string;
  };

/**
 * Hand one finding's words to the writer, and put back only what comes out.
 *
 * `settleFinding` can only apply wording that already exists — the auditor's
 * or the reviewer's. This asks for new wording, with the paragraph either side
 * as context, and writes it over the quote or its paragraph and nowhere else.
 * The result is checked before it is written: a rewrite that lost a name or a
 * line of dialogue the finding was not about, or grew or shrank by more than a
 * third, has changed the story and not just the sentence, and is refused.
 *
 * Every other finding on the file is re-pinned afterwards. Their offsets were
 * into the old text, and a highlight a paragraph off is worse than none.
 */
/**
 * The span one paragraph either side of `para`, for the `beat` scope.
 *
 * A pacing complaint cannot be answered inside one paragraph — the answer is
 * usually to move a beat across the break — so the writer is given the three
 * and replaces the three.
 */
function beatSpan(text: string, para: { start: number; end: number }): { start: number; end: number } {
  const head = text.slice(0, para.start).trimEnd();
  const before = head.lastIndexOf("\n\n");
  const tail = text.slice(para.end).trimStart();
  const gap = text.length - tail.length;
  const after = tail.indexOf("\n\n");
  return {
    start: before === -1 ? 0 : before + 2,
    end: after === -1 ? text.length : gap + after,
  };
}

export async function rewriteFinding(
  root: string,
  id: string,
  options: {
    readonly scope?: RewriteScope;
    readonly note?: string;
    readonly voice?: string;
    readonly ask: StoryAskFn;
    /** Other findings in the same paragraph, answered in the same call. */
    readonly also?: ReadonlyArray<Finding>;
  },
): Promise<RewriteOutcome> {
  const findings = await readFindings(root);
  const finding = findings.find((f) => f.id === id);
  if (!finding) return { ok: false, reason: "no-such-finding" };
  if (!finding.quote) return { ok: false, reason: "no-span" };

  const absolute = safeChildPath(root, finding.path);
  const original = await readFile(absolute, "utf-8");
  const at = locateQuote(original, finding.quote);
  if (!at) return { ok: false, reason: "drifted" };
  const para = paragraphSpan(original, { ...finding, ...at })!;
  const scope = options.scope ?? "quote";
  const target = scope === "paragraph" ? para : scope === "beat" ? beatSpan(original, para) : at;
  const span = original.slice(target.start, target.end);

  const head = original.slice(0, target.start).trimEnd();
  const tail = original.slice(target.end).trimStart();
  const cut = tail.indexOf("\n\n");
  const out = await options.ask(buildFindingRewritePrompt({
    finding,
    ...(options.also?.length ? { also: options.also } : {}),
    scope,
    span,
    paragraph: original.slice(para.start, para.end),
    before: head.slice(head.lastIndexOf("\n\n") + 1).trim(),
    after: (cut === -1 ? tail : tail.slice(0, cut)).trim(),
    language: languageOf(original),
    ...(options.note ? { note: options.note } : {}),
    ...(options.voice ? { voice: options.voice } : {}),
  }), "finding-rewrite");

  const text = String(out.text ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };
  const unsafe = rewriteDrops(span, text, finding.quote);
  if (unsafe) return { ok: false, reason: "unsafe", detail: unsafe };

  const markdown = original.slice(0, target.start) + text + original.slice(target.end);
  await writeFile(absolute, markdown, "utf-8");

  const at_ = new Date().toISOString();
  const fixed: Finding = {
    ...finding,
    state: "fixed",
    fixedBy: "reviser",
    settledAt: at_,
    settledText: text,
    replaced: span,
    para: at.para,
    start: target.start,
    end: target.start + text.length,
  };
  // Anything answered inside the same call is settled by the same write. Left
  // open, they would be re-offered against words that no longer exist.
  const alsoFixed = new Set((options.also ?? []).map((f) => f.id));
  await writeFindings(root, findings.map((f) =>
    f.id === id ? fixed
      : alsoFixed.has(f.id)
        ? { ...f, state: "fixed" as FindingState, fixedBy: "reviser" as const, settledAt: at_, replaced: span }
        : f.path === finding.path ? relocate(f, markdown) : f));
  return { ok: true, finding: fixed, original, markdown };
}

export interface BatchRewriteResult {
  readonly rewritten: number;
  readonly paragraphs: number;
  readonly failed: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
}

/**
 * Rewrite every accepted finding in one file, one call per paragraph (19 §5b).
 *
 * Grouping is the whole point: fourteen findings over four paragraphs become
 * four calls, each seeing all of its paragraph's complaints at once, so the
 * second fix cannot undo the first. The file is never regenerated, so a
 * rewrite still cannot introduce a problem three pages away.
 *
 * Paragraphs are taken last-first. Each rewrite moves every offset after it,
 * and working backwards means the spans still ahead are the ones not yet
 * touched.
 */
export async function rewriteAccepted(
  root: string,
  path: string,
  options: {
    readonly ask: StoryAskFn;
    readonly voice?: string;
    readonly note?: string;
    readonly scope?: RewriteScope;
  },
): Promise<BatchRewriteResult> {
  const all = await readFindings(root);
  const mine = all.filter((f) => f.path === path && f.state === "accepted" && f.quote);
  if (!mine.length) return { rewritten: 0, paragraphs: 0, failed: [] };

  const text = await readFile(safeChildPath(root, path), "utf-8");
  const groups = new Map<number, Finding[]>();
  for (const f of mine) {
    const at = locateQuote(text, f.quote);
    const para = at ? paragraphSpan(text, { ...f, ...at }) : null;
    // A finding whose words have moved cannot be grouped by paragraph; it is
    // reported as drifted rather than guessed at.
    if (!para) continue;
    (groups.get(para.start) ?? groups.set(para.start, []).get(para.start)!).push(f);
  }

  const failed: Array<{ id: string; reason: string }> = [];
  for (const f of mine) {
    if (![...groups.values()].some((g) => g.includes(f))) failed.push({ id: f.id, reason: "drifted" });
  }

  let rewritten = 0;
  for (const start of [...groups.keys()].sort((a, b) => b - a)) {
    const group = groups.get(start)!;
    const [lead, ...rest] = group as [Finding, ...Finding[]];
    const out = await rewriteFinding(root, lead.id, {
      ask: options.ask,
      scope: options.scope ?? "paragraph",
      ...(rest.length ? { also: rest } : {}),
      ...(options.voice ? { voice: options.voice } : {}),
      ...(options.note ? { note: options.note } : {}),
    });
    if (out.ok) rewritten += group.length;
    else failed.push({ id: lead.id, reason: out.reason });
  }
  return { rewritten, paragraphs: groups.size, failed };
}

/*
 * ---------------------------------------------------------------- reader map
 *
 * Where simulated readers stop (19 §5c). The maps are kept per file beside the
 * findings; the cold paragraphs are findings too, filed `reader/<persona>`.
 */

export interface ReaderRun {
  readonly at: string;
  readonly maps: ReadonlyArray<ReaderMap>;
}

function readerFile(root: string): string {
  return join(root, ".quire", "reader.json");
}

export async function readReaderRuns(root: string): Promise<Readonly<Record<string, ReaderRun>>> {
  try {
    const parsed = JSON.parse(await readFile(readerFile(root), "utf-8")) as { files?: Record<string, ReaderRun> };
    return parsed?.files && typeof parsed.files === "object" ? parsed.files : {};
  } catch {
    return {};
  }
}

const isReader = (f: Finding) => f.category.startsWith("reader/");

/**
 * Keep one run's maps and replace this file's open reader findings with its
 * cold paragraphs. The audit's own findings are not touched, and a reader
 * finding somebody already settled stays settled.
 */
export async function saveReaderRun(
  root: string,
  path: string,
  run: ReaderRun,
  fresh: ReadonlyArray<Finding>,
): Promise<void> {
  const files = { ...(await readReaderRuns(root)), [path]: run };
  await mkdir(dirname(readerFile(root)), { recursive: true });
  await writeFile(readerFile(root), `${JSON.stringify({ version: 1, files }, null, 2)}\n`, "utf-8");

  const existing = await readFindings(root);
  const settled = new Set(existing.filter((f) => f.state !== "open").map((f) => f.id));
  const kept = existing.filter((f) => !(f.path === path && isReader(f) && f.state === "open"));
  await writeFindings(root, [...kept, ...fresh.filter((f) => !settled.has(f.id))]);
}

export { countBySeverity };
