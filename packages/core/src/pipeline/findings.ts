/**
 * A finding that knows where it is.
 *
 * Every check in this codebase reports the same way: a category, a severity, a
 * sentence about what is wrong, and a sentence about what to do. None of them
 * says *where*. `StoryFinding` carries a section heading, `AuditIssue` carries
 * nothing at all, and `PublicationFinding` carries a page number. So the only
 * thing a screen can do with a finding is print it, and the only thing a
 * person can do with it is read the whole chapter looking for the sentence the
 * machine meant.
 *
 * That is also why the revise pass is all-or-nothing. It rewrites a whole
 * section from every finding against it at once, because it has no way to
 * touch the one paragraph a single finding is about. A reviewer who agrees
 * with four findings and disagrees with the fifth has no move except to accept
 * all five or none.
 *
 * A finding with an offset and a proposed replacement fixes both: the passage
 * can be shown with the span marked, and one finding can be settled on its own
 * without disturbing the sentence beside it.
 *
 * Offsets are into the file as it stood when the check ran, so they go stale
 * the moment anything else is written. Every function here re-verifies the
 * quote before trusting a span, and reports drift rather than writing to the
 * wrong place.
 */
import { createHash } from "node:crypto";

/** What a finding costs. `blocking` is the only one that stops an approval. */
export type FindingSeverity = "blocking" | "warning" | "note";

/** Whether a person has dealt with it yet. */
export type FindingState = "open" | "accepted" | "ignored";

export interface FindingLocation {
  /** Index of the paragraph in the file, counting blank-line-separated blocks from 0. */
  readonly para: number;
  /** Character offsets into the file. `end` is exclusive. */
  readonly start: number;
  readonly end: number;
}

export interface Finding extends FindingLocation {
  /** Stable across re-runs: the same complaint about the same words keeps its id. */
  readonly id: string;
  /** Project-relative path of the file this is about. */
  readonly path: string;
  /** The heading it sits under, or "" for a finding about the whole piece. */
  readonly section: string;
  /** The exact text the finding is about. Empty when it is about the piece, not a span. */
  readonly quote: string;
  readonly severity: FindingSeverity;
  /** Machine-facing family: `continuity`, `voice`, `fact`, `ai-tell/hedging`, `dim7/…`. */
  readonly category: string;
  /** Short enough to be a row in a queue. */
  readonly title: string;
  readonly description: string;
  readonly suggestion: string;
  /** What the checker proposes should replace `quote`. Absent when it has no proposal. */
  readonly fix?: string;
  readonly state: FindingState;
  readonly at: string;
  readonly settledAt?: string;
  /** Set when the reviewer wrote the replacement themselves rather than taking the proposal. */
  readonly settledText?: string;
}

/** A finding as a checker produces it, before it is located and stored. */
export interface RawFinding {
  readonly path: string;
  readonly section?: string;
  readonly quote?: string;
  readonly severity: FindingSeverity;
  readonly category: string;
  readonly title?: string;
  readonly description: string;
  readonly suggestion: string;
  readonly fix?: string;
}

/**
 * Severity from whatever a checker happened to call it.
 *
 * Three vocabularies exist already — `critical|warning|info` in the continuity
 * auditor, `warning|info` in the story audit, `error|warning` in the rule
 * passes — and they all mean the same three things.
 */
export function normalizeSeverity(value: unknown): FindingSeverity {
  const s = String(value ?? "").toLowerCase();
  if (s === "blocking" || s === "critical" || s === "error" || s === "blocker") return "blocking";
  if (s === "note" || s === "info" || s === "minor" || s === "suggestion") return "note";
  return "warning";
}

/** Only a blocking finding that nobody has settled stands in the way of an approval. */
export function blocksApproval(finding: Finding): boolean {
  return finding.severity === "blocking" && finding.state === "open";
}

/*
 * ------------------------------------------------------------------ locating
 */

/** Whitespace differences are the model's, not the author's. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Paragraph index of a character offset: blank-line-separated blocks, from 0. */
export function paragraphAt(markdown: string, offset: number): number {
  if (offset <= 0) return 0;
  const before = markdown.slice(0, offset);
  // A run of two-or-more newlines ends a paragraph however much space is in it.
  return (before.match(/\n\s*\n/g) ?? []).length;
}

