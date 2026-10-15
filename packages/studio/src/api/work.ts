/*
 * Where any piece of work stands, asked one way for every kind.
 *
 * A magazine had `/publications/:id`, a book `/books/:id/workflow`, and the
 * other seven kinds had the audit screen's project detail. Three answers to
 * one question is how the status drawn on the rail, the work page and chat
 * came to disagree. These two routes are the one answer:
 *
 *   GET /work/:kind/:id   title, stages, gates and the job working on it
 *   GET /now              every piece of work being worked on right now,
 *                         plus what finished in the last few hours
 *
 * Nothing here derives a stage of its own; it calls the derivations that
 * already exist and says which job, if any, is on the work.
 */
import type { Hono } from "hono";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PRODUCTIONS, liveJobFor, listJobs, openPublicationIssue, type Job } from "@actalk/quire-core";
import { publicationMath, publicationPack, publicationRunning, publicationWorkflow, runningPublicationIds } from "./publications.js";
import { readAuditProject } from "./audit.js";
import type { Workflow } from "./workflow.js";

export interface WorkStatus {
  readonly kind: string;
  /** What it is, as a person says it: "Magazine", "Book", "Short". */
  readonly kindLabel: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly workflow: Workflow | null;
  /** The job working on it now, if one is. */
  readonly job: { readonly id: string; readonly stage: string; readonly startedAt: string | null; readonly message: string | null } | null;
  /** Whether its runner can be picked up at a stage. */
  readonly resumable: boolean;
}

