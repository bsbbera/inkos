/**
 * A studied voice, written to disk, for any kind of work.
 *
 * This lived inside `PipelineRunner.generateStyleGuide` and could therefore
 * only ever be given to a book: it loaded a book config to find the language
 * and wrote into `books/<id>/story/`. A short story, a script or a storyboard
 * had no way to be told to sound like anybody, which made "write in the voice
 * of X" a feature of one production type out of nine for no reason anyone
 * chose.
 *
 * So the part that needs a book stays in the runner, and everything here —
 * fingerprint, qualitative extraction, and the fallback for when there is not
 * enough text to extract from — takes a directory and a language and nothing
 * else.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeStyle } from "../agents/style-analyzer.js";
import type { StyleProfile } from "../models/style-profile.js";
import { buildWritingMethodologySection } from "../utils/writing-methodology.js";

/**
 * Below this many characters the model is not asked.
 *
 * Qualitative extraction from three sentences invents a voice rather than
 * observing one, and an invented voice is worse than none: it reads as
 * authoritative and then steers every chapter after it. The statistical
 * fingerprint at least does not pretend.
 */
export const MIN_SAMPLE_FOR_LLM = 500;

/** Ask the model. The caller owns the routing; this file owns the prompt. */
export type StyleChat = (system: string, user: string) => Promise<string>;

export interface WriteStyleGuideResult {
  readonly guide: string;
  readonly profile: StyleProfile;
  /** True when the guide is the fingerprint alone. `note` says why. */
  readonly deterministic: boolean;
  readonly note?: string;
}

/**
 * Write `style_profile.json` and `style_guide.md` into `dir`.
 *
 * Both are replaced, not merged. A second import is a correction of the first,
 * not an addition to it: two voices in one guide is not a voice.
 */
