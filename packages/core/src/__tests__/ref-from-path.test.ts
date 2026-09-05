/**
 * Turning an audited file back into a unit of a run.
 *
 * This is the join between the only thing the audit screen knows (a path) and
 * the only thing the pipeline knows (a run and a unit). Get it wrong in the
 * quiet direction and a book sits at content.audit forever; get it wrong in the
 * loud direction and reading chapter 3 reports chapter 30 as read.
 */
import { describe, expect, it } from "vitest";
import { refFromPath } from "../productions/registry.js";

describe("refFromPath", () => {
  it("reads the chapter number off a book chapter", () => {
    expect(refFromPath("books/the-tower/chapters/0003_the-door.md")).toEqual({
      type: "book",
      id: "the-tower",
      unit: 3,
    });
  });

  it("finds a magazine issue under the extra issues segment", () => {
    expect(refFromPath("Magazine/issues/deep-time/pages/02-first-light.md")).toEqual({
      type: "publication",
      id: "deep-time",
      unit: 2,
    });
  });

  it("reads a translation chapter whose number is not at the front", () => {
    expect(refFromPath("translations/wuxia/translated/chapter-0004.json")).toEqual({
      type: "translation",
      id: "wuxia",
      unit: 4,
    });
  });

  it("calls a work-shaped production unit one, whatever the file is named", () => {
    expect(refFromPath("shorts/the-second-law/final/story.md")).toEqual({
      type: "short",
      id: "the-second-law",
      unit: 1,
    });
    // A script lives in dramas/ and is written in one pass; the digits in the
    // filename are not a unit and must not be read as one.
    expect(refFromPath("dramas/ep-7-pilot/script.md")).toEqual({
      type: "script",
      id: "ep-7-pilot",
      unit: 1,
    });
  });

  it("refuses what it cannot place rather than guessing a unit", () => {
    // A directory no production owns.
    expect(refFromPath("notes/whatever.md")).toBeNull();
    // A production with no pipeline at all.
    expect(refFromPath("worlds/a-world/notes.md")).toBeNull();
    // Unit-shaped, but the leaf carries no number to be a unit.
    expect(refFromPath("books/the-tower/chapters/outline.md")).toBeNull();
    // Nothing after the out dir to be an id.
    expect(refFromPath("books")).toBeNull();
  });
});
