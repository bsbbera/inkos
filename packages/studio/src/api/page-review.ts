/*
 * The beauty gate and the section board over HTTP (13 §2, §9; Phase 6).
 *
 *   GET  /publications/:id/pages/:n/bundle      everything about one page, in one read
 *   GET  /publications/:id/pages/:n/render.png  its latest render
 *   POST /publications/:id/pages/:n/verdict     keep · redesign · re-world · tweak
 *   POST /publications/:id/sections/:n/mark     keep or lock a section, or clear it
 *
 * The bundle is assembled, not migrated: content and spec stay in
 * publication.json, the render, layout, score and reviews in pages/<nn>/.
 * Every verdict lands twice — in the page's own reviews.jsonl and in the
 * taste stream, scoped to the section's world, so a cause pressed often on
 * one world becomes that world's rule.
 */
import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PipelineRunner, appendPublicationReview, createPublicationAsk, designPublicationSection, enqueueJob,
  layoutScored, liveJobFor, markPublicationSection, openPublicationIssue, readPublicationReviews, readScore,
  redesignPublicationPage,
} from "@actalk/quire-core";
import { appendFeedback } from "./taste.js";
import { issueDirOf } from "./publications.js";

export interface PageReviewDeps {
  readonly root: string;
  readonly shimUrl: () => string;
  readonly pipeline: () => Promise<PipelineRunner>;
  readonly broadcast: (event: string, data: unknown) => void;
}

const VERDICTS = new Set(["keep", "redesign", "re-world", "tweak"]);
/** The page score's dimensions, as the chips a person presses (13 §9: one learning stream). */
export const DESIGN_CHIPS = ["grid", "hierarchy", "whitespace", "colour", "typography", "image fit", "rules"] as const;

const pageDir = (root: string, id: string, n: number) => join(issueDirOf(root, id), "pages", String(n).padStart(2, "0"));

