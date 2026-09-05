/**
 * Rewriting what is already written, in a voice imported after it was written.
 *
 * Importing a voice used to reach new prose only. That is the wrong half: a
 * person pastes three pages of an author they admire because they want *their
 * own draft* to read like that, and being told it will apply to chapter
 * fourteen onwards is not the feature they asked for.
 *
 * This is deliberately not the reviser. The reviser fixes faults an audit
 * found and is free to change what happens on the page to do it. This changes
 * only how it is said. The distinction is the whole safety story of the
 * feature, so it is stated three times over — in the system prompt, in the
 * user prompt, and in the check below that refuses a result which threw half
 * the draft away.
 */

/** How far a rewrite may drift in length before it is treated as a loss. */
const SHRANK_TOO_FAR = 0.55;
const GREW_TOO_FAR = 1.9;

export class RestyleRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestyleRefused";
  }
}

/**
 * The voice, without the craft rules underneath it.
 *
 * `style_guide.md` is the extracted voice followed by the full writing
 * methodology, which runs to thousands of words and is already in force
 * everywhere. Sending it again with every chapter would pay for it once per
 * chapter and bury the two paragraphs that actually describe the author.
 */
export function voiceOnly(styleGuide: string): string {
  const marker = styleGuide.search(/^---\s*$\n+^#\s+(Writing Methodology|写作方法论)/m);
  return (marker < 0 ? styleGuide : styleGuide.slice(0, marker)).trim();
}


/*
 * Which files of a work are the work.
 *
 * The audit walks every markdown file a production owns, which is right for
 * auditing and wrong here: for one short story that list is twenty-three
 * files, and it includes the outline, two review reports, a sales blurb, a
 * cover prompt, `full.md` (the same fourteen chapters again, concatenated) and
 * `style_guide.md` — the voice itself. Rewriting a sales blurb in Ursula Le
 * Guin's prose is not a feature, and rewriting the chapters twice because one
 * copy is glued together costs twice as much to produce a contradiction.
 *
 * `refFromPath` cannot answer this: a short's unit is the whole work, so it
 * maps every path under the work to unit 1, outline and review alike.
 *
 * So the rule is the one a person would give: the chapters, spreads, scenes or
 * panels of the newest edition. Working papers are not the story.
 */

/** Directories whose contents are the units of a work. */
const UNIT_DIRS = new Set(["chapters", "spreads", "scenes", "panels"]);

function inUnitDir(path: string): boolean {
  const parts = path.split("/");
  return parts.slice(0, -1).some((segment) => UNIT_DIRS.has(segment.toLowerCase()));
}

/**
 * The edition a path belongs to: `final`, or `drafts/<version>`, or nothing.
 *
 * A short keeps `final/chapters/` beside `drafts/v001/chapters/` and
 * `drafts/v001-partial/chapters/`. All three are the same story at different
 * ages, and rewriting all three is three times the cost for one result.
 */
function editionOf(path: string): string {
  const parts = path.split("/");
  const final = parts.findIndex((p) => p.toLowerCase() === "final");
  if (final >= 0) return "final";
  const drafts = parts.findIndex((p) => p.toLowerCase() === "drafts");
  if (drafts >= 0 && parts[drafts + 1]) return `drafts/${parts[drafts + 1]}`;
  return "";
}

/**
 * Narrow a work's files down to the prose a restyle should touch.
 *
 * Deterministic and pure so the screen can show the same list the job will
 * rewrite - nobody should discover which files were overwritten afterwards.
 */
export function restyleTargets(paths: ReadonlyArray<string>): ReadonlyArray<string> {
  const units = paths.filter(inUnitDir);
  if (units.length === 0) return [];

  const editions = new Set(units.map(editionOf));
  // `final` wins outright; otherwise the highest-sorting draft, which is the
  // newest under v001/v002 naming.
  const keep = editions.has("final")
    ? "final"
    : [...editions].filter(Boolean).sort().pop() ?? "";

  return units.filter((path) => editionOf(path) === keep).sort();
}

export async function restyleProse(input: {
  readonly text: string;
  readonly styleGuide: string;
  readonly language: "zh" | "en";
  readonly chat: (system: string, user: string) => Promise<string>;
}): Promise<string> {
  const original = input.text.trim();
  if (!original) throw new RestyleRefused("There is nothing written here to restyle.");

  const voice = voiceOnly(input.styleGuide);
  if (!voice) throw new RestyleRefused("This work has no imported voice to restyle it into.");

  const reply = await input.chat(
    input.language === "en" ? EN_SYSTEM : ZH_SYSTEM,
    input.language === "en"
      ? `## The voice to write in\n\n${voice}\n\n## The text to rewrite\n\n${original}`
      : `## 目标文风\n\n${voice}\n\n## 待改写的正文\n\n${original}`,
  );

  const rewritten = unfence(reply).trim();
  if (!rewritten) throw new RestyleRefused("The model returned nothing.");

  /*
   * A restyle that halves the chapter has not restyled it, it has summarised
   * it — the single most likely way this goes wrong, and silently destructive
   * because the original is only one keystroke behind a backup nobody thought
   * to check. Refusing leaves the file untouched.
   */
  const ratio = rewritten.length / original.length;
  if (ratio < SHRANK_TOO_FAR) {
    throw new RestyleRefused(
      `The rewrite came back ${Math.round((1 - ratio) * 100)}% shorter, which means text was dropped rather than restyled. Left as it was.`,
    );
  }
  if (ratio > GREW_TOO_FAR) {
    throw new RestyleRefused(
      `The rewrite came back ${Math.round(ratio * 100)}% of the original length, which means it added rather than restyled. Left as it was.`,
    );
  }

  return rewritten;
}

/** Models like to wrap a whole document in a fence. Take it back off. */
function unfence(reply: string): string {
  const fenced = reply.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/);
  return fenced?.[1] ?? reply;
}

const EN_SYSTEM = `You rewrite prose into another writer's voice. You do not rewrite the story.

Keep, exactly:
- Every event, in the order it happens.
- Every fact: names, places, numbers, times, objects, relationships.
- What every line of dialogue means, and who says it.
- Every heading, scene break, and section marker, unchanged and in place.
- Roughly the same length. This is a rewrite, not a summary and not an expansion.

Change:
- Sentence construction, rhythm and length.
- Word choice, imagery, and figures of speech.
- How emotion is carried, how description is paced, how scenes are entered and left.

If the voice you are given would suit a different plot, that is not your problem to solve. The plot stays.

Output the rewritten text and nothing else. No preamble, no notes on what you changed, no code fence.`;

const ZH_SYSTEM = `你的任务是把正文改写成另一位作者的文风，而不是改写故事。

必须保持不变：
- 所有事件及其发生顺序。
- 所有事实：人名、地名、数字、时间、物件、人物关系。
- 每句对白的含义，以及说话人是谁。
- 所有标题、场景分隔符、章节标记，位置和内容都不变。
- 大致相同的篇幅。这是改写，不是缩写，也不是扩写。

可以改变：
- 句子结构、节奏和长短。
- 用词、意象和修辞。
- 情绪的承载方式、描写的密度、场景的进入与退出方式。

如果目标文风更适合另一个故事，那不是你要解决的问题。故事本身不动。

只输出改写后的正文，不要前言，不要说明改了什么，不要代码块包裹。`;
