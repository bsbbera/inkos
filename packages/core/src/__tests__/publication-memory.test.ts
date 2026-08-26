import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicationMemory, isPageWritten } from "../pipeline/publication-memory.js";
import { validateIssue } from "../pipeline/publication-schema.js";
import { readIssue, writePage, type RunnerContext, type PublicationIssue } from "../pipeline/publication-runner.js";
import type { PublicationDefinition } from "../publications/types.js";

const definition = {
  id: "magazine",
  label: "magazine",
  outDir: "Magazine",
  densities: { heavy: [10, 400] },
  defaultDensity: "heavy",
  blocks: {},
  rules: {},
  prompts: { page: "{{takenBlock}}||{{pageResearch}}" },
  needsImages: false,
  needsPdf: false,
} as unknown as PublicationDefinition;

let root: string;
const dir = () => join(root, "Magazine", "issues", "issue-a");
const file = () => join(dir(), "publication.json");

const page = (n: number, over: Record<string, unknown> = {}) => ({
  n, title: `Page ${n}`, type: "feature", density: "heavy", section: 1,
  pillar: n % 2 ? "chemistry" : "optics", premise: `premise ${n}`,
  body: `Body of page ${n}.`, ...over,
});

const base = (over: Partial<PublicationIssue> = {}): PublicationIssue => ({
  id: "issue-a", type: "magazine", series: "s", subject: "Photography", angle: "a",
  title: "Light Touched", thesis: "A photograph is a chemical memory.", extent: 2,
  status: "writing", createdAt: "now", research: null,
  sections: [{ n: 1, label: "one", question: "How does film remember?", colour: "silver", from: 1, to: 2 }],
  pages: [page(1)],
  ...over,
} as PublicationIssue);

const seed = async (issue: PublicationIssue) => {
  await mkdir(dir(), { recursive: true });
  await writeFile(file(), JSON.stringify(issue), "utf-8");
};

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pubmem-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("what an issue remembers", () => {
  const withMemory = <T>(issue: PublicationIssue, fn: (m: PublicationMemory) => T): T => {
    const memory = new PublicationMemory(dir());
    try { memory.record(issue); return fn(memory); } finally { memory.close(); }
  };

  it("recalls the page that shares a subject, not the page that is merely nearby", async () => {
    await mkdir(dir(), { recursive: true });
    const issue = base({
      pages: [
        page(1, { body: "Silver bromide crystals hold a latent image until development." }),
        page(2, { body: "A darkroom safelight is amber because the emulsion is blind to it." }),
        page(3, { body: "Silver halide grains vary in size across a single emulsion batch." }),
        page(4, { body: null }),
      ] as never,
    });
    const hits = withMemory(issue, (m) => m.pages("silver halide emulsion grains", 3));
    expect(hits.map((h) => h.n)).toContain(1);
    // p4 is unwritten, so it was never indexed; p3 was the excluded page.
    expect(hits.map((h) => h.n)).not.toContain(4);
    expect(hits.map((h) => h.n)).not.toContain(3);
  });

  it("recalls research findings across pillars, by what the page is about", async () => {
    await mkdir(dir(), { recursive: true });
    const issue = base({
      research: {
        title: "t", thesis: "t", searchedWith: "test", searchedAt: "now",
        pillars: {
          chemistry: { pillar: "chemistry", queries: [], sources: [], findings: [
            { claim: "Four silver atoms make a developable latent image speck.", kind: "fact", sourceUrl: "u1", sourceTitle: "Mees" },
          ] },
          optics: { pillar: "optics", queries: [], sources: [], findings: [
            { claim: "A Petzval lens is fast and swirls the background.", kind: "fact", sourceUrl: "u2", sourceTitle: "Kingslake" },
          ] },
        },
      } as never,
    });
    const found = withMemory(issue, (m) => m.findings("latent image silver atoms"));
    expect(found[0]?.sourceTitle).toBe("Mees");
    expect(found[0]?.claim).toContain("Four silver atoms");
  });

  // Both issues in the workspace store research the old way, so an index that
  // only reads the new shape would give the only real data no research at all.
  it("recalls findings from research stored the way older issues stored it", async () => {
    await mkdir(dir(), { recursive: true });
    const issue = base({
      research: {
        origin: [{
          fact: "A pewter plate coated in bitumen of Judea held the first surviving photograph.",
          who: "Joseph Nicephore Niepce",
          when: "1827, at Le Gras",
          why_it_matters: "It is the oldest image light made by itself.",
        }],
        today: [{ fact: "A phone sensor counts photons directly.", who: "Sony", when: "2015" }],
      } as never,
    });
    const found = withMemory(issue, (m) => m.findings("bitumen pewter plate first photograph"));
    expect(found[0]?.claim).toContain("bitumen of Judea");
    expect(found[0]?.sourceTitle).toBe("Joseph Nicephore Niepce, 1827, at Le Gras");
  });

  // The index is a projection. Deleting it must cost nothing but a rebuild.
  it("rebuilds itself from the issue", async () => {
    await mkdir(dir(), { recursive: true });
    const issue = base({ pages: [page(1, { body: "Silver bromide remembers." })] as never });
    withMemory(issue, () => undefined);
    await rm(join(dir(), "memory.db"), { force: true });
    expect(withMemory(issue, (m) => m.pages("silver bromide", 9)).length).toBe(1);
  });
});

