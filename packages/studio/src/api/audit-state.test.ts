import { describe, expect, it } from "vitest";
import { isApproved, withFileAudit, type AuditState } from "./audit-state.js";

const empty: AuditState = { files: {} };

describe("withFileAudit", () => {
  it("records a check on a file it has never seen", () => {
    const next = withFileAudit(empty, "shorts/a/final/one.md", {
      checked: "2026-08-28T00:00:00.000Z", findings: 14, warnings: 9,
    });
    expect(next.files["shorts/a/final/one.md"]?.findings).toBe(14);
  });

  /**
   * The reason the merge is its own function: a later check must not erase the
   * fact that the file was rewritten, or the tree loses the one mark that says
   * this file is not what the model first produced.
   */
  it("keeps what the patch does not mention", () => {
    const first = withFileAudit(empty, "a.md", {
      rewritten: "2026-08-01T00:00:00.000Z",
      approved: { at: "2026-08-02T00:00:00.000Z", by: "you" },
    });
    const second = withFileAudit(first, "a.md", { checked: "2026-08-28T00:00:00.000Z" });
    expect(second.files["a.md"]?.rewritten).toBe("2026-08-01T00:00:00.000Z");
    expect(second.files["a.md"]?.approved?.by).toBe("you");
    expect(second.files["a.md"]?.checked).toBe("2026-08-28T00:00:00.000Z");
  });

  it("clears a field only when told to with null", () => {
    const on = withFileAudit(empty, "a.md", {
      approved: { at: "2026-08-02T00:00:00.000Z", by: "you" },
    });
    expect(isApproved(on, "a.md")).toBe(true);
    const off = withFileAudit(on, "a.md", { approved: null });
    expect(isApproved(off, "a.md")).toBe(false);
  });

  it("leaves every other file alone", () => {
    const two = withFileAudit(
      withFileAudit(empty, "a.md", { checked: "x" }), "b.md", { checked: "y" },
    );
    expect(Object.keys(two.files).sort()).toEqual(["a.md", "b.md"]);
    expect(two.files["a.md"]?.checked).toBe("x");
  });
});
