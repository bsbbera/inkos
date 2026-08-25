import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, runDeslop, type RunnerContext, type PublicationIssue } from "../pipeline/publication-runner.js";
import type { PublicationDefinition } from "../publications/types.js";

const definition = {
  id: "magazine",
  label: "magazine",
  outDir: "Magazine",
  densities: { heavy: [10, 400] },
  defaultDensity: "heavy",
  blocks: {},
  rules: {},
  needsImages: false,
  needsPdf: false,
} as unknown as PublicationDefinition;

let root: string;
let asked: string[];

/** A body long enough to clear the band and varied enough to clear the rules. */
const BODY = [
  "A grain of silver bromide is struck by a photon and never forgets it.",
  "",
  "The crystal holds a few atoms of metallic silver now. Four is enough. Below four the trace decays before the developer arrives, and the picture that was there is simply not.",
  "",
  "Nobody saw this happen. It was inferred, decades later, from what would and would not develop.",
].join("\n");

const issueFile = () => join(root, "Magazine", "issues", "issue-a", "publication.json");

const seed = async (over: Record<string, unknown> = {}) => {
  await mkdir(join(root, "Magazine", "issues", "issue-a"), { recursive: true });
  const issue: PublicationIssue = {
    id: "issue-a", type: "magazine", series: "s", subject: "Photography", angle: "a",
    title: "Light Touched", thesis: "A photograph is a chemical memory.", extent: 2,
    status: "writing", createdAt: "now", research: {},
    sections: [{ n: 1, label: "one", question: "How does film remember?", colour: "silver", from: 1, to: 2 }],
    pages: [{
      n: 1, title: "Latent", type: "feature", density: "heavy", section: 1,
      pillar: "chemistry", premise: "Silver halide remembers a photon.", body: BODY,
    }],
    ...over,
  } as PublicationIssue;
  await writeFile(issueFile(), JSON.stringify(issue), "utf-8");
};

const read = async (): Promise<PublicationIssue> =>
  JSON.parse(await readFile(issueFile(), "utf-8"));

/** A model that faults the page once, then finds it clean. */
const ctxWith = (reply: (tag: string, n: number) => Record<string, unknown>): RunnerContext => {
  let calls = 0;
  return {
    projectRoot: root,
    definition,
    ask: async (_prompt, tag) => {
      asked.push(tag);
      return reply(tag, calls++);
    },
  };
};

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pubrev-")); asked = []; });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const faultThenClean = (fixed = "The developer arrives, or it does not, and four atoms decide which.") => {
  let audits = 0;
  return (tag: string): Record<string, unknown> => {
    if (tag.startsWith("audit-")) {
      audits += 1;
      return audits === 1
        ? { findings: [{ dimension: 7, severity: "warning", description: "the date is invented", suggestion: "Cut it." }] }
        : { findings: [] };
    }
    return { title: "Latent", deck: "d", body: fixed, pull_quote: "", furniture: [], image_prompt: "silver" };
  };
};

