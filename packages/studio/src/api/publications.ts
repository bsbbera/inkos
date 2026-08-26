/**
 * Everything a publication needs from Studio that it did not have.
 *
 * Before this there were two routes, both GET: the installed types, and a list
 * of what had been made. Nothing could be opened, nothing approved, nothing
 * resumed. That mattered more than it sounds: the build gates check
 * `approved` and `designApproved`, and no surface anywhere could set either —
 * so every gate added in Phase 4 was a gate nobody could open, and a run
 * stopped after `write` was over for good.
 *
 * Kept out of server.ts deliberately. These routes need a pipeline (the audit
 * and the resume call the model) and that dependency is passed in rather than
 * reached for, so the whole surface can be exercised without a server.
 */

import type { Hono } from "hono";
import {
  approvePublication,
  approvePublicationDesign,
  createPublicationAsk,
  isPublicationPageWritten,
  openPublicationIssue,
  renderPublicationPage,
  revisePublicationPage,
  runPublication,
  runPublicationAudit,
  runPublicationDeslop,
  setPublicationNotes,
  unapprovePublication,
  unapprovePublicationDesign,
  checkPublicationDesign,
  type PipelineRunner,
  type PublicationFinding,
  type PublicationIssue,
  type PublicationStage,
} from "@actalk/quire-core";

export interface PublicationRouteDeps {
  readonly root: string;
  /** Built per request: a run must use whatever the project is configured with now. */
  readonly pipeline: () => Promise<PipelineRunner>;
  readonly broadcast: (event: string, data: unknown) => void;
}

const STAGES: ReadonlyArray<PublicationStage> = ["research", "plan", "write", "audit", "art", "build"];

/**
 * What has actually happened to this issue, read off the issue itself.
 *
 * Derived rather than stored: a status string drifts from the files the moment
 * anything is done outside the run that set it, and tools now do exactly that.
 */
export function stageStates(issue: PublicationIssue): Array<{ stage: PublicationStage; state: string; detail: string }> {
  const written = issue.pages.filter(isPublicationPageWritten).length;
  const withArt = issue.pages.filter((p) => p.image).length;
  const done = (yes: boolean) => (yes ? "done" : "pending");
  return [
    { stage: "research", state: done(!!issue.research), detail: issue.research ? "sources gathered" : "not run" },
    {
      stage: "plan",
      state: done(issue.pages.length > 0),
      detail: issue.pages.length ? `${issue.sections.length} sections, ${issue.pages.length} pages` : "no flatplan",
    },
    {
      stage: "write",
      state: written === 0 ? "pending" : written < issue.pages.length ? "partial" : "done",
      detail: `${written}/${issue.pages.length} pages written`,
    },
    {
      stage: "audit",
      state: issue.audit ? "done" : "pending",
      detail: issue.audit
        ? `${issue.audit.findings.length} findings${issue.audit.rounds ? `, ${issue.audit.rounds} revise rounds` : ", not revised"}`
        : "never audited",
    },
    {
      stage: "art",
      state: withArt === 0 ? "pending" : withArt < issue.pages.length ? "partial" : "done",
      detail: `${withArt}/${issue.pages.length} pages have art`,
    },
    {
      stage: "build",
      state: done(!!issue.build?.pdf),
      detail: issue.build?.pdf ?? "no PDF",
    },
  ];
}

/**
 * The gates, and — when one is shut — what is actually keeping it shut.
 *
 * "Cannot build" with no reason is what makes a gate feel like a bug. Every
 * blocked gate names its own remedy.
 */
export function gateState(issue: PublicationIssue) {
  const written = issue.pages.filter(isPublicationPageWritten).length;
  const designProblems = issue.design ? checkPublicationDesign(issue.design) : ["no design has been run"];

  const copyBlockers: string[] = [];
  if (issue.pages.length === 0) copyBlockers.push("there is no flatplan yet");
  else if (written < issue.pages.length) copyBlockers.push(`${issue.pages.length - written} pages are still unwritten`);
  if (!issue.audit) copyBlockers.push("the issue has not been audited");

  const buildBlockers: string[] = [];
  if (!issue.approved) buildBlockers.push("the copy is not approved");
  if (!issue.designApproved) buildBlockers.push("the design is not approved");
  if (designProblems.length) buildBlockers.push(...designProblems);

  return {
    copy: {
      approved: issue.approved ?? null,
      /** Approving is always allowed; these are what an editor should know first. */
      warnings: copyBlockers,
    },
    design: {
      approved: issue.designApproved ?? null,
      /** Unlike copy, an unsound design cannot be signed off — build reads it. */
      blockers: designProblems,
      canApprove: designProblems.length === 0,
    },
    build: { canBuild: buildBlockers.length === 0, blockers: buildBlockers },
  };
}

/** Runs in flight, so a second resume on the same issue is refused rather than raced. */
const running = new Set<string>();