// The sidebar and the detail page disagreed on screen: 16/16 in one place and
// 12/16 in the other. A plate page is written when its body is empty, because
// an empty body is what a plate is.
describe("one predicate for a written page", () => {
  it("counts an empty body as written and a missing one as not", () => {
    expect(isPageWritten(page(1, { body: "" }) as never)).toBe(true);
    expect(isPageWritten(page(1, { body: null }) as never)).toBe(false);
    expect(isPageWritten(page(1) as never)).toBe(true);
  });
});

describe("an issue is checked before it is written", () => {
  it("names the field and the page when the shape is wrong", () => {
    expect(() => validateIssue(base({ pages: [page(1, { n: "one" })] as never }), "issue-a"))
      .toThrow(/pages\.0\.n/);
  });

  it("refuses two pages with the same number", () => {
    expect(() => validateIssue(base({ pages: [page(1), page(1)] as never }), "issue-a"))
      .toThrow(/two pages numbered 1/);
  });

  // A real issue in the workspace predates `type`, a section's `question` and
  // `colour`, and a page's `premise`. The first version of this schema required
  // all four and refused to load it. A check that rejects the user's own back
  // catalogue is data loss with a good error message.
  it("loads an issue made before half its fields existed", () => {
    const old = {
      id: "indian-culture-everyday-rituals", series: "s", subject: "x", angle: "a",
      title: "Everyday Rituals", thesis: "t", extent: 16, status: "done", createdAt: "then",
      sections: [{ n: 1, label: "Food", from: 7, to: 8 }],
      pages: [{
        n: 1, title: "p", type: "feature", section: 1, body: "words",
        density: null, pillar: null, furniture: ["a bare string, not a block"],
      }],
    };
    expect(validateIssue(old, "old").id).toBe("indian-culture-everyday-rituals");
  });

  it("keeps fields it does not know about", () => {
    const issue = validateIssue(base({ somethingNewer: 42 } as never), "issue-a");
    expect((issue as unknown as { somethingNewer: number }).somethingNewer).toBe(42);
  });

  it("reads a good issue back", async () => {
    await seed(base());
    const ctx = { projectRoot: root, definition, ask: async () => ({}) } as RunnerContext;
    expect((await readIssue(ctx, "issue-a")).title).toBe("Light Touched");
  });

  it("refuses to read an issue that is not one", async () => {
    await mkdir(dir(), { recursive: true });
    await writeFile(file(), JSON.stringify({ id: "issue-a" }), "utf-8");
    const ctx = { projectRoot: root, definition, ask: async () => ({}) } as RunnerContext;
    await expect(readIssue(ctx, "issue-a")).rejects.toThrow(/not a valid publication/);
  });
});

describe("a write that fails leaves the last good issue alone", () => {
  it("renames into place rather than writing over the file", async () => {
    await seed(base());
    const ctx: RunnerContext = {
      projectRoot: root, definition,
      ask: async () => ({ title: "Latent", body: "Four atoms decide." }),
    };
    await writePage(ctx, "issue-a", 1);

    // No temp file survives a successful write, and the issue parses.
    const left = (await readdir(dir())).filter((f) => f.endsWith(".tmp"));
    expect(left).toEqual([]);
    expect(JSON.parse(await readFile(file(), "utf-8")).pages[0].body).toBe("Four atoms decide.");
  });
});
