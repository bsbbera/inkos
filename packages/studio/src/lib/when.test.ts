import { describe, expect, it } from "vitest";
import { when, whenExact } from "./when";

const now = new Date("2026-10-06T12:00:00Z").getTime();

describe("when", () => {
  it("is relative inside a day", () => {
    expect(when(now - 30_000, now)).toBe("just now");
    expect(when(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(when(now - 11 * 3_600_000, now)).toBe("11 hours ago");
  });
  it("is a short date this year, with the year only when it differs", () => {
    expect(when("2026-09-16T15:53:17", now)).toBe("16 Sep");
    expect(when("2025-09-16T15:53:17", now)).toBe("16 Sep 2025");
  });
  it("adds the time of day without seconds", () => {
    expect(whenExact("2026-09-16T15:53:17", now)).toBe("16 Sep, 15:53");
  });
  it("says nothing for nothing", () => {
    expect(when(undefined, now)).toBe("");
    expect(when("not a date", now)).toBe("");
  });
});
