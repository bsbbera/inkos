/**
 * The art-plan executor.
 *
 * The case that matters is the negative prompt: the house style ends a cover
 * prompt with "Avoid: …", and sending that whole paragraph to a generator as
 * the positive prompt asks for the very things it lists.
 */
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artplan, splitNegative, subjectOf, type ArtBrief } from "../pipeline/executors.js";

async function workspaceWithCover(text: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "quire-exec-"));
  await mkdir(join(root, "shorts", "a-short", "final"), { recursive: true });
  await writeFile(join(root, "shorts", "a-short", "final", "cover-prompt.md"), text, "utf-8");
  return root;
}

describe("splitNegative", () => {
  it("takes what to avoid out of what to draw", () => {
    const { prompt, negative } = splitNegative("A hand on a page. Avoid: halos, light beams.");
    expect(prompt).toBe("A hand on a page.");
    expect(negative).toBe("halos, light beams.");
  });

  it("leaves a prompt that never says avoid alone", () => {
    expect(splitNegative("A lamp.").negative).toBe("");
  });
});

describe("subjectOf", () => {
  it("is the first sentence, so a list of briefs can be read", () => {
    expect(subjectOf("A hand on a page. Then more detail.")).toBe("A hand on a page.");
  });
});

describe("artplan", () => {
  it("writes a brief the generator can take as-is", async () => {
    const root = await workspaceWithCover("A hand on a page. Avoid: halos.");
    const out = await artplan({ projectRoot: root, type: "short", id: "a-short", unit: 1 });
    expect(out.ok).toBe(true);
    expect(out.artifacts).toEqual(["shorts/a-short/art/briefs/1-cover.json"]);

    const brief = JSON.parse(
      await readFile(join(root, "shorts", "a-short", "art", "briefs", "1-cover.json"), "utf-8"),
    ) as ArtBrief;
    expect(brief.slot).toBe("cover");
    expect(brief.prompt).toBe("A hand on a page.");
    expect(brief.negative).toBe("halos.");
    expect(brief.width).toBeGreaterThan(0);
  });

  it("says what is missing rather than inventing a cover", async () => {
    const root = await mkdtemp(join(tmpdir(), "quire-exec-"));
    const out = await artplan({ projectRoot: root, type: "short", id: "nothing-here", unit: 1 });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("cover-prompt.md");
  });
});
