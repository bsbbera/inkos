import { describe, expect, it } from "vitest";
import type { ChapterMeta } from "@actalk/quire-core";
import type { Finding } from "@actalk/quire-core";
import { bookWorkflow, gate, partOf, projectWorkflow } from "./workflow.js";

const NOW = "2026-08-31T00:00:00.000Z";

function chapter(number: number, status: string, wordCount = 2000): ChapterMeta {
  return {
    number,
    title: `Chapter ${number}`,
    status: status as ChapterMeta["status"],
    wordCount,
    createdAt: NOW,
    updatedAt: NOW,
    auditIssues: [],
    lengthWarnings: [],
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    path: "books/tide/chapters/0001_x.md",
    section: "",
    quote: "she had never owned a coat",
    severity: "blocking",
    category: "continuity",
    title: "The coat contradicts chapter one",
    description: "Chapter one gives her a coat.",
    suggestion: "Say what she wore.",
    state: "open",
    para: 0,
    start: 10,
    end: 36,
    ...over,
  } as Finding;
}

/** Chapters live under a predictable path, which is all the workflow needs. */
const pathOf = (n: number) => `books/tide/chapters/${String(n).padStart(4, "0")}_x.md`;

const build = (chapters: readonly ChapterMeta[], findings: readonly Finding[] = []) =>
  bookWorkflow({ chapters, findings, pathOf });

const stageMap = (w: ReturnType<typeof build>) =>
  Object.fromEntries(w.stages.map((s) => [s.stage, s.state]));

const gateNamed = (w: ReturnType<typeof build>, name: string) =>
  w.gates.find((g) => g.name === name)!;

describe("partOf", () => {
  it("calls nothing-of-nothing pending rather than done", () => {
    // A book with no chapters has not finished writing them.
    expect(partOf(0, 0)).toBe("pending");
    expect(partOf(0, 5)).toBe("pending");
    expect(partOf(2, 5)).toBe("partial");
    expect(partOf(5, 5)).toBe("done");
  });
});

describe("gate", () => {
  it("can be approved exactly when nothing blocks it, warnings notwithstanding", () => {
    expect(gate("copy", "Copy", null, [], ["two chapters unwritten"]).canApprove).toBe(true);
    expect(gate("copy", "Copy", null, ["a chapter failed"], []).canApprove).toBe(false);
  });
});

describe("bookWorkflow stages", () => {
  it("says nothing has happened rather than that everything is done", () => {
    const states = stageMap(build([]));
    expect(states).toEqual({
      plan: "pending", write: "pending", audit: "pending", review: "pending", publish: "pending",
    });
  });

  it("separates written from read from signed off", () => {
    const w = build([
      chapter(1, "approved"),
      chapter(2, "ready-for-review"),
      chapter(3, "drafted"),
    ]);
    const states = stageMap(w);
    expect(states.write).toBe("done");
    // Three written, two of them read, one of them signed off.
    expect(states.audit).toBe("partial");
    expect(states.review).toBe("partial");
    expect(states.publish).toBe("pending");
  });

  it("counts the words it actually has, not the target", () => {
    const w = bookWorkflow({
      chapters: [chapter(1, "drafted", 1500), chapter(2, "drafted", 2500)],
      targetChapters: 10,
      findings: [],
      pathOf,
    });
    expect(w.stages.find((s) => s.stage === "write")!.detail).toContain("4,000 words");
    // Two of a planned ten is a plan part-done, not a plan finished.
    expect(stageMap(w).plan).toBe("partial");
  });

  it("names the contradictions in the audit stage rather than only counting reads", () => {
    const w = build([chapter(1, "ready-for-review")], [finding()]);
    expect(w.stages.find((s) => s.stage === "audit")!.detail)
      .toBe("1/1 read, 1 contradicts the book");
  });
});

describe("bookWorkflow gates", () => {
  it("warns about unwritten chapters but does not refuse over them", () => {
    const copy = gateNamed(build([chapter(1, "approved"), chapter(2, "card-generated")]), "copy");
    expect(copy.canApprove).toBe(true);
    expect(copy.warnings).toContain("1 chapters are still unwritten");
    expect(copy.blockers).toEqual([]);
  });

  it("refuses over a chapter that stopped, and says which", () => {
    const copy = gateNamed(build([chapter(1, "approved"), chapter(4, "rejected")]), "copy");
    expect(copy.canApprove).toBe(false);
    expect(copy.blockers[0]).toContain("(4)");
  });

  it("holds the audit gate on open blocking findings and names the chapter", () => {
    const w = build([chapter(1, "ready-for-review"), chapter(2, "ready-for-review")], [
      finding({ id: "a", path: pathOf(2) }),
    ]);
    const audit = gateNamed(w, "audit");
    expect(audit.canApprove).toBe(false);
    expect(audit.blockers[0]).toContain("chapter 2");
  });

  it("ignores a settled finding, because settled is the point of settling", () => {
    const w = build([chapter(1, "ready-for-review")], [
      finding({ path: pathOf(1), state: "accepted" }),
    ]);
    expect(gateNamed(w, "audit").canApprove).toBe(true);
  });

  it("ignores a warning, because only a contradiction stops a sign-off", () => {
    const w = build([chapter(1, "ready-for-review")], [
      finding({ path: pathOf(1), severity: "warning" }),
    ]);
    expect(gateNamed(w, "audit").canApprove).toBe(true);
  });

  it("does not attribute a finding to a book whose chapter file is elsewhere", () => {
    const w = build([chapter(1, "ready-for-review")], [
      finding({ path: "books/other/chapters/0001_x.md" }),
    ]);
    expect(gateNamed(w, "audit").canApprove).toBe(true);
  });
});

