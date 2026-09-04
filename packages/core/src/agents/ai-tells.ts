/**
 * Structural AI-tell detection — pure rule-based analysis (no LLM).
 *
 * Detects patterns common in AI-generated Chinese text:
 * - dim 20: Paragraph length uniformity (low variance)
 * - dim 21: Filler/hedge word density
 * - dim 22: Formulaic transition patterns
 * - dim 23: List-like structure (consecutive same-prefix sentences)
 */

export interface AITellIssue {
  readonly severity: "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
  /**
   * The words the check is actually complaining about, verbatim from the text.
   *
   * Every one of these detectors knew exactly where the problem was and threw
   * it away, so a finding arrived as a sentence of prose about the prose -
   * "detected 3 consecutive sentences with the same opening pattern" - and the
   * reader had to go and find them. A quote is what lets a screen mark the
   * passage instead of describing it.
   *
   * Absent where the finding genuinely has no one place: paragraph-length
   * uniformity is a property of the whole page, and quoting one paragraph for
   * it would point at an innocent one.
   */
  readonly quote?: string;
}

export interface AITellResult {
  readonly issues: ReadonlyArray<AITellIssue>;
}

type AITellLanguage = "zh" | "en";

const HEDGE_WORDS: Record<AITellLanguage, ReadonlyArray<string>> = {
  zh: ["似乎", "可能", "或许", "大概", "某种程度上", "一定程度上", "在某种意义上"],
  en: ["seems", "seemed", "perhaps", "maybe", "apparently", "in some ways", "to some extent"],
};

const TRANSITION_WORDS: Record<AITellLanguage, ReadonlyArray<string>> = {
  zh: ["然而", "不过", "与此同时", "另一方面", "尽管如此", "话虽如此", "但值得注意的是"],
  en: ["however", "meanwhile", "on the other hand", "nevertheless", "even so", "still"],
};

/**
 * Analyze text content for structural AI-tell patterns.
 * Returns issues that can be merged into audit results.
 */
/**
 * The first sentence containing `needle`, so a density finding can point at an
 * instance of the thing it is counting.
 *
 * Returns undefined rather than a guess when the needle spans a sentence break
 * or is not found: a mark placed over the wrong words is worse than no mark.
 */
function sentenceContaining(
  content: string,
  needle: string,
  isEnglish: boolean,
): string | undefined {
  const at = content.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return undefined;
  const enders = isEnglish ? ".!?\n" : "。！？\n";
  let start = at;
  while (start > 0 && !enders.includes(content[start - 1]!)) start--;
  let end = at + needle.length;
  while (end < content.length && !enders.includes(content[end]!)) end++;
  const sentence = content.slice(start, end).trim();
  return sentence.length > 2 ? sentence : undefined;
}

