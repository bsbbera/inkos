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
