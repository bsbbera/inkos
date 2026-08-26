import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRuleStack, ruleFilesFor } from "../utils/rule-stack.js";

describe("buildRuleStack", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rule-stack-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // The whole point of the layer split: a de-AI rule is about prose, so it
  // reaches a magazine page as surely as it reaches a novel chapter.
  it("gives every kind the universal prose layer", async () => {
    for (const kind of ["book", "short", "script", "storyboard", "publication"] as const) {
      const stack = await buildRuleStack({ kind, language: "en" });
      expect(stack, kind).toContain("Anti-AI Pattern Guide");
      expect(stack, kind).toContain("Factual Consistency");
      expect(stack, kind).toContain("Language Constraints");
    }
  });

  // And the other half of it: six-step character psychology has nothing to say
  // about a two-page explainer, so a publication must not be handed it.
  it("gives the story layer to stories and withholds it from publications", async () => {
    const short = await buildRuleStack({ kind: "short", language: "en" });
    expect(short).toContain("Six-Step Character Psychology");

    const magazine = await buildRuleStack({ kind: "publication", language: "en" });
    expect(magazine).not.toContain("Six-Step Character Psychology");
    expect(magazine).not.toContain("Immersion Pillars");
  });

  it("reads a series' own rules the way a book reads its bible", async () => {
    await writeFile(join(dir, "series_rules.md"), "No page may cite a number without a source.");
    await writeFile(join(dir, "house_style.md"), "Sentences under 22 words.");
    const stack = await buildRuleStack({ kind: "publication", language: "en", rulesDir: dir });
    expect(stack).toContain("No page may cite a number without a source.");
    expect(stack).toContain("Sentences under 22 words.");
  });

  // Standing law first, near-term steering last, so a focus note can override.
  it("puts current_focus last", async () => {
    await writeFile(join(dir, "series_rules.md"), "STANDING");
    await writeFile(join(dir, "current_focus.md"), "STEERING");
    const stack = await buildRuleStack({ kind: "publication", language: "en", rulesDir: dir });
    expect(stack.indexOf("STANDING")).toBeLessThan(stack.indexOf("STEERING"));
  });

  it("omits layers it has nothing for, rather than leaving empty headings", async () => {
    const stack = await buildRuleStack({ kind: "publication", language: "en", rulesDir: dir });
    expect(stack).not.toContain("series_rules.md");
    expect(stack).not.toContain("current_focus.md");
  });

  it("names the files each kind carries", () => {
    expect(ruleFilesFor("book")).toContain("story_bible.md");
    expect(ruleFilesFor("publication")).toContain("house_style.md");
    expect(ruleFilesFor("publication")).not.toContain("story_bible.md");
  });

  it("speaks the language it was asked for", async () => {
    const zh = await buildRuleStack({ kind: "short", language: "zh" });
    expect(zh).toContain("去AI味");
    expect(zh).toContain("事实一致性");
  });
});
