/**
 * Words that did not exist yet, found without spending a token.
 *
 * The research pass writes down what is out of place in this world — a plastic
 * bag in 1943, "okay" in a Bengali clerk's mouth — and that list is exact, so
 * checking it is a string search rather than a question for a model. That
 * matters twice: it costs nothing on every chapter of a long book, and it
 * never changes its mind between runs, which is what lets a person add a term
 * to the lexicon and trust the next audit to catch it (22 §4).
 *
 * Each finding carries the words it is about, so the audit can point at the
 * sentence instead of describing it.
 */
import type { Lexicon } from "./setting.js";
import type { FindingSeverity } from "./findings.js";

export interface AnachronismHit {
  readonly term: string;
  readonly reason: string;
  readonly quote: string;
  readonly index: number;
}

/** `strict` blocks an approval, `flavour` warns, `loose` only mentions it. */
export function severityFor(fidelity: string | undefined): FindingSeverity {
  if (fidelity === "strict") return "blocking";
  if (fidelity === "loose") return "note";
  return "warning";
}

const escape = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A term, matched the way its own script needs.
 *
 * Word boundaries are a Latin-alphabet idea: Chinese runs without spaces, so
 * `\b` there would match nothing at all. Latin terms still need the boundary,
 * or "tea" fires inside "steam".
 */
function patternFor(term: string): RegExp {
  const body = escape(term.trim());
  const latin = /^[\p{Script=Latin}\p{N}\s'’-]+$/u.test(term.trim());
  return latin ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu") : new RegExp(body, "gu");
}

/** Below this, a quote is too short to find again unambiguously. */
const MIN_QUOTE = 8;

/** The sentence a hit sits in, so the finding quotes something readable. */
function sentenceAround(text: string, index: number, length: number): string {
  const before = text.slice(0, index);
  const start = Math.max(
    before.lastIndexOf(". ") + 1, before.lastIndexOf("\n") + 1,
    before.lastIndexOf("。") + 1, before.lastIndexOf("！") + 1, before.lastIndexOf("？") + 1,
    0,
  );
  const after = text.slice(index + length);
  const ends = [after.indexOf(". "), after.indexOf("\n"), after.indexOf("。"), after.indexOf("！"), after.indexOf("？")]
    .filter((n) => n >= 0);
  const end = index + length + (ends.length ? Math.min(...ends) + 1 : Math.min(after.length, 120));
  const quote = text.slice(start, end).trim();
  // A quote has to be findable again in the file for the span to be real, and
  // long enough to be unambiguous. Falling back to the term itself is honest:
  // it still locates, just less precisely.
  return quote.length >= MIN_QUOTE && quote.length <= 400 ? quote : text.slice(index, index + length);
}

/**
 * Every forbidden term that actually appears, once per term.
 *
 * Once per term, not once per occurrence: a chapter that says "okay" eleven
 * times is one thing to fix, and eleven identical rows is a queue nobody
 * reads.
 */
export function findAnachronisms(text: string, lexicon: Lexicon | null | undefined): ReadonlyArray<AnachronismHit> {
  if (!lexicon?.forbidden?.length) return [];
  const body = String(text ?? "");
  const hits: AnachronismHit[] = [];
  for (const entry of lexicon.forbidden) {
    const term = String(entry?.term ?? "").trim();
    if (term.length < 2) continue;
    const found = patternFor(term).exec(body);
    if (!found) continue;
    hits.push({
      term,
      reason: String(entry.reason ?? "not of this time or place"),
      quote: sentenceAround(body, found.index, found[0].length),
      index: found.index,
    });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * The same hits as audit findings.
 *
 * `prefer` is folded into the suggestion when the lexicon knows what should
 * stand in the term's place, because "don't say okay" is advice and "say
 * 'very well'" is a fix.
 */
export function anachronismFindings(input: {
  readonly text: string;
  readonly lexicon: Lexicon | null | undefined;
  readonly fidelity?: string;
  readonly section?: string;
}): ReadonlyArray<{
  section: string;
  severity: FindingSeverity;
  category: string;
  description: string;
  suggestion: string;
  quote: string;
}> {
  const severity = severityFor(input.fidelity);
  const prefer = new Map(
    (input.lexicon?.prefer ?? [])
      .filter((p) => p.for)
      .map((p) => [String(p.for).toLowerCase(), p.term]),
  );
  return findAnachronisms(input.text, input.lexicon).map((hit) => {
    const instead = prefer.get(hit.term.toLowerCase());
    return {
      section: input.section ?? "",
      severity,
      category: `anachronism/${hit.term.toLowerCase().replace(/\s+/g, "-")}`,
      description: input.section
        ? `${input.section}: "${hit.term}" is out of place here — ${hit.reason}`
        : `"${hit.term}" is out of place here — ${hit.reason}`,
      suggestion: instead
        ? `Use "${instead}" instead of "${hit.term}".`
        : `Replace "${hit.term}" with something this world would have.`,
      quote: hit.quote,
    };
  });
}
