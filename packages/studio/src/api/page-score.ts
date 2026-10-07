/*
 * The page score over HTTP (design-skill §12b, Phase 4).
 *
 *   POST /publications/:id/pages/:n/score     score one page; {layout: true} lays it out,
 *                                             renders and mends it by its cause first
 *   GET  /publications/:id/pages/:n/score     the latest score and its history
 *   POST /publications/:id/improve-spec       mend the spec by its causes, at most twice
 *
 * The work is core's (`pipeline/page-score-run.ts`), which the layout stage
 * runs too; this joins it to an issue by id.
 */
import type { Hono } from "hono";
import {
  improvePage, layoutScored, openPublicationIssue, readMath, readScore, repairGoldenRules, scoreAndSave,
  scoreIssuePage, type Checkpoint, type PublicationIssue,
} from "@actalk/quire-core";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { issueDirOf } from "./publications.js";

export interface PageScoreDeps {
  readonly root: string;
  readonly shimUrl: () => string;
  readonly broadcast: (event: string, data: unknown) => void;
}

const contextOf = async (deps: PageScoreDeps, id: string) =>
  (await openPublicationIssue(deps.root, id, { shimUrl: deps.shimUrl() })).ctx;

export function registerPageScoreRoutes(app: Hono, deps: PageScoreDeps): void {
  const { root, broadcast } = deps;

  app.post("/api/v1/publications/:id/pages/:n/score", async (c) => {
    const id = c.req.param("id");
    const n = Number(c.req.param("n"));
    const body = await c.req.json().catch(() => ({})) as { checkpoint?: Checkpoint; render?: string; layout?: boolean };
    try {
      const ctx = await contextOf(deps, id);
      if (body.layout) {
        const lines: string[] = [];
        const { findings, result } = await layoutScored(ctx, id, n, { onProgress: (l) => lines.push(l) });
        broadcast("publication:score", { id, n, pass: result.final.pass, total: result.final.total });
        return c.json({ ...result.final, passes: result.passes, stopped: result.stopped, findings, progress: lines });
      }
      const score = await scoreAndSave(ctx, id, n, body);
      if (!score) return c.json({ error: `no page ${n} in ${id}` }, 404);
      broadcast("publication:score", { id, n, pass: score.pass, total: score.total });
      return c.json(score);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/api/v1/publications/:id/pages/:n/score", async (c) => {
    const file = await readScore(issueDirOf(root, c.req.param("id")), Number(c.req.param("n")));
    return file ? c.json(file) : c.json({ error: "this page has not been scored" }, 404);
  });

  /*
   * Mend the issue's design spec by what its pages' scores blame, twice at most.
   * Only a rule broken on the spec (`repair`) is mended here, without Affinity;
   * the layout stage does the rest with a render in hand.
   */
  app.post("/api/v1/publications/:id/improve-spec", async (c) => {
    const id = c.req.param("id");
    try {
      const ctx = await contextOf(deps, id);
      const { issue } = await openPublicationIssue(root, id, {});
      const specFile = join(issueDirOf(root, id), "publication.json");
      const math = await readMath(root, { type: "publication", id, worlds: (issue.design?.sections ?? []).map((w) => w.register) });
      const done: Array<{ page: number; repairs: string[]; passes: number; stopped: string }> = [];
      for (const page of issue.pages) {
        const result = await improvePage({
          score: async () => (await scoreIssuePage(ctx, id, page.n, { checkpoint: "spec-lint" }))!.score,
          fix: async (_cause, fix) => {
            if (fix !== "repair") return false;
            const current = JSON.parse(await readFile(specFile, "utf-8")) as PublicationIssue;
            if (!current.design?.spec) return false;
            const mended = repairGoldenRules(current.design.spec, current.sections, math);
            if (!mended.repairs.length) return false;
            await writeFile(specFile, JSON.stringify({ ...current, design: { ...current.design, spec: mended.spec } }, null, 2), "utf-8");
            done.push({ page: page.n, repairs: mended.repairs, passes: 0, stopped: "" });
            return true;
          },
        });
        const last = done[done.length - 1];
        if (last && last.page === page.n) { last.passes = result.passes.length; last.stopped = result.stopped; }
      }
      broadcast("design:changed", { type: "publication", id });
      return c.json({ ok: true, repaired: done });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
