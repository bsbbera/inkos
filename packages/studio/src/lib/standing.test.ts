import { describe, expect, it } from "vitest";
import { standingOf } from "./standing";

const c = (files: number, read: number, signedOff: number, blocking = 0) => ({ files, read, signedOff, blocking });

describe("standingOf", () => {
  it("ranks a blocking finding above everything", () => {
    expect(standingOf(c(22, 1, 0, 2)).label).toBe("blocked");
    expect(standingOf(c(22, 22, 22, 1), true).label).toBe("blocked");
  });
  it("calls unread work waiting, not drafting", () => {
    expect(standingOf(c(3, 0, 0))).toMatchObject({ state: "waiting", label: "needs a read" });
  });
  it("asks for the signature once everything is read", () => {
    expect(standingOf(c(3, 3, 1)).label).toBe("ready to sign");
    expect(standingOf(c(3, 1, 0), true).label).toBe("ready to sign");
  });
  it("is done only when every file is signed off", () => {
    expect(standingOf(c(3, 3, 3)).state).toBe("done");
  });
  it("is drafting while there is nothing to read yet", () => {
    expect(standingOf(undefined).state).toBe("drafting");
    expect(standingOf(c(0, 0, 0)).state).toBe("drafting");
  });
});
