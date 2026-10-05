import { describe, expect, it } from "vitest";
import { gateState, stageStates } from "./publications.js";
import type { PublicationIssue } from "@actalk/quire-core";

const page = (n: number, over: Record<string, unknown> = {}) => ({
  n, title: `p${n}`, type: "feature", density: "heavy", section: 1,
  pillar: "x", premise: "y", body: "words here", ...over,
});

const issue = (over: Partial<PublicationIssue> = {}): PublicationIssue => ({
  id: "issue-a", type: "magazine", series: "s", subject: "Photography", angle: "a",
  title: "Light Touched", thesis: "t", extent: 2, status: "writing", createdAt: "now",
  research: { ok: true }, sections: [{ n: 1, label: "l", question: "q", colour: "c", from: 1, to: 2 }],
  pages: [page(1), page(2)],
  ...over,
} as PublicationIssue);

describe("what has happened to an issue", () => {
  // Derived from the files rather than from `status`, because tools now change
  // an issue outside the run that set that string.
  it("reads each stage off the issue itself", () => {
    const states = Object.fromEntries(stageStates(issue()).map((s) => [s.stage, s.state]));
    expect(states).toMatchObject({ research: "done", plan: "done", write: "done", audit: "pending", build: "pending" });
  });

  // The design decides palette, type and one world per section, and the build
  // refuses without it. Nothing ran it and no screen showed it, so an issue
  // with every page written sat one invisible step short of a PDF.
  it("shows the design as its own step, pending until one exists", () => {
    const states = Object.fromEntries(stageStates(issue()).map((s) => [s.stage, s.state]));
    expect(states.design).toBe("pending");
    const designed = stageStates(issue({
      design: {
        sections: [{ n: 1, register: "Bauhaus", idiom: "i", paper: "#fdfcf8", ink: "#141414" }],
        fixed: { folio: "f", trim: "t", grid: "g", divider: "d" },
      },
    } as Partial<PublicationIssue>));
    expect(designed.find((s) => s.stage === "design")).toMatchObject({ state: "done", detail: "1 sections styled" });
  });

  it("calls a half-written issue partial, not done", () => {
    const states = stageStates(issue({ pages: [page(1), page(2, { body: null })] as never }));
    expect(states.find((s) => s.stage === "write")).toMatchObject({ state: "partial", detail: "1/2 pages written" });
  });

  it("says whether the audit revised anything or only reported", () => {
    const reported = stageStates(issue({ audit: { at: "now", findings: [], rounds: 0 } }));
    expect(reported.find((s) => s.stage === "audit")?.detail).toContain("not revised");
    const revised = stageStates(issue({ audit: { at: "now", findings: [], rounds: 2 } }));
    expect(revised.find((s) => s.stage === "audit")?.detail).toContain("2 revise rounds");
  });
});

describe("a stage that failed", () => {
  it("says failed with the reason, instead of reading as never run", () => {
    // A research stage that threw left the strip saying "not run", which
    // reads as nothing happened rather than as something to pick back up.
    const states = stageStates(issue({
      research: null,
      lastError: { at: "now", stage: "research", message: "research:today: model returned invalid JSON" },
    } as Partial<PublicationIssue>));
    expect(states.find((s) => s.stage === "research")).toMatchObject({
      state: "failed",
      detail: "research:today: model returned invalid JSON",
    });
  });

  it("shows the stage being worked on as running, keeping its progress", () => {
    const planning = stageStates(issue({ pages: [], sections: [] } as Partial<PublicationIssue>), { stage: "plan" });
    expect(planning.find((s) => s.stage === "plan")).toMatchObject({ state: "running", detail: "working on it" });

    const writing = stageStates(
      issue({ pages: [page(1), page(2, { body: null })] as never }),
      { stage: "write" },
    );
    expect(writing.find((s) => s.stage === "write")).toMatchObject({ state: "running", detail: "1/2 pages written" });
  });

  // A run that stopped at page 15 keeps what it checked, and the strip says so.
  it("calls a fact-check that stopped part-way partial, with its page count", () => {
    const states = stageStates(issue({
      factCheck: {
        at: "now", findings: [], checked: 4, searchedWith: [],
        pages: { 1: { hash: "a", checked: 4 } }, complete: false,
      },
    }));
    expect(states.find((s) => s.stage === "fact-check")).toMatchObject({
      state: "partial", detail: "4 claims checked, 0 worth acting on, 1/2 pages",
    });
  });

  // Briefs arrive with the pages, so "none asked for a picture" is unknown
  // until they are all written; art read done on an issue it had not touched.
  it("does not call art done while pages are still unwritten", () => {
    const states = stageStates(issue({ pages: [page(1), page(2, { body: null })] as never }));
    expect(states.find((s) => s.stage === "art")?.state).toBe("pending");
  });

  it("does not call art done before there is a flatplan", () => {
    const states = stageStates(issue({ pages: [], sections: [] } as Partial<PublicationIssue>));
    expect(states.find((s) => s.stage === "art")).toMatchObject({ state: "pending", detail: "no flatplan yet" });
  });

  it("shows a stopped stage as stopped, not as failed", () => {
    const states = stageStates(issue({
      factCheck: {
        at: "now", findings: [], checked: 7, searchedWith: [],
        pages: { 1: { hash: "a", checked: 7 } }, complete: false,
      },
      lastError: { at: "now", stage: "fact-check", message: "Stopped by user", stopped: true },
    } as Partial<PublicationIssue>));
    expect(states.find((s) => s.stage === "fact-check")).toMatchObject({
      state: "partial", detail: "stopped · 7 claims checked, 0 worth acting on, 1/2 pages",
    });
  });

  it("reads an old stop record, written before the flag, as a stop", () => {
    const states = stageStates(issue({
      lastError: { at: "then", stage: "art", message: "Stopped by user" },
    } as Partial<PublicationIssue>));
    expect(states.find((s) => s.stage === "art")?.state).not.toBe("failed");
  });

  it("leaves a stage alone once it has actually finished", () => {
    const states = stageStates(issue({
      lastError: { at: "now", stage: "research", message: "an older failure" },
    } as Partial<PublicationIssue>));
    expect(states.find((s) => s.stage === "research")?.state).toBe("done");
  });
});

