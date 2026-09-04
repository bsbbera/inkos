import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildStoryAuditPrompt,
  isStorySlopFinding,
  parseStoryFindings,
  runStoryAudit,
  runStoryDeslop,
  reviseStoryFile,
  splitMachineTail,
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

describe("splitMachineTail", () => {
  const PAGE = `# Page

Prose that may be rewritten.

---
*visual brief 1:* A hand drawing a kolam at dawn.
`;

  it("separates a page's visual brief from its prose", () => {
    const { prose, tail } = splitMachineTail(PAGE);
    expect(prose).toContain("Prose that may be rewritten.");
    expect(prose).not.toContain("visual brief");
    expect(tail).toContain("A hand drawing a kolam at dawn.");
  });

  it("leaves a file with no brief entirely alone", () => {
    const plain = `# Story

Just prose.
`;
    const { prose, tail } = splitMachineTail(plain);
    expect(prose).toBe(plain);
    expect(tail).toBe("");
  });

  // A bare rule is ordinary punctuation. Cutting there would truncate the
  // writing rather than protect anything.
  it("does not cut at a horizontal rule that is only punctuation", () => {
    const { tail } = splitMachineTail(`# Story

One part.

---

Another part.
`);
    expect(tail).toBe("");
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

  // A revise pass runs for minutes and the panel beside it went on showing the
  // text the pass was replacing. There is no token stream to forward, but a
  // finished section is a real unit of progress.
  it("reports the document after each section it rewrites", async () => {
    let audits = 0;
    const ask: StoryAskFn = async (_prompt, tag) => {
      if (tag.startsWith("story-revise")) return { body: `rewritten ${tag}` };
      audits += 1;
      return audits <= 2
        ? { findings: [{ dimension: 11, severity: "warning", description: "d", suggestion: "s" }] }
        : { findings: [] };
    };

    const seen: string[] = [];
    await runStoryAudit({ projectRoot: root, path, ask, onText: (md) => seen.push(md) });

    expect(seen.length).toBeGreaterThan(1);
    // Each report is the whole document as it then stood, not a fragment.
    expect(seen[0]).toContain("# The Tide Ledger");
    // And it grows: the last one carries rewrites the first one did not.
    expect(seen.at(-1)!.match(/rewritten/g)!.length)
      .toBeGreaterThan(seen[0]!.match(/rewritten/g)!.length);
  });

  // The de-AI pass ate the visual brief off a real magazine page: the whole
  // file went to the model as prose and came back without the only description
  // of the picture that page is meant to carry.
  it("does not let a rewrite touch the visual brief", async () => {
    const page = `# Inside This Issue

However, perhaps the flour is not decoration. However, it feeds ants.

---
*visual brief 1:* A hand drawing a kolam at dawn.
`;
    await writeFile(join(root, path), page);

    let audits = 0;
    const ask: StoryAskFn = async (_prompt, tag) => {
      if (tag.startsWith("story-revise")) return { body: "The flour feeds ants." };
      audits += 1;
      return audits <= 2
        ? { findings: [{ dimension: 29, severity: "warning", description: "d", suggestion: "s" }] }
        : { findings: [] };
    };

    await runStoryAudit({ projectRoot: root, path, ask });
    const after = await readFile(join(root, path), "utf-8");
    expect(after).toContain("The flour feeds ants.");
    expect(after).toContain("*visual brief 1:* A hand drawing a kolam at dawn.");
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
    expect(storyAuditReport({ at: "now", path, findings: [], rounds: 0, located: [] }))
      .toContain("nothing to fix");
  });
});

describe("findings that know where they are", () => {
  it("asks for the quote and the replacement, and says what blocking means", () => {
    const prompt = buildStoryAuditPrompt({ heading: "One", body: "Some prose." }, 0, 1, "en");
    expect(prompt).toContain("QUOTE:");
    expect(prompt).toContain("FIX:");
    expect(prompt).toContain("contradicts something the piece has already");
  });

  it("keeps the quote and the fix the model returned", () => {
    const findings = parseStoryFindings({
      findings: [{
        dimension: 18, severity: "critical", title: "The limp changed legs",
        quote: "favoured his right leg", fix: "favoured his left leg",
        description: "Chapter 3 puts the weight on his left.",
        suggestion: "Match chapter 3.",
      }],
    }, "Chapter 9");
    expect(findings).toHaveLength(1);
    // `critical` is the continuity auditor's word for it; one vocabulary now.
    expect(findings[0].severity).toBe("blocking");
    expect(findings[0].quote).toBe("favoured his right leg");
    expect(findings[0].fix).toBe("favoured his left leg");
    expect(findings[0].title).toBe("The limp changed legs");
  });

  it("drops a fix with no quote, because it has nothing to stand in for", () => {
    const findings = parseStoryFindings({
      findings: [{ dimension: 1, fix: "write it better", description: "d", suggestion: "s" }],
    }, "");
    expect(findings[0].fix).toBeUndefined();
    expect(findings[0].quote).toBeUndefined();
  });
});

describe("runStoryAudit located findings", () => {
  let root = "";
  const path = "shorts/x/final/story.md";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "located-"));
    await writeFile(join(root, "story.md"), STORY, "utf-8");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("gives a quoted finding a span into the file and leaves an unquoted one unlocated", async () => {
    await writeFile(join(root, "story.md"), STORY, "utf-8");
    const ask: StoryAskFn = async (_p, tag) => tag.startsWith("story-audit")
      ? {
          findings: [
            { dimension: 18, severity: "warning", quote: "the ledger was still open",
              fix: "the ledger lay open", description: "d", suggestion: "s" },
            { dimension: 16, severity: "info", description: "Runs short.", suggestion: "s" },
          ],
        }
      : {};
    const audit = await runStoryAudit({ projectRoot: root, path: "story.md", ask, revise: false });

    const withSpan = audit.located.filter((f) => f.start >= 0);
    expect(withSpan.length).toBeGreaterThan(0);
    for (const f of withSpan) {
      expect(STORY.slice(f.start, f.end)).toBe(f.quote);
      expect(f.fix).toBe("the ledger lay open");
    }
    // The one that measured the whole section keeps its complaint and no span.
    expect(audit.located.some((f) => f.start === -1 && f.severity === "note")).toBe(true);
    // Every finding gets a stable id whether or not it could be located.
    expect(new Set(audit.located.map((f) => f.id)).size).toBe(audit.located.length);
  });
});

