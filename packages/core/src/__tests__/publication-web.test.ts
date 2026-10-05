import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approve, createIssue, readIssue, readWeb, run, type PublicationIssue, type RunnerContext,
} from "../pipeline/publication-runner.js";
import { loadPipeline } from "../pipeline/orchestrator.js";
import { connectionFindings } from "../pipeline/magazine-bar.js";
import { findPublicationDefinition } from "../publications/registry.js";

/**
 * The magazine on the shared pipeline, with the connection web (13 rev. B, C).
 *
 * A scripted model plans four pages tied together by bridges and a thread,
 * writes them, and the audit reads the copy for the promises the plan made.
 * Every model call goes through `ask`, so the prompts the stages actually sent
 * are on record and can be checked for the web.
 */

const WEB = {
  centre: "Indigo",
  question: "How did a green leaf make the world blue?",
  rings: ["origin", "people", "you"],
  nodes: [
    { id: "n1", ring: "origin", fact: "6,000-year-old indigo cloth was found in Peru.", source: "https://a.example/peru" },
    { id: "n2", ring: "people", fact: "Champaran farmers refused to grow indigo.", source: "https://a.example/champaran" },
    { id: "n3", ring: "you", fact: "Denim is dyed with indigo.", source: "https://a.example/denim" },
    { id: "n4", ring: "origin", fact: "No source for this one." },
  ],
  links: [
    { from: "n1", to: "n2", why: "the same plant fed a protest", cue: "Champaran" },
    { from: "n1", to: "n9", why: "a node that does not exist" },
  ],
  threads: [{ name: "the vat", cue: ["vat"] }],
  wonder: { text: "Green cloth turns blue in the air.", cue: ["turns blue"] },
  accent: { name: "indigo", hex: "#2B3A67" },
  motif: "stitching",
};

const PLAN = {
  sections: [{ n: 1, label: "journey", question: WEB.question, colour: "indigo", from: 1, to: 4 }],
  pages: [
    { n: 1, title: "Before blue had a name", type: "feature", density: "M", section: 1, pillar: "origin",
      premise: "Where indigo began.", ring: "origin", threads: ["the vat", "made-up thread"],
      links: [{ to: 3, why: "the same plant fed a protest", cue: "Champaran" }] },
    { n: 2, title: "The map", type: "map", density: "D", section: 1, pillar: "none", premise: "The web.", ring: "" },
    { n: 3, title: "Refusing the blue", type: "feature", density: "M", section: 1, pillar: "today",
      premise: "The farmers who said no.", ring: "people", threads: ["the vat"],
      links: [{ to: 1, why: "the plant from page 1", cue: "Peru" }] },
    { n: 4, title: "Your jeans", type: "in-your-hands", density: "M", section: 1, pillar: "today",
      premise: "Where you meet indigo.", ring: "you", threads: ["the vat"] },
  ],
};

/** Page copy: page 1 builds its bridge, page 3 forgets its own, page 4 answers. */
const COPY: Record<number, string> = {
  1: "The cloth from Peru sat in a vat of leaves. Later, in Champaran, farmers would refuse the same plant.",
  2: "Follow any line.",
  3: "They would not plant it. The vat stood empty that year.",
  4: "Look down at your jeans. A green leaf made the world blue, and the vat is still working.",
};

async function setUp() {
  const projectRoot = await mkdtemp(join(tmpdir(), "pub-web-"));
  const found = await findPublicationDefinition(projectRoot, "magazine");
  if (!found) throw new Error("magazine definition missing");
  // No fact-check: it searches the web, and this is about the run, not the check.
  const definition = { ...found, needsFactCheck: false };
  const prompts: Record<string, string> = {};
  const ctx: RunnerContext = {
    projectRoot,
    definition,
    ask: async (prompt, tag) => {
      prompts[tag] = prompt;
      if (tag === "plan") return PLAN;
      const page = /^page-(\d+)$/.exec(tag);
      if (page) return { title: "", deck: "", body: COPY[Number(page[1])] ?? "", image_prompts: [], sources: [] };
      const revise = /^revise-(\d+)$/.exec(tag);
      if (revise) return { body: COPY[Number(revise[1])] ?? "" };
      return { findings: [] };
    },
  };
  const { id } = await createIssue(ctx, { subject: "indigo", angle: "a colour's journey", extent: 4 });
  // Research is a web search; stand in for it with a finished one and its web.
  const file = join(projectRoot, "Magazine", "issues", id, "publication.json");
  const issue = JSON.parse(await readFile(file, "utf-8")) as PublicationIssue;
  issue.research = { pillars: {} };
  issue.web = readWeb(WEB);
  await writeFile(file, JSON.stringify(issue), "utf-8");
  return { ctx, id, prompts, projectRoot };
}

