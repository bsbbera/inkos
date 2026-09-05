import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_SAMPLE_FOR_LLM, writeStyleGuide } from "../pipeline/style-guide.js";
import { analyzeStyle } from "../agents/style-analyzer.js";
import { ruleFilesFor, buildRuleStack } from "../utils/rule-stack.js";

/** Long enough that the model is asked, short enough to read in a failure. */
const ENGLISH = ("The lamp went out. He stood in the dark and counted to ten, "
  + "which was what his mother had taught him to do when the house made noises. "
  + "Nothing came. He counted again. ").repeat(6);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "style-"));
});

describe("reading a sample", () => {
  it("measures English in words, not characters", () => {
    // The endpoint used to leave the language out, so this ran as Chinese:
    // sentences split on punctuation English does not contain, length counted
    // in characters, and diversity scored over the 26 letters of the alphabet.
    const en = analyzeStyle(ENGLISH, "sample", "en");
    const zh = analyzeStyle(ENGLISH, "sample", "zh");
    expect(en.avgSentenceLength).toBeLessThan(zh.avgSentenceLength);
    expect(en.vocabularyDiversity).toBeGreaterThan(0.1);
    expect(zh.vocabularyDiversity).toBeLessThan(0.1);
  });

  it("counts in the reader's own language, without Chinese suffixes", () => {
    const { topPatterns } = analyzeStyle(ENGLISH, "sample", "en");
    expect(topPatterns.join(" ")).not.toContain("次");
  });
});

describe("writing the guide", () => {
  it("asks the model and keeps the craft rules underneath", async () => {
    const chat = vi.fn().mockResolvedValue("## Narrative Voice & Tone\nDry, and close to the ear.");
    const result = await writeStyleGuide({
      dir: root, referenceText: ENGLISH, language: "en", sourceName: "A sample", chat,
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.deterministic).toBe(false);
    const guide = await readFile(join(root, "style_guide.md"), "utf-8");
    expect(guide).toContain("Dry, and close to the ear.");
    // An imported voice must not switch off the de-AI pass by replacing it.
    expect(guide).toContain("Writing Methodology Reference");

    const profile = JSON.parse(await readFile(join(root, "style_profile.json"), "utf-8"));
    expect(profile.sourceName).toBe("A sample");
  });

  it("does not invent a voice from three sentences", async () => {
    const chat = vi.fn();
    const short = "He waited. Nobody came.";
    expect(short.length).toBeLessThan(MIN_SAMPLE_FOR_LLM);

    const result = await writeStyleGuide({ dir: root, referenceText: short, language: "en", chat });
    expect(chat).not.toHaveBeenCalled();
    expect(result.deterministic).toBe(true);
    expect(result.note).toContain("short");
  });

  it("still writes a guide when the model fails", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("no route to model"));
    const result = await writeStyleGuide({ dir: root, referenceText: ENGLISH, language: "en", chat });

    expect(result.deterministic).toBe(true);
    expect(result.note).toContain("no route to model");
    expect(await readFile(join(root, "style_guide.md"), "utf-8")).toContain("Statistical Fingerprint");
  });

  it("replaces the previous voice rather than stacking a second one", async () => {
    const first = vi.fn().mockResolvedValue("## Voice\nFirst.");
    await writeStyleGuide({ dir: root, referenceText: ENGLISH, language: "en", chat: first });
    const second = vi.fn().mockResolvedValue("## Voice\nSecond.");
    await writeStyleGuide({ dir: root, referenceText: ENGLISH, language: "en", chat: second });

    const guide = await readFile(join(root, "style_guide.md"), "utf-8");
    expect(guide).toContain("Second.");
    expect(guide).not.toContain("First.");
  });

  it("refuses an empty sample", async () => {
    await expect(writeStyleGuide({ dir: root, referenceText: "   ", language: "en" }))
      .rejects.toThrow(/Reference text is required/);
  });
});

describe("who the voice reaches", () => {
  it("is carried by every kind that tells a story", () => {
    for (const kind of ["book", "short", "script", "storyboard"] as const) {
      expect(ruleFilesFor(kind)).toContain("style_guide.md");
    }
  });

  it("is not carried by a magazine", () => {
    // A publication's voice is its series house style. An author's fingerprint
    // has no business on a page of research.
    expect(ruleFilesFor("publication")).not.toContain("style_guide.md");
  });

  it("reaches a short's writer through the rule stack", async () => {
    await writeStyleGuide({
      dir: root,
      referenceText: ENGLISH,
      language: "en",
      chat: async () => "## Narrative Voice & Tone\nDry, and close to the ear.",
    });
    const rules = await buildRuleStack({ kind: "short", language: "en", rulesDir: root });
    expect(rules).toContain("## style_guide.md");
    expect(rules).toContain("Dry, and close to the ear.");
  });
});
