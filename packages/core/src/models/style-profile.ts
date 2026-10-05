/** Style fingerprint profile extracted from reference text. */
export interface StyleProfile {
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly avgParagraphLength: number;
  readonly paragraphLengthRange: {
    readonly min: number;
    readonly max: number;
  };
  readonly vocabularyDiversity: number; // TTR (Type-Token Ratio)
  readonly topPatterns: ReadonlyArray<string>;
  readonly rhetoricalFeatures: ReadonlyArray<string>;
  readonly sourceName?: string;
  readonly analyzedAt?: string;
  /**
   * The measurements that can actually tell two authors apart (05 §2a).
   *
   * The seven fields above describe a voice; they do not discriminate one.
   * Two very different writers land on similar sentence averages, so "is this
   * in the voice?" had no operational answer and a restyle could only be
   * judged by reading it. Optional and versioned because every profile
   * already written on disk lacks them and must keep loading.
   */
  readonly v2?: StyleProfileV2;
}

/** Stylometry: the parts of a voice that are countable. */
export interface StyleProfileV2 {
  readonly version: 2;
  readonly language: "zh" | "en";
  /** Share of sentences in each length bucket: 1–5, 6–10, … 36–40, 40+. */
  readonly sentenceBuckets: ReadonlyArray<number>;
  readonly fragmentRate: number;
  readonly oneSentenceParagraphs: number;
  readonly dialogueRatio: number;
  readonly hapaxRatio: number;
  readonly meanWordLength: number;
  readonly contractionRate: number;
  readonly adverbRate: number;
  /**
   * Relative frequency of the commonest function words — the Burrows' Delta
   * basis, and the single feature group that carries most of the signal about
   * who wrote something.
   */
  readonly functionWords: Readonly<Record<string, number>>;
  /** Per 1000 words: em-dash, semicolon, colon, ellipsis, exclamation, question, parenthesis. */
  readonly punctuation: Readonly<Record<string, number>>;
  readonly saidBookismRate: number;
  readonly sensoryDensity: number;
  readonly openingLength: number;
  readonly closingLength: number;
}
