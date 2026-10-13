import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDesign, replanPage, sizeForFrame, type PublicationIssue, type RunnerContext } from "../pipeline/publication-runner.js";
import type { PublicationDefinition } from "../publications/types.js";

const definition = {
  id: "magazine", label: "magazine", outDir: "Magazine", densities: { heavy: [10, 400] },
  defaultDensity: "heavy", blocks: {}, rules: {}, needsImages: true, needsPdf: true,
} as unknown as PublicationDefinition;
const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
const spec = {
  palette: { paper: "#fbf1de", ink: "#1f1a5c", accent: "#c2185b" },
  type: { display: "Zodiak", text: "Sentient", scale: [64, 24, 10] },
  grid: { system: "modular", columns: 6, gutterMm: 5, marginMm: 14, baselineMm: 5 },
  imageDirection: "Indian miniature painting",
};

let root: string;
const issueFile = () => join(root, "Magazine", "issues", "birds", "publication.json");
const read = async (): Promise<PublicationIssue> => JSON.parse(await readFile(issueFile(), "utf-8"));
const ctx = (): RunnerContext => ({ projectRoot: root, definition, ask: async () => ({}) });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "quire-plan-"));
  await mkdir(join(root, "Magazine", "issues", "birds"), { recursive: true });
  await writeFile(issueFile(), JSON.stringify({
    id: "birds", type: "magazine", series: "b", subject: "birds", angle: "a", title: "Dressed to Be Seen",
    thesis: "t", extent: 2, status: "written", createdAt: "now", research: {}, sections: [{ n: 1, label: "Birds", question: "q", colour: "", from: 1, to: 2 }], approved: { at: "now", by: "editor" },
    pages: [
      { n: 1, title: "The peacock", type: "feature", density: "heavy", section: 1, pillar: "p", premise: "p", deck: "Why a train.", body: words(180), pullQuote: "A promise of health." },
      { n: 2, title: "The kingfisher", type: "feature", density: "heavy", section: 1, pillar: "p", premise: "p", body: words(220) },
    ],
  }), "utf-8");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("a plan made outside Quire", () => {
  it("is taken as a design option with its frames boxed from the grid, and the pages it leaves out are planned", async () => {
    await installDesign(ctx(), "birds", { label: "editor's plan", spec: { ...spec, pages: { 1: { layout: "mine", blocks: [
      { kind: "image", col: 1, span: 6, row: 0, rows: 26, bleed: true, brief: { shows: "a peacock" } },
      { kind: "title", col: 1, span: 6, row: 28, rows: 5 },
      { kind: "deck", col: 1, span: 4, row: 34, rows: 2 },
      { kind: "body", col: 1, span: 6, row: 37, rows: 10, columns: 2 },
    ] } } } });
    const issue = await read();
    expect(issue.designOptions).toHaveLength(1);
    expect(issue.designApproved).toBeNull();
    const p1 = issue.design!.spec!.pages["1"]!;
    expect(p1.blocks!.map((b) => b.kind)).toEqual(["image", "title", "deck", "body"]);
    expect((p1.blocks![0] as { box?: { x: number; y: number } }).box).toMatchObject({ x: 0, y: 0 });
    expect(issue.design!.spec!.pages["2"]!.plan).toBeTruthy();
    expect(issue.design!.notes!.join(" ")).toMatch(/pages 2 were not in it/);
  });
});

describe("the visual loop's next move", () => {
  it("lays the best arrangement not tried yet, and says when none is left", async () => {
    await installDesign(ctx(), "birds", { spec: { ...spec, pages: {} } });
    const first = (await read()).design!.spec!.pages["1"]!.plan!;
    const tried = new Set([first]);
    const next = await replanPage(ctx(), "birds", 1, tried, ["major: two dominants compete"]);
    expect(next).toBeTruthy();
    expect(next).not.toBe(first);
    expect((await read()).design!.spec!.pages["1"]!.plan).toBe(next);
    // Everything tried: nothing left to lay.
    const all = new Set<string>();
    for (let k = 0; k < 200; k++) { const id = await replanPage(ctx(), "birds", 1, all, []); if (!id) break; all.add(id); }
    expect(await replanPage(ctx(), "birds", 1, all, [])).toBeNull();
  });
});

describe("a picture rendered for its frame", () => {
  it("keeps the frame's shape at about the same area", () => {
    const tall = sizeForFrame(0.6);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(Math.abs(tall.width / tall.height - 0.6)).toBeLessThan(0.05);
    // A strip is drawn at 1:2 and cropped, never as a strip.
    expect(sizeForFrame(0.27).width / sizeForFrame(0.27).height).toBeGreaterThan(0.45);
    expect(tall.width % 64).toBe(0);
  });
});
