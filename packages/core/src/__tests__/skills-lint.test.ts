/*
 * The builtin skill catalogue, checked the way the model sees it.
 *
 * A skill's `description:` is the one line that reaches the model when it is
 * deciding whether to load the skill at all. That line spent a long release
 * cycle holding Chinese text written for a different product, and nothing in
 * the build noticed, because a skill with a wrong description still parses,
 * still loads, and still renders — it just never gets chosen for the right
 * job. So the checks here are the ones a type-check cannot make: that the
 * frontmatter parses, that the name matches the folder the loader derives ids
 * from, and that the description is in the language of the catalogue it sits
 * in.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAgentSkillDocument } from "../skills/external-loader.js";

const SKILLS_ROOT = fileURLToPath(new URL("../../skills", import.meta.url));

/** Any CJK ideograph. Skill bodies may quote them; the catalogue line may not. */
const HAN = /[㐀-䶿一-鿿豈-﫿]/;

async function skillDirs(): Promise<string[]> {
  const entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

describe("the builtin skill catalogue", () => {
  it("has skills in it at all", async () => {
    // A loader pointed at the wrong folder returns an empty list rather than
    // an error, and every check below would then pass on nothing.
    expect((await skillDirs()).length).toBeGreaterThanOrEqual(15);
  });

  it("gives every skill parseable frontmatter, a matching name and a version", async () => {
    const problems: string[] = [];
    for (const dir of await skillDirs()) {
      const path = join(SKILLS_ROOT, dir, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        problems.push(`${dir}: no SKILL.md`);
        continue;
      }
      try {
        const skill = parseAgentSkillDocument(raw, { skillPath: path, source: "builtin" });
        if (skill.name !== dir) problems.push(`${dir}: name is "${skill.name}"`);
        if (!skill.body.trim()) problems.push(`${dir}: empty body`);
        if (!/^version:/m.test(raw.replace(/\r\n?/g, "\n").split("\n---")[0] ?? "")) {
          problems.push(`${dir}: no version in frontmatter`);
        }
      } catch (error) {
        problems.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("writes the catalogue line in English", async () => {
    const problems: string[] = [];
    for (const dir of await skillDirs()) {
      const path = join(SKILLS_ROOT, dir, "SKILL.md");
      const raw = await readFile(path, "utf8");
      const skill = parseAgentSkillDocument(raw, { skillPath: path, source: "builtin" });
      if (HAN.test(skill.description)) problems.push(`${dir}: description is not English`);
      // Long enough to say what the skill is for, short enough that the whole
      // catalogue still fits in a prompt beside everything else.
      if (skill.description.length < 40) problems.push(`${dir}: description is too thin`);
    }
    expect(problems).toEqual([]);
  });
});