/**
 * Where a quoted span sits in the file.
 *
 * Exact first, because that is what a model returns when it copied properly.
 * Then whitespace-insensitive, because a model that re-wrapped the line still
 * meant the same words and losing the location over a line break would make
 * the feature useless in practice.
 *
 * Nothing fuzzier than that. A near-match found by edit distance would put a
 * highlight — and later a replacement — over words the checker never read.
 */
export function locateQuote(markdown: string, quote: string): FindingLocation | null {
  const wanted = quote.trim();
  if (!wanted) return null;

  const exact = markdown.indexOf(wanted);
  if (exact !== -1) {
    return { para: paragraphAt(markdown, exact), start: exact, end: exact + wanted.length };
  }

  /*
   * Whitespace-insensitive search, done by walking the file and comparing
   * normalized forms rather than by building a regex out of user text — a
   * quote with `(` or `*` in it is ordinary prose and a common one.
   */
  const target = normalize(wanted);
  if (!target) return null;
  const words = target.split(" ");
  const first = words[0]!;

  for (let i = markdown.indexOf(first); i !== -1; i = markdown.indexOf(first, i + 1)) {
    // The candidate can be longer than the quote by however much whitespace
    // was collapsed; a generous window costs one comparison.
    const window = markdown.slice(i, i + wanted.length * 2 + 32);
    if (!normalize(window).startsWith(target)) continue;
    // Walk back from the window's end until the normalized slice is exactly
    // the target, so the span stops at the quote and not somewhere after it.
    for (let end = i + target.length; end <= i + window.length; end += 1) {
      if (normalize(markdown.slice(i, end)) === target) {
        return { para: paragraphAt(markdown, i), start: i, end };
      }
    }
  }
  return null;
}

/** No location: the finding is about the piece, or the quote no longer exists. */
export const NO_LOCATION: FindingLocation = { para: -1, start: -1, end: -1 };

/**
 * The id that survives a re-run.
 *
 * Deliberately not the description: a model asked the same question twice
 * words its complaint differently each time, and an id built from the wording
 * would resurrect every finding a person had already dismissed. Path, section,
 * category and the quoted text are the things that are actually the same
 * complaint.
 */
