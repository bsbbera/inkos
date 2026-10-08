import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendReview, designSection, markSection, readReviews, redesignPage,
  type PublicationIssue, type RunnerContext,
} from "../pipeline/publication-runner.js";
import { applies, causeProposals, type TasteEvent } from "../pipeline/taste-engine.js";
import type { PublicationDefinition } from "../publications/types.js";

const definition = {
  id: "magazine", label: "magazine", outDir: "Magazine", densities: { heavy: [10, 400] },
  defaultDensity: "heavy", blocks: {}, rules: {}, needsImages: true, needsPdf: true,
} as unknown as PublicationDefinition;

let root: string;
const issueFile = () => join(root, "Magazine", "issues", "issue-a", "publication.json");
const read = async (): Promise<PublicationIssue> => JSON.parse(await readFile(issueFile(), "utf-8"));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "quire-review-"));
  await mkdir(join(root, "Magazine", "issues", "issue-a"), { recursive: true });
  const issue = {
    id: "issue-a", type: "magazine", series: "Petrichor", subject: "rain", angle: "a", title: "Monsoon",
    thesis: "t", extent: 2, status: "designed", createdAt: "now", research: {},
    sections: [{ n: 1, label: "Meghalaya", question: "q", colour: "", from: 1, to: 2 }],
    pages: [{ n: 1, title: "The village", type: "feature", density: "heavy", section: 1, pillar: "p", premise: "p", body: "Rain." }],
    design: {
      sections: [{ n: 1, register: "survey map", idiom: "contours", paper: "#eef0ea", ink: "#14211d" }],
      spec: {
        palette: { paper: "#eef0ea", ink: "#14211d", accent: "#f0a202" },
        type: { display: "Bodoni MT", text: "Lora", scale: [30, 14, 9.5] },
        grid: { columns: 12, gutterMm: 4, marginMm: 14, baselineMm: 4.7625 },
        imageDirection: "contours", pages: { 1: { layout: "feature", imageSlot: "top" } },
      },
    },
    designApproved: { at: "now", by: "editor" },
  };
  await writeFile(issueFile(), JSON.stringify(issue), "utf-8");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const ctx = (reply: Record<string, unknown> = {}, prompts: string[] = []): RunnerContext => ({
  projectRoot: root, definition,
  ask: async (prompt) => { prompts.push(prompt); return reply; },
});

describe("the section board", () => {
  it("keeps, locks and clears a section, and a locked section refuses another world", async () => {
    await markSection(ctx(), "issue-a", 1, "locked");
    expect((await read()).sectionBoard?.["1"]?.state).toBe("locked");
    await expect(designSection(ctx(), "issue-a", 1)).rejects.toThrow(/locked/);
    await markSection(ctx(), "issue-a", 1, "approved");
    expect((await read()).sectionBoard?.["1"]?.state).toBe("approved");
    await markSection(ctx(), "issue-a", 1, null);
    expect((await read()).sectionBoard?.["1"]).toBeUndefined();
    await expect(markSection(ctx(), "issue-a", 9, "approved")).rejects.toThrow(/no section 9/);
  });
});

describe("a one-page redesign", () => {
  it("asks for this page's blocks with the reason, keeps the placeable ones, and leaves the sign-off standing", async () => {
    const prompts: string[] = [];
    const out = await redesignPage(ctx({
      layout: "opener", imageSlot: "top",
      blocks: [
        { kind: "drawn", slot: { col: 1, span: 12, row: 0, rows: 29, bleed: true }, drawn: "contours" },
        { kind: "title", slot: { col: 1, span: 8, row: 33, rows: 4 } },
        { kind: "masthead", slot: { col: 1, span: 2, row: 0, rows: 2 } },
      ],
    }, prompts), "issue-a", 1, { note: "a bigger picture", cause: ["hierarchy"] });
    expect(prompts[0]).toMatch(/THE EDITOR ASKS FOR: a bigger picture/);
    expect(prompts[0]).toMatch(/What went wrong: hierarchy/);
    expect(prompts[0]).toMatch(/PAGE BLOCKS/);
    expect(out.dropped).toEqual([expect.stringMatching(/masthead/)]);
    const saved = await read();
    expect(saved.design?.spec?.pages["1"]?.blocks?.map((b) => b.kind)).toEqual(["drawn", "title"]);
    expect(saved.designApproved).toMatchObject({ by: "editor" });
  });
});

describe("page reviews", () => {
  it("are kept in the page's own folder, in order", async () => {
    await appendReview(ctx(), "issue-a", 1, { at: "1", verdict: "keep", total: 92 });
    await appendReview(ctx(), "issue-a", 1, { at: "2", verdict: "tweak", note: "figure in ink", world: "survey map" });
    const all = await readReviews(ctx(), "issue-a", 1);
    expect(all.map((r) => r.verdict)).toEqual(["keep", "tweak"]);
    expect(await readFile(join(root, "Magazine", "issues", "issue-a", "pages", "01", "reviews.jsonl"), "utf-8")).toMatch(/figure in ink/);
  });
});

describe("taste per world", () => {
  const ev = (i: number, world: string): TasteEvent => ({
    id: `e${i}`, at: String(i), ref: { type: "publication", id: `issue-${i % 2}`, unit: 1 },
    surface: "design", verdict: "redo", cause: ["hierarchy"], source: "design", scope: { world },
  });

  it("proposes a cause pressed often on one world as that world's rule", () => {
    const out = causeProposals([1, 2, 3, 4, 5].map((i) => ev(i, "survey map")), []);
    expect(out).toHaveLength(1);
    expect(out[0]!.scope).toEqual({ surface: "design", world: "survey map" });
    expect(out[0]!.text).toMatch(/One dominant per page/);
  });

  it("applies a world's rule to that world only", () => {
    const rule = { scope: { surface: "design", world: "survey map" } };
    expect(applies(rule, { type: "publication", id: "x", surface: "design", world: "survey map" })).toBe(true);
    expect(applies(rule, { type: "publication", id: "x", surface: "design", world: "linocut" })).toBe(false);
    expect(applies(rule, { type: "publication", id: "x", surface: "design" })).toBe(false);
  });
});
