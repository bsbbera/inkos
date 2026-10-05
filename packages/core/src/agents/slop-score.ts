/**
 * A humanity check that needs no API key (19 §5.5).
 *
 * The de-AI pass has always needed GPTZero or Originality, which means most
 * people have never had one: no key, no score, no destyle. But the signals
 * those services sell are largely the ones already measured here for nothing —
 * paragraphs of identical length, hedges every other sentence, the same four
 * joins over and over, prose shaped like a list. Counting them gives a score
 * on the same 0–1 scale, so the same threshold and the same rewrite loop work
 * with or without a subscription.
 *
 * It is deliberately not a detector. It cannot tell a careful writer from a
 * model, and it is not evidence of anything; it is a mirror held up to the
 * habits that make prose read as machine-made. The external providers stay as
 * the answer for anyone who needs a number they can cite.
 *
 * The pack tunes it: a word list the person added is counted like a builtin
 * one, so "stop writing 'nestled'" raises the score of a page that does.
 */
import { analyzeAITells } from "./ai-tells.js";
import type { ResolvedAuditPack } from "../pipeline/audit-pack.js";

export interface SlopScore {
  /** 0 (reads human) to 1 (reads machine-made), the detector scale. */
  readonly score: number;
  /** What pushed it up, worst first, as sentences a person can act on. */
  readonly reasons: ReadonlyArray<string>;
  readonly provider: "local";
}

/**
 * What each tell is worth.
 *
 * Uniform paragraphs and list-shaped prose weigh most because they are
 * structural — a writer does not fall into them by accident — while hedges and
 * joins are habits a human shares, so they count for less.
 */
const WEIGHTS: Readonly<Record<string, number>> = {
  "Paragraph uniformity": 0.3,
  段落等长: 0.3,
  "List-like structure": 0.25,
  列表式结构: 0.25,
  "Formulaic transitions": 0.2,
  套话密度: 0.15,
  "Hedge density": 0.15,
  公式化转折: 0.2,
  "Paragraph length": 0.1,
  段落过长: 0.1,
};

/** Anything not in the table still counts for something, just not much. */
const OTHER = 0.08;

export function slopScore(
  content: string,
  language: "zh" | "en" = "en",
  pack?: ResolvedAuditPack,
): SlopScore {
  const { issues } = analyzeAITells(content, language, pack ? {
    hedgeWords: pack.hedgeWords,
    markers: pack.markers,
    ...(pack.paragraphMaxChars ? { paragraphMaxChars: pack.paragraphMaxChars } : {}),
  } : undefined);

  let total = 0;
  const reasons: string[] = [];
  // One category counts once however many times it fired: a long chapter
  // would otherwise score higher than a short one saying the same thing.
  const counted = new Set<string>();
  for (const issue of issues) {
    if (counted.has(issue.category)) continue;
    counted.add(issue.category);
    total += WEIGHTS[issue.category] ?? OTHER;
    reasons.push(issue.description);
  }

  return {
    // Held below 1 on purpose: no count of habits proves authorship, and a
    // score of exactly 1 would read as one.
    score: Math.min(0.95, Number(total.toFixed(2))),
    reasons,
    provider: "local",
  };
}
