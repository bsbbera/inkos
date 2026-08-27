/**
 * Where a publication's voice comes from.
 *
 * It came from the definition file — OYLA's register written out inline, in
 * JSON, beside the page grammar. That put taste in the one place it cannot be
 * revised: editing how a magazine sounds meant editing the same file that says
 * how many pages it has.
 *
 * A skill is the right home. It is read as **inspiration** — how to represent
 * a subject beautifully, how a spread earns attention — and prefixed to the
 * definition's own voice rather than replacing it, because the writer is still
 * Quire's engine and the definition still owns its own law.
 */
import { createSkillRegistry } from "../skills/registry.js";
import { loadAvailableAgentSkills } from "../skills/builtin-loader.js";

export interface VoiceResult {
  readonly voice: string;
  /** Non-fatal: a missing skill is reported, never thrown. */
  readonly diagnostic?: string;
}

/**
 * Sections that are instructions to the harness rather than to a writer.
 *
 * A denylist, where this used to be an allowlist of headings matching
 * voice/tone/style/craft/register. That kept the register and threw away
 * everything else the skill knew — mag-content's page archetypes, its
 * user-research cross-check, its rule about explaining a thing the way you
 * would to a five-year-old. Those are the parts worth having, and they were
 * dropped silently at load time because their headings did not match a word
 * list. Renaming a heading in the skill degraded every magazine after it, with
 * no error anywhere.
 *
 * So: keep the document, minus the parts that only make sense to whoever runs
 * the skill by hand.
 */
const SCAFFOLD = new RegExp(
  "^#{1,4}\\s*(" + [
    "trigger", "usage", "how to (use|run|invoke)", "invocation", "install(ation)?",
    "setup", "requirements?", "prerequisites?", "inputs?", "outputs?",
    "file (layout|structure)", "where (files|output)", "folder", "directory",
    "workflow steps?", "steps? to run", "checklist for the agent",
    "changelog", "version", "licen[sc]e", "credits?", "see also",
  ].join("|") + ")\\b",
  "i",
);

function craftOf(body: string): string {
  const sections = body.split(/\n(?=#{1,4}\s)/);
  const kept = sections.filter((section) => !SCAFFOLD.test(section.trim()));
  return (kept.length ? kept : sections).join("\n").trim();
}

/**
 * Resolve the voice for a run.
 *
 * Never throws. A publication whose voice skill has been uninstalled, renamed
 * or broken still runs — in the definition's own voice, with the reason said
 * out loud rather than silently producing different prose than last time.
 */
export async function resolveVoice(args: {
  readonly projectRoot: string;
  readonly fallback: string;
  readonly skillId?: string | undefined;
  readonly maxChars?: number;
}): Promise<VoiceResult> {
  if (!args.skillId) return { voice: args.fallback };

  try {
    const { skills } = await loadAvailableAgentSkills({ projectRoot: args.projectRoot });
    const registry = createSkillRegistry({ skills });
    const skill = registry.getSkill(args.skillId);
    if (!skill) {
      return {
        voice: args.fallback,
        diagnostic: `voice skill "${args.skillId}" is not installed — using ${""
          }the type's own voice instead`,
      };
    }

    // Keeping most of the document costs more context than keeping four
    // sections did. 16k is roughly a full craft skill and still small beside a
    // page prompt's research block.
    const craft = craftOf(skill.body ?? "").slice(0, args.maxChars ?? 16000);
    if (!craft) {
      return {
        voice: args.fallback,
        diagnostic: `voice skill "${args.skillId}" has no usable craft sections`,
      };
    }

    return {
      voice: [
        `HOW THIS KIND OF THING IS MADE WELL (from the "${skill.name}" skill).`,
        "Take it as inspiration for how to represent the subject and how a page",
        "earns attention. It is not a template and not a script to copy:",
        "",
        craft,
        "",
        "--- and the voice this publication is written in ---",
        "",
        args.fallback,
      ].join("\n"),
    };
  } catch (error) {
    return {
      voice: args.fallback,
      diagnostic: `could not read voice skill "${args.skillId}": ${(error as Error).message}`,
    };
  }
}
