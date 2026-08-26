/**
 * A publication's voice skill is not a second way to make that publication.
 *
 * `magazine.json` names `mag-content` as its voice, and the pipeline reads it
 * that way. But the same skill is also installed as an ordinary skill, with a
 * description that reads like an instruction manual for producing a magazine
 * end to end. Asked for a magazine, a model took that door: it followed the
 * skill, wrote loose markdown, and never called `publication_create`. No issue
 * was created, so nothing appeared in the sidebar and the audit screen — which
 * exists, and works — had nothing to open.
 *
 * Two doors, one of which silently skips the pipeline. This closes the wrong
 * one by rewriting what the model is told the skill is for. The body is left
 * alone: the voice resolver reads the file, not this description, so the
 * craft the skill carries still reaches the page writer.
 */
import { loadPublicationRegistry } from "./registry.js";
import type { AgentSkill } from "../skills/types.js";

/** Skill id -> the publication type that claims it as its voice. */
export async function voiceClaims(projectRoot: string): Promise<Map<string, string>> {
  const claims = new Map<string, string>();
  const registry = await loadPublicationRegistry(projectRoot);
  for (const source of registry.definitions) {
    const skill = source.definition.prompts?.voiceSkill;
    if (skill) claims.set(skill, source.definition.id);
  }
  return claims;
}

export function redirectDescription(skill: AgentSkill, publicationType: string): AgentSkill {
  return {
    ...skill,
    description:
      `Voice and craft reference for the "${publicationType}" publication type — how one should `
      + `read and sound, not a procedure to follow. Do NOT follow it directly to produce one: call `
      + `publication_create with type="${publicationType}", which runs research, flatplan, page `
      + `writing and audit, and registers the issue so it can be opened, edited and re-audited. `
      + `The publication pipeline loads this skill on its own.`,
  };
}

/**
 * Rewrite the descriptions of skills claimed as a publication's voice.
 *
 * Never throws: a broken or missing registry leaves the skills exactly as they
 * were, which is the behaviour that was there before this existed.
 */
export async function applyVoiceClaims(
  projectRoot: string,
  skills: ReadonlyArray<AgentSkill>,
): Promise<ReadonlyArray<AgentSkill>> {
  let claims: Map<string, string>;
  try {
    claims = await voiceClaims(projectRoot);
  } catch {
    return skills;
  }
  if (claims.size === 0) return skills;
  return skills.map((skill) => {
    const type = claims.get(skill.id);
    return type ? redirectDescription(skill, type) : skill;
  });
}