export interface WorkDeps {
  readonly root: string;
  /** A book's title and workflow; the book store lives in server.ts. */
  readonly bookWork: (id: string) => Promise<{ title: string; subtitle: string; workflow: Workflow } | null>;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** `the-lamp-room` read as a name, for work that carries no title of its own. */
const named = (id: string) =>
  id.replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim() || id;

const jobOf = (j: Job | null): WorkStatus["job"] =>
  j ? { id: j.id, stage: j.stage, startedAt: j.startedAt ?? null, message: j.message ?? null } : null;

export async function workStatus(deps: WorkDeps, kind: string, id: string): Promise<WorkStatus | null> {
  const job = liveJobFor({ type: kind, id });
  const spec = PRODUCTIONS.find((p) => p.id === kind);

  if (kind === "publication") {
    const issue = await openPublicationIssue(deps.root, id, {}).then((o) => o.issue).catch(() => null);
    if (!issue) return null;
    const [pack, math] = await Promise.all([publicationPack(deps.root, id), publicationMath(deps.root, issue)]);
    return {
      kind, id,
      kindLabel: cap(issue.type || "magazine"),
      title: issue.title || issue.subject || named(id),
      subtitle: issue.pages.length ? `${issue.pages.length} pages` : `${issue.extent ?? "?"} pages planned`,
      workflow: publicationWorkflow(issue, publicationRunning(id), job, pack, math),
      job: jobOf(job),
      resumable: true,
    };
  }

  if (kind === "book") {
    const book = await deps.bookWork(id).catch(() => null);
    if (!book) return null;
    return {
      kind, id, kindLabel: "Book", title: book.title, subtitle: book.subtitle,
      workflow: job ? { ...book.workflow, running: true } : book.workflow,
      job: jobOf(job), resumable: false,
    };
  }

  const detail = spec ? await readAuditProject(deps.root, kind, id).catch(() => null) : null;
  if (!detail) {
    /* Work a job names that is not a production on disk yet - a chat run
       still starting, a crawl. Said as running, with no stages to show. */
    return job ? { kind, id, kindLabel: spec?.label ?? cap(kind), title: named(id), subtitle: "", workflow: null, job: jobOf(job), resumable: false } : null;
  }
  return {
    kind, id,
    kindLabel: detail.kindLabel,
    title: detail.title === id ? named(id) : detail.title,
    subtitle: detail.subtitle,
    workflow: job ? { ...detail.workflow, running: true } : detail.workflow,
    job: jobOf(job),
    resumable: detail.resumable,
  };
}

/** One line in the "now" list: a job, and the work it is on. */
export interface NowItem {
  readonly jobId: string | null;
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  readonly kindLabel: string;
  /** The job's own stage id; the client words it. */
  readonly stage: string | null;
  readonly status: Job["status"] | "running";
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly message: string | null;
  readonly error: string | null;
  readonly workflow: Workflow | null;
}

const RECENT_MS = 6 * 60 * 60 * 1000;

export function registerWorkRoutes(app: Hono, deps: WorkDeps): void {
  app.get("/api/v1/work/:kind/:id", async (c) => {
    const status = await workStatus(deps, c.req.param("kind"), c.req.param("id"));
    return status ? c.json(status) : c.json({ error: "There is no such work in this folder." }, 404);
  });

  app.get("/api/v1/now", async (c) => {
    const jobs = listJobs();
    const live = jobs.filter((j) => j.status === "running" || j.status === "queued");
    /* A magazine run started before its job was listed is still a run. */
    const orphans = runningPublicationIds().filter((id) => !live.some((j) => j.ref.type === "publication" && j.ref.id === id));

    const items: NowItem[] = [];
    for (const j of live) {
      const work = await workStatus(deps, j.ref.type, j.ref.id).catch(() => null);
      items.push({
        jobId: j.id, kind: j.ref.type, id: j.ref.id,
        title: work?.title ?? named(j.ref.id),
        kindLabel: work?.kindLabel ?? cap(j.ref.type),
        stage: j.stage, status: j.status,
        startedAt: j.startedAt ?? null, endedAt: null,
        message: j.message ?? null, error: null,
        workflow: work?.workflow ?? null,
      });
    }
    for (const id of orphans) {
      const work = await workStatus(deps, "publication", id).catch(() => null);
      if (!work) continue;
      items.push({
        jobId: null, kind: "publication", id, title: work.title, kindLabel: work.kindLabel,
        stage: null, status: "running", startedAt: null, endedAt: null, message: null, error: null,
        workflow: work.workflow,
      });
    }

    const since = Date.now() - RECENT_MS;
    const ended = jobs
      .filter((j) => j.endedAt && Date.parse(j.endedAt) >= since)
      .sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))
      .slice(0, 8);
    /* The work's own name - "Rain", not its folder - for each that still exists. */
    const named8 = await Promise.all(ended.map((j) => workStatus(deps, j.ref.type, j.ref.id).catch(() => null)));
    const recent = ended
      .map((j, i): NowItem => ({
        jobId: j.id, kind: j.ref.type, id: j.ref.id,
        title: named8[i]?.title ?? named(j.ref.id), kindLabel: named8[i]?.kindLabel ?? cap(j.ref.type),
        stage: j.stage, status: j.status,
        startedAt: j.startedAt ?? null, endedAt: j.endedAt ?? null,
        message: j.message ?? null, error: j.error ?? null, workflow: null,
      }));

    return c.json({ live: items, recent });
  });

  /*
   * Delete a piece of work, any kind. Its folders move to .quire/trash, out of
   * every listing, rather than being erased: one wrong press should not cost a
   * magazine. Refused while anything is working on it.
   */
  app.delete("/api/v1/work/:kind/:id", async (c) => {
    const kind = c.req.param("kind");
    const id = c.req.param("id");
    const spec = PRODUCTIONS.find((p) => p.id === kind);
    if (!spec || !id || /[\\/]|\.\./.test(id)) return c.json({ error: "There is no such work in this folder." }, 404);
    if (liveJobFor({ type: kind, id }) || (kind === "publication" && publicationRunning(id))) {
      return c.json({ error: "It is being worked on. Stop it first, then delete it." }, 409);
    }
    const homes = [join(spec.outDir, id), ...(kind === "publication" ? [join(spec.outDir, "issues", id)] : [])]
      .filter((rel) => existsSync(join(deps.root, rel)));
    if (!homes.length) return c.json({ error: "There is no such work in this folder." }, 404);
    const trash = join(deps.root, ".quire", "trash", `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}-${id}`);
    for (const rel of homes) {
      await mkdir(dirname(join(trash, rel)), { recursive: true });
      await rename(join(deps.root, rel), join(trash, rel));
    }
    return c.json({ ok: true, trash });
  });
}
