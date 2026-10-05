import { describe, expect, it } from "vitest";
import {
  designSkillBrief, designSkillFor, EDITORIAL_DESIGN_SKILL, ILLUSTRATION_SKILL,
} from "../skills/design-skills.js";

describe("design and illustration, for every kind of work", () => {
  // They were bound to the magazine alone: the editorial-design skill reached
  // a model only through the magazine page writer, and the illustration skill
  // reached one through nothing at all. The binding is by stage now, so a
  // storybook's art direction is answered under the same rules as an issue's.
  it("answers a design stage under the design skill, whatever is being made", () => {
    expect(designSkillFor("design-system")).toBe(EDITORIAL_DESIGN_SKILL);   // book, short, storybook…
    expect(designSkillFor("design")).toBe(EDITORIAL_DESIGN_SKILL);          // the magazine
    expect(designSkillFor("layout")).toBe(EDITORIAL_DESIGN_SKILL);
  });

  it("answers a picture stage under the illustration skill", () => {
    expect(designSkillFor("art-director")).toBe(ILLUSTRATION_SKILL);
    expect(designSkillFor("art")).toBe(ILLUSTRATION_SKILL);
    expect(designSkillFor("cover")).toBe(ILLUSTRATION_SKILL);
  });

  it("leaves every other stage alone", () => {
    for (const tag of ["story-audit", "plan", "page", "factcheck", "write", "research"]) {
      expect(designSkillFor(tag), tag).toBeNull();
    }
  });

  it("loads the skill's own text, so the rules reach the model", async () => {
    const brief = await designSkillBrief("art-director");
    expect(brief).toContain(ILLUSTRATION_SKILL);
    // A sentence from the skill body itself, not just its name.
    expect(brief.length).toBeGreaterThan(2000);
    expect(await designSkillBrief("write")).toBe("");
  });
});
