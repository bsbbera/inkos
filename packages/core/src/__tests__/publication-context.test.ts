import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findIssue, listIssueIds, openIssueContext } from "../pipeline/publication-context.js";

let root: string;

// The builtin "magazine" definition is what the workspace actually uses, and
// its outDir is what decides where issues are looked for — so the fixture is
// built where a real one lives rather than somewhere invented.
const OUT_DIR = "Magazine";

const writeIssue = async (id: string, issue: Record<string, unknown>) => {
  const dir = join(root, OUT_DIR, "issues", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "publication.json"), JSON.stringify({ id, type: "magazine", ...issue }));
  return dir;
};

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pubctx-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("reaching an issue that already exists", () => {
  it("finds an issue and where it lives", async () => {
    const dir = await writeIssue("issue-a", { subject: "Photography" });
    const found = await findIssue(root, "issue-a");
    expect(found?.issue.subject).toBe("Photography");
    expect(found?.dir).toBe(dir);
  });

  it("returns nothing for an id that is not there", async () => {
    expect(await findIssue(root, "nope")).toBeUndefined();
  });

  it("lists what the workspace holds", async () => {
    await writeIssue("issue-a", {});
    await writeIssue("issue-b", {});
    expect((await listIssueIds(root)).sort()).toEqual(["issue-a", "issue-b"]);
  });

  // The whole point: an id alone is enough to reconstruct a runner context, so
  // art, layout, render and build stop being reachable only from the call that
  // created the publication.
  it("builds a context from an id alone", async () => {
    await writeIssue("issue-a", { subject: "Photography" });
    const { ctx, issue } = await openIssueContext(root, "issue-a");
    expect(issue.subject).toBe("Photography");
    expect(ctx.projectRoot).toBe(root);
    expect(ctx.definition.id).toBe("magazine");
    expect(ctx.shimUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  // A wrong id is the most likely mistake a model makes here, so the error has
  // to carry the answer rather than only the complaint.
  it("names the issues it does have when the id is wrong", async () => {
    await writeIssue("issue-a", {});
    await expect(openIssueContext(root, "typo")).rejects.toThrow(/no publication issue "typo"[\s\S]*issue-a/);
  });

  it("says so plainly when the workspace has none", async () => {
    await expect(openIssueContext(root, "any")).rejects.toThrow(/has none yet/);
  });

  it("explains an issue whose type is no longer installed", async () => {
    const dir = join(root, OUT_DIR, "issues", "orphan");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "publication.json"), JSON.stringify({ id: "orphan", type: "gone-away" }));
    await expect(openIssueContext(root, "orphan")).rejects.toThrow(/no longer installed/);
  });

  // Most operations on an existing issue are deterministic and never call the
  // model. One that tries without being given an ask should say that, not fail
  // somewhere further in.
  it("refuses to call the model when no ask was supplied", async () => {
    await writeIssue("issue-a", {});
    const { ctx } = await openIssueContext(root, "issue-a");
    await expect(ctx.ask("anything", "plan"))
      .rejects.toThrow(/plan: this operation does not call the model/);
  });

  it("uses the ask it was given when there is one", async () => {
    await writeIssue("issue-a", {});
    const { ctx } = await openIssueContext(root, "issue-a", {
      ask: async () => ({ answered: true }),
    });
    await expect(ctx.ask("anything", "plan")).resolves.toEqual({ answered: true });
  });
});