describe("the audit fixes what it finds", () => {
  it("audits, revises the page, and audits again", async () => {
    await seed();
    const issue = await runAudit(ctxWith(faultThenClean()), "issue-a");

    expect(asked.filter((t) => t.startsWith("audit-"))).toHaveLength(2);
    expect(asked).toContain("revise-1");
    expect(issue.audit?.rounds).toBe(1);
    expect(issue.audit?.findings).toEqual([]);
    expect((await read()).pages[0].body).toContain("four atoms decide");
  });

  it("writes the revised page back to its markdown, not only its JSON", async () => {
    await seed();
    await runAudit(ctxWith(faultThenClean()), "issue-a");
    const md = await readFile(join(root, "Magazine", "issues", "issue-a", "pages", "01-latent.md"), "utf-8");
    expect(md).toContain("four atoms decide");
  });

  // Approval is of specific copy. A revise pass that keeps the sign-off would
  // let a build ship prose nobody signed off on.
  it("clears the copy approval when it rewrites a page", async () => {
    await seed({ approved: { at: "yesterday", by: "editor" } });
    await runAudit(ctxWith(faultThenClean()), "issue-a");
    expect((await read()).approved).toBeNull();
  });

  it("stops after the round budget rather than rewriting forever", async () => {
    await seed();
    let n = 0;
    const issue = await runAudit(ctxWith((tag) => tag.startsWith("audit-")
      ? { findings: [{ dimension: 7, severity: "warning", description: "still wrong", suggestion: "again" }] }
      : { body: `${BODY}\n\nAttempt ${++n} at saying it differently.` }), "issue-a", { rounds: 2 });

    expect(issue.audit?.rounds).toBe(2);
    expect(asked.filter((t) => t === "revise-1")).toHaveLength(2);
    expect(issue.audit?.findings.length).toBeGreaterThan(0);
  });

  // A page rewritten to the same words is a model that has nothing left to
  // give; another round costs a call and changes nothing.
  it("gives up when a revise changes nothing", async () => {
    await seed();
    const issue = await runAudit(ctxWith((tag) => tag.startsWith("audit-")
      ? { findings: [{ dimension: 7, severity: "warning", description: "still wrong", suggestion: "again" }] }
      : { body: BODY }), "issue-a", { rounds: 5 });
    expect(issue.audit?.rounds).toBe(1);
    expect(asked.filter((t) => t === "revise-1")).toHaveLength(1);
  });

  // Losing content is the one outcome a revise must not have. The first live
  // run returned no usable furniture for p2 and took three good blocks off the
  // page; an empty array is not an instruction to delete.
  it("keeps the blocks the page had when the revise returns none", async () => {
    await seed({
      pages: [{
        n: 1, title: "Latent", type: "feature", density: "heavy", section: 1,
        pillar: "chemistry", premise: "p", body: BODY,
        furniture: [{ kind: "stat", text: "0.01 megapixels" }],
      }],
    } as never);
    await runAudit(ctxWith(faultThenClean()), "issue-a", { rounds: 1 });
    expect((await read()).pages[0].furniture).toEqual([{ kind: "stat", text: "0.01 megapixels" }]);
  });

  it("reports without rewriting when asked not to revise", async () => {
    await seed();
    const issue = await runAudit(ctxWith(faultThenClean()), "issue-a", { revise: false });
    expect(asked).not.toContain("revise-1");
    expect(issue.audit?.findings).toHaveLength(1);
    expect(issue.audit?.rounds).toBe(0);
  });

  // Info is an editor's business. Rewriting a page over one risks the copy for
  // something nobody called wrong.
  it("does not rewrite over info-level findings", async () => {
    await seed();
    await runAudit(ctxWith(() => ({ findings: [{ dimension: 13, severity: "info", description: "a bit general", suggestion: "…" }] })), "issue-a");
    expect(asked).not.toContain("revise-1");
  });

  // One unreadable page must not throw away the audit of the others.
  it("records a page the model could not read instead of failing the run", async () => {
    await seed();
    const issue = await runAudit({
      projectRoot: root, definition,
      ask: async () => { throw new Error("429 rate limited"); },
    }, "issue-a", { rounds: 1 });
    expect(issue.audit?.findings.some((f) => f.category === "audit/unavailable")).toBe(true);
    expect(issue.audit?.findings.some((f) => f.description.includes("429"))).toBe(true);
  });

  it("runs the rules alone when the model is not wanted", async () => {
    await seed();
    const issue = await runAudit(ctxWith(() => ({})), "issue-a", { deep: false, revise: false });
    expect(asked).toEqual([]);
    expect(issue.audit).toBeTruthy();
  });
});

describe("de-AI-ification is the same loop with a filter", () => {
  it("rewrites a page over a prose tell", async () => {
    await seed();
    let audits = 0;
    await runDeslop(ctxWith((tag) => {
      if (!tag.startsWith("audit-")) return { body: `${BODY}\n\nA sentence with its own shape.` };
      return ++audits === 1
        ? { findings: [{ dimension: 28, severity: "warning", description: "the stock image again", suggestion: "Find another." }] }
        : { findings: [] };
    }), "issue-a");
    expect(asked).toContain("revise-1");
  });

  // The separation is the point: asked to de-slop, it must not quietly rewrite
  // the copy over a sourcing problem nobody raised.
  it("leaves a sourcing finding reported and untouched", async () => {
    await seed();
    const issue = await runDeslop(ctxWith(() => ({
      findings: [{ dimension: 7, severity: "warning", description: "the date is invented", suggestion: "Cut it." }],
    })), "issue-a");
    expect(asked).not.toContain("revise-1");
    expect(issue.audit?.findings).toHaveLength(1);
  });
});
