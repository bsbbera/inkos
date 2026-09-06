/**
 * Putting the whole story back together after somebody rewrote a piece of it.
 *
 * A short is written to disk four times over: `final/chapters/0001.md` and its
 * siblings, `final/full.md`, `final/<Title>.md`, and `short-story.json`. That
 * is deliberate - one to read a chapter at a time, one to read straight
 * through, one named after the story for handing to somebody, one to resume
 * from - and it was fine as long as the only thing that ever wrote them was
 * the run that produced all four in the same breath.
 *
 * Then three things learned to rewrite a chapter on its own: the restyle pass,
 * the audit's revise, and a person typing in the editor. All three write the
 * chapter file. None of them touched the other three copies. So a restyled
 * short had its chapters in the new voice and `full.md` in the old one, both
 * on the audit screen, both listed as the same story, disagreeing.
 *
 * This is the other half of any write to a chapter: fold the file back into
 * the draft and render the long copies from it again. It renders through
 * `renderShortFictionDraftMarkdown` rather than concatenating the files,
 * because the chapter files carry `# ` headings and the long copies carry
 * `## ` under a `# Title`; gluing them together would produce a document with
 * fourteen top-level headings and no title.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatShortFictionChapterHeading,
  renderShortFictionDraftMarkdown,
  type ShortFictionBatchDraft,
  type ShortFictionLanguage,
} from "../agents/short-fiction.js";

/** The prose of a chapter file, without the heading the file leads with. */
export function chapterBody(markdown: string): string {
  return markdown.replace(/^\s*#[^\n]*\n+/, "").trim();
}

/**
 * Which language the long copies were written in.
 *
 * Read off the existing document rather than plumbed in from project config,
 * because the document is the thing being rewritten and it already says: the
 * hook heading is one of exactly two strings. Config can disagree with a story
 * written before it changed; the file on disk cannot.
 */
export function renderedLanguage(
  existing: string | null,
  draft: ShortFictionBatchDraft,
): ShortFictionLanguage {
  if (existing?.includes("## Opening Hook")) return "en";
  if (existing?.includes("## 开篇钩子")) return "zh";
  const sample = `${draft.storyTitle}${draft.chapters[0]?.content.slice(0, 200) ?? ""}`;
  const cjk = (sample.match(/[一-鿿]/g) ?? []).length;
  return cjk > sample.length * 0.15 ? "zh" : "en";
}

/** The file name a short's own copy is given. Mirrors the runner's rule. */
export function shortFileName(value: string): string {
  const cleaned = value
    .replace(/[\\/:\0*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "short-fiction";
}

/**
 * Fold chapter files back into the draft.
 *
 * Pure, so the interesting half can be tested without a workspace: which
 * chapters changed is decided here, and only writing is left to the caller.
 */
export function foldChapters(
  draft: ShortFictionBatchDraft,
  bodies: ReadonlyMap<number, string>,
): { readonly draft: ShortFictionBatchDraft; readonly changed: number } {
  let changed = 0;
  const chapters = draft.chapters.map((chapter) => {
    const body = bodies.get(chapter.number);
    if (body === undefined || body === chapter.content) return chapter;
    changed += 1;
    return { ...chapter, content: body, charCount: body.length };
  });
  return { draft: { ...draft, chapters }, changed };
}

export interface RecomposeResult {
  /** Project-relative paths that were rewritten. */
  readonly written: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<{ readonly path: string; readonly why: string }>;
  readonly chapters: number;
}

/**
 * Rebuild `full.md`, `<Title>.md` and `short-story.json` from the chapter files.
 *
 * `null` when this directory is not a short - a book keeps no long copy, so
 * there is nothing here to disagree with it, and the caller can hand every
 * directory it touched to this without knowing which kind of work it was.
 */
export async function recomposeShortFiction(input: {
  /** Workspace root. */
  readonly root: string;
  /** Project-relative directory holding `short-story.json` and `chapters/`. */
  readonly baseDir: string;
  /** Whether a path is signed off, and so must not be written over. */
  readonly isApproved?: (path: string) => boolean;
  /** Where the pre-write copy goes, so the audit screen's Restore reaches it. */
  readonly backupOf: (path: string) => string;
}): Promise<RecomposeResult | null> {
  const rel = (...parts: string[]) => [input.baseDir, ...parts].join("/");
  const abs = (path: string) => join(input.root, path);

  const raw = await readFile(abs(rel("short-story.json")), "utf-8").catch(() => null);
  if (raw === null) return null;

  let draft: ShortFictionBatchDraft;
  try {
    draft = JSON.parse(raw) as ShortFictionBatchDraft;
  } catch {
    // A hand-edited resume file that has lost its shape is not worth taking a
    // rewrite down over; the chapters are still correct on disk.
    return null;
  }
  if (!Array.isArray(draft.chapters) || draft.chapters.length === 0) return null;

  const bodies = new Map<number, string>();
  for (const chapter of draft.chapters) {
    const file = rel("chapters", `${String(chapter.number).padStart(4, "0")}.md`);
    const text = await readFile(abs(file), "utf-8").catch(() => null);
    if (text !== null) bodies.set(chapter.number, chapterBody(text));
  }

  const folded = foldChapters(draft, bodies);
  if (folded.changed === 0) return { written: [], skipped: [], chapters: 0 };

  const fullPath = rel("full.md");
  const existing = await readFile(abs(fullPath), "utf-8").catch(() => null);
  const language = renderedLanguage(existing, folded.draft);
  const markdown = renderShortFictionDraftMarkdown(folded.draft, language);

  const titled = rel(`${shortFileName(folded.draft.storyTitle)}.md`);
  const plan: ReadonlyArray<{ path: string; body: string }> = [
    { path: fullPath, body: markdown },
    { path: titled, body: markdown },
    { path: rel("short-story.json"), body: `${JSON.stringify(folded.draft, null, 2)}\n` },
  ];

  const written: string[] = [];
  const skipped: Array<{ path: string; why: string }> = [];
  for (const { path, body } of plan) {
    if (input.isApproved?.(path)) {
      skipped.push({ path, why: "signed off" });
      continue;
    }
    const before = await readFile(abs(path), "utf-8").catch(() => null);
    if (before === body) continue;
    // Backed up on the same convention as every other rewriting pass, so the
    // audit screen's Restore puts the long copy back too.
    if (before !== null) await writeFile(abs(input.backupOf(path)), before, "utf-8");
    await writeFile(abs(path), body, "utf-8");
    written.push(path);
  }

  return { written, skipped, chapters: folded.changed };
}

/**
 * The directory whose long copies a chapter file belongs to.
 *
 * `shorts/x/final/chapters/0001.md` is composed into `shorts/x/final`. A path
 * that is not inside a `chapters/` directory belongs to no such set.
 */
export function composedDirOf(path: string): string | null {
  const parts = path.split("/");
  const at = parts.lastIndexOf("chapters");
  if (at <= 0 || at !== parts.length - 2) return null;
  return parts.slice(0, at).join("/");
}

/** Re-exported so callers need not reach into the agent module for the heading rule. */
export { formatShortFictionChapterHeading };