describe("the gates, and what is holding them", () => {
  // "Cannot build" with no reason is what makes a gate feel like a bug.
  it("names every reason a build is held", () => {
    const gates = gateState(issue());
    expect(gates.build.canBuild).toBe(false);
    expect(gates.build.blockers).toContain("the copy is not approved");
    expect(gates.build.blockers).toContain("the design is not approved");
    expect(gates.build.blockers).toContain("no design has been run");
  });

  it("warns before a copy approval without refusing it — the editor decides", () => {
    const gates = gateState(issue({ pages: [page(1), page(2, { body: null })] as never }));
    expect(gates.copy.warnings).toContain("1 pages are still unwritten");
    expect(gates.copy.warnings).toContain("the issue has not been audited");
  });

  // Unlike copy, an unsound design cannot be signed off: build reads the spec,
  // so approving a broken one only moves the failure later.
  it("refuses a design approval while the design is unsound", () => {
    expect(gateState(issue()).design.canApprove).toBe(false);
    expect(gateState(issue()).design.blockers).toEqual(["no design has been run"]);
  });

  it("opens the build once both approvals are in and the design holds", () => {
    const sound = issue({
      approved: { at: "now", by: "editor" },
      designApproved: { at: "now", by: "editor" },
      design: {
        sections: [{ n: 1, register: "Bauhaus", idiom: "i", paper: "#fdfcf8", ink: "#141414" }],
        fixed: { folio: "f", trim: "t", grid: "g", divider: "d" },
      },
    });
    const gates = gateState(sound);
    expect(gates.design.blockers).toEqual([]);
    expect(gates.build).toEqual({ canBuild: true, blockers: [] });
  });
});

describe("the files a run reads", () => {
  it("lists the research files, cited ones first, and says which were cited", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { researchInputs } = await import("./publications.js");
    const root = await mkdtemp(join(tmpdir(), "pub-inputs-"));
    const dir = join(root, "research");
    await mkdir(dir, { recursive: true });
    const manifest = (id: string, title: string, source: string, purpose = "research") => writeFile(
      join(dir, `${id}.json`),
      JSON.stringify({ id, title, source, purpose, kind: "webpage", mimeType: "text/html",
        markdownPath: `research/${id}.md`, manifestPath: `research/${id}.json`,
        charCount: 10, excerpt: "" }),
    );
    await manifest("a", "Pinhole camera", "https://example.org/pinhole");
    await manifest("b", "Box cameras", "https://example.org/box");
    await manifest("c", "A novel's notes", "notes.md", "reference");

    const out = await researchInputs(root, issue({
      research: { pillars: { history: { sources: [{ url: "https://example.org/box" }, { url: "https://else.org" }] } } },
    } as Partial<PublicationIssue>));

    expect(out.sources).toBe(2);
    expect(out.files.map((f) => [f.title, f.cited])).toEqual([
      ["Box cameras", true],
      ["Pinhole camera", false],
    ]);
  });
});
