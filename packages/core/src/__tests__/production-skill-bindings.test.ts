import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrateActivatedSkillGuidance } from "../agent/skill-tool.js";
import {
  NON_LONG_PRODUCTION_CAPABILITIES,
  PRODUCTION_SKILL_IDS,
  mergeActivatedSkillGuidance,
  resolveProductionSkillActivations,
} from "../skills/production-bindings.js";
import type { AgentSkill } from "../skills/types.js";

function skill(id: string): AgentSkill {
  return {
    id,
    name: id,
    description: `${id} description`,
    body: `${id} method`,
    source: "builtin",
  };
}

describe("production skill bindings", () => {
  it("uses distinct professional skills for each production shape", () => {
    expect(PRODUCTION_SKILL_IDS).toMatchObject({
      longWriting: ["quire-long-writing"],
      shortWriting: ["quire-short-writing"],
      play: ["quire-play-world"],
      script: ["quire-script-writing"],
      storyboard: ["quire-storyboard"],
      interactiveFilm: ["quire-interactive-film"],
      translation: ["quire-translation"],
    });
    for (const capability of NON_LONG_PRODUCTION_CAPABILITIES) {
      expect(PRODUCTION_SKILL_IDS[capability], capability).not.toContain("quire-long-writing");
      expect(PRODUCTION_SKILL_IDS[capability], capability).not.toContain("quire-story-review");
    }
  });

  it("resolves host-selected skills and lets project replacements win", () => {
    const builtin = skill("quire-play-world");
    const replacement = { ...builtin, source: "project" as const, body: "project play method" };
    const resolved = resolveProductionSkillActivations(
      [builtin, replacement, skill("quire-long-writing")],
      "play",
    );

    expect(resolved).toEqual([{ skill: replacement, resources: [] }]);
  });

  it("merges default and user-requested skills without duplicates", () => {
    const defaultActivation = { skill: skill("quire-play-world"), resources: [] };
    const userActivation = { skill: skill("detective-evidence"), resources: [] };
    const replacement = {
      skill: { ...defaultActivation.skill, source: "project" as const, body: "replacement" },
      resources: [],
    };

    expect(mergeActivatedSkillGuidance(
      [defaultActivation],
      [userActivation, replacement],
    )).toEqual([replacement, userActivation]);
  });

  it("retrieves task-relevant references for production workers", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "inkos-skill-bindings-"));
    try {
      await mkdir(join(baseDir, "references"), { recursive: true });
      await writeFile(join(baseDir, "references", "craft.md"), [
        "# Craft",
        "",
        "## Dialogue pressure",
        "Every reply changes leverage and leaves a concrete consequence.",
        "",
        "## Travel description",
        "Use spatial anchors and sensory continuity.",
      ].join("\n"));
      const activation = {
        skill: { ...skill("quire-long-writing"), baseDir },
        resources: [],
      };

      const [resolved] = await hydrateActivatedSkillGuidance(
        [activation],
        "Write a confrontation where every dialogue reply changes leverage.",
      ) ?? [];

      expect(resolved?.resources).toHaveLength(1);
      expect(resolved?.resources[0]?.body).toContain("Every reply changes leverage");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