describe("bookWorkflow done gate", () => {
  it("stays shut while a chapter is unapproved, and names the count", () => {
    const w = build([chapter(1, "approved"), chapter(2, "ready-for-review")]);
    expect(w.done.can).toBe(false);
    expect(w.done.blockers).toContain("1 chapters are not approved");
  });

  it("opens once every chapter is signed off and nothing contradicts", () => {
    const w = build([chapter(1, "approved"), chapter(2, "published")]);
    expect(w.done).toEqual({ can: true, blockers: [] });
  });

  it("carries the audit blocker through rather than reporting only the count", () => {
    const w = build([chapter(1, "approved")], [finding({ path: pathOf(1) })]);
    expect(w.done.can).toBe(false);
    expect(w.done.blockers.join(" ")).toContain("contradicts the book");
  });
});

/* -------------------------------------------------- every other production */

const file = (path: string, over: Record<string, unknown> = {}) => ({
  path, words: 1200, audit: over,
});

const project = (items: ReturnType<typeof file>[], findings: readonly Finding[] = []) =>
  projectWorkflow({ kind: "short", kindLabel: "Short", items, findings });

const named = (w: ReturnType<typeof project>, name: string) =>
  w.gates.find((g) => g.name === name)!;

describe("projectWorkflow", () => {
  it("gives a short the same three answers a magazine gets", () => {
    const w = project([
      file("shorts/tide/one.md", { checked: NOW, approved: { at: NOW, by: "you" } }),
      file("shorts/tide/two.md", { checked: NOW }),
    ]);
    expect(w.stages.map((s) => s.stage)).toEqual(["write", "audit", "review"]);
    expect(w.stages.find((s) => s.stage === "audit")!.state).toBe("done");
    expect(w.stages.find((s) => s.stage === "review")!.state).toBe("partial");
  });

  it("counts only its own files, never another project's findings", () => {
    // A findings store holds every project's. A short must not be held shut
    // by a contradiction found in somebody's novel.
    const w = project([file("shorts/tide/one.md", { checked: NOW })], [
      finding({ path: "books/other/chapters/0001_x.md" }),
    ]);
    expect(named(w, "audit").canApprove).toBe(true);
  });

  it("holds the audit gate on a contradiction in a file it does own", () => {
    const w = project([file("shorts/tide/one.md", { checked: NOW })], [
      finding({ path: "shorts/tide/one.md" }),
    ]);
    expect(named(w, "audit").canApprove).toBe(false);
    expect(w.done.can).toBe(false);
  });

  it("warns about unread files without refusing over them", () => {
    const w = project([
      file("shorts/tide/one.md", { checked: NOW, approved: { at: NOW, by: "you" } }),
      file("shorts/tide/two.md"),
    ]);
    const copy = named(w, "copy");
    expect(copy.canApprove).toBe(true);
    expect(copy.warnings.join(" ")).toContain("never been read");
  });

  it("opens the done gate only when everything is read and signed", () => {
    const both = { checked: NOW, approved: { at: NOW, by: "you" } };
    const w = project([file("shorts/tide/one.md", both), file("shorts/tide/two.md", both)]);
    expect(w.done).toEqual({ can: true, blockers: [] });
  });

  it("leads with the runner's own stage where the runner records one", () => {
    const w = projectWorkflow({
      kind: "script", kindLabel: "Script",
      items: [file("dramas/x/one.md", { checked: NOW })],
      findings: [],
      runStage: { stage: "render", state: "failed", detail: "ffmpeg exited 1" },
    });
    expect(w.stages[0]!.stage).toBe("render");
    // Failed is not partial progress; it is not done.
    expect(w.stages[0]!.state).toBe("pending");
    // The reason beats the status word, which says less.
    expect(w.stages[0]!.detail).toBe("ffmpeg exited 1");
  });

  it("calls a run that is waiting for a person finished, not stalled", () => {
    // stage "complete" with status "needs-review" used to render as
    // "complete / partial / needs-review", which reads as a stuck run.
    const w = projectWorkflow({
      kind: "short", kindLabel: "Short",
      items: [file("shorts/x/one.md")],
      findings: [],
      runStage: { stage: "complete", state: "needs-review", detail: "" },
    });
    expect(w.stages[0]!.state).toBe("done");
    expect(w.stages[0]!.detail).toBe("finished, waiting for a read");
  });

  it("says there is nothing here rather than that an empty project is finished", () => {
    const w = project([]);
    expect(w.done.can).toBe(false);
    expect(w.done.blockers).toContain("there is nothing here yet");
  });
});
