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
import { gate, type StageState, type Workflow } from "./workflow.js";
import { appendFeedback } from "./taste.js";
import { locate, normalizeSeverity, type Finding } from "@actalk/quire-core";
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
  designPublicationSection,
  enqueueJob,
  type PipelineRunner,
  type PublicationFinding,
  type PublicationIssue,
  publicationPageBriefs,
  type PublicationStage,
  setPublicationLastError,
  listPublicationIssueIds,
  nextIssueDue,
  setIssueSchedule,
  startNextIssue,
  liveJobFor,
  listMaterialAssets,
} from "@actalk/quire-core";

/** One research file the issue could draw on, and whether it did. */
export interface ResearchInput {
  readonly title: string;
  readonly source: string;
  readonly path: string;
  readonly chars: number;
  readonly cited: boolean;
}

/*
 * The files a run reads before it writes.
 *
 * The research stage searches the project's archived material first and cites
 * what it uses by the page's own address. None of that was on screen: the
 * issue said "3 blocks of gathered material: title, thesis, pillars", which is
 * the shape of a JSON object, not a list of what was read. Cited files lead.
 */
export async function researchInputs(root: string, issue: PublicationIssue): Promise<{
  readonly sources: number;
  readonly files: ReadonlyArray<ResearchInput>;
}> {
  const pillars = ((issue.research as { pillars?: Record<string, { sources?: ReadonlyArray<{ url?: string }> }> } | null)
    ?.pillars) ?? {};
  const cited = new Set<string>();
  for (const pillar of Object.values(pillars)) {
    for (const s of pillar.sources ?? []) if (s.url) cited.add(s.url);
  }
  const assets = (await listMaterialAssets(root).catch(() => []))
    .filter((a) => a.purpose === "research");
  const files = assets
    .map((a) => ({
      title: a.title,
      source: a.source,
      path: a.markdownPath,
      chars: a.charCount,
      cited: cited.has(a.source) || cited.has(`material:${a.id}`),
    }))
    .sort((x, y) => Number(y.cited) - Number(x.cited) || x.title.localeCompare(y.title));
  return { sources: cited.size, files };
}

export interface PublicationRouteDeps {
  readonly root: string;
  /** Built per request: a run must use whatever the project is configured with now. */
  readonly pipeline: () => Promise<PipelineRunner>;
  readonly broadcast: (event: string, data: unknown) => void;
}

const STAGES: ReadonlyArray<PublicationStage> = ["research", "plan", "write", "fact-check", "audit", "design", "art", "build"];

/**
 * What has actually happened to this issue, read off the issue itself.
 *
 * Derived rather than stored: a status string drifts from the files the moment
 * anything is done outside the run that set it, and tools now do exactly that.
 */
export function stageStates(
  issue: PublicationIssue,
  inFlight?: { readonly stage: string; readonly message?: string } | null,
): Array<{ stage: PublicationStage; state: string; detail: string }> {
  const stages = withFailure(issue, baseStageStates(issue));
  if (!inFlight) return stages;
  // The strip is the one place that says what is happening now. The header
  // used to repeat it as text ("planning · running") while the strip still
  // read "no flatplan" for the very stage being worked on.
  return stages.map((st) => (
    st.stage === inFlight.stage
      // Progress it already has ("12/50 pages written") is kept; a stage with
      // nothing to show yet says it is being worked on.
      ? { ...st, state: "running", detail: st.state === "pending" ? "working on it" : st.detail }
      : st
  ));
}

/*
 * A stage that threw says so, instead of reading as one that never ran.
 *
 * The issue records where the last run died. Without this the strip showed
 * research as "not run" after research had run and failed, which reads as
 * nothing happened rather than as something to pick back up.
 */
function withFailure(
  issue: PublicationIssue,
  stages: Array<{ stage: PublicationStage; state: string; detail: string }>,
) {
  const failed = issue.lastError?.stage;
  if (!failed) return stages;
  // A Stop is the person's decision, not a fault: the stage keeps the state
  // its work puts it in, and says it was stopped.
  // Records from before the flag carry only the runner's words.
  const stopped = issue.lastError!.stopped === true || /^stopped by user\.?$/i.test(issue.lastError!.message.trim());
  return stages.map((s) => (
    s.stage === failed && s.state !== "done"
      ? stopped
        ? { ...s, detail: `stopped · ${s.detail}` }
        : { ...s, state: "failed", detail: firstLine(issue.lastError!.message) }
      : s
  ));
}

