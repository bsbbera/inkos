import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("node:fs/promises", async (orig) => ({
  ...(await orig<typeof import("node:fs/promises")>()),
  rename: vi.fn(async () => {
    calls.push("rename");
    if (calls.length < 3) throw Object.assign(new Error("busy"), { code: "EPERM" });
  }),
}));

describe("replaceFile", () => {
  it("waits out a file Windows holds for a moment", async () => {
    const { replaceFile } = await import("../utils/replace-file.js");
    await replaceFile("a.tmp", "a");
    expect(calls).toHaveLength(3);
  });
});