describe("reviseStoryFile", () => {
  let root: string;
  const path = "story.md";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "story-revise-"));
    await writeFile(join(root, path), STORY);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Echoes the note back as the new body, so the rewrite is visible. */
  const rewrites: StoryAskFn = async (prompt: string) => ({
    body: prompt.includes("Chapter 1") ? "Chapter one, redone." : "Chapter two, redone.",
  });

  it("carries an editor's note into every section and writes the file back", async () => {
    const out = await reviseStoryFile({
      projectRoot: root, path, ask: rewrites, note: "the openings are limp",
    });
    expect(out.changed).toBe(true);
    expect(out.sections).toBe(2);
    const after = await readFile(join(root, path), "utf-8");
    expect(after).toContain("redone");
    // The heading is the section's own; a rewrite replaces bodies, not structure.
    expect(after).toContain("## Chapter 1");
  });

  it("keeps the original beside it, so the same Restore puts it back", async () => {
    await reviseStoryFile({ projectRoot: root, path, ask: rewrites, note: "again" });
    const kept = await readFile(join(root, "story.pre-audit.md"), "utf-8");
    expect(kept).toBe(STORY);
  });

  it("rewrites only the section it was pointed at", async () => {
    const out = await reviseStoryFile({
      projectRoot: root, path, ask: rewrites, note: "just this one",
      sections: ["Chapter 2"],
    });
    expect(out.sections).toBe(1);
    const after = await readFile(join(root, path), "utf-8");
    expect(after).toContain("He felt very angry");
    expect(after).toContain("redone");
  });

  it("refuses an empty note rather than rewriting the file for no reason", async () => {
    await expect(reviseStoryFile({ projectRoot: root, path, ask: rewrites, note: "   " }))
      .rejects.toThrow(/note is required/);
  });
});
