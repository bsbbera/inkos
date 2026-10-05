import { describe, expect, it } from "vitest";
import { isConfirmedProductionAction } from "./confirmed-production";

describe("what counts as a confirmed production run", () => {
  it("treats a confirmed magazine as a production run, so navigation cannot cancel it", () => {
    // A magazine was missing from this set, so confirming one started an
    // ordinary chat round. Opening another conversation aborted it a few
    // seconds later and the issue was never written.
    expect(isConfirmedProductionAction("button", "publication_create")).toBe(true);
  });

  it("keeps free text out, whatever intent it claims", () => {
    expect(isConfirmedProductionAction("free-text", "publication_create")).toBe(false);
  });

  it("leaves an intent the confirmed executor cannot run as a chat tool", () => {
    // There is no storyboard_art branch in executeConfirmedProductionAction, so
    // promoting it here would turn a working card into an error.
    expect(isConfirmedProductionAction("button", "storyboard_art")).toBe(false);
  });
});
