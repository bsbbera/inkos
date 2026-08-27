import type {
  AgentSkill,
  SkillRegistry,
  SkillResolutionInput,
  SkillResolutionResult,
} from "./types.js";

export interface CreateSkillRegistryOptions {
  readonly skills?: ReadonlyArray<AgentSkill>;
}

export function createSkillRegistry(options: CreateSkillRegistryOptions = {}): SkillRegistry {
  const skills = dedupeSkills(options.skills ?? []);
  const byId = new Map(skills.map((skill) => [skill.id, skill]));

  return {
    listSkills() {
      return skills;
    },
    getSkill(id: string) {
      return byId.get(normalizeSkillId(id));
    },
    resolveSkills(input: SkillResolutionInput) {
      const disabled = new Set(normalizeIdList(input.disabledSkills));
      const requested = normalizeIdList(input.requestedSkills);
      const missingSkillIds: string[] = [];
      const disabledSkillIds = [...disabled].filter((id) => byId.has(id));
      const used = new Map<string, AgentSkill>();
      const forcedSkillIds: string[] = [];

      for (const id of requested) {
        const skill = byId.get(id);
        if (!skill) {
          missingSkillIds.push(id);
          continue;
        }
        if (disabled.has(id)) continue;
        used.set(id, skill);
        forcedSkillIds.push(id);
      }

      const availableSkills = skills.filter((skill) => !disabled.has(skill.id));

      return {
        usedSkills: [...used.values()],
        forcedSkillIds,
        missingSkillIds: dedupeStrings(missingSkillIds),
        disabledSkillIds,
        availableSkills,
        availableSkillIds: availableSkills.map((skill) => skill.id),
      } satisfies SkillResolutionResult;
    },
  };
}

function dedupeSkills(skills: ReadonlyArray<AgentSkill>): AgentSkill[] {
  const byId = new Map<string, AgentSkill>();
  for (const skill of skills) {
    byId.set(normalizeSkillId(skill.id), {
      ...skill,
      id: normalizeSkillId(skill.id),
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeIdList(values: ReadonlyArray<string> | undefined): string[] {
  return dedupeStrings((values ?? []).map(normalizeSkillId).filter(Boolean));
}

function normalizeSkillId(value: string): string {
  const id = value.trim().toLowerCase();
  // The built-in skills are named for this app, which is Quire. They were
  // named inkos-*, and every id anyone has already written down — an activated
  // skill on a session, a voiceSkill in a user's own publication definition, a
  // requestedSkills list in a saved config — uses the old prefix. Every lookup
  // funnels through here, so one line keeps all of them working. Renaming
  // without it would silently disable a user's skills rather than error.
  return id.startsWith("inkos-") ? `quire-${id.slice("inkos-".length)}` : id;
}

function dedupeStrings(values: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