/** The reason, short enough for a strip that has one line per stage. */
function firstLine(message: string): string {
  const line = (message.split("\n")[0] ?? "").trim();
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

function baseStageStates(issue: PublicationIssue): Array<{ stage: PublicationStage; state: string; detail: string }> {
  const written = issue.pages.filter(isPublicationPageWritten).length;
  // A page wanting no picture is not a page missing one. Counting by `image`
  // made every plate-free page read as outstanding art forever.
  const wantsArt = issue.pages.filter((p) => publicationPageBriefs(p).length > 0);
  const withArt = wantsArt.filter(
    (p) => (p.images ?? (p.image ? [p.image] : [])).filter(Boolean).length
      >= publicationPageBriefs(p).length,
  ).length;
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
      stage: "fact-check",
      // A run that stopped part-way keeps what it checked, and says so.
      state: !issue.factCheck ? "pending" : issue.factCheck.complete === false ? "partial" : "done",
      detail: issue.factCheck
        ? `${issue.factCheck.checked} claims checked, ${
          issue.factCheck.findings.filter((f) => f.verdict === "unsupported" || f.verdict === "contradicted").length
        } worth acting on${issue.factCheck.complete === false
          ? `, ${Object.keys(issue.factCheck.pages ?? {}).length}/${issue.pages.length} pages`
          : ""}`
        : "never checked",
    },
    {
      stage: "audit",
      state: issue.audit ? "done" : "pending",
      detail: issue.audit
        ? `${issue.audit.findings.length} findings${issue.audit.rounds ? `, ${issue.audit.rounds} revise rounds` : ", not revised"}`
        : "never audited",
    },
    {
      // The design decides the palette, the type and one world per section.
      // Nothing ran it until 2026-09-17, which is why an issue with every page
      // written still could not be built: the build reads this and refuses
      // without it.
      stage: "design",
      state: issue.design ? "done" : "pending",
      detail: issue.design
        ? `${issue.design.sections?.length ?? 0} sections styled`
        : "no design yet",
    },
    {
      stage: "art",
      state: issue.pages.length === 0
        ? "pending"
        : wantsArt.length === 0
        // Briefs are written with the pages, so until every page is written
        // "none asked for a picture" is not yet known, and is not done.
        ? (written < issue.pages.length ? "pending" : "done")
        : withArt === 0 ? "pending" : withArt < wantsArt.length ? "partial" : "done",
      // With no flatplan, no page has asked for anything yet; that is not done.
      detail: issue.pages.length === 0
        ? "no flatplan yet"
        : wantsArt.length === 0
        ? "no page asked for a picture"
        : `${withArt}/${wantsArt.length} pages have art`,
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

/**
 * Every finding, told where it is.
 *
 * The audit already knew — the AI-tell checks compute the exact run of
 * sentences they object to — and the issue file kept only the sentence of
 * prose describing it. So a magazine finding could be read but never seen:
 * "p4: detected 7 consecutive sentences with the same opening pattern", with
 * no way to reach the seven sentences.
 *
 * The page's own body is the text a quote is located against, which is why
 * this is per-page rather than over the issue: two pages can contain the same
 * sentence, and a finding about page 4 marked on page 9 is a wrong answer
 * rather than a missing one.
 */
export function locatedFindings(issue: PublicationIssue): ReadonlyArray<Finding> {
  const at = issue.audit?.at ?? new Date().toISOString();
  const bodyOf = new Map(issue.pages.map((p) => [p.n, p.body ?? ""]));
  return (issue.audit?.findings ?? []).map((f) => locate(
    {
      /* A page is the unit a magazine finding belongs to, so it stands in for
         the file path the chapter side uses. It is what the screen groups on
         and what a later settle would have to write back to. */
      path: `${issue.id}#p${f.page}`,
      section: f.page ? `p${f.page}` : "",
      category: f.category,
      /* Two vocabularies, one meaning: the publication audit says info where
         the rest of the app says note, and neither ever says blocking. */
      severity: normalizeSeverity(f.severity),
      description: f.description,
      suggestion: f.suggestion,
      ...(f.quote ? { quote: f.quote } : {}),
    },
    bodyOf.get(f.page) ?? "",
    at,
  ));
}

/**
 * The same issue, said in the vocabulary every other kind of work now uses.
 *
 * `stageStates` and `gateState` stay as they are because the publication
 * routes and their tests are built on them; this is the adapter, so one screen
 * component can render a magazine and a book without knowing which it has.
 */
export function publicationWorkflow(
  issue: PublicationIssue,
  isRunning: boolean,
  inFlight?: { readonly stage: string; readonly message?: string } | null,
): Workflow {
  const g = gateState(issue);
  return {
    kind: issue.type || "publication",
    stages: stageStates(issue, inFlight).map((s) => ({
      stage: s.stage,
      // The publication side has always spoken these three words; it just
      // never had a type saying so.
      state: (["done", "partial", "failed", "running"].includes(s.state) ? s.state : "pending") as StageState,
      detail: s.detail,
    })),
    gates: [
      /* Copy has warnings and no blockers on purpose: an editor may sign off
         an unfinished issue, and always could. Design is the opposite - build
         reads it, so an unsound design cannot be waved through. */
      gate("copy", "Copy", g.copy.approved, [], g.copy.warnings),
      gate("design", "Design", g.design.approved, g.design.blockers),
    ],
    done: { can: g.build.canBuild, blockers: g.build.blockers },
    running: isRunning,
    lastError: issue.lastError ?? null,
  };
}

/** Runs in flight, so a second resume on the same issue is refused rather than raced. */
const running = new Set<string>();

/*
 * Whether anything is working on this issue, from any door.
 *
 * The set only knows the runs this file started. A run confirmed in chat
 * never touched it, so the issue page said "not running" while that run
 * wrote pages. The job list is the account every run now reports to.
 */
const isRunning = (id: string): boolean =>
  running.has(id) || liveJobFor({ type: "publication", id }) !== null;

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

  const detail = async (issue: PublicationIssue) => ({
    inputs: await researchInputs(root, issue),
    issue,
    stages: stageStates(issue, liveJobFor({ type: "publication", id: issue.id })),
    gates: gateState(issue),
    running: isRunning(issue.id),
    /* The shared shape, alongside the two the existing screen reads. Both are
       derived from the same issue, so they cannot disagree. */
    workflow: publicationWorkflow(issue, isRunning(issue.id), liveJobFor({ type: "publication", id: issue.id })),
    /* Findings that know where they are, so the screen can mark the sentence
       rather than paraphrase it. */
    located: locatedFindings(issue),
  });

  // Everything about one issue, in the shape the detail page needs: what has
  // run, what is gated on what, and every finding the audit left standing.
  app.get("/api/v1/publications/:id", async (c) => {
    const { issue } = await open(c.req.param("id"), false);
    return c.json(await detail(issue));
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
    return c.json(await detail(issue));
  });

  /*
   * One section's look, chosen by the editor rather than by the stage.
   *
   * The design stage decides every section in one pass. That is the right
   * default and the wrong last word: sections are meant to be different from
   * each other, and the editor is the one who can say a register is wrong for
   * this subject. The issue's law — palette, type, grid — is untouched.
   *
   * Queued rather than awaited: it is a model call, and the screen already
   * follows jobs. The design sign-off drops, because it was given to a design
   * that no longer stands.
   */
  app.post("/api/v1/publications/:id/design/section", async (c) => {
    const id = c.req.param("id");
    if (isRunning(id)) return c.json({ error: "this issue is running — stop it first" }, 409);
    const body = await c.req.json().catch(() => ({})) as { n?: number; note?: string };
    const n = Number(body.n);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: "a section number is required" }, 400);
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const { ctx } = await open(id, true);
    const job = enqueueJob({
      ref: { type: "publication", id },
      stage: "design.section",
      work: async ({ signal, onProgress }) => {
        onProgress(`Choosing a world for section ${n}…`);
        const issue = await designPublicationSection({ ...ctx, signal }, id, n, note || undefined);
        broadcast("publication:issue", { id, designApproved: false });
        broadcast("design:changed", { type: "publication", id });
        return issue;
      },
    });
    return c.json({ ok: true, job });
  });

  /**
   * Pick the run back up.
   *
   * A run that stopped at `write` was unrecoverable before this: the context
   * that could continue it only existed inside the tool call that started it.
   */
  app.post("/api/v1/publications/:id/resume", async (c) => {
    const id = c.req.param("id");
    if (isRunning(id)) return c.json({ error: "this issue is already running" }, 409);
    const body = await c.req.json().catch(() => ({})) as { from?: PublicationStage; stopAt?: PublicationStage };
    const from = STAGES.includes(body.from as PublicationStage) ? body.from as PublicationStage : "write";
    const stopAt = STAGES.includes(body.stopAt as PublicationStage) ? body.stopAt as PublicationStage : "audit";

    const { ctx } = await open(id, true);
    running.add(id);
    broadcast("publication:run", { id, state: "start", from, stopAt });

    // Not awaited: a forty-page resume outlives any sane request timeout, and
    // progress already arrives over SSE.
    // The failure is recorded on the issue as well as broadcast. It used to be
    // broadcast only, so a run that died at page two left the issue reading
    // "writing, 1/16, not running" with no reason attached — the explanation
    // lived only in an SSE frame, and only for whoever had the page open at
    // that second.
    void setPublicationLastError(ctx, id, null)
      .then(() => runPublication(ctx, id, { from, stopAt }))
      .then(() => broadcast("publication:run", { id, state: "done" }))
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        await setPublicationLastError(ctx, id, { stage: from, message });
        broadcast("publication:run", { id, state: "error", message });
      })
      .finally(() => running.delete(id));

    return c.json({ started: true, from, stopAt });
  });

  // Who it is for (picks the writing bar, 13 §4b) and how often a new one is made.
  app.post("/api/v1/publications/:id/schedule", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({})) as { recurring?: unknown; audience?: unknown };
    const recurring = body.recurring === "weekly" || body.recurring === "monthly"
      ? body.recurring
      : body.recurring === null || body.recurring === "" ? null : undefined;
    const audience = typeof body.audience === "string" ? body.audience : undefined;
    const { ctx } = await open(id, false);
    const issue = await setIssueSchedule(ctx, id, {
      ...(recurring !== undefined ? { recurring } : {}),
      ...(audience !== undefined ? { audience } : {}),
    });
    return c.json({
      id: issue.id,
      recurring: issue.recurring ?? null,
      audience: issue.audience ?? null,
      nextDue: nextIssueDue(issue)?.toISOString() ?? null,
    });
  });

  /*
   * The personal magazine's clock (13 §Sources). Once a minute after start and
   * hourly after that: a recurring issue whose successor is due gets it made,
   * and the new issue researches, plans and writes on its own up to the audit.
   * It stops where a person has to sign off, like every other run.
   */
  const tick = async () => {
    for (const id of await listPublicationIssueIds(root).catch(() => [] as string[])) {
      if (isRunning(id)) continue;
      try {
        const { ctx, issue } = await open(id, false);
        const due = nextIssueDue(issue);
        if (!due || due > new Date()) continue;
        const next = await startNextIssue(ctx, id);
        if (!next) continue;
        broadcast("publication:created", { id: next.id, from: id, recurring: next.recurring ?? null });
        const { ctx: runCtx } = await open(next.id, true);
        running.add(next.id);
        void runPublication(runCtx, next.id, { from: "research", stopAt: "audit" })
          .then(() => broadcast("publication:run", { id: next.id, state: "done" }))
          .catch(async (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            await setPublicationLastError(runCtx, next.id, { stage: "research", message });
            broadcast("publication:run", { id: next.id, state: "error", message });
          })
          .finally(() => running.delete(next.id));
      } catch {
        // One unreadable issue does not stop the others being checked.
      }
    }
  };
  setTimeout(() => void tick(), 60_000).unref?.();
  setInterval(() => void tick(), 60 * 60_000).unref?.();

  // The checks, on demand. `revise: false` reports without touching the copy.
  app.post("/api/v1/publications/:id/audit", async (c) => {
    const id = c.req.param("id");
    if (isRunning(id)) return c.json({ error: "this issue is already running" }, 409);
    const body = await c.req.json().catch(() => ({})) as { revise?: boolean; deslop?: boolean };
    const { ctx } = await open(id, true);
    running.add(id);
    try {
      const issue = body.deslop
        ? await runPublicationDeslop(ctx, id)
        : await runPublicationAudit(ctx, id, { revise: body.revise !== false });
      return c.json(await detail(issue));
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
    // An editor's note is a verdict too, and lands in the same stream (18 §1).
    await appendFeedback(root, {
      ref: { type: "publication", id, ...(body.page ? { unit: Number(body.page) } : {}) },
      surface: "content", verdict: "tweak", note, source: "page",
    }).catch(() => undefined);

    if (!body.page) {
      const { ctx } = await open(id, false);
      const issue = await setPublicationNotes(ctx, id, note);
      return c.json(await detail(issue));
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
    return c.json({ ...(await detail(issue)), changed });
  });
}