describe("the connection web", () => {
  it("keeps only sourced facts and links between facts that exist", () => {
    const web = readWeb(WEB)!;
    expect(web.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(web.links).toHaveLength(1);
    expect(web.accent?.hex).toBe("#2B3A67");
    expect(readWeb({ nodes: [] })).toBeNull();
  });
});

describe("an issue on the shared pipeline", () => {
  it("plans on the web, writes the bridges into the prompts, and audits the promises", async () => {
    const { ctx, id, prompts, projectRoot } = await setUp();
    await run(ctx, id, { from: "plan", stopAt: "audit" });

    // The plan was asked with the web, and kept its links and only real threads.
    expect(prompts.plan).toContain("CENTRE: Indigo");
    expect(prompts.plan).toContain("Champaran");
    const issue = await readIssue(ctx, id);
    expect(issue.pages[0]!.links).toEqual([{ to: 3, why: "the same plant fed a protest", cue: "Champaran" }]);
    expect(issue.pages[0]!.threads).toEqual(["the vat"]);
    expect(issue.pages[0]!.ring).toBe("origin");

    // Each writer was handed its bridges, threads and signature brief.
    expect(prompts["page-1"]).toContain("BRIDGES THIS PAGE MUST BUILD");
    expect(prompts["page-1"]).toContain("Champaran");
    expect(prompts["page-1"]).toContain("THREADS THIS PAGE CARRIES — let them surface, never as a list: the vat (vat)");
    expect(prompts["page-2"]).toContain("THIS IS THE MAP");
    expect(prompts["page-4"]).toContain("THIS IS IN YOUR HANDS");
    // The brand book is read from above every series.
    expect(prompts["page-1"]).not.toContain("register of OYLA");

    // The audit read the copy for the plan's promises: page 3 never wrote its
    // bridge back to Peru, and nothing else broke one.
    const bridges = (issue.audit?.findings ?? []).filter((f) => f.category === "connection/bridge");
    expect(bridges.map((f) => f.page)).toEqual([3]);
    expect((issue.audit?.findings ?? []).some((f) => f.category === "connection/thread")).toBe(false);
    expect((issue.audit?.findings ?? []).some((f) => f.category === "connection/ending")).toBe(false);

    // One account of the run: the shared run file walked past the content gate.
    const state = await loadPipeline(projectRoot, { type: "publication", id });
    expect(state?.stage).toBe("design.artplan");
    expect(state?.gates.content?.state).toBe("waiting");

    // Approving the copy signs the same gate in the run file.
    await approve(ctx, id);
    expect((await loadPipeline(projectRoot, { type: "publication", id }))?.gates.content?.state).toBe("approved");
  });

  it("walks back to an earlier stage when asked to do it again", async () => {
    const { ctx, id, prompts, projectRoot } = await setUp();
    await run(ctx, id, { from: "plan", stopAt: "audit" });
    delete prompts.plan;
    await run(ctx, id, { from: "plan", stopAt: "plan" });
    expect(prompts.plan).toBeDefined();
    const state = await loadPipeline(projectRoot, { type: "publication", id });
    expect(state?.history.some((h) => h.event === "stage:rewound")).toBe(true);
  });

  it("reads a brand book above the series", async () => {
    const { ctx, id, prompts, projectRoot } = await setUp();
    await mkdir(join(projectRoot, "Magazine"), { recursive: true });
    await writeFile(join(projectRoot, "Magazine", "house_style.md"), "One thing. Every connection.", "utf-8");
    await run(ctx, id, { from: "plan", stopAt: "write" });
    expect(prompts["page-1"]).toContain("## house_style.md");
    expect(prompts["page-1"]).toContain("One thing. Every connection.");
  });
});

describe("a closing page outside every section", () => {
  // The live indigo plan put in-your-hands on p15 with sections ending at p14:
  // it is still the closing page, and it still answers the question.
  it("counts as the closing page and as the ending", async () => {
    const { checkPlan } = await import("../pipeline/publication-runner.js");
    const found = await findPublicationDefinition(await mkdtemp(join(tmpdir(), "pub-close-")), "magazine");
    const pages = [
      { n: 1, type: "feature", section: 1, body: "x" },
      { n: 2, type: "in-your-hands", section: 0, body: "A green leaf made the world blue in your jeans." },
      { n: 3, type: "cover", section: 0, body: "" },
    ].map((p) => ({ title: "", density: "M", pillar: "", premise: "", ...p }));
    const issue = { extent: 3, sections: [{ n: 1, from: 1, to: 1 }], pages } as unknown as PublicationIssue;
    expect(checkPlan(found!, issue).some((w) => w.includes("last page before the back cover"))).toBe(false);
    const findings = connectionFindings({ web: readWeb(WEB)!, sections: issue.sections, pages: issue.pages });
    expect(findings.some((f) => f.category === "connection/ending")).toBe(false);
  });
});

describe("the planning stays backstage", () => {
  // Written on the live indigo run's imprint page.
  it("flags copy that names the web to the reader", () => {
    const findings = connectionFindings({
      sections: [],
      pages: [{
        n: 3, title: "", type: "data", density: "M", section: 0, pillar: "", premise: "",
        body: "It anchors the opening node of the connection web on page 8.",
      }],
    });
    expect(findings.map((f) => f.category)).toEqual(["connection/machinery"]);
  });
});

describe("connection findings", () => {
  it("flags a thread that surfaces too rarely and an ending that never answers", () => {
    const web = readWeb(WEB)!;
    const findings = connectionFindings({
      web,
      sections: [{ n: 1, from: 1, to: 2 }],
      pages: [
        { n: 1, title: "", type: "feature", density: "M", section: 1, pillar: "", premise: "", body: "A vat." },
        { n: 2, title: "", type: "feature", density: "M", section: 1, pillar: "", premise: "", body: "Nothing here." },
      ],
    });
    expect(findings.map((f) => f.category).sort())
      .toEqual(["connection/ending", "connection/thread", "connection/wonder"]);
  });
});
