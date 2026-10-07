import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { readMath } from "@actalk/quire-core";
import { describe, expect, it } from "vitest";
import { bytesOfDataUrl, safeName } from "./final.js";
import { writeFindings } from "./findings-store.js";
import {
  appendFeedback, appendProposals, checkVerdict, readFeedback, readProposals, registerTasteRoutes, settleProposal,
} from "./taste.js";

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

describe("what an accepted proposal does (Phase 3)", () => {
  const appFor = (root: string) => {
    const app = new Hono();
    registerTasteRoutes(app, { root, broadcast: () => undefined } as never);
    return app;
  };
  const post = (app: Hono, path: string) => app.request(`http://localhost${path}`, { method: "POST", body: "{}" });

  it("writes a number rule into the scope's math, so the next design check holds it", async () => {
    const root = await mkdtemp(join(tmpdir(), "quire-taste-"));
    const [p] = await appendProposals(root, [{
      scope: { work: "publication/i1" }, text: "No more than 1 full-bleed in a row", kind: "number", evidence: [], source: "distill",
    }]);
    const app = appFor(root);
    const out = await (await post(app, `/api/v1/taste/proposals/${p!.id}/accept`)).json() as { enforced: unknown };
    expect(out.enforced).toEqual({ key: "maxFullBleedRun", value: 1, scope: "work:publication/i1" });
    expect(await readMath(root, { type: "publication", id: "i1" })).toEqual({ maxFullBleedRun: 1 });

    // A number the checker cannot hold is still a prompt line, and the answer says it is not enforced.
    const [q] = await appendProposals(root, [{ scope: {}, text: "Keep sentences near 12 words.", kind: "number", evidence: [], source: "distill" }]);
    const soft = await (await post(app, `/api/v1/taste/proposals/${q!.id}/accept`)).json() as { enforced: unknown };
    expect(soft.enforced).toBeNull();
  });

  it("shows the passages a proposal rests on, not the finding titles", async () => {
    const root = await mkdtemp(join(tmpdir(), "quire-taste-"));
    const e = await appendFeedback(root, {
      ref: { type: "book", id: "b" }, surface: "content", verdict: "reject", source: "audit",
      note: "Hedging", passage: "She seemed to perhaps almost smile.",
    });
    const [p] = await appendProposals(root, [{ scope: {}, text: "Cut hedges.", kind: "sentence", evidence: [e.id], source: "distill" }]);
    const out = await (await appFor(root).request(`http://localhost/api/v1/taste/proposals/${p!.id}/evidence`)).json() as { evidence: Array<{ passage: string; note: string }> };
    expect(out.evidence).toMatchObject([{ passage: "She seemed to perhaps almost smile.", note: "Hedging" }]);
  });

  it("finds the passage of a verdict recorded before passages were, from its finding", async () => {
    const root = await mkdtemp(join(tmpdir(), "quire-taste-"));
    await writeFindings(root, [{ id: "f1", path: "Books/b/ch1.md", title: "Hedging", quote: "It was almost perhaps blue." } as never]);
    const e = await appendFeedback(root, {
      ref: { type: "book", id: "b" }, surface: "content", verdict: "reject", source: "audit", note: "Hedging", target: "Books/b/ch1.md",
    });
    const [p] = await appendProposals(root, [{ scope: {}, text: "Cut hedges.", kind: "sentence", evidence: [e.id], source: "distill" }]);
    const out = await (await appFor(root).request(`http://localhost/api/v1/taste/proposals/${p!.id}/evidence`)).json() as { evidence: Array<{ passage: string }> };
    expect(out.evidence[0]!.passage).toBe("It was almost perhaps blue.");
  });
});

describe("uploads into my-final (04 §6)", () => {
  it("reads a data URL and keeps a file name safe", () => {
    expect(bytesOfDataUrl("data:text/plain;base64,aGVsbG8=").toString()).toBe("hello");
    expect(safeName("../../etc/pass wd?.md")).toBe("pass wd-.md");
  });
});
