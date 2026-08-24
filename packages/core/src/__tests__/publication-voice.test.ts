import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveVoice } from "../pipeline/publication-voice.js";

function projectWithSkill(id: string, body: string): string {
  const root = mkdtempSync(join(tmpdir(), "pub-voice-"));
  const dir = join(root, "skills", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"),
    `---\nname: ${id}\ndescription: a test skill\n---\n\n${body}\n`);
  return root;
}

describe("resolveVoice", () => {
  it("uses the definition's own voice when no skill is named", async () => {
    const result = await resolveVoice({ projectRoot: tmpdir(), fallback: "own voice" });
    expect(result.voice).toBe("own voice");
    expect(result.diagnostic).toBeUndefined();
  });

  // The whole reason this degrades instead of throwing: an uninstalled skill
  // should cost a warning, not a failed run.
  it("degrades with a diagnostic when the skill is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "pub-voice-"));
    try {
      const result = await resolveVoice({
        projectRoot: root, fallback: "own voice", skillId: "not-installed",
      });
      expect(result.voice).toBe("own voice");
      expect(result.diagnostic).toMatch(/not installed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps the definition's voice alongside the skill's craft", async () => {
    const root = projectWithSkill("mag-content",
      "# Setup\nrun the thing\n\n## Voice\nOpen on a person, never the subject's name.");
    try {
      const result = await resolveVoice({
        projectRoot: root, fallback: "own voice", skillId: "mag-content",
      });
      expect(result.voice).toContain("Open on a person");
      expect(result.voice).toContain("own voice");
      // Setup instructions are for a human and cost context for nothing.
      expect(result.voice).not.toContain("run the thing");
      expect(result.diagnostic).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