export function findingId(input: {
  readonly path: string;
  readonly section?: string;
  readonly category: string;
  readonly quote?: string;
}): string {
  const key = [
    input.path,
    input.section ?? "",
    input.category,
    normalize(input.quote ?? ""),
  ].join(" :: ");
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

/** Give a raw finding an id, a location and an open state. */
export function locate(raw: RawFinding, markdown: string, at = new Date().toISOString()): Finding {
  const where = raw.quote ? locateQuote(markdown, raw.quote) : null;
  return {
    id: findingId(raw),
    path: raw.path,
    section: raw.section ?? "",
    quote: raw.quote ?? "",
    severity: raw.severity,
    category: raw.category,
    // A queue row needs a label. The first sentence of the description is one
    // when the checker did not write a title, and is never worse than the id.
    title: raw.title?.trim() || firstSentence(raw.description),
    description: raw.description,
    suggestion: raw.suggestion,
    ...(raw.fix ? { fix: raw.fix } : {}),
    state: "open" as const,
    at,
    ...(where ?? NO_LOCATION),
  };
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const stop = /[.!?](\s|$)/.exec(trimmed);
  const head = stop ? trimmed.slice(0, stop.index + 1) : trimmed;
  return head.length > 90 ? `${head.slice(0, 87)}…` : head;
}

/*
 * -------------------------------------------------------------------- merging
 */

/**
 * Fold a fresh run's findings into what is already on record.
 *
 * The rule the mock states: *findings from earlier runs stay until you settle
 * them*. So a re-run may not wipe the list, and may not resurrect what a person
 * already dealt with either.
 *
 * - Same id, still open → refresh it: the offsets are newer than the stored
 *   ones and the file has probably moved underneath them.
 * - Same id, already settled → leave the settlement alone.
 * - On record but not in this run, for a file this run actually read → gone;
 *   the words it was about were changed. Findings for files the run did not
 *   read are untouched.
 */
export function mergeFindings(
  existing: ReadonlyArray<Finding>,
  fresh: ReadonlyArray<Finding>,
  pathsRead: ReadonlyArray<string>,
): Finding[] {
  const read = new Set(pathsRead);
  const byId = new Map(existing.map((f) => [f.id, f]));
  const out: Finding[] = [];

  for (const f of existing) {
    if (!read.has(f.path)) out.push(f);
    else if (f.state !== "open") out.push(f);
    // An open finding for a re-read file survives only if the run found it again.
  }

  for (const f of fresh) {
    const prior = byId.get(f.id);
    if (prior && prior.state !== "open") continue; // settled stays settled
    out.push(f);
  }
  return out;
}

/*
 * ------------------------------------------------------------------- applying
 */

export type ApplyOutcome =
  | { readonly ok: true; readonly markdown: string }
  | { readonly ok: false; readonly reason: "no-span" | "drifted" | "empty" };

/**
 * Put `replacement` where the finding's quote is.
 *
 * The stored offsets are a hint, not an authority: anything written to the file
 * since the check moved them. So the quote is verified at the stored span
 * first, and the file is re-searched for it if it is not there. Only when the
 * quote cannot be found at all does this refuse — which is the honest answer,
 * because the words the finding was about are gone.
 */
export function applyFix(
  markdown: string,
  finding: Finding,
  replacement: string,
): ApplyOutcome {
  if (!finding.quote) return { ok: false, reason: "no-span" };
  if (!replacement.trim()) return { ok: false, reason: "empty" };

  const stored = markdown.slice(finding.start, finding.end);
  const at = normalize(stored) === normalize(finding.quote)
    ? { start: finding.start, end: finding.end }
    : locateQuote(markdown, finding.quote);
  if (!at) return { ok: false, reason: "drifted" };

  return { ok: true, markdown: markdown.slice(0, at.start) + replacement + markdown.slice(at.end) };
}

/** What separates one paragraph from the next in a markdown file. */
const BLANK_LINE = "\n\n";

/** Offsets of the whole paragraph a finding sits in, blank lines excluded. */
export function paragraphSpan(markdown: string, finding: Finding): FindingLocation | null {
  if (finding.start < 0) return null;
  const before = markdown.lastIndexOf(BLANK_LINE, finding.start);
  const after = markdown.indexOf(BLANK_LINE, finding.end);
  const from = before === -1 ? 0 : before + 2;
  const to = after === -1 ? markdown.length : after;
  const block = markdown.slice(from, to);
  // Trim inward, so a replacement written over this span cannot weld the
  // paragraph to the one above or below it.
  const lead = block.length - block.trimStart().length;
  const trail = block.length - block.trimEnd().length;
  return { para: finding.para, start: from + lead, end: to - trail };
}

/** The paragraph a finding sits in, for the panel that shows it in context. */
export function paragraphOf(markdown: string, finding: Finding): string {
  const span = paragraphSpan(markdown, finding);
  return span ? markdown.slice(span.start, span.end) : "";
}

/**
 * Put a rewritten paragraph where the old one was.
 *
 * The other half of taking the pen back. `applyFix` swaps the quoted words,
 * which is what accepting a proposal means; a reviewer writing the fix
 * themselves works in whole sentences, and a span with no context around it is
 * not something anybody can write inside.
 *
 * The paragraph is found from the quote rather than from the stored offset, so
 * anything written to the file since the check does not send this write
 * astray — and then the whole paragraph around it is replaced, so a reviewer
 * who rewrote every word of it still saves to the right place.
 */
export function applyParagraph(
  markdown: string,
  finding: Finding,
  replacement: string,
): ApplyOutcome {
  if (!replacement.trim()) return { ok: false, reason: "empty" };

  const anchored = finding.quote
    ? locateQuote(markdown, finding.quote)
    : { para: finding.para, start: finding.start, end: finding.end };
  if (!anchored || anchored.start < 0) {
    return { ok: false, reason: finding.quote ? "drifted" : "no-span" };
  }

  const span = paragraphSpan(markdown, { ...finding, ...anchored });
  if (!span) return { ok: false, reason: "no-span" };
  return {
    ok: true,
    markdown: markdown.slice(0, span.start) + replacement.trim() + markdown.slice(span.end),
  };
}

/** Counts the queue header shows, in the order it shows them. */
export function countBySeverity(findings: ReadonlyArray<Finding>): {
  readonly blocking: number; readonly warning: number; readonly note: number; readonly open: number;
} {
  const open = findings.filter((f) => f.state === "open");
  return {
    blocking: open.filter((f) => f.severity === "blocking").length,
    warning: open.filter((f) => f.severity === "warning").length,
    note: open.filter((f) => f.severity === "note").length,
    open: open.length,
  };
}
