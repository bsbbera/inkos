/**
 * Measuring a voice well enough to tell two writers apart.
 *
 * The original seven features describe prose — average sentence length, TTR,
 * a few regex-spotted devices — and that is enough to put a paragraph of
 * advice in a prompt. It is not enough to answer "did the rewrite land in the
 * voice?", because two unlike authors sit at the same averages. Without a
 * number there, a restyle could only be judged by reading it, and a long book
 * could drift chapter by chapter with nothing noticing (05 §2a).
 *
 * What discriminates is function words — the/of/and, 的/了/是 — which authors
 * use at rates they cannot feel and do not vary by subject. That is the
 * Burrows' Delta basis, and it is most of the signal here. The rest of the
 * features are the ones a reader would name: how long sentences run, how much
 * is dialogue, how heavily it is punctuated.
 *
 * Everything is deterministic and costs no tokens, which is what lets it run
 * on every chapter of a fourteen-chapter book.
 */
import type { StyleProfileV2 } from "../models/style-profile.js";

/** The commonest English function words, in frequency order. */
const EN_FUNCTION = [
  "the", "of", "and", "to", "a", "in", "that", "it", "is", "was", "he", "for", "on", "with",
  "as", "at", "by", "i", "this", "had", "not", "but", "her", "she", "they", "from", "or",
  "an", "were", "we", "there", "been", "his", "him", "would", "all", "will", "my", "one",
  "so", "up", "out", "if", "into", "then", "no", "when", "them", "me", "what", "who",
] as const;

/**
 * Chinese function words: particles, pronouns and prepositions.
 *
 * Chinese has no spaces, so word frequency needs a dictionary or a segmenter.
 * These are the high-frequency single characters and two-character particles,
 * counted as substrings — crude against a real segmenter, and stable enough to
 * compare two texts with, which is all this is for.
 */
const ZH_FUNCTION = [
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也",
  "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那",
  "他", "她", "们", "把", "被", "给", "让", "从", "但", "而", "却", "又", "还", "才",
] as const;

const SAID_BOOKISMS = /\b(exclaimed|declared|retorted|hissed|barked|chuckled|snarled|breathed|muttered|shouted|whispered|growled)\b/gi;
const SENSORY = /\b(saw|looked|watched|heard|sound|listened|smell|scent|taste|touch|felt|cold|warm|bright|dark|loud|soft|rough|sweet|bitter)\b/gi;

/** Sentences, the same way the original analyzer splits them. */
function sentencesOf(text: string, isEn: boolean): ReadonlyArray<string> {
  return text.split(isEn ? /[.!?]+/ : /[。！？\n]/).map((s) => s.trim()).filter(Boolean);
}

/** Length in the unit that language counts in: words for en, characters for zh. */
function measure(sentence: string, isEn: boolean): number {
  if (!isEn) return sentence.replace(/\s+/g, "").length;
  return (sentence.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) ?? []).length;
}

/** Eight buckets: 1–5, 6–10, 11–15, 16–20, 21–25, 26–30, 31–40, 40+. */
const BUCKET_EDGES = [5, 10, 15, 20, 25, 30, 40];

function bucketsOf(lengths: ReadonlyArray<number>): ReadonlyArray<number> {
  const counts = new Array(BUCKET_EDGES.length + 1).fill(0) as number[];
  for (const n of lengths) {
    const index = BUCKET_EDGES.findIndex((edge) => n <= edge);
    counts[index < 0 ? BUCKET_EDGES.length : index] += 1;
  }
  const total = lengths.length || 1;
  return counts.map((c) => round(c / total, 4));
}

const round = (n: number, places = 4): number => {
  const f = 10 ** places;
  return Math.round((Number.isFinite(n) ? n : 0) * f) / f;
};

/** How much of the text is inside quotation marks. */
function dialogueRatio(text: string, isEn: boolean): number {
  const pattern = isEn ? /[""][^""]{2,400}[""]|"[^"]{2,400}"/g : /[「“][^」”]{2,400}[」”]/g;
  const inside = (text.match(pattern) ?? []).join("").length;
  return round(inside / (text.length || 1));
}

/**
 * Measure one text. Language decides how words are counted, not which
 * features exist — the two profiles stay comparable in shape.
 */
