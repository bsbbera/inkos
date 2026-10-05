import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bytesOfDataUrl, safeName } from "./final.js";
import { appendFeedback, appendProposals, checkVerdict, readFeedback, readProposals, settleProposal } from "./taste.js";

describe("the verdict (04 §7)", () => {
  it("holds a verdict to its surface's causes", () => {
    expect(checkVerdict({ surface: "image", verdict: "redo", cause: ["too busy"] }))
      .toEqual({ surface: "image", verdict: "redo", cause: ["too busy"] });
    expect(checkVerdict({ surface: "image", verdict: "redo", cause: ["too long"] })).toMatch(/^not a cause for image/);
    expect(checkVerdict({ surface: "page", verdict: "keep" })).toMatch(/^surface must be/);
    expect(checkVerdict({ surface: "content", verdict: "maybe" })).toMatch(/^verdict must be/);
  });

  it("appends to one stream and reads it back in order", async () => {
    const root = await mkdtemp(join(tmpdir(), "quire-taste-"));
    const a = await appendFeedback(root, { ref: { type: "book", id: "b" }, surface: "content", verdict: "keep", source: "gate" });
    const b = await appendFeedback(root, { ref: { type: "book", id: "b", unit: 3 }, surface: "image", verdict: "reject", source: "gallery", cause: ["realism"] });
    expect((await readFeedback(root)).map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it("keeps proposals pending until someone settles them", async () => {
    const root = await mkdtemp(join(tmpdir(), "quire-taste-"));
    const [p] = await appendProposals(root, [{ scope: { work: "book/b" }, text: "Keep sentences near 12 words.", kind: "number", evidence: [], source: "final" }]);
    expect(p!.state).toBe("pending");
    await settleProposal(root, p!.id, "accepted", "Keep sentences near 11 words.");
    expect(await readProposals(root)).toMatchObject([{ state: "accepted", text: "Keep sentences near 11 words." }]);
  });
});

describe("uploads into my-final (04 §6)", () => {
  it("reads a data URL and keeps a file name safe", () => {
    expect(bytesOfDataUrl("data:text/plain;base64,aGVsbG8=").toString()).toBe("hello");
    expect(safeName("../../etc/pass wd?.md")).toBe("pass wd-.md");
  });
});
