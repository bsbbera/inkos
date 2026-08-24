import { BaseAgent } from "./base.js";
import { parseJson } from "../publications/parse-json.js";

/**
 * The model half of a publication run.
 *
 * Every stage asks for JSON and gets prose-wrapped JSON back, so the extractor
 * is applied here rather than in each stage. Temperature sits high enough for
 * the writing to have a voice and low enough that the JSON envelope survives.
 */
export class PublicationAgent extends BaseAgent {
  get name(): string {
    return "publication-writer";
  }

  async askJson(prompt: string, tag: string): Promise<Record<string, unknown>> {
    const response = await this.chat(
      [{ role: "user", content: prompt }],
      // A 60-page flatplan is a genuinely large reply; a low ceiling here
      // truncates the JSON and the stage fails on parse rather than on limit.
      { temperature: tag === "research" || tag === "plan" ? 0.4 : 0.7, maxTokens: 32_000 },
    );
    try {
      return parseJson(response.content);
    } catch (error) {
      // Name the stage: "invalid JSON" alone gives no clue which of forty
      // page calls produced it.
      const why = error instanceof Error ? error.message : String(error);
      throw new Error(`${tag}: ${why}`);
    }
  }
}
