/**
 * The long copies of a short, after somebody rewrites a chapter.
 *
 * The bug these cover is not that the recomposition is hard - it is that
 * nothing did it at all, so `full.md` sat beside the chapters saying something
 * else. The cases worth holding are the ones where doing it wrong is silent:
 * a heading level that would double up, a language guessed from config rather
 * than read off the document, and a signed-off file written over.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chapterBody,
  composedDirOf,
  foldChapters,
  recomposeShortFiction,
  renderedLanguage,
} from "../pipeline/recompose.js";

const DRAFT = {
  storyTitle: "The Lamp Room",
  openingHook: "A light that no one lit.",
  chapters: [
    { number: 1, title: "The Stair", content: "He climbed.", charCount: 11 },
    { number: 2, title: "The Glass", content: "It was cold.", charCount: 12 },
  ],
  rawContent: "",
};

function backupOf(path: string): string {
  return path.replace(/(\.[^.]+)$/, ".pre-audit$1");
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "recompose-"));
  const base = join(root, "shorts", "lamp-room", "final");
  await mkdir(join(base, "chapters"), { recursive: true });
  await writeFile(join(base, "short-story.json"), JSON.stringify(DRAFT, null, 2), "utf-8");
  await writeFile(join(base, "chapters", "0001.md"), "# Chapter 1: The Stair\n\nHe climbed.\n", "utf-8");
  await writeFile(join(base, "chapters", "0002.md"), "# Chapter 2: The Glass\n\nIt was cold.\n", "utf-8");
  await writeFile(join(base, "full.md"), "# The Lamp Room\n\n## Opening Hook\n\nA light that no one lit.\n", "utf-8");
  return root;
}

describe("chapterBody", () => {
  it("drops the heading the chapter file leads with", () => {
    expect(chapterBody("# Chapter 1: The Stair\n\nHe climbed.\n")).toBe("He climbed.");
  });

  it("leaves a chapter that opens straight into prose alone", () => {
    expect(chapterBody("He climbed.\n")).toBe("He climbed.");
  });

  it("keeps headings that are inside the prose rather than above it", () => {
    expect(chapterBody("# One\n\nA\n\n## A break\n\nB")).toBe("A\n\n## A break\n\nB");
  });
});

describe("composedDirOf", () => {
  it("finds the directory whose long copies a chapter belongs to", () => {
    expect(composedDirOf("shorts/x/final/chapters/0001.md")).toBe("shorts/x/final");
  });

  it("answers nothing for a file that is not a chapter", () => {
    expect(composedDirOf("shorts/x/final/full.md")).toBeNull();
    expect(composedDirOf("shorts/x/final/chapters/notes/0001.md")).toBeNull();
  });
});

describe("renderedLanguage", () => {
  it("reads the language off the document rather than guessing", () => {
    expect(renderedLanguage("# T\n\n## Opening Hook\n\nx", DRAFT)).toBe("en");
    expect(renderedLanguage("# T\n\n## 开篇钩子\n\nx", DRAFT)).toBe("zh");
  });

  it("falls back to the prose when there is no document yet", () => {
    expect(renderedLanguage(null, DRAFT)).toBe("en");
    expect(renderedLanguage(null, {
      ...DRAFT,
      storyTitle: "灯室",
      chapters: [{ number: 1, title: "楼梯", content: "他爬上去了。", charCount: 6 }],
    })).toBe("zh");
  });
});

describe("foldChapters", () => {
  it("counts only the chapters whose prose actually moved", () => {
    const folded = foldChapters(DRAFT, new Map([[1, "He ascended."], [2, "It was cold."]]));
    expect(folded.changed).toBe(1);
    expect(folded.draft.chapters[0]!.content).toBe("He ascended.");
    expect(folded.draft.chapters[0]!.charCount).toBe("He ascended.".length);
    expect(folded.draft.chapters[1]!.content).toBe("It was cold.");
  });
});

describe("recomposeShortFiction", () => {
  it("rebuilds the long copies from the chapter files", async () => {
    const root = await workspace();
    const base = "shorts/lamp-room/final";
    await writeFile(
      join(root, base, "chapters", "0001.md"),
      "# Chapter 1: The Stair\n\nHe went up the stair, slowly.\n",
      "utf-8",
    );

    const result = await recomposeShortFiction({ root, baseDir: base, backupOf });

    expect(result?.chapters).toBe(1);
    expect(result?.written).toContain(`${base}/full.md`);
    expect(result?.written).toContain(`${base}/The Lamp Room.md`);
    expect(result?.written).toContain(`${base}/short-story.json`);

    const full = await readFile(join(root, base, "full.md"), "utf-8");
    expect(full).toContain("He went up the stair, slowly.");
    expect(full).toContain("It was cold.");
    // The title stays the only top-level heading; chapters sit under it.
    expect(full.match(/^# /gm)).toHaveLength(1);
    expect(full).toContain("## Chapter 1: The Stair");

    const json = JSON.parse(await readFile(join(root, base, "short-story.json"), "utf-8"));
    expect(json.chapters[0].content).toBe("He went up the stair, slowly.");
  });

  it("leaves a pre-write copy the audit screen's Restore can reach", async () => {
    const root = await workspace();
    const base = "shorts/lamp-room/final";
    await writeFile(join(root, base, "chapters", "0001.md"), "# One\n\nChanged.\n", "utf-8");

    await recomposeShortFiction({ root, baseDir: base, backupOf });

    const backup = await readFile(join(root, base, "full.pre-audit.md"), "utf-8");
    expect(backup).toContain("A light that no one lit.");
    expect(backup).not.toContain("Changed.");
  });

  it("does not write over a long copy that has been signed off", async () => {
    const root = await workspace();
    const base = "shorts/lamp-room/final";
    await writeFile(join(root, base, "chapters", "0001.md"), "# One\n\nChanged.\n", "utf-8");

    const result = await recomposeShortFiction({
      root,
      baseDir: base,
      backupOf,
      isApproved: (path) => path === `${base}/full.md`,
    });

    expect(result?.skipped).toEqual([{ path: `${base}/full.md`, why: "signed off" }]);
    expect(await readFile(join(root, base, "full.md"), "utf-8")).not.toContain("Changed.");
  });

  it("writes nothing when no chapter has changed", async () => {
    const root = await workspace();
    const result = await recomposeShortFiction({
      root,
      baseDir: "shorts/lamp-room/final",
      backupOf,
    });
    expect(result).toEqual({ written: [], skipped: [], chapters: 0 });
  });

  it("is a no-op for work that keeps no long copy", async () => {
    const root = await workspace();
    const result = await recomposeShortFiction({
      root,
      baseDir: "books/some-novel",
      backupOf,
    });
    expect(result).toBeNull();
  });
});
