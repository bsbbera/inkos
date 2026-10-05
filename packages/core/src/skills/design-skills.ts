/**
 * The two skills every design decision is made under, whatever is being made.
 *
 * Design and illustration are not magazine features. A picture book is
 * illustrated, a novel's cover is composed, a storyboard is drawn, a script's
 * title card is set — the same measurements and the same rules about what to
 * draw apply to all of them. They were reachable from one place only: the
 * magazine page writer carried the editorial-design skill, and
 * `quire-illustration` was bound to nothing at all and so had never once
 * reached a model.
 *
 * So the binding is by *stage*, not by type. Whoever asks the model to decide
 * a design gets the design skill; whoever asks it to decide a picture gets the
 * illustration skill — for every production type, through the two `ask`
 * factories every stage goes through.
 */
import { loadBuiltinAgentSkills } from "./builtin-loader.js";

export const EDITORIAL_DESIGN_SKILL = "quire-editorial-design";
export const ILLUSTRATION_SKILL = "quire-illustration";

/**
 * Which skill a stage is answered under, by the tag the stage already passes.
 *
 * Tags are the stage's own name: `design-system` and `design` decide how a
 * thing looks, `art-director` and `art` decide what is in the picture. Matching
 * on the prefix means a new design stage is covered the day it is written
 * without anyone remembering to add it here.
 */
const BY_TAG: ReadonlyArray<readonly [RegExp, string]> = [
  [/^design/i, EDITORIAL_DESIGN_SKILL],
  [/^art/i, ILLUSTRATION_SKILL],
  [/^cover/i, ILLUSTRATION_SKILL],
  [/^layout|^build/i, EDITORIAL_DESIGN_SKILL],
];

/** Read once per process: these are ~28 KB of text that never change at runtime. */
let bodies: Promise<ReadonlyMap<string, string>> | null = null;

async function skillBodies(): Promise<ReadonlyMap<string, string>> {
  bodies ??= loadBuiltinAgentSkills().then(({ skills }) =>
    new Map(skills.map((skill) => [skill.id, skill.body])));
  return bodies;
}

export function designSkillFor(tag: string): string | null {
  return BY_TAG.find(([when]) => when.test(tag))?.[1] ?? null;
}

/**
 * The skill text a stage should be answered under, or "" when it needs none.
 *
 * Empty rather than throwing: a missing skill file must not stop a run that
 * would otherwise have produced a page. The stage simply runs as it did before
 * the skill existed.
 */
export async function designSkillBrief(tag: string): Promise<string> {
  const id = designSkillFor(tag);
  if (!id) return "";
  const body = (await skillBodies().catch(() => null))?.get(id)?.trim();
  return body ? `You are working under the "${id}" skill. Follow it.\n\n${body}` : "";
}
