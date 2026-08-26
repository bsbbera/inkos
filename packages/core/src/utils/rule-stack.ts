/**
 * One rule stack, assembled once, read by every pipeline.
 *
 * The rules used to be a book feature. `buildWritingMethodologySection` was
 * imported by exactly two files, both on the long-book path, so a short story
 * got a hand-maintained craft list of its own and a magazine got nothing at
 * all — three producers, three drifting ideas of what good prose is, and a
 * de-AI rule added in one place that changed nothing anywhere else.
 *
 * What a kind of work gets is a question of what it is, not of which pipeline
 * happens to be running:
 *
 *   universal   prose quality        every kind
 *   story       narrative craft      things that tell a story
 *   genre       per-genre law        story kinds; publications use subject law
 *   own         this work's canon    read off disk, per kind
 *
 * A magazine takes the universal layer — emotion carried by action, factual
 * consistency, language constraints — and not the story layer, because
 * six-step character psychology has nothing to say about a two-page explainer
 * on monsoon farming. It takes its own canon from the series it belongs to,
 * which is the thing a magazine had and a book did not: `series_rules.md` and
 * `house_style.md` are to a series what `book_rules.md` and `story_bible.md`
 * are to a book.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildProseCraftSection, buildStoryCraftSection } from "./writing-methodology.js";

export type RuleKind = "book" | "short" | "script" | "storyboard" | "publication";

/** Kinds that tell a story, and therefore take the narrative layer. */
const NARRATIVE: ReadonlySet<RuleKind> = new Set<RuleKind>(["book", "short", "script", "storyboard"]);

/**
 * The rule files a kind carries with it, in the order they are read.
 *
 * Later files win by being read later, so steering beats standing law:
 * `current_focus.md` is the near-term instruction and is always last.
 */
export function ruleFilesFor(kind: RuleKind): readonly string[] {
  if (kind === "book") {
    return ["book_rules.md", "story_bible.md", "author_intent.md", "current_focus.md"];
  }
  if (kind === "publication") {
    return ["series_rules.md", "house_style.md", "current_focus.md"];
  }
  return ["current_focus.md"];
}

export interface RuleStackOptions {
  readonly kind: RuleKind;
  readonly language: "zh" | "en";
  /**
   * Where this work's own rule files live — a book's directory, a magazine
   * series' directory. Absent means the built-in layers only.
   */
  readonly rulesDir?: string;
  /** Genre or subject law, already resolved by the caller. */
  readonly genreRules?: string;
}

/** Missing rule files are the normal case, not an error: most work has none. */
async function readIfPresent(dir: string, name: string): Promise<string | null> {
  try {
    const text = (await readFile(join(dir, name), "utf-8")).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * The rules for one piece of work, as one block of markdown.
 *
 * Empty layers are dropped rather than left as empty headings, so a short
 * story with no rule files of its own gets the universal and story layers and
 * nothing else — no scaffolding announcing what it does not have.
 */
export async function buildRuleStack(options: RuleStackOptions): Promise<string> {
  const { kind, language, rulesDir, genreRules } = options;
  const en = language === "en";

  const layers: Array<string | null> = [
    en
      ? "# Rules\n\nThese apply to everything written here. They are not suggestions and\nthey are not overridden by the material below unless a later layer says so\nexplicitly."
      : "# 规则\n\n以下规则适用于这里写的一切。不是建议，除非后面的层明确改写，否则不得违反。",
    buildProseCraftSection(language),
    NARRATIVE.has(kind) ? buildStoryCraftSection(language) : null,
    genreRules?.trim() || null,
  ];

  if (rulesDir) {
    for (const name of ruleFilesFor(kind)) {
      const body = await readIfPresent(rulesDir, name);
      if (body) layers.push(`## ${name}\n\n${body}`);
    }
  }

  return layers.filter((l): l is string => Boolean(l)).join("\n\n");
}
