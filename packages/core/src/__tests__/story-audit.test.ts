import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isStorySlopFinding,
  runStoryAudit,
  runStoryDeslop,
  splitSections,
  storyAuditReport,
  type StoryAskFn,
} from "../pipeline/story-audit.js";

const STORY = `# The Tide Ledger

## Chapter 1

He felt very angry. The room seemed cold, perhaps colder than before.
However, things were not so simple.

## Chapter 2

She was very sad and tears fell. However, the ledger was still open.
Perhaps it had always been open.
`;

describe("splitSections", () => {
  it("splits on headings below the title", () => {
    const sections = splitSections(STORY);
    expect(sections.map((s) => s.heading)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(sections[0].body).toContain("He felt very angry");
  });

  it("keeps an unheaded file as one section rather than dropping it", () => {
    const sections = splitSections("Just prose, no headings at all.\n");
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("");
  });
});

describe("isStorySlopFinding", () => {
  const f = (category: string) => ({
    section: "", severity: "warning" as const, category, description: "d", suggestion: "s",
  });

  it("counts the rule-pass AI tells and the prose dimensions", () => {
    expect(isStorySlopFinding(f("ai-tell/hedge-density"))).toBe(true);
    expect(isStorySlopFinding(f("repetition/cross-chapter"))).toBe(true);
    expect(isStorySlopFinding(f("dim23/Sentence rhythm"))).toBe(true);
  });

  it("leaves the story dimensions alone — a plot hole is not slop", () => {
    expect(isStorySlopFinding(f("dim3/Causality"))).toBe(false);
    expect(isStorySlopFinding(f("dim17/Setup and payoff"))).toBe(false);
  });
});

describe("runStoryAudit", () => {
  let root: string;
  const path = "story.md";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "story-audit-"));
    await writeFile(join(root, path), STORY);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const noFindings: StoryAskFn = async () => ({ findings: [] });

  it("runs the rule pass without a model finding anything", async () => {
    const audit = await runStoryAudit({ projectRoot: root, path, ask: noFindings, revise: false });
    // "however" twice and "perhaps" twice is what the rule pass is for.
    expect(audit.findings.some((f) => f.category.startsWith("ai-tell/"))).toBe(true);
    expect(audit.rounds).toBe(0);
  });

  it("leaves the file untouched when asked only to report", async () => {
    const before = await readFile(join(root, path), "utf-8");
    await runStoryAudit({ projectRoot: root, path, ask: noFindings, revise: false });
    expect(await readFile(join(root, path), "utf-8")).toBe(before);
  });

  it("rewrites a faulted section and keeps the original beside it", async () => {
    // Fault chapter 1 on the first pass only, so the loop terminates.
    let audits = 0;
    const ask: StoryAskFn = async (_prompt, tag) => {
      if (tag.startsWith("story-revise")) return { body: "He crushed the teacup." };
      audits += 1;
      return audits <= 2
        ? { findings: [{ dimension: 11, severity: "warning", description: "names the feeling", suggestion: "show it" }] }
        : { findings: [] };
    };

    const audit = await runStoryAudit({ projectRoot: root, path, ask });
    const after = await readFile(join(root, path), "utf-8");
    expect(after).toContain("He crushed the teacup.");
    expect(audit.rounds).toBeGreaterThan(0);

    const kept = await readFile(join(root, "story.pre-audit.md"), "utf-8");
    expect(kept).toBe(STORY);
  });

  it("keeps the section when a rewrite comes back empty", async () => {
    const ask: StoryAskFn = async (_prompt, tag) =>
      tag.startsWith("story-revise")
        ? { body: "" }
        : { findings: [{ dimension: 11, severity: "warning", description: "d", suggestion: "s" }] };

    await runStoryAudit({ projectRoot: root, path, ask });
    expect(await readFile(join(root, path), "utf-8")).toContain("He felt very angry");
  });

  // The whole difference between the two passes: deslop rewrites the prose
  // findings and reports the story ones without touching them. Clean prose
  // here on purpose — the rule pass finds real AI tells in STORY, and those
  // are slop, so they would trigger a rewrite and hide what is being tested.
  it("deslop leaves a plot finding alone", async () => {
    await writeFile(
      join(root, path),
      "# Clean\n\n## One\n\nHe crushed the teacup. Water ran through his fingers.\n",
    );
    const revised: string[] = [];
    const ask: StoryAskFn = async (prompt, tag) => {
      if (tag.startsWith("story-revise")) {
        revised.push(prompt);
        return { body: "rewritten" };
      }
      return { findings: [{ dimension: 3, severity: "warning", description: "events merely happen", suggestion: "connect them" }] };
    };

    const audit = await runStoryDeslop({ projectRoot: root, path, ask });
    expect(revised).toHaveLength(0);
    expect(audit.rounds).toBe(0);
    expect(audit.findings.some((f) => f.category.startsWith("dim3/"))).toBe(true);
  });

  it("stops after two rounds rather than looping on a model that always finds something", async () => {
    const ask: StoryAskFn = async (_prompt, tag) =>
      tag.startsWith("story-revise")
        ? { body: "still not good enough" }
        : { findings: [{ dimension: 25, severity: "warning", description: "filler", suggestion: "cut" }] };

    const audit = await runStoryAudit({ projectRoot: root, path, ask });
    expect(audit.rounds).toBe(2);
  });

  it("reads back as something a person can act on", () => {
    expect(storyAuditReport({ at: "now", path, findings: [], rounds: 0 }))
      .toContain("nothing to fix");
  });
});
