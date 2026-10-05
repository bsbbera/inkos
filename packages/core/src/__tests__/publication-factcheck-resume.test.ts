import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fact-check needs a search source; the machine running the tests has none.
vi.mock("../pipeline/publication-research.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pipeline/publication-research.js")>()),
  allSearchSources: async () => [{
    id: "fake",
    kind: "key",
    run: async (query: string) => [{ title: "hit", url: `https://example.org/${query.length}`, snippet: query }],
  }],
}));

const { coverTitle, readIssue, runFactCheck, writePage } = await import("../pipeline/publication-runner.js");
const { worthChecking } = await import("../pipeline/fact-check.js");
import type { PublicationIssue, RunnerContext } from "../pipeline/publication-runner.js";
import type { PublicationDefinition } from "../publications/types.js";

const definition = {
  id: "magazine",
  label: "magazine",
  outDir: "Magazine",
  densities: { heavy: [1, 400] },
  defaultDensity: "heavy",
  blocks: {},
  rules: {},
  prompts: { page: "{{pageTitle}}" },
  needsImages: false,
  needsPdf: false,
  needsFactCheck: true,
  factCheckSkipTypes: ["plate"],
} as unknown as PublicationDefinition;

let root: string;
const dir = () => join(root, "Magazine", "issues", "issue-a");

const page = (n: number, over: Record<string, unknown> = {}) => ({
  n, title: `Page ${n}`, type: "feature", density: "heavy", section: 1,
  pillar: "chemistry", premise: `premise ${n}`, body: `In 1871 Richard Maddox wrote page ${n}.`, ...over,
});

const seed = async (pages: unknown[]) => {
  await mkdir(dir(), { recursive: true });
  await writeFile(join(dir(), "publication.json"), JSON.stringify({
    id: "issue-a", type: "magazine", series: "s", subject: "Photography", angle: "a",
    title: "Light Touched", thesis: "t", extent: pages.length, status: "writing",
    createdAt: "now", research: null,
    sections: [{ n: 1, label: "one", question: "q", colour: "silver", from: 1, to: pages.length }],
    pages,
  }), "utf-8");
};

/** Answers both fact-check prompts, and records which pages were asked about. */
const asker = (failOn?: string) => {
  const asked: string[] = [];
  const ask = async (_prompt: string, label: string) => {
    asked.push(label);
    if (label === failOn) throw new Error("model returned no JSON");
    if (label.startsWith("factcheck:extract")) return { claims: [{ claim: `claim of ${label}` }] };
    return { verdicts: [{ n: 1, verdict: "supported", note: "fine", sources: [] }] };
  };
  return { asked, ask };
};

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pubfc-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("fact-check keeps its place", () => {
  it("saves each page as it goes, so a failure keeps the pages before it", async () => {
    await seed([page(1), page(2), page(3)]);
    const first = asker("factcheck:extract:p3");
    await expect(runFactCheck({ projectRoot: root, definition, ask: first.ask }, "issue-a")).rejects.toThrow();

    const kept = (await readIssue({ projectRoot: root, definition, ask: first.ask }, "issue-a")).factCheck!;
    expect(kept.complete).toBe(false);
    expect(Object.keys(kept.pages ?? {})).toEqual(["1", "2"]);
    expect(kept.findings.map((f) => f.where)).toEqual(["p1", "p2"]);

    // The next run starts at page 3, not page 1.
    const second = asker();
    const done = (await runFactCheck({ projectRoot: root, definition, ask: second.ask }, "issue-a")).factCheck!;
    expect(second.asked).toEqual(["factcheck:extract:p3", "factcheck:verify:p3"]);
    expect(done.complete).toBe(true);
    expect(done.checked).toBe(3);
    expect(done.findings.map((f) => f.where)).toEqual(["p1", "p2", "p3"]);
  });

  it("checks an edited page again, and only that page", async () => {
    await seed([page(1), page(2)]);
    await runFactCheck({ projectRoot: root, definition, ask: asker().ask }, "issue-a");
    const file = join(dir(), "publication.json");
    const issue = JSON.parse(await readFile(file, "utf-8")) as PublicationIssue;
    issue.pages[1]!.body = "In 1888 George Eastman sold the Kodak.";
    await writeFile(file, JSON.stringify(issue), "utf-8");

    const again = asker();
    await runFactCheck({ projectRoot: root, definition, ask: again.ask }, "issue-a");
    expect(again.asked).toEqual(["factcheck:extract:p2", "factcheck:verify:p2"]);
  });

  it("makes no model call for a page with nothing a search could settle", async () => {
    await seed([
      page(1, { type: "plate", body: "" }),
      page(2, { type: "plate", body: "Set in 1900, but a plate all the same." }),
      page(3, { body: "the light was soft and the room was quiet." }),
      page(4),
    ]);
    const run = asker();
    const result = (await runFactCheck({ projectRoot: root, definition, ask: run.ask }, "issue-a")).factCheck!;
    expect(run.asked).toEqual(["factcheck:extract:p4", "factcheck:verify:p4"]);
    expect(result.complete).toBe(true);
    expect(Object.keys(result.pages ?? {})).toEqual(["1", "2", "3", "4"]);
  });
});

describe("worthChecking", () => {
  it("wants a figure, a quotation or a name", () => {
    expect(worthChecking("It took 8 hours.")).toBe(true);
    expect(worthChecking("He called it “the latent image” at last.")).toBe(true);
    expect(worthChecking("the plate was coated by Maddox himself.")).toBe(true);
    expect(worthChecking("The light was soft. The room was quiet.")).toBe(false);
  });
});

describe("a written page keeps its picture briefs", () => {
  // The prompt asks for `image_prompts`; the writer read only `image_prompt`,
  // and a 50-page issue reached the art stage with no briefs at all.
  it("stores every brief the page asked for", async () => {
    await seed([page(1, { body: null, briefs: [] })]);
    const ctx: RunnerContext = {
      projectRoot: root, definition,
      ask: async () => ({
        title: "Latent", body: "Four atoms decide.",
        image_prompts: [
          { prompt: "a darkroom lit amber", orientation: "portrait", role: "hero" },
          { prompt: "a crystal under a microscope", orientation: "square", role: "inset" },
        ],
      }),
    };
    await writePage(ctx, "issue-a", 1);
    const written = (await readIssue(ctx, "issue-a")).pages[0]!;
    expect(written.briefs?.map((b) => b.role)).toEqual(["hero", "inset"]);
  });
});

describe("coverTitle", () => {
  it("keeps the cover line and drops the subtitle", () => {
    expect(coverTitle("The Latent Surface: Photochemical Mechanics, Industrial Scale, and the Living Craft of Film"))
      .toBe("The Latent Surface");
    expect(coverTitle("Silver Memory — how film remembers")).toBe("Silver Memory");
    expect(coverTitle("Half-Life - a story")).toBe("Half-Life");
    expect(coverTitle("The Hidden Mathematics of Kolam")).toBe("The Hidden Mathematics of Kolam");
  });
});