export function registerPublicationRoutes(app: Hono, deps: PublicationRouteDeps): void {
  const { root, broadcast } = deps;

  /** A context whose stages can call the model, wired to this run's events. */
  const open = async (id: string, withModel: boolean) => {
    const onEvent = (event: unknown) => broadcast("publication:event", { id, ...(event as object) });
    if (!withModel) return openPublicationIssue(root, id, { onEvent });
    const pipeline = await deps.pipeline();
    return openPublicationIssue(root, id, {
      onEvent,
      ask: createPublicationAsk({ pipeline, projectRoot: root, issueId: id }),
    });
  };

  const detail = (issue: PublicationIssue) => ({
    issue,
    stages: stageStates(issue),
    gates: gateState(issue),
    running: running.has(issue.id),
  });

  // Everything about one issue, in the shape the detail page needs: what has
  // run, what is gated on what, and every finding the audit left standing.
  app.get("/api/v1/publications/:id", async (c) => {
    const { issue } = await open(c.req.param("id"), false);
    return c.json(detail(issue));
  });

  // The two decisions, kept separate on purpose: an editor who signs off the
  // copy has not seen the layout, and usually cannot until it is built.
  app.post("/api/v1/publications/:id/approve", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({})) as { what?: string; approve?: boolean };
    const what = body.what === "design" ? "design" : "copy";
    const yes = body.approve !== false;
    const { ctx } = await open(id, false);

    const issue = what === "design"
      ? yes ? await approvePublicationDesign(ctx, id) : await unapprovePublicationDesign(ctx, id)
      : yes ? await approvePublication(ctx, id) : await unapprovePublication(ctx, id);

    broadcast("publication:issue", { id, [what === "design" ? "designApproved" : "approved"]: yes });
    return c.json(detail(issue));
  });

  /**
   * Pick the run back up.
   *
   * A run that stopped at `write` was unrecoverable before this: the context
   * that could continue it only existed inside the tool call that started it.
   */
  app.post("/api/v1/publications/:id/resume", async (c) => {
    const id = c.req.param("id");
    if (running.has(id)) return c.json({ error: "this issue is already running" }, 409);
    const body = await c.req.json().catch(() => ({})) as { from?: PublicationStage; stopAt?: PublicationStage };
    const from = STAGES.includes(body.from as PublicationStage) ? body.from as PublicationStage : "write";
    const stopAt = STAGES.includes(body.stopAt as PublicationStage) ? body.stopAt as PublicationStage : "audit";

    const { ctx } = await open(id, true);
    running.add(id);
    broadcast("publication:run", { id, state: "start", from, stopAt });

    // Not awaited: a forty-page resume outlives any sane request timeout, and
    // progress already arrives over SSE.
    void runPublication(ctx, id, { from, stopAt })
      .then(() => broadcast("publication:run", { id, state: "done" }))
      .catch((error: unknown) => broadcast("publication:run", {
        id, state: "error", message: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => running.delete(id));

    return c.json({ started: true, from, stopAt });
  });

  // The checks, on demand. `revise: false` reports without touching the copy.
  app.post("/api/v1/publications/:id/audit", async (c) => {
    const id = c.req.param("id");
    if (running.has(id)) return c.json({ error: "this issue is already running" }, 409);
    const body = await c.req.json().catch(() => ({})) as { revise?: boolean; deslop?: boolean };
    const { ctx } = await open(id, true);
    running.add(id);
    try {
      const issue = body.deslop
        ? await runPublicationDeslop(ctx, id)
        : await runPublicationAudit(ctx, id, { revise: body.revise !== false });
      return c.json(detail(issue));
    } finally {
      running.delete(id);
    }
  });

  // A page as an image, so a spread can be looked at instead of inferred from
  // the layout report.
  app.post("/api/v1/publications/:id/render", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({})) as { page?: number };
    const { ctx } = await open(id, false);
    return c.json(await renderPublicationPage(ctx, id, Number(body.page ?? 1)));
  });

  /**
   * An editor's note, turned into a rewrite.
   *
   * A note about a page becomes a finding and goes through the same revise
   * pass the audit uses, so feedback lands where the checks land instead of in
   * a comment field nothing reads. A note about the issue as a whole has no
   * one page to rewrite, so it is stored where every later stage reads it.
   */
  app.post("/api/v1/publications/:id/feedback", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({})) as { page?: number; note?: string };
    const note = String(body.note ?? "").trim();
    if (!note) return c.json({ error: "a note is required" }, 400);

    if (!body.page) {
      const { ctx } = await open(id, false);
      const issue = await setPublicationNotes(ctx, id, note);
      return c.json(detail(issue));
    }

    const { ctx } = await open(id, true);
    const finding: PublicationFinding = {
      page: Number(body.page),
      severity: "warning",
      category: "feedback/editor",
      description: `p${body.page}: ${note}`,
      suggestion: "Do what the editor asked, and change nothing else.",
    };
    const changed = await revisePublicationPage(ctx, id, Number(body.page), [finding]);
    const { issue } = await open(id, false);
    return c.json({ ...detail(issue), changed });
  });
}