export function analyzeAITells(content: string, language: AITellLanguage = "zh"): AITellResult {
  const issues: AITellIssue[] = [];
  const isEnglish = language === "en";
  const joiner = isEnglish ? ", " : "、";

  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // dim 20: Paragraph length uniformity (needs ≥3 paragraphs)
  if (paragraphs.length >= 3) {
    const paragraphLengths = paragraphs.map((p) => p.length);
    const mean = paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length;
    if (mean > 0) {
      const variance = paragraphLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / paragraphLengths.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / mean;
      if (cv < 0.15) {
        issues.push({
          severity: "warning",
          category: isEnglish ? "Paragraph uniformity" : "段落等长",
          description: isEnglish
            ? `Paragraph-length coefficient of variation is only ${cv.toFixed(3)} (threshold <0.15), which suggests unnaturally uniform paragraph sizing`
            : `段落长度变异系数仅${cv.toFixed(3)}（阈值<0.15），段落长度过于均匀，呈现AI生成特征`,
          suggestion: isEnglish
            ? "Increase paragraph-length contrast: use shorter beats for impact and longer blocks for immersive detail"
            : "增加段落长度差异：短段落用于节奏加速或冲击，长段落用于沉浸描写",
        });
      }
    }
  }

  // dim 21: Hedge word density
  const totalChars = content.length;
  if (totalChars > 0) {
    let hedgeCount = 0;
    /* The first hedge that actually occurs, kept so the finding can point at
       a real one rather than at a rate. */
    let firstHedge: string | undefined;
    for (const word of HEDGE_WORDS[language]) {
      const regex = new RegExp(word, isEnglish ? "gi" : "g");
      const matches = content.match(regex);
      hedgeCount += matches?.length ?? 0;
      if (!firstHedge && matches?.length) firstHedge = matches[0];
    }
    const hedgeDensity = hedgeCount / (totalChars / 1000);
    if (hedgeDensity > 3) {
      issues.push({
        quote: firstHedge ? sentenceContaining(content, firstHedge, isEnglish) : undefined,
        severity: "warning",
        category: isEnglish ? "Hedge density" : "套话密度",
        description: isEnglish
          ? `Hedge-word density is ${hedgeDensity.toFixed(1)} per 1k characters (threshold >3), making the prose sound overly tentative`
          : `套话词（似乎/可能/或许等）密度为${hedgeDensity.toFixed(1)}次/千字（阈值>3），语气过于模糊犹豫`,
        suggestion: isEnglish
          ? "Replace hedges with firmer narration: remove vague qualifiers and use concrete detail instead"
          : "用确定性叙述替代模糊表达：去掉「似乎」直接描述状态，用具体细节替代「可能」",
      });
    }
  }

  // dim 22: Formulaic transition repetition
  const transitionCounts: Record<string, number> = {};
  for (const word of TRANSITION_WORDS[language]) {
    const regex = new RegExp(word, isEnglish ? "gi" : "g");
    const matches = content.match(regex);
    const count = matches?.length ?? 0;
    if (count > 0) {
      transitionCounts[isEnglish ? word.toLowerCase() : word] = count;
    }
  }
  const repeatedTransitions = Object.entries(transitionCounts)
    .filter(([, count]) => count >= 3);
  if (repeatedTransitions.length > 0) {
    const detail = repeatedTransitions
      .map(([word, count]) => `"${word}"×${count}`)
      .join(joiner);
    /* The worst offender, shown where it happens. Sorting matters: quoting
       whichever transition the word list happened to reach first would point
       at the least repeated one as often as the most. */
    const worst = [...repeatedTransitions].sort((a, b) => b[1] - a[1])[0]![0];
    issues.push({
      quote: sentenceContaining(content, worst, isEnglish),
      severity: "warning",
      category: isEnglish ? "Formulaic transitions" : "公式化转折",
      description: isEnglish
        ? `Transition words repeat too often: ${detail}. Reusing the same transition pattern 3+ times creates a formulaic AI texture`
        : `转折词重复使用：${detail}。同一转折模式≥3次暴露AI生成痕迹`,
      suggestion: isEnglish
        ? "Let scenes pivot through action, timing, or viewpoint shifts instead of repeating the same transitions"
        : "用情节自然转折替代转折词，或换用不同的过渡手法（动作切入、时间跳跃、视角切换）",
    });
  }

  // dim 23: List-like structure (consecutive sentences with same prefix pattern)
  const sentences = content
    .split(isEnglish ? /[.!?\n]/ : /[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  if (sentences.length >= 3) {
    let consecutiveSamePrefix = 1;
    let maxConsecutive = 1;
    /* Which sentences the longest run is, not merely how many there were.
       The count alone was all this ever kept, which is why the finding could
       only describe the problem and never show it. */
    let bestFirst = 0;
    let bestLast = 0;
    for (let i = 1; i < sentences.length; i++) {
      const prevPrefix = isEnglish
        ? sentences[i - 1]!.split(/\s+/)[0]?.toLowerCase() ?? ""
        : sentences[i - 1]!.slice(0, 2);
      const currPrefix = isEnglish
        ? sentences[i]!.split(/\s+/)[0]?.toLowerCase() ?? ""
        : sentences[i]!.slice(0, 2);
      if (prevPrefix === currPrefix) {
        consecutiveSamePrefix++;
        if (consecutiveSamePrefix > maxConsecutive) {
          maxConsecutive = consecutiveSamePrefix;
          bestFirst = i - consecutiveSamePrefix + 1;
          bestLast = i;
        }
      } else {
        consecutiveSamePrefix = 1;
      }
    }
    if (maxConsecutive >= 3) {
      /* The run as it reads on the page, punctuation and all, taken from the
         source rather than rebuilt by joining the split pieces back up. */
      const from = content.indexOf(sentences[bestFirst]!);
      const lastAt = from < 0 ? -1 : content.indexOf(sentences[bestLast]!, from);
      const run = from >= 0 && lastAt >= 0
        ? content.slice(from, lastAt + sentences[bestLast]!.length)
        : undefined;
      issues.push({
        quote: run,
        severity: "info",
        category: isEnglish ? "List-like structure" : "列表式结构",
        description: isEnglish
          ? `Detected ${maxConsecutive} consecutive sentences with the same opening pattern, creating a list-like generated cadence`
          : `检测到${maxConsecutive}句连续以相同开头的句子，呈现列表式AI生成结构`,
        suggestion: isEnglish
          ? "Vary how sentences open: change subject, timing, or action entry to break the list effect"
          : "变换句式开头：用不同主语、时间词、动作词开头，打破列表感",
      });
    }
  }

  return { issues };
}