export function fingerprint(text: string, language: "zh" | "en" = "en"): StyleProfileV2 {
  const isEn = language === "en";
  const body = String(text ?? "");
  const sentences = sentencesOf(body, isEn);
  const lengths = sentences.map((s) => measure(s, isEn));
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const words = isEn
    ? (body.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [])
    : Array.from(body.replace(/\s+/g, ""));
  const total = words.length || 1;
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  const functionWords: Record<string, number> = {};
  if (isEn) {
    for (const w of EN_FUNCTION) functionWords[w] = round((counts.get(w) ?? 0) / total, 5);
  } else {
    // Substring counting, because these are particles rather than tokens.
    const flat = body.replace(/\s+/g, "");
    const chars = flat.length || 1;
    for (const w of ZH_FUNCTION) {
      functionWords[w] = round(flat.split(w).length - 1 > 0 ? (flat.split(w).length - 1) / chars : 0, 5);
    }
  }

  const per1000 = (n: number) => round((n / total) * 1000, 3);
  const count = (re: RegExp) => (body.match(re) ?? []).length;

  const hapax = [...counts.values()].filter((n) => n === 1).length;
  const fragments = lengths.filter((n) => n > 0 && n <= (isEn ? 4 : 8)).length;

  return {
    version: 2,
    language,
    sentenceBuckets: bucketsOf(lengths),
    fragmentRate: round(fragments / (sentences.length || 1)),
    oneSentenceParagraphs: round(
      paragraphs.filter((p) => sentencesOf(p, isEn).length <= 1).length / (paragraphs.length || 1),
    ),
    dialogueRatio: dialogueRatio(body, isEn),
    hapaxRatio: round(hapax / total),
    meanWordLength: isEn ? round(words.join("").length / total, 3) : 1,
    contractionRate: isEn ? per1000(count(/\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi)) : 0,
    adverbRate: isEn ? per1000(count(/\b\w+ly\b/gi)) : per1000(count(/地[^\s]/g)),
    functionWords,
    punctuation: {
      emDash: per1000(count(/—|--/g)),
      semicolon: per1000(count(/;|；/g)),
      colon: per1000(count(/:|：/g)),
      ellipsis: per1000(count(/\.\.\.|…/g)),
      exclamation: per1000(count(/!|！/g)),
      question: per1000(count(/\?|？/g)),
      parenthesis: per1000(count(/\(|（/g)),
    },
    saidBookismRate: isEn ? per1000(count(SAID_BOOKISMS)) : 0,
    sensoryDensity: isEn ? per1000(count(SENSORY)) : 0,
    openingLength: lengths[0] ?? 0,
    closingLength: lengths[lengths.length - 1] ?? 0,
  };
}

/* ------------------------------------------------------------------ distance */

/** The non-function-word features, and how much each is worth in the total. */
const WEIGHTS: ReadonlyArray<{ get: (p: StyleProfileV2) => number; weight: number; scale: number }> = [
  { get: (p) => p.fragmentRate, weight: 1, scale: 0.2 },
  { get: (p) => p.oneSentenceParagraphs, weight: 1, scale: 0.25 },
  { get: (p) => p.dialogueRatio, weight: 1.5, scale: 0.2 },
  { get: (p) => p.hapaxRatio, weight: 1, scale: 0.15 },
  { get: (p) => p.meanWordLength, weight: 0.5, scale: 0.8 },
  { get: (p) => p.contractionRate, weight: 0.8, scale: 12 },
  { get: (p) => p.adverbRate, weight: 0.8, scale: 10 },
  { get: (p) => p.punctuation.emDash ?? 0, weight: 0.7, scale: 6 },
  { get: (p) => p.punctuation.semicolon ?? 0, weight: 0.7, scale: 4 },
  { get: (p) => p.punctuation.ellipsis ?? 0, weight: 0.5, scale: 6 },
  { get: (p) => p.punctuation.exclamation ?? 0, weight: 0.5, scale: 6 },
  { get: (p) => p.saidBookismRate, weight: 0.6, scale: 4 },
  { get: (p) => p.sensoryDensity, weight: 0.6, scale: 12 },
];

/**
 * How far one voice is from another. 0 is identical; ~1 is a different writer.
 *
 * Burrows' Delta over the function words carries the weight, with the named
 * features as a second term so that a real difference a reader would notice —
 * half the text is dialogue, or nothing is — is not washed out by particles.
 * Each feature is divided by a plausible spread rather than z-scored against a
 * corpus, because there is no corpus here; the number only has to be
 * comparable with itself, which is what "did this rewrite get closer?" needs.
 */
export function distance(a: StyleProfileV2 | undefined, b: StyleProfileV2 | undefined): number {
  if (!a || !b) return 1;
  if (a.language !== b.language) return 1;

  const keys = Object.keys(a.functionWords).filter((k) => k in b.functionWords);
  let delta = 0;
  for (const key of keys) {
    const x = a.functionWords[key] ?? 0;
    const y = b.functionWords[key] ?? 0;
    // Scaled by the pair's own magnitude: a gap of 0.01 is enormous for a word
    // used 0.2% of the time and nothing for one used 6%.
    const spread = Math.max(x, y, 0.004);
    delta += Math.abs(x - y) / spread;
  }
  const words = keys.length ? delta / keys.length : 1;

  let sum = 0;
  let weight = 0;
  for (const feature of WEIGHTS) {
    const gap = Math.abs(feature.get(a) - feature.get(b)) / feature.scale;
    sum += feature.weight * Math.min(gap, 3) ** 2;
    weight += feature.weight;
  }
  const named = Math.sqrt(sum / (weight || 1));

  const buckets = a.sentenceBuckets.reduce(
    (n, share, i) => n + Math.abs(share - (b.sentenceBuckets[i] ?? 0)), 0,
  ) / 2;

  return round(0.5 * Math.min(words, 3) + 0.35 * named + 0.15 * buckets, 3);
}

/** The features furthest apart, as the instruction a second pass needs. */
export function gaps(
  target: StyleProfileV2 | undefined,
  got: StyleProfileV2 | undefined,
  limit = 3,
): ReadonlyArray<string> {
  if (!target || !got) return [];
  const rows: Array<{ text: string; size: number }> = [];
  const say = (name: string, want: number, have: number, scale: number, fmt: (n: number) => string) => {
    const size = Math.abs(want - have) / scale;
    if (size > 0.35) rows.push({ text: `${name}: yours is ${fmt(have)}, the voice is ${fmt(want)}`, size });
  };
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const per = (n: number) => `${n.toFixed(1)} per 1000 words`;

  say("dialogue", target.dialogueRatio, got.dialogueRatio, 0.2, pct);
  say("one-sentence paragraphs", target.oneSentenceParagraphs, got.oneSentenceParagraphs, 0.25, pct);
  say("fragments", target.fragmentRate, got.fragmentRate, 0.2, pct);
  say("em-dashes", target.punctuation.emDash ?? 0, got.punctuation.emDash ?? 0, 6, per);
  say("semicolons", target.punctuation.semicolon ?? 0, got.punctuation.semicolon ?? 0, 4, per);
  say("-ly adverbs", target.adverbRate, got.adverbRate, 10, per);
  say("contractions", target.contractionRate, got.contractionRate, 12, per);
  say("said-bookisms", target.saidBookismRate, got.saidBookismRate, 4, per);

  const wantLong = (target.sentenceBuckets[6] ?? 0) + (target.sentenceBuckets[7] ?? 0);
  const haveLong = (got.sentenceBuckets[6] ?? 0) + (got.sentenceBuckets[7] ?? 0);
  say("long sentences", wantLong, haveLong, 0.2, pct);

  return rows.sort((x, y) => y.size - x.size).slice(0, limit).map((r) => r.text);
}

/**
 * A blend's target: the weighted mean, except where one voice owns a facet.
 *
 * Averaging everything would make a three-way blend sound like nobody. The
 * facet rules exist so "Chandler's sentences, my dialogue" produces exactly
 * that: the dialogue features come from the dialogue owner outright rather
 * than being diluted by two writers who were not asked about it (05 §4).
 */
export function blendTarget(
  parts: ReadonlyArray<{ profile: StyleProfileV2 | undefined; weight: number; facets?: ReadonlyArray<string> }>,
): StyleProfileV2 | undefined {
  const known = parts.filter((p) => p.profile) as Array<{
    profile: StyleProfileV2; weight: number; facets?: ReadonlyArray<string>;
  }>;
  if (!known.length) return undefined;
  if (known.length === 1) return known[0]!.profile;

  const total = known.reduce((n, p) => n + (p.weight || 0), 0) || 1;
  const mean = (get: (p: StyleProfileV2) => number): number =>
    round(known.reduce((n, p) => n + get(p.profile) * (p.weight || 0), 0) / total, 4);
  const ownerOf = (facet: string) => known.find((p) => p.facets?.includes(facet))?.profile;

  const base = known.reduce((a, b) => ((a.weight || 0) >= (b.weight || 0) ? a : b)).profile;
  const dialogue = ownerOf("dialogue");
  const punct = ownerOf("punctuation");
  const sentence = ownerOf("sentence") ?? ownerOf("rhythm");

  const functionWords: Record<string, number> = {};
  for (const key of Object.keys(base.functionWords)) {
    functionWords[key] = round(
      known.reduce((n, p) => n + (p.profile.functionWords[key] ?? 0) * (p.weight || 0), 0) / total, 5,
    );
  }
  const punctuation: Record<string, number> = {};
  for (const key of Object.keys(base.punctuation)) {
    punctuation[key] = punct
      ? (punct.punctuation[key] ?? 0)
      : round(known.reduce((n, p) => n + (p.profile.punctuation[key] ?? 0) * (p.weight || 0), 0) / total, 3);
  }

  return {
    version: 2,
    language: base.language,
    sentenceBuckets: sentence
      ? sentence.sentenceBuckets
      : base.sentenceBuckets.map((_, i) => mean((p) => p.sentenceBuckets[i] ?? 0)),
    fragmentRate: sentence ? sentence.fragmentRate : mean((p) => p.fragmentRate),
    oneSentenceParagraphs: mean((p) => p.oneSentenceParagraphs),
    dialogueRatio: dialogue ? dialogue.dialogueRatio : mean((p) => p.dialogueRatio),
    hapaxRatio: mean((p) => p.hapaxRatio),
    meanWordLength: mean((p) => p.meanWordLength),
    contractionRate: dialogue ? dialogue.contractionRate : mean((p) => p.contractionRate),
    adverbRate: mean((p) => p.adverbRate),
    functionWords,
    punctuation,
    saidBookismRate: dialogue ? dialogue.saidBookismRate : mean((p) => p.saidBookismRate),
    sensoryDensity: ownerOf("description")?.sensoryDensity ?? ownerOf("imagery")?.sensoryDensity ?? mean((p) => p.sensoryDensity),
    openingLength: mean((p) => p.openingLength),
    closingLength: mean((p) => p.closingLength),
  };
}