export function registerPageReviewRoutes(app: Hono, deps: PageReviewDeps): void {
  const { root, broadcast } = deps;
  const open = async (id: string, withModel: boolean) => openPublicationIssue(root, id, {
    shimUrl: deps.shimUrl(),
    onEvent: (event: unknown) => broadcast("publication:event", { id, ...(event as object) }),
    ...(withModel ? { ask: createPublicationAsk({ pipeline: await deps.pipeline(), projectRoot: root, issueId: id }) } : {}),
  });
  const busy = (id: string) => liveJobFor({ type: "publication", id }) !== null;

  app.get("/api/v1/publications/:id/pages/:n/bundle", async (c) => {
    const id = c.req.param("id"), n = Number(c.req.param("n"));
    try {
      const { issue, ctx } = await open(id, false);
      const page = issue.pages.find((p) => p.n === n);
      if (!page) return c.json({ error: `no page ${n} in ${id}` }, 404);
      const section = (issue.sections ?? []).find((s) => n >= s.from && n <= s.to) ?? null;
      const dir = pageDir(root, id, n);
      const layout = await readFile(join(dir, "layout.json"), "utf-8").then((t) => JSON.parse(t)).catch(() => null);
      return c.json({
        page,
        section,
        world: (issue.design?.sections ?? []).find((w) => w.n === section?.n) ?? null,
        spec: issue.design?.spec?.pages?.[String(n)] ?? null,
        mark: section ? issue.sectionBoard?.[String(section.n)] ?? null : null,
        render: existsSync(join(dir, "render.png")) ? `/api/v1/publications/${encodeURIComponent(id)}/pages/${n}/render.png` : null,
        layout: layout ? { built: layout.built ?? "type", at: layout.at, warnings: layout.warnings ?? [], findings: layout.findings ?? [] } : null,
        score: await readScore(issueDirOf(root, id), n),
        reviews: (await readPublicationReviews(ctx, id, n)).slice(-10),
        chips: DESIGN_CHIPS,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/api/v1/publications/:id/pages/:n/render.png", async (c) => {
    const file = join(pageDir(root, c.req.param("id"), Number(c.req.param("n"))), "render.png");
    if (!existsSync(file)) return c.json({ error: "this page has not been rendered" }, 404);
    return c.body(new Uint8Array(await readFile(file)), 200, { "content-type": "image/png", "cache-control": "no-store" });
  });

  app.post("/api/v1/publications/:id/pages/:n/verdict", async (c) => {
    const id = c.req.param("id"), n = Number(c.req.param("n"));
    const body = await c.req.json().catch(() => ({})) as { verdict?: string; cause?: unknown; note?: unknown };
    const verdict = String(body.verdict ?? "");
    if (!VERDICTS.has(verdict)) return c.json({ error: "verdict is one of keep, redesign, re-world, tweak" }, 400);
    const cause = Array.isArray(body.cause) ? body.cause.map(String).filter((k) => (DESIGN_CHIPS as readonly string[]).includes(k)) : [];
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (verdict === "tweak" && !note && !cause.length) return c.json({ error: "say what to change" }, 400);
    if (verdict !== "keep" && busy(id)) return c.json({ error: "this issue is running - stop it first" }, 409);

    const { issue, ctx } = await open(id, false);
    const page = issue.pages.find((p) => p.n === n);
    if (!page) return c.json({ error: `no page ${n} in ${id}` }, 404);
    const section = (issue.sections ?? []).find((s) => n >= s.from && n <= s.to);
    const world = (issue.design?.sections ?? []).find((w) => w.n === section?.n)?.register;
    if (verdict === "re-world" && section && issue.sectionBoard?.[String(section.n)]?.state === "locked") {
      return c.json({ error: `section ${section.n} is locked - unlock it on the section board first` }, 409);
    }
    const score = await readScore(issueDirOf(root, id), n);

    await appendPublicationReview(ctx, id, n, {
      at: new Date().toISOString(), verdict: verdict as "keep",
      ...(cause.length ? { cause } : {}), ...(note ? { note } : {}), ...(world ? { world } : {}),
      ...(score?.latest?.total !== undefined ? { total: score.latest.total } : {}),
    });
    const event = await appendFeedback(root, {
      ref: { type: "publication", id, unit: n }, surface: "design",
      // The taste stream's verdict words: a redesign is a redo, a tweak a tweak.
      verdict: verdict === "redesign" ? "redo" : verdict as "keep" | "tweak" | "re-world",
      ...(cause.length ? { cause } : {}), ...(note ? { note } : {}),
      source: "design", ...(world ? { scope: { world } } : {}),
      acted: verdict === "keep" ? "noted" : verdict === "re-world" ? "re-worlding" : "redesigning",
    });
    broadcast("feedback:new", event);
    if (verdict === "keep") return c.json({ ok: true, event });

    const { ctx: withModel } = await open(id, true);
    const job = enqueueJob({
      ref: { type: "publication", id },
      stage: verdict === "re-world" ? "design.section" : "design.page",
      work: async ({ signal, onProgress }) => {
        if (verdict === "re-world") {
          if (!section) throw new Error(`page ${n} is in no section`);
          onProgress(`Choosing another world for section ${section.n}…`);
          // A section's world is its pages' world: the page is re-laid with it, its neighbours on their next layout.
          await designPublicationSection({ ...withModel, signal }, id, section.n, [note, ...cause].filter(Boolean).join("; ") || undefined, { keepSignOff: true });
        } else {
          onProgress(`Redesigning p${n}…`);
          const out = await redesignPublicationPage({ ...withModel, signal }, id, n, { note, cause });
          if (out.dropped.length) onProgress(`Left out: ${out.dropped.join("; ")}`);
        }
        onProgress(`Laying out p${n} in Affinity…`);
        const laid = await layoutScored({ ...withModel, signal }, id, n, { onProgress });
        broadcast("publication:score", { id, n, pass: laid.result.final.pass, total: laid.result.final.total });
        broadcast("design:changed", { type: "publication", id });
        return { total: laid.result.final.total, pass: laid.result.final.pass };
      },
    });
    return c.json({ ok: true, event, job });
  });

  app.post("/api/v1/publications/:id/sections/:n/mark", async (c) => {
    const id = c.req.param("id"), n = Number(c.req.param("n"));
    const body = await c.req.json().catch(() => ({})) as { state?: string | null };
    const state = body.state === "approved" || body.state === "locked" ? body.state : null;
    try {
      const { ctx } = await open(id, false);
      const issue = await markPublicationSection(ctx, id, n, state);
      broadcast("publication:issue", { id });
      return c.json({ ok: true, sectionBoard: issue.sectionBoard ?? {} });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
}