export async function writeStyleGuide(input: {
  readonly dir: string;
  readonly referenceText: string;
  readonly language: "zh" | "en";
  readonly sourceName?: string;
  readonly chat?: StyleChat;
}): Promise<WriteStyleGuideResult> {
  const sample = input.referenceText.trim();
  if (!sample) throw new Error("Reference text is required for style extraction.");

  await mkdir(input.dir, { recursive: true });
  const profile = analyzeStyle(sample, input.sourceName, input.language);
  await writeFile(
    join(input.dir, "style_profile.json"),
    JSON.stringify(profile, null, 2),
    "utf-8",
  );

  let qualitative: string;
  let deterministic = false;
  let note: string | undefined;

  if (sample.length < MIN_SAMPLE_FOR_LLM || !input.chat) {
    note = thinSampleNote(input.language, sample.length, Boolean(input.chat));
    qualitative = deterministicGuide(profile, { language: input.language, reason: note });
    deterministic = true;
  } else {
    try {
      const reply = (await input.chat(
        styleSystemPrompt(input.language),
        input.language === "en"
          ? `Analyze the writing style of the following reference text:\n\n${sample}`
          : `分析以下参考文本的写作风格：\n\n${sample}`,
      )).trim();
      if (reply) {
        qualitative = reply;
      } else {
        note = input.language === "en"
          ? "The model returned no style analysis, so this guide is the statistical fingerprint."
          : "模型未返回有效文风分析，本次使用统计指纹兜底生成文风指南。";
        qualitative = deterministicGuide(profile, { language: input.language, reason: note });
        deterministic = true;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      note = input.language === "en"
        ? `Style extraction failed: ${detail}. This guide is the statistical fingerprint.`
        : `LLM 定性拆解失败：${detail}。本次使用统计指纹兜底生成文风指南。`;
      qualitative = deterministicGuide(profile, { language: input.language, reason: note });
      deterministic = true;
    }
  }

  // The craft rules ride along with every guide. They are not the voice, they
  // are the floor underneath it, and a guide that replaced them would quietly
  // switch off the de-AI pass by being imported.
  const guide = `${qualitative}\n\n${buildWritingMethodologySection(input.language)}`;
  await writeFile(join(input.dir, "style_guide.md"), guide, "utf-8");

  return { guide, profile, deterministic, ...(note ? { note } : {}) };
}

function thinSampleNote(language: "zh" | "en", length: number, hasChat: boolean): string {
  if (!hasChat) {
    return language === "en"
      ? "No model was available, so this guide is the statistical fingerprint."
      : "本次没有可用模型，仅使用统计指纹生成文风指南。";
  }
  return language === "en"
    ? `The sample is short (${length} characters), so this guide uses the statistical fingerprint rather than model extraction. Import a longer excerpt to replace it.`
    : `样本文本较短（${length}字），本次先使用统计指纹生成文风指南，不强行调用 LLM 做定性拆解。`;
}

export function styleSystemPrompt(language: "zh" | "en"): string {
  return language === "en" ? EN_STYLE_PROMPT : ZH_STYLE_PROMPT;
}

const EN_STYLE_PROMPT = `You are a literary style analyst. Analyze the writing style of the reference text and extract qualitative, imitable features.

Output format (Markdown):
## Narrative Voice & Tone
(detached / fervent / ironic / warm / ..., with 1-2 quoted lines from the text)

## Dialogue Style
(shared traits in how characters speak: sentence length, verbal tics, dialect markers, dialogue rhythm)

## Scene Description
(sensory preferences, choice of imagery, description density, how setting ties to emotion)

## Transitions & Connective Technique
(how scenes switch, how time jumps are handled, paragraph-to-paragraph transitions)

## Pacing
(distribution of long vs short sentences, paragraph-length preference, how climaxes and lulls alternate)

## Diction
(signature high-frequency word choices, figurative/rhetorical tendencies, degree of colloquialism)

## Emotional Expression
(direct lyricism vs externalized action, frequency and style of interior monologue)

## Distinctive Habits
(any personal writing habits worth imitating)

Base the analysis on the text's actual features, not generalities. Support each section with 1-2 quoted lines from the original.`;

const ZH_STYLE_PROMPT = `你是一位文学风格分析专家。分析参考文本的写作风格，提取可供模仿的定性特征。

输出格式（Markdown）：
## 叙事声音与语气
（冷峻/热烈/讽刺/温情/...，附1-2个原文例句）

## 对话风格
（角色说话的共性特征：句子长短、口头禅倾向、方言痕迹、对话节奏）

## 场景描写特征
（五感偏好、意象选择、描写密度、环境与情绪的关联方式）

## 转折与衔接手法
（场景如何切换、时间跳跃的处理方式、段落间的过渡特征）

## 节奏特征
（长短句分布、段落长度偏好、高潮/舒缓的交替方式）

## 词汇偏好
（高频特色用词、比喻/修辞倾向、口语化程度）

## 情绪表达方式
（直白抒情 vs 动作外化、内心独白的频率和风格）

## 独特习惯
（任何值得模仿的个人写作习惯）

分析必须基于原文实际特征，不要泛泛而谈。每个部分用1-2个原文例句佐证。`;

/** The guide when there is nothing to extract from, or nothing to extract with. */
export function deterministicGuide(
  profile: {
    readonly avgSentenceLength: number;
    readonly sentenceLengthStdDev: number;
    readonly avgParagraphLength: number;
    readonly vocabularyDiversity: number;
    readonly topPatterns: ReadonlyArray<string>;
    readonly rhetoricalFeatures: ReadonlyArray<string>;
    readonly sourceName?: string;
  },
  options: { readonly language: "zh" | "en"; readonly reason: string },
): string {
  if (options.language === "en") {
    return [
      "# Style Guide",
      "",
      `> ${options.reason}`,
      "",
      "## Statistical Fingerprint",
      `- Source: ${profile.sourceName ?? "unknown"}`,
      `- Average sentence length: ${profile.avgSentenceLength}`,
      `- Sentence length variance: ${profile.sentenceLengthStdDev}`,
      `- Average paragraph length: ${profile.avgParagraphLength}`,
      `- Vocabulary diversity: ${Math.round(profile.vocabularyDiversity * 100)}%`,
      profile.topPatterns.length > 0 ? `- Repeated openings: ${profile.topPatterns.join(", ")}` : "- Repeated openings: none obvious in this sample",
      profile.rhetoricalFeatures.length > 0 ? `- Rhetorical features: ${profile.rhetoricalFeatures.join(", ")}` : "- Rhetorical features: none obvious in this sample",
      "",
      "## How To Use",
      "- Treat this as a lightweight style fingerprint, not a full imitation bible.",
      "- Keep sentence and paragraph rhythm close to the sample when drafting.",
      "- If this guide feels too thin, import a longer excerpt later; the file will be replaced.",
    ].join("\n");
  }

  return [
    "# 文风指南",
    "",
    `> ${options.reason}`,
    "",
    "## 统计风格指纹",
    `- 来源：${profile.sourceName ?? "unknown"}`,
    `- 平均句长：${profile.avgSentenceLength}`,
    `- 句长波动：${profile.sentenceLengthStdDev}`,
    `- 平均段落长度：${profile.avgParagraphLength}`,
    `- 词汇多样性：${Math.round(profile.vocabularyDiversity * 100)}%`,
    profile.topPatterns.length > 0 ? `- 高频句首/模式：${profile.topPatterns.join("、")}` : "- 高频句首/模式：样本内不明显",
    profile.rhetoricalFeatures.length > 0 ? `- 修辞特征：${profile.rhetoricalFeatures.join("、")}` : "- 修辞特征：样本内不明显",
    "",
    "## 使用方式",
    "- 这是一份轻量文风指纹，不是完整仿写圣经。",
    "- 后续写作优先参考句长、段落长度、节奏波动和可见修辞。",
    "- 如果想得到更稳定的定性拆解，后续可以导入更长片段覆盖本文件。",
  ].join("\n");
}
