/**
 * Voices kept by name.
 *
 * The cases worth holding are the ones that were silently wrong before there
 * was a library: a voice with no name at all, the same name saved twice, and a
 * work claiming a voice it was never given.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyStyleTo,
  deleteStyle,
  listStyles,
  readStyleMeta,
  saveStyle,
  styleSlug,
  voiceNameFor,
} from "../pipeline/style-library.js";
import type { StyleProfile } from "../models/style-profile.js";

const PROFILE = {
  sourceName: "The Time Machine",
  avgSentenceLength: 13.8,
  sentenceLengthStdDev: 10.9,
  avgParagraphLength: 51,
  paragraphLengthRange: { min: 40, max: 67 },
  vocabularyDiversity: 0.69,
  topPatterns: [],
  rhetoricalFeatures: [],
  analyzedAt: "2026-09-06T00:00:00.000Z",
} as unknown as StyleProfile;

async function library() {
  const root = await mkdtemp(join(tmpdir(), "styles-"));
  await saveStyle({
    root,
    name: "Cold Coastal",
    guide: "## Narrative Voice\n\nFlat, salt-worn.\n",
    profile: PROFILE,
    language: "en",
    sampleChars: 2400,
    deterministic: false,
    sourceName: "The Time Machine",
  });
  return root;
}

describe("styleSlug", () => {
  it("makes a folder name out of a name a person typed", () => {
    expect(styleSlug("Cold Coastal")).toBe("cold-coastal");
    expect(styleSlug("  Mercer's Voice!  ")).toBe("mercer-s-voice");
  });

  it("never returns an empty or traversing name", () => {
    expect(styleSlug("///")).toMatch(/^voice-\d+$/);
    expect(styleSlug("..")).toMatch(/^voice-\d+$/);
  });
});

describe("the library", () => {
  it("keeps a voice under the name it was given", async () => {
    const root = await library();
    const [meta] = await listStyles(root);
    expect(meta?.name).toBe("Cold Coastal");
    expect(meta?.id).toBe("cold-coastal");
    expect(meta?.sampleChars).toBe(2400);
  });

  it("replaces a voice saved under a name already used", async () => {
    const root = await library();
    await saveStyle({
      root,
      name: "Cold Coastal",
      guide: "## Narrative Voice\n\nWarmer now.\n",
      profile: PROFILE,
      language: "en",
      sampleChars: 9000,
      deterministic: false,
    });
    const all = await listStyles(root);
    expect(all).toHaveLength(1);
    expect(all[0]!.sampleChars).toBe(9000);
  });

  it("forgets one when asked, and says so when there is nothing to forget", async () => {
    const root = await library();
    expect(await deleteStyle(root, "cold-coastal")).toBe(true);
    expect(await deleteStyle(root, "cold-coastal")).toBe(false);
    expect(await listStyles(root)).toHaveLength(0);
  });
});

describe("giving a voice to a piece of work", () => {
  it("copies the guide and leaves the name beside it", async () => {
    const root = await library();
    const dir = join(root, "shorts", "lamp-room");
    const meta = await applyStyleTo({ root, id: "cold-coastal", dir });

    expect(meta?.name).toBe("Cold Coastal");
    expect(await readFile(join(dir, "style_guide.md"), "utf-8")).toContain("salt-worn");
    expect(await voiceNameFor(dir)).toBe("Cold Coastal");
  });

  it("is a copy, so refining the library voice does not rewrite history", async () => {
    const root = await library();
    const dir = join(root, "shorts", "lamp-room");
    await applyStyleTo({ root, id: "cold-coastal", dir });
    await saveStyle({
      root,
      name: "Cold Coastal",
      guide: "## Narrative Voice\n\nSomething else entirely.\n",
      profile: PROFILE,
      language: "en",
      sampleChars: 100,
      deterministic: true,
    });
    expect(await readFile(join(dir, "style_guide.md"), "utf-8")).toContain("salt-worn");
  });

  it("refuses a voice that is not in the library", async () => {
    const root = await library();
    expect(await applyStyleTo({ root, id: "nobody", dir: join(root, "x") })).toBeNull();
  });
});

describe("voiceNameFor", () => {
  it("says nothing for a work that was never given one", async () => {
    const root = await library();
    expect(await voiceNameFor(join(root, "shorts", "nothing-here"))).toBeUndefined();
  });

  it("falls back to where the sample came from, for work styled before the library", async () => {
    const root = await library();
    const dir = join(root, "shorts", "old");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "style_profile.json"), JSON.stringify(PROFILE), "utf-8");
    expect(await voiceNameFor(dir)).toBe("The Time Machine");
  });

  it("prefers the name somebody chose over where the sample came from", async () => {
    const root = await library();
    const dir = join(root, "shorts", "both");
    await applyStyleTo({ root, id: "cold-coastal", dir });
    expect(await voiceNameFor(dir)).toBe("Cold Coastal");
  });
});

describe("readStyleMeta", () => {
  it("does not take the screen down over a hand-edited file", async () => {
    const root = await library();
    await writeFile(join(root, "styles", "cold-coastal", "style.json"), "{not json", "utf-8");
    expect(await readStyleMeta(root, "cold-coastal")).toBeNull();
    expect(await listStyles(root)).toHaveLength(0);
  });
});
