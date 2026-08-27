import type { ActivatedSkillGuidance } from "../agent/skill-tool.js";
import type { AgentSkill } from "./types.js";

export const PRODUCTION_SKILL_IDS = {
  longWriting: ["quire-long-writing"],
  longReview: ["quire-long-writing", "quire-story-review"],
  shortWriting: ["quire-short-writing"],
  play: ["quire-play-world"],
  script: ["quire-script-writing"],
  storyboard: ["quire-storyboard"],
  interactiveFilm: ["quire-interactive-film"],
  translation: ["quire-translation"],
} as const;

export type ProductionSkillCapability = keyof typeof PRODUCTION_SKILL_IDS;

export const NON_LONG_PRODUCTION_CAPABILITIES = [
  "shortWriting",
  "play",
  "script",
  "storyboard",
  "interactiveFilm",
  "translation",
] as const satisfies ReadonlyArray<ProductionSkillCapability>;

export function resolveProductionSkillActivations(
  availableSkills: ReadonlyArray<AgentSkill>,
  capability: ProductionSkillCapability,
): ActivatedSkillGuidance[] {
  const byId = new Map(availableSkills.map((skill) => [skill.id, skill]));
  return PRODUCTION_SKILL_IDS[capability].flatMap((id) => {
    const skill = byId.get(id);
    return skill ? [{ skill, resources: [] }] : [];
  });
}

export function mergeActivatedSkillGuidance(
  ...groups: ReadonlyArray<ReadonlyArray<ActivatedSkillGuidance>>
): ActivatedSkillGuidance[] {
  const merged = new Map<string, ActivatedSkillGuidance>();
  for (const group of groups) {
    for (const activation of group) merged.set(activation.skill.id, activation);
  }
  return [...merged.values()];
}

export function activatedSkillIds(
  activations: ReadonlyArray<ActivatedSkillGuidance>,
): string[] {
  return activations.map((activation) => activation.skill.id);
}
