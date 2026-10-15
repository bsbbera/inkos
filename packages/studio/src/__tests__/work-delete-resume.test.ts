import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerWorkRoutes } from "../api/work.js";
import { publicationWorkflow } from "../api/publications.js";

describe("delete and pick up", () => {
  it("moves a deleted magazine's folders to .quire/trash", async () => {
    const root = mkdtempSync(join(tmpdir(), "quire-del-"));
    mkdirSync(join(root, "Magazine", "issues", "rain"), { recursive: true });
    mkdirSync(join(root, "Magazine", "rain"), { recursive: true });
    writeFileSync(join(root, "Magazine", "issues", "rain", "publication.json"), "{}");
    const app = new Hono();
    registerWorkRoutes(app, { root, bookWork: async () => null });

    expect((await app.request("/api/v1/work/publication/..%2Fx", { method: "DELETE" })).status).toBe(404);
    const res = await app.request("/api/v1/work/publication/rain", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(existsSync(join(root, "Magazine", "issues", "rain"))).toBe(false);
    expect(existsSync(join(root, "Magazine", "rain"))).toBe(false);
    const [kept] = readdirSync(join(root, ".quire", "trash"));
    expect(existsSync(join(root, ".quire", "trash", kept!, "Magazine", "issues", "rain", "publication.json"))).toBe(true);
  });

  it("says a half-written issue with nothing running stopped, at write", () => {
    const page = (body: string | null) => ({ n: 1, title: "", body, briefs: [] });
    const issue = {
      id: "rain", type: "magazine", status: "writing", subject: "Rain", title: "Rain",
      research: { pillars: {} }, sections: [{}], pages: [page("x"), page(null), page(null)], lastError: null,
    } as never;
    expect(publicationWorkflow(issue, false).lastError?.stage).toBe("write");
    expect(publicationWorkflow(issue, true).lastError).toBeNull();
  });
});
