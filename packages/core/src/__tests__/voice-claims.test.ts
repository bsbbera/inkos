import { describe, expect, it } from "vitest";
import { applyVoiceClaims, redirectDescription } from "../publications/voice-claims.js";
import type { AgentSkill } from "../skills/types.js";

const skill = (id: string, description: string): AgentSkill => ({
  id,
  name: id,
  description,
  body: "## Voice\n\nWrite like a person.",
  source: "user",
});

describe("voice claims", () => {
  // The bug this exists for: the model read mag-content as a procedure and
  // wrote a magazine by hand, so no issue was ever registered.
  it("sends a claimed skill to publication_create", () => {
    const out = redirectDescription(skill("mag-content", "Write a 50-70 page magazine"), "magazine");
    expect(out.description).toContain("publication_create");
    expect(out.description).toContain('type="magazine"');
  });

  it("leaves the body alone — the pipeline still reads it as voice", () => {
    const original = skill("mag-content", "Write a magazine");
    expect(redirectDescription(original, "magazine").body).toBe(original.body);
  });

  it("touches nothing when no definition claims the skill", async () => {
    const skills = [skill("cookbook", "Write a cookbook")];
    // Real registry: the builtin magazine claims mag-content, not cookbook.
    const out = await applyVoiceClaims(process.cwd(), skills);
    expect(out[0]?.description).toBe("Write a cookbook");
  });

  it("rewrites the claimed one and only that one", async () => {
    const skills = [skill("mag-content", "Write a magazine"), skill("cookbook", "Write a cookbook")];
    const out = await applyVoiceClaims(process.cwd(), skills);
    expect(out[0]?.description).toContain("publication_create");
    expect(out[1]?.description).toBe("Write a cookbook");
  });
});
