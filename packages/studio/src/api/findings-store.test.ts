import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { locate, type Finding } from "@actalk/quire-core";
import {
  blockersFor, readFindings, readPassage, recordRun, settleFinding, writeFindings,
} from "./findings-store.js";

const CHAPTER = [
  "# Nine",
  "",
  "Inside, everything was in its place. That was the first thing.",
  "",
  "He set the box down and favoured his right leg going up the last flight,",
  "and stood a while in the lamp room.",
  "",
].join("\n");

const PATH = "books/tide/chapters/0009_nine.md";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "findings-"));
  await mkdir(join(root, "books/tide/chapters"), { recursive: true });
  await writeFile(join(root, PATH), CHAPTER, "utf-8");
});

function limpFinding(): Finding {
  return locate({
    path: PATH,
    severity: "blocking",
    category: "continuity",
    title: "The limp changed legs",
    quote: "favoured his right leg",
    fix: "favoured his left leg",
    description: "Chapter 3 puts the weight on his left.",
    suggestion: "Match chapter 3.",
  }, CHAPTER);
}

describe("the record", () => {
  it("survives a run and comes back", async () => {
    await recordRun(root, [limpFinding()], [PATH]);
    const back = await readFindings(root);
    expect(back).toHaveLength(1);
    expect(back[0]!.title).toBe("The limp changed legs");
    expect(back[0]!.state).toBe("open");
  });

  it("reads an absent or corrupt file as no findings rather than failing", async () => {
    expect(await readFindings(root)).toEqual([]);
    await mkdir(join(root, ".quire"), { recursive: true });
    await writeFile(join(root, ".quire/findings.json"), "{ not json", "utf-8");
    expect(await readFindings(root)).toEqual([]);
  });

  it("does not resurrect a finding somebody already settled", async () => {
    await recordRun(root, [limpFinding()], [PATH]);
    await settleFinding(root, limpFinding().id, "ignored");
    // The same check runs again and reports the same thing.
    await recordRun(root, [limpFinding()], [PATH]);
    const back = await readFindings(root);
    expect(back).toHaveLength(1);
    expect(back[0]!.state).toBe("ignored");
  });
});

describe("settling", () => {
  it("accepting the proposal writes it into the chapter", async () => {
    await recordRun(root, [limpFinding()], [PATH]);
    const out = await settleFinding(root, limpFinding().id, "accepted");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.wrote).toBe(true);

    const after = await readFile(join(root, PATH), "utf-8");
    expect(after).toContain("favoured his left leg going up the last flight");
    expect(after).not.toContain("his right leg");
    // Nothing else in the chapter moved.
    expect(after).toContain("Inside, everything was in its place.");
  });

  it("the reviewer's own wording wins over the proposal", async () => {
    await recordRun(root, [limpFinding()], [PATH]);
    await settleFinding(root, limpFinding().id, "accepted", "put his weight on the left");

    const after = await readFile(join(root, PATH), "utf-8");
    expect(after).toContain("put his weight on the left going up");
    expect(after).not.toContain("favoured his left leg");
    const stored = (await readFindings(root))[0]!;
    expect(stored.settledText).toBe("put his weight on the left");
  });

  it("a paragraph the reviewer rewrote replaces the paragraph, not the quote", async () => {
    await recordRun(root, [limpFinding()], [PATH]);
    const written = "He set the box down and climbed, favouring the left, and stood a while.";
    const out = await settleFinding(root, limpFinding().id, "accepted", written, "paragraph");
    expect(out.ok).toBe(true);

    const after = await readFile(join(root, PATH), "utf-8");
    expect(after).toContain(written);
    // The rest of the old paragraph is gone rather than welded onto the new one.
    expect(after).not.toContain("going up the last flight");
    expect(after).not.toContain("in the lamp room");
    // And the paragraphs on either side of it are intact.
    expect(after).toContain("Inside, everything was in its place.");
    expect(after).toContain("# Nine");
  });

  it("ignoring records the decision and leaves the prose alone", async () => {
    await recordRun(root, [limpFinding()], [PATH]);
    await settleFinding(root, limpFinding().id, "ignored");
    expect(await readFile(join(root, PATH), "utf-8")).toBe(CHAPTER);
    expect((await readFindings(root))[0]!.state).toBe("ignored");
  });

  it("refuses to write when the words it was about are gone", async () => {
    await recordRun(root, [limpFinding()], [PATH]);
    await writeFile(join(root, PATH), CHAPTER.replace("favoured his right leg", "climbed"), "utf-8");
    const out = await settleFinding(root, limpFinding().id, "accepted");
    expect(out).toEqual({ ok: false, reason: "drifted" });
    // And the finding is still open, not marked done over a write that failed.
    expect((await readFindings(root))[0]!.state).toBe("open");
  });

  it("refuses to accept a finding that proposes nothing", async () => {
    const noFix = locate({
      path: PATH, severity: "note", category: "shape",
      description: "Runs short of target.", suggestion: "Add 80 words.",
    }, CHAPTER);
    await recordRun(root, [noFix], [PATH]);
    expect(await settleFinding(root, noFix.id, "accepted")).toEqual({ ok: false, reason: "no-fix" });
  });

  it("says so when the finding is not on record", async () => {
    expect(await settleFinding(root, "nope", "ignored")).toEqual({
      ok: false, reason: "no-such-finding",
    });
  });

  it("reopening clears the settlement without undoing the words", async () => {
    await recordRun(root, [limpFinding()], [PATH]);
    await settleFinding(root, limpFinding().id, "accepted");
    const out = await settleFinding(root, limpFinding().id, "open");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.wrote).toBe(false);
    const stored = (await readFindings(root))[0]!;
    expect(stored.state).toBe("open");
    expect(stored.settledAt).toBeUndefined();
    // The accepted text stays in the chapter: taking words back out is what
    // the pre-audit copy is for, not what reopening a row means.
    expect(await readFile(join(root, PATH), "utf-8")).toContain("favoured his left leg");
  });
});

describe("blockers", () => {
  it("only counts open blocking findings for that file", async () => {
    const other = locate({
      path: "books/tide/chapters/0008_eight.md", severity: "blocking",
      category: "continuity", quote: "x", description: "d", suggestion: "s",
    }, "x");
    await writeFindings(root, [limpFinding(), other]);
    const findings = await readFindings(root);
    expect(blockersFor(findings, PATH).map((f) => f.title)).toEqual(["The limp changed legs"]);

    await settleFinding(root, limpFinding().id, "ignored");
    expect(blockersFor(await readFindings(root), PATH)).toHaveLength(0);
  });
});

describe("the passage", () => {
  it("returns the paragraph with the quote's offsets inside it", async () => {
    const f = limpFinding();
    const passage = await readPassage(root, f);
    expect(passage.paragraph).toContain("He set the box down");
    expect(passage.paragraph).not.toContain("Inside, everything");
    expect(passage.paragraph.slice(passage.markStart, passage.markEnd))
      .toBe("favoured his right leg");
  });

  it("survives the file having been deleted under the record", async () => {
    const gone = locate({
      path: "books/tide/chapters/9999_missing.md", severity: "note",
      category: "voice", quote: "x", description: "d", suggestion: "s",
    }, "x");
    const passage = await readPassage(root, gone);
    expect(passage.paragraph).toBe("");
    expect(passage.markStart).toBe(-1);
  });
});
