/**
 * Detection pipeline runner — handles detection, auto-rewrite loop, and history tracking.
 * Extracted from runner.ts to keep runner under 800 lines.
 */

import type { DetectionConfig } from "../models/project.js";
import type { DetectionHistoryEntry } from "../models/detection.js";
import type { AgentContext } from "../agents/base.js";
import { detectAIContent, type DetectionResult } from "../agents/detector.js";
import { slopScore } from "../agents/slop-score.js";
import { ReviserAgent } from "../agents/reviser.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { auditPackIn } from "./audit-pack.js";
import { languageOf } from "./story-audit.js";

/**
 * Score the text, by the external service when one is configured and by the
 * local count of machine-made habits when it is not (19 §5.5).
 *
 * Without this, no key meant no score and the whole destyle stage did nothing
 * for most people. The local score is on the same scale, so `threshold`,
 * `maxRetries` and the rewrite loop below are unchanged by which one answered.
 */
async function scoreText(
  config: DetectionConfig,
  content: string,
  bookDir?: string,
): Promise<DetectionResult> {
  try {
    return await detectAIContent(config, content);
  } catch (error) {
    // A missing key is the expected case, not a failure. A service that is
    // configured and genuinely broken falls back too rather than stopping a
    // run: a local score is worth more here than an exception.
    const pack = bookDir ? await auditPackIn(bookDir, "book").catch(() => undefined) : undefined;
    const local = slopScore(content, languageOf(content), pack);
    return {
      score: local.score,
      provider: local.provider,
      detectedAt: new Date().toISOString(),
      raw: { reasons: local.reasons, why: error instanceof Error ? error.message : String(error) },
    };
  }
}

export interface DetectChapterResult {
  readonly chapterNumber: number;
  readonly detection: DetectionResult;
  readonly passed: boolean;
}

export interface DetectAndRewriteResult {
  readonly chapterNumber: number;
  readonly originalScore: number;
  readonly finalScore: number;
  readonly attempts: number;
  readonly passed: boolean;
  readonly finalContent: string;
}

/** Run detection on a single chapter's content. */
export async function detectChapter(
  config: DetectionConfig,
  content: string,
  chapterNumber: number,
): Promise<DetectChapterResult> {
  const detection = await scoreText(config, content);
  return {
    chapterNumber,
    detection,
    passed: detection.score <= config.threshold,
  };
}

/**
 * Detect-and-rewrite loop: detect → revise in anti-detect mode → re-detect,
 * until score passes threshold or max retries reached.
 */
export async function detectAndRewrite(
  config: DetectionConfig,
  ctx: AgentContext,
  bookDir: string,
  content: string,
  chapterNumber: number,
  genre?: string,
): Promise<DetectAndRewriteResult> {
  const maxRetries = config.maxRetries;

  let currentContent = content;
  const firstDetection = await scoreText(config, currentContent, bookDir);
  const originalScore = firstDetection.score;

  if (firstDetection.score <= config.threshold) {
    await recordHistory(bookDir, {
      chapterNumber,
      timestamp: firstDetection.detectedAt,
      provider: firstDetection.provider,
      score: firstDetection.score,
      action: "detect",
      attempt: 0,
    });
    return {
      chapterNumber,
      originalScore,
      finalScore: firstDetection.score,
      attempts: 0,
      passed: true,
      finalContent: currentContent,
    };
  }

  let finalScore = firstDetection.score;
  let attempts = 0;

  for (let i = 0; i < maxRetries; i++) {
    attempts = i + 1;

    // Rewrite in anti-detect mode
    const reviser = new ReviserAgent(ctx);
    const reviseOutput = await reviser.reviseChapter(
      bookDir,
      currentContent,
      chapterNumber,
      [{
        severity: "warning",
        category: "AIGC检测",
        description: `AI检测分数 ${finalScore.toFixed(2)} 超过阈值 ${config.threshold}`,
        suggestion: "降低AI生成痕迹：增加段落长度差异、减少套话、用口语化表达替代书面语",
      }],
      "anti-detect",
      genre,
    );

    if (reviseOutput.revisedContent.length === 0) break;
    currentContent = reviseOutput.revisedContent;

    // Re-detect
    const reDetection = await scoreText(config, currentContent, bookDir);
    finalScore = reDetection.score;

    await recordHistory(bookDir, {
      chapterNumber,
      timestamp: reDetection.detectedAt,
      provider: reDetection.provider,
      score: reDetection.score,
      action: "rewrite",
      attempt: attempts,
    });

    if (finalScore <= config.threshold) break;
  }

  return {
    chapterNumber,
    originalScore,
    finalScore,
    attempts,
    passed: finalScore <= config.threshold,
    finalContent: currentContent,
  };
}

/** Append an entry to detection_history.json. */
async function recordHistory(
  bookDir: string,
  entry: DetectionHistoryEntry,
): Promise<void> {
  const historyPath = join(bookDir, "story", "detection_history.json");
  let history: DetectionHistoryEntry[] = [];

  try {
    const raw = await readFile(historyPath, "utf-8");
    history = JSON.parse(raw);
  } catch {
    // File doesn't exist yet
  }

  history.push(entry);

  await mkdir(join(bookDir, "story"), { recursive: true });
  await writeFile(historyPath, JSON.stringify(history, null, 2), "utf-8");
}

/** Load detection history from disk. */
export async function loadDetectionHistory(
  bookDir: string,
): Promise<ReadonlyArray<DetectionHistoryEntry>> {
  const historyPath = join(bookDir, "story", "detection_history.json");
  try {
    const raw = await readFile(historyPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
