import { describe, expect, it, vi } from "vitest";
import { restyleProse, restyleTargets, voiceOnly, RestyleRefused } from "../pipeline/restyle.js";
import { buildWritingMethodologySection } from "../utils/writing-methodology.js";

const ORIGINAL = ("The lamp went out. He stood in the dark and counted to ten, which was what "
  + "his mother had taught him to do when the house made noises. Nothing came. ").repeat(4);

/** A rewrite of roughly the right size, so the length guard is not the thing under test. */
const REWRITTEN = ("Dark, all at once. He held still and counted - ten, the way his mother had "
  + "taught him for nights the house spoke. Nothing answered. ").repeat(4);

describe("the voice, separated from the craft rules", () => {
  it("keeps the extracted voice and drops the methodology", () => {
    const guide = `## Narrative Voice\nDry and close.\n\n${buildWritingMethodologySection("en")}`;
    const voice = voiceOnly(guide);
    expect(voice).toContain("Dry and close.");
    // Thousands of words already in force everywhere; re-sending them per
    // chapter costs money and buries the two paragraphs that matter.
    expect(voice).not.toContain("Writing Methodology Reference");
  });

  it("leaves a guide alone that has no methodology in it", () => {
    expect(voiceOnly("## Voice\nPlain.")).toBe("## Voice\nPlain.");
  });
});

describe("rewriting a draft", () => {
  const chatting = (reply: string) => vi.fn().mockResolvedValue(reply);

  it("sends the voice and the text, and returns the rewrite", async () => {
    const chat = chatting(REWRITTEN);
    const out = await restyleProse({
      text: ORIGINAL, styleGuide: "## Voice\nDry and close.", language: "en", chat,
    });
    expect(out).toBe(REWRITTEN.trim());
    const [system, user] = chat.mock.calls[0] as [string, string];
    expect(system).toContain("You do not rewrite the story");
    expect(user).toContain("Dry and close.");
    expect(user).toContain("The lamp went out.");
  });

  it("takes the fence off a reply the model wrapped", async () => {
    const out = await restyleProse({
      text: ORIGINAL, styleGuide: "## Voice", language: "en",
      chat: chatting("```markdown\n" + REWRITTEN + "\n```"),
    });
    expect(out.startsWith("```")).toBe(false);
    expect(out).toContain("Dark, all at once.");
  });

  it("refuses a rewrite that summarised the draft instead", async () => {
    // The most likely failure, and a silently destructive one: the original is
    // only a backup away, and nobody checks a backup they did not know to want.
    await expect(restyleProse({
      text: ORIGINAL, styleGuide: "## Voice", language: "en",
      chat: chatting("The lamp went out and he counted to ten."),
    })).rejects.toThrow(RestyleRefused);
  });

  it("refuses a rewrite that ran away with itself", async () => {
    await expect(restyleProse({
      text: ORIGINAL, styleGuide: "## Voice", language: "en",
      chat: chatting(REWRITTEN.repeat(3)),
    })).rejects.toThrow(/added rather than restyled/);
  });

  it("refuses an empty reply", async () => {
    await expect(restyleProse({
      text: ORIGINAL, styleGuide: "## Voice", language: "en", chat: chatting("   "),
    })).rejects.toThrow(/returned nothing/);
  });

  it("refuses when the work has no voice to be rewritten into", async () => {
    const chat = chatting(REWRITTEN);
    await expect(restyleProse({
      text: ORIGINAL, styleGuide: buildWritingMethodologySection("en"), language: "en", chat,
    })).rejects.toThrow(/no imported voice/);
    expect(chat).not.toHaveBeenCalled();
  });

  it("refuses an empty draft", async () => {
    await expect(restyleProse({
      text: "  ", styleGuide: "## Voice", language: "en", chat: chatting(REWRITTEN),
    })).rejects.toThrow(/nothing written here/);
  });
});

describe("choosing which files are the work", () => {
  // Exactly what the audit reports for the real short `the-lamp-room`.
  const OWNED = [
    "shorts/the-lamp-room/final/The Last Log of Tern Island.md",
    "shorts/the-lamp-room/final/chapters/0001.md",
    "shorts/the-lamp-room/final/chapters/0002.md",
    "shorts/the-lamp-room/final/cover-prompt.md",
    "shorts/the-lamp-room/final/full.md",
    "shorts/the-lamp-room/final/sales-package.md",
    "shorts/the-lamp-room/drafts/v001/chapters/0001.md",
    "shorts/the-lamp-room/outline/v001.md",
    "shorts/the-lamp-room/reviews/draft-v001.md",
    "shorts/the-lamp-room/style_guide.md",
  ];

  it("takes the chapters and leaves the working papers", () => {
    expect(restyleTargets(OWNED)).toEqual([
      "shorts/the-lamp-room/final/chapters/0001.md",
      "shorts/the-lamp-room/final/chapters/0002.md",
    ]);
  });

  it("never rewrites the voice itself", () => {
    expect(restyleTargets(OWNED)).not.toContain("shorts/the-lamp-room/style_guide.md");
  });

  it("does not rewrite the same chapters twice through full.md", () => {
    expect(restyleTargets(OWNED)).not.toContain("shorts/the-lamp-room/final/full.md");
  });

  it("prefers the final edition over the drafts behind it", () => {
    expect(restyleTargets(OWNED).every((p) => p.includes("/final/"))).toBe(true);
  });

  it("falls back to the newest draft when there is no final", () => {
    expect(restyleTargets([
      "shorts/x/drafts/v001/chapters/0001.md",
      "shorts/x/drafts/v002/chapters/0001.md",
      "shorts/x/drafts/v002/chapters/0002.md",
    ])).toEqual([
      "shorts/x/drafts/v002/chapters/0001.md",
      "shorts/x/drafts/v002/chapters/0002.md",
    ]);
  });

  it("takes a storybook's spreads", () => {
    expect(restyleTargets([
      "storybooks/fox/spreads/0001.md",
      "storybooks/fox/plan.json",
      "storybooks/fox/storybook.json",
    ])).toEqual(["storybooks/fox/spreads/0001.md"]);
  });

  it("has nothing to offer a work with no units written", () => {
    expect(restyleTargets(["shorts/x/outline/v001.md"])).toEqual([]);
  });
});
