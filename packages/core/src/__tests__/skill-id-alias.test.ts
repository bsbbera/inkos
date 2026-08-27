import { describe, expect, it } from "vitest";
import { createSkillRegistry } from "../skills/registry.js";
import type { AgentSkill } from "../skills/types.js";

const skill = (id: string): AgentSkill => ({
  id,
  name: id,
  description: `${id} description`,
  body: "body",
  source: "builtin",
} as AgentSkill);

describe("skill id alias", () => {
  const registry = createSkillRegistry({ skills: [skill("quire-long-writing"), skill("mag-content")] });

  it("finds a renamed skill by its new id", () => {
    expect(registry.getSkill("quire-long-writing")?.id).toBe("quire-long-writing");
  });

  // Everything anyone already wrote down uses the old prefix: activated skills
  // on a saved session, a voiceSkill in a user's own publication definition, a
  // requestedSkills list in a config. Renaming without this disables them
  // silently rather than erroring.
  it("still finds it by the id it used to have", () => {
    expect(registry.getSkill("inkos-long-writing")?.id).toBe("quire-long-writing");
  });

  it("resolves an old id in a requested list", () => {
    const resolved = registry.resolveSkills({ requestedSkills: ["inkos-long-writing"] });
    expect(resolved.usedSkills.map((s) => s.id)).toEqual(["quire-long-writing"]);
    expect(resolved.missingSkillIds).toEqual([]);
  });

  it("honours an old id in a disabled list", () => {
    const resolved = registry.resolveSkills({
      requestedSkills: ["quire-long-writing"],
      disabledSkills: ["inkos-long-writing"],
    });
    expect(resolved.usedSkills).toEqual([]);
  });

  it("leaves a skill that was never ours alone", () => {
    expect(registry.getSkill("mag-content")?.id).toBe("mag-content");
  });

  // "inkoscape-something" must not become "quire-cape-something".
  it("only rewrites the prefix, not the substring", () => {
    const other = createSkillRegistry({ skills: [skill("my-inkos-notes")] });
    expect(other.getSkill("my-inkos-notes")?.id).toBe("my-inkos-notes");
  });

  it("still reports a genuinely missing skill as missing", () => {
    expect(registry.resolveSkills({ requestedSkills: ["inkos-nonexistent"] }).missingSkillIds)
      .toEqual(["quire-nonexistent"]);
  });
});
