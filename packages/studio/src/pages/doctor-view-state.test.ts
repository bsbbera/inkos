import { describe, expect, it } from "vitest";
import { doctorViewState } from "./doctor-view-state";

describe("doctorViewState", () => {
  it("shows the checks once they arrive", () => {
    expect(doctorViewState({ error: null, data: { inkosJson: true } })).toBe("ready");
  });

  it("spins only while nothing has come back yet", () => {
    expect(doctorViewState({ error: null, data: null })).toBe("loading");
  });

  // The whole reason this page kept spinning forever: the backend answered
  // with a failure, and the view had no state for that at all.
  it("reports a failure rather than spinning on it", () => {
    expect(doctorViewState({ error: "fetch failed", data: null })).toBe("error");
  });

  // A re-check after a failure sets loading again. Falling back to the spinner
  // would hide the reason the person is still on this page.
  it("keeps showing the failure while a re-check is in flight", () => {
    expect(doctorViewState({ error: "fetch failed", data: undefined })).toBe("error");
  });

  // Stale data plus a fresh failure is still a failure: the checks on screen
  // no longer describe the machine.
  it("prefers a new failure over the last good result", () => {
    expect(doctorViewState({ error: "HTTP 500", data: { inkosJson: true } })).toBe("error");
  });
});
