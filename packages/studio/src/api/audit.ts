/**
 * Audit anything already written.
 *
 * The checks existed and could only be reached from the run that produced the
 * thing: a publication had its own page, and everything else had two buttons
 * on a chat card that went away with the conversation. A book finished last
 * week, a short from before the audit was written, a folder of pages some
 * skill produced outside the pipeline — none of them could be checked at all.
 *
 * runStoryAudit has always taken a path rather than a project, so nothing here
 * needs the artifact to have come from anywhere in particular. This is the
 * surface it was missing.
 */
import { copyFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Hono } from "hono";
import {
  PRODUCTIONS,
  PipelineRunner,
  type ProductionRunSnapshot,
  type PublicationIssue,
  auditableRoots,
  createStoryAsk,
  runStoryAudit,
  runStoryDeslop,
  reviseStoryFile,
  safeChildPath,
  storyAuditReport,
  type Finding,
  type StoryAudit,
} from "@actalk/quire-core";
import {
  loadPipeline, pipelineFor, productionByDir, reportUnitDone,
} from "@actalk/quire-core";
import { gateState, publicationWorkflow, stageStates } from "./publications.js";
import { projectWorkflow, type Workflow } from "./workflow.js";
import {
  isApproved, passCounts, readAuditState, updateFileAudit, type FileAudit,
} from "./audit-state.js";
import {
  blockersFor, countBySeverity, readFindings, readPassage, recordRun, settleFinding,
} from "./findings-store.js";

export interface AuditRouteDeps {
  readonly root: string;
  readonly pipeline: () => Promise<PipelineRunner>;
  readonly broadcast: (event: string, data: unknown) => void;
}

export interface AuditTarget {
  /** Project-relative, and the id the run route takes. */
  readonly path: string;
  readonly name: string;
  /** Which production wrote it, as far as the path can say. */
  readonly kind: string;
  /** That production's own name, so the screen need not keep a second table. */
  readonly kindLabel: string;
  /** The piece of work this file belongs to — one book, one issue, one short. */
  readonly project: string;
  readonly words: number;
  readonly modified: string;
}

/**
 * Where finished work lives — asked, rather than restated.
 *
 * This was a hand-kept list, and it had drifted: it looked for scripts under
 * `scripts/` while the script runner has always written them to `dramas/`, so
 * no script has ever been auditable. Play worlds were missing entirely. The
 * production registry is where an output directory is declared now, and a
 * production that says it is not auditable — a play world is live state, not a
 * finished text — is not offered.
 *
 * Still an allowlist rather than a walk of the workspace: research caches,
 * per-chapter drafts and truth files are all markdown too, and offering to
 * audit a story bible would be offering nonsense.
 */
const ROOTS = auditableRoots();

/**
 * Directories that hold working state rather than finished work.
 *
 * `drafts` earns its place: a short is written two or three times before
 * `final/`, each version keeping its own numbered chapters. Offering all of
 * them listed one short story as sixty-four files with `0001.md` in it four
 * times, only one of which was the text that survived. Auditing a superseded
 * draft is auditing writing that has already been replaced.
 */
const SKIP = new Set([
  "node_modules", "assets", "source", "generated", "selected", "_trash",
  ".inkos", ".quire", "truth", "chapters-raw", "cache", "drafts",
]);

/** Files that are scaffolding for a run rather than the thing it produced. */
const SKIP_FILE = /^(book_rules|story_bible|author_intent|current_focus|series_rules|house_style|volume_outline|README|notes)\.md$/i;

/** A backup the audit itself left behind. Auditing one would be circular. */
const IS_BACKUP = /\.pre-audit\.[^.]+$/;

/**
 * Structural directories that are not the name of anything.
 *
 * A file's project is normally the first directory under the production's own
 * — `shorts/the-lamp-room/...`. Publications nest theirs one deeper under
 * `issues/`, and grouping eighty files under a folder called "issues" would be
 * the same as not grouping them.
 */
const CONTAINERS = new Set(["issues", "projects", "final", "drafts", "output"]);

function projectOf(relPath: string, outDir: string): string {
  const rest = relPath.slice(outDir.length).replace(/^\/+/, "").split("/");
  for (const segment of rest.slice(0, -1)) {
    if (!CONTAINERS.has(segment.toLowerCase())) return segment;
  }
  // A file sitting directly in the production directory belongs to no project.
  return rest.length > 1 ? rest[0]! : "";
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > 4) return;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, depth + 1, out);
    else if (entry.name.endsWith(".md") && !SKIP_FILE.test(entry.name) && !IS_BACKUP.test(entry.name)) {
      out.push(full);
    }
  }
}

export async function listAuditTargets(root: string): Promise<AuditTarget[]> {
  const targets: AuditTarget[] = [];
  for (const { dir, kind, label } of ROOTS) {
    const files: string[] = [];
    await walk(join(root, dir), 0, files);
    for (const file of files) {
      try {
        const info = await stat(file);
        // Below this a file is a stub, a heading, or a note to self — not a
        // piece of writing anyone would want judged.
        if (info.size < 400) continue;
        targets.push({
          path: relative(root, file).split("\\").join("/"),
          name: file.split(/[\\/]/).pop() ?? file,
          kind,
          kindLabel: label,
          project: projectOf(relative(root, file).split("\\").join("/"), dir),
          // Close enough to order by, and far cheaper than reading every file.
          words: Math.round(info.size / 6),
          modified: info.mtime.toISOString(),
        });
      } catch { /* vanished between listing and stat: not worth failing over */ }
    }
  }
  return targets.sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * The audit in flight for a file, so a second click cannot race the first and
 * so the person who started a minutes-long rewrite can stop it.
 *
 * This was a Set of paths. `runStoryAudit` has taken an `AbortSignal` since it
 * was written; nothing was ever holding the controller that could fire it.
 */
const running = new Map<string, AbortController>();

/** Where a rewriting pass keeps the text as it stood before it ran. */
function backupPathOf(path: string): string {
  return path.replace(/(\.[^.]+)$/, ".pre-audit$1");
}

async function exists(absolute: string): Promise<boolean> {
  try { await stat(absolute); return true; } catch { return false; }
}

export function registerAuditRoutes(app: Hono, deps: AuditRouteDeps): void {
  const { root, broadcast } = deps;

  app.get("/api/v1/audit/targets", async (c) => {
    return c.json({ targets: await listAuditTargets(root) });
  });

  app.get("/api/v1/audit/projects", async (c) => {
    return c.json({ projects: await listAuditProjects(root) });
  });

  // Sits under audit because that is where the walk and the counting already
  // live; it is asked for by the screen that names the workspace folder.
  app.get("/api/v1/workspace/summary", async (c) => {
    return c.json(await workspaceSummary(root));
  });

  app.get("/api/v1/audit/project/:kind/:id", async (c) => {
    const detail = await readAuditProject(root, c.req.param("kind"), c.req.param("id"));
    return detail ? c.json(detail) : c.json({ error: "no such project" }, 404);
  });

  /**
   * Sign off a whole project, or take the sign-off back.
   *
   * Approving twenty-two files one at a time is not a decision anyone makes
   * twenty-two times; it is one decision the screen was making you repeat. A
   * publication keeps its two approvals on the issue itself, so this hands
   * those to the routes that own them rather than writing a second copy of the
   * same fact into the audit state.
   */
  app.post("/api/v1/audit/project/:kind/:id/approve", async (c) => {
    const kind = c.req.param("kind");
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({})) as {
      approve?: boolean; by?: string; gate?: string;
    };
    const yes = body.approve !== false;

    const detail = await readAuditProject(root, kind, id);
    if (!detail) return c.json({ error: "no such project" }, 404);

    if (kind === "publication") {
      /* The issue owns these. Forwarding keeps one writer for one fact. */
      return c.json({
        forwarded: `/api/v1/publications/${encodeURIComponent(id)}/approve`,
        gate: body.gate === "design" ? "design" : "copy",
        approve: yes,
      });
    }

    /* An audit gate that is shut is a refusal, not a formality: signing off
       work the checks say contradicts itself is exactly the moment nothing
       downstream ever catches it again. `force` is how you mean it anyway. */
    const auditGate = detail.workflow.gates.find((g) => g.name === "audit");
    if (yes && auditGate && !auditGate.canApprove && body.gate !== "force") {
      return c.json({
        error: auditGate.blockers.join("; "),
        blockers: auditGate.blockers,
      }, 409);
    }

    const approved = yes ? { at: new Date().toISOString(), by: String(body.by || "you") } : null;
    for (const item of detail.items) {
      await updateFileAudit(root, item.path, { approved });
    }
    broadcast("audit:state", { kind, id });
    return c.json({ approved, files: detail.items.length });
  });

  /**
   * Check what was asked for.
   *
   * `revise: false` reports and changes nothing, which is the honest default
   * for work the user did not just ask to be rewritten. `deslop` acts only on
   * the findings about prose sounding machine-made and leaves a plot hole
   * reported but untouched.
   *
   * `paths` reads several files in one go, because that is the unit of the
   * decision: nobody audits one chapter of a book they are part-way through,
   * they audit the four they have written since the last time. Files are read
   * one after another rather than at once — the model behind this is serial
   * anyway, and a stop has to leave a knowable amount of work done.
   * `path` still works and means a list of one.
   */
  /**
   * Tell the pipeline that a read happened, when a read is what it was waiting
   * for.
   *
   * The audit has always been a button with no consequence beyond its own
   * screen: a production could sit at `content.audit` forever while somebody
   * audited every file in it, because nothing connected the two. This is that
   * connection, and it is deliberately narrow - it fires only when the run is
   * standing on the audit stage, so auditing a file again later moves nothing.
   *
   * Only work-shaped productions (a short, a translation) are reported. A book
   * audits per chapter and needs a chapter-to-unit map that does not exist
   * yet; reporting unit 1 for it would claim the whole book had been read.
   *
   * `satisfies` is which stage this run was: a de-AI pass is the destyle
   * stage, a read is the audit stage. Sending one for the other would let a
   * single button walk the run two steps.
   */
  async function reportAudited(
    paths: ReadonlyArray<string>,
    satisfies: "content.audit" | "content.destyle",
  ): Promise<void> {
    const refs = new Map<string, { type: string; id: string }>();
    for (const path of paths) {
      const [dir, id] = path.split("/");
      if (!dir || !id) continue;
      const spec = productionByDir(dir);
      if (!spec?.pipeline || spec.pipeline.unit !== "work") continue;
      refs.set(`${spec.id}/${id}`, { type: spec.id, id });
    }
    for (const ref of refs.values()) {
      try {
        const state = await loadPipeline(root, ref);
        if (!state || state.stage !== satisfies) continue;
        if (!pipelineFor(ref.type)) continue;
        await reportUnitDone({ projectRoot: root, ref, unit: 1 });
        broadcast("pipeline:stage", { kind: "stage:start", ref, stage: satisfies });
      } catch {
        // Bookkeeping never costs the audit that already ran.
      }
    }
  }

  app.post("/api/v1/audit/run", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      path?: string; paths?: ReadonlyArray<string>; revise?: boolean;
      deslop?: boolean; force?: boolean;
    };
    const requested = (Array.isArray(body.paths) && body.paths.length > 0
      ? body.paths
      : [body.path ?? ""]
    ).map((p) => String(p ?? "").trim()).filter(Boolean);

    if (requested.length === 0) return c.json({ error: "an artifact path is required" }, 400);
    const busy = requested.filter((p) => running.has(p));
    if (busy.length > 0) {
      return c.json({ error: `already being audited: ${busy.join(", ")}` }, 409);
    }

    /*
     * A signed-off file is not rewritten by a button.
     *
     * The editor was made read-only on approval and every pass beside it went
     * on working, so the lock stopped typing and permitted the model to
     * replace the whole chapter — which is the larger of the two edits.
     * Reporting is still allowed: it changes nothing.
     */
    const rewriting = body.revise === true || body.deslop === true;
    if (rewriting && body.force !== true) {
      const state = await readAuditState(root);
      const locked = requested.filter((p) => isApproved(state, p));
      if (locked.length > 0) {
        return c.json({
          error: locked.length === 1
            ? "this file has been signed off — withdraw the sign-off, or reopen it, before rewriting it"
            : `${locked.length} of these files have been signed off — withdraw the sign-offs before rewriting them`,
          locked,
        }, 409);
      }
    }

    const control = new AbortController();
    for (const p of requested) running.set(p, control);

    const ran: Array<{ path: string; findings: number; rounds: number; error?: string }> = [];
    const located: Finding[] = [];
    const read: string[] = [];
    let last: StoryAudit | null = null;

    try {
      const pipeline = await deps.pipeline();
      const ask = createStoryAsk(pipeline, control.signal);

      for (const path of requested) {
        control.signal.throwIfAborted();
        broadcast("audit:run", { path, state: "start" });
        const options = {
          projectRoot: root,
          path,
          signal: control.signal,
          ask,
          onProgress: (message: string) => broadcast("audit:progress", { path, message }),
          // The rewrite is minutes long and the editor beside it was showing
          // the text being replaced. Each finished section goes out as it lands.
          onText: (markdown: string) => broadcast("audit:text", { path, markdown }),
          // The heading of each section as it lands. `audit:text` carries the
          // whole document, which is what the editor needs and useless as a
          // progress signal.
          onSection: (heading: string) => broadcast("audit:section", { path, heading }),
        };

        try {
          const audit = body.deslop
            ? await runStoryDeslop(options)
            : await runStoryAudit({ ...options, revise: body.revise === true });
          last = audit;
          located.push(...audit.located);
          read.push(path);
          ran.push({ path, findings: audit.findings.length, rounds: audit.rounds });
          broadcast("audit:run", { path, state: "done" });

          /*
           * Every count here is a count of passes over the prose, so the three
           * numbers can be read against each other.
           *
           * `reads` used to be `+ 1` - one per request, whatever happened
           * inside it. A revise goes round the loop up to `MAX_ROUNDS` times
           * and audits once more before it stops, so a single press that
           * rewrote twice recorded one read and two rewrites, and the file
           * claimed to have been rewritten more often than it had been read.
           * A run audits `rounds + 1` times: once per round, plus the pass
           * that found nothing left to act on and ended the loop.
           *
           * The counts go up rather than being overwritten - "rewritten on
           * Tuesday" and "rewritten four times" are different facts and only
           * the second one tells you a file is fighting back.
           */
          const before = (await readAuditState(root)).files[path] ?? {};
          const added = passCounts(audit.rounds, body.deslop === true);
          await updateFileAudit(root, path, {
            checked: new Date().toISOString(),
            findings: audit.findings.length,
            warnings: audit.findings.filter((f) => f.severity !== "note").length,
            rewritten: audit.rounds > 0 ? new Date().toISOString() : undefined,
            reads: (before.reads ?? 0) + added.reads,
            revisions: (before.revisions ?? 0) + added.revisions,
            // A de-AI pass you asked for and that found nothing still ran.
            deslops: (before.deslops ?? 0) + added.deslops,
          });
          broadcast("audit:state", { path });
        } catch (error) {
          if (control.signal.aborted) throw error;
          /*
           * One unreadable file does not cost the other three.
           *
           * A run over four chapters that threw on the second used to lose the
           * first one's findings as well, because the whole request failed. The
           * failure is reported against its own file and the loop goes on.
           */
          const message = error instanceof Error ? error.message : String(error);
          ran.push({ path, findings: 0, rounds: 0, error: message });
          broadcast("audit:run", { path, state: "error", message });
        }
      }

      /*
       * Keep them. The findings were returned in this response and nowhere
       * else, so a second run reported the same six complaints with no memory
       * of the four somebody had already decided about, and there was no way
       * to say "fix that one" about any of them.
       */
      const kept = await recordRun(root, located, read);
      broadcast("findings:changed", { paths: read });
      await reportAudited(read, body.deslop === true ? "content.destyle" : "content.audit");

      const mine = kept.filter((f) => requested.includes(f.path));
      return c.json({
        // One file keeps the shape every existing caller reads.
        ...(last && requested.length === 1
          ? { audit: last, report: storyAuditReport(last) }
          : {}),
        ran,
        findings: mine,
        counts: countBySeverity(mine),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A pass the user stopped is not a failure, and saying "AbortError" to a
      // novelist who just clicked Stop is the app blaming them for it.
      const stopped = control.signal.aborted;
      for (const path of requested) {
        broadcast("audit:run", { path, state: stopped ? "cancelled" : "error", message });
      }
      if (!stopped) return c.json({ error: message }, 500);
      // Whatever finished before the stop is real work and is kept.
      if (located.length > 0) await recordRun(root, located, read);
      return c.json({ cancelled: true, ran }, 200);
    } finally {
      for (const p of requested) running.delete(p);
    }
  });

  /**
   * Stop the pass running against one artifact.
   *
   * There was no way to. A de-AI pass on a long chapter is minutes of model
   * time writing over the user's prose, and the only options were to watch it
   * finish or kill the app.
   */
  /**
   * One artefact, whole.
   *
   * The reading panel had only `GET /findings/:id`, which returns the one
   * paragraph a finding sits in. So the screen whose job is judging a page
   * could show a fragment of it and never the page — you could not read what
   * you were being asked to approve. The findings carry file-wide offsets, so
   * the caller can mark every one of them in the text this returns.
   */
  app.get("/api/v1/audit/file", async (c) => {
    const path = String(c.req.query("path") ?? "").trim();
    if (!path) return c.json({ error: "an artifact path is required" }, 400);
    try {
      const text = await readFile(safeChildPath(root, path), "utf-8");
      return c.json({
        path,
        text,
        words: text.split(/\s+/).filter(Boolean).length,
      });
    } catch {
      // Deleted or renamed out from under the record. Saying so beats a 500.
      return c.json({ error: "that file is not there any more" }, 404);
    }
  });

  /**
   * The page, as the person rewrote it.
   *
   * The reading panel could only ever save one paragraph, through a finding,
   * because a finding was the only thing it ever had on screen. With the whole
   * page there, "Edit" has to mean the page. Same lock as every other write:
   * a signed-off file is not replaced by a text box.
   */
  app.put("/api/v1/audit/file", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      path?: string; text?: string; force?: boolean;
    };
    const path = String(body.path ?? "").trim();
    const text = typeof body.text === "string" ? body.text : "";
    if (!path) return c.json({ error: "an artifact path is required" }, 400);
    // An empty save is a mistake every time; refusing it costs nothing and
    // losing a chapter to a stray Ctrl-A costs the whole chapter.
    if (!text.trim()) return c.json({ error: "a page cannot be saved empty" }, 400);
    if (body.force !== true && isApproved(await readAuditState(root), path)) {
      return c.json({
        error: "this file has been signed off — withdraw the sign-off before editing it",
      }, 409);
    }

    const file = safeChildPath(root, path);
    const before = await readFile(file, "utf-8").catch(() => null);
    if (before === null) return c.json({ error: "that file is not there any more" }, 404);
    if (before === text) return c.json({ path, changed: false });

    // The same backup an audit takes, so the same Restore puts it back.
    await writeFile(backupPathOf(file), before, "utf-8");
    await writeFile(file, text, "utf-8");
    await updateFileAudit(root, path, { rewritten: new Date().toISOString() });
    broadcast("audit:text", { path, markdown: text });
    broadcast("audit:state", { path });
    return c.json({ path, changed: true });
  });

  /**
   * An editor's note, turned into a rewrite of one file.
   *
   * The magazine has had this since it was written: say what is wrong with a
   * page and the revise pass fixes it. Every other kind of writing could only
   * be rewritten by running a whole audit and hoping it happened to object to
   * the same thing. Same lock as every other pass that writes: a file that has
   * been signed off is not rewritten by a sentence typed into a box.
   */
  app.post("/api/v1/audit/file/revise", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      path?: string; note?: string; force?: boolean;
    };
    const path = String(body.path ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!path) return c.json({ error: "an artifact path is required" }, 400);
    if (!note) return c.json({ error: "say what is wrong with it" }, 400);
    if (running.has(path)) return c.json({ error: "this file is already being worked on" }, 409);

    if (body.force !== true && isApproved(await readAuditState(root), path)) {
      return c.json({
        error: "this file has been signed off — withdraw the sign-off before rewriting it",
      }, 409);
    }

    const control = new AbortController();
    running.set(path, control);
    try {
      const pipeline = await deps.pipeline();
      broadcast("audit:run", { path, state: "start" });
      const out = await reviseStoryFile({
        projectRoot: root,
        path,
        note,
        ask: createStoryAsk(pipeline, control.signal),
        signal: control.signal,
        onProgress: (message: string) => broadcast("audit:progress", { path, message }),
        onText: (markdown: string) => broadcast("audit:text", { path, markdown }),
        onSection: (heading: string) => broadcast("audit:section", { path, heading }),
      });

      const before = (await readAuditState(root)).files[path] ?? {};
      await updateFileAudit(root, path, {
        ...(out.changed ? { rewritten: out.at } : {}),
        notes: (before.notes ?? 0) + 1,
        revisions: (before.revisions ?? 0) + (out.changed ? 1 : 0),
      });
      broadcast("audit:run", { path, state: "done" });
      broadcast("audit:state", { path });
      return c.json(out);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stopped = control.signal.aborted;
      broadcast("audit:run", { path, state: stopped ? "cancelled" : "error", message });
      if (stopped) return c.json({ cancelled: true, path }, 200);
      return c.json({ error: message }, 500);
    } finally {
      running.delete(path);
    }
  });

  app.post("/api/v1/audit/cancel", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { path?: string };
    const path = String(body.path ?? "").trim();
    const control = running.get(path);
    if (!control) return c.json({ error: "nothing is running for that path" }, 404);
    control.abort();
    return c.json({ cancelled: true });
  });

  /**
   * Put back the text as it stood before the last rewriting pass.
   *
   * `runStoryAudit` writes `<name>.pre-audit.md` before it changes a word and
   * always has. Nothing read it. The backup is kept rather than consumed, so
   * restoring twice is the same as restoring once.
   */
  app.post("/api/v1/audit/restore", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { path?: string };
    const path = String(body.path ?? "").trim();
    if (!path) return c.json({ error: "an artifact path is required" }, 400);
    if (running.has(path)) return c.json({ error: "this artifact is being audited right now" }, 409);
    if (isApproved(await readAuditState(root), path)) {
      return c.json({
        error: "this file has been signed off — withdraw the sign-off before putting an older copy back",
      }, 409);
    }

    const backup = join(root, backupPathOf(path));
    if (!(await exists(backup))) {
      return c.json({ error: "there is no pre-audit copy of this file" }, 404);
    }
    await copyFile(backup, join(root, path));
    const content = await readFile(join(root, path), "utf-8");
    // The file is the pre-rewrite text again, so the mark that says otherwise
    // has to go with it.
    await updateFileAudit(root, path, { rewritten: null });
    broadcast("audit:text", { path, markdown: content });
    broadcast("audit:state", { path });
    return c.json({ restored: true, content });
  });

  /**
   * Sign a file off, or take the sign-off back.
   *
   * Approval is the thing the screen had no way to say. A project of
   * twenty-two files being read one at a time needs somewhere to put "this one
   * is finished", or the reader is holding that list in their head. While it
   * holds, saving over the file is refused unless the caller says explicitly
   * that it meant to.
   */
  app.post("/api/v1/audit/approve", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      path?: string; approve?: boolean; by?: string;
    };
    const path = String(body.path ?? "").trim();
    if (!path) return c.json({ error: "an artifact path is required" }, 400);

    const approved = body.approve === false
      ? null
      : { at: new Date().toISOString(), by: String(body.by || "you") };
    await updateFileAudit(root, path, { approved });
    broadcast("audit:state", { path });
    return c.json({ approved });
  });

  /* ------------------------------------------------------------- findings
   *
   * The queue, and the three things a person does to a row in it.
   *
   * Findings used to exist only inside the response of the run that produced
   * them. These routes are the whole difference between a report and a piece
   * of work you can get to the end of.
   */

  /**
   * Everything still on record, newest run first, optionally for one file.
   *
   * Settled findings are included and marked rather than hidden, because "I
   * already dealt with that one" is exactly what a person re-opening this
   * screen needs to see; `open=1` is there for the callers that only want the
   * queue.
   */
  app.get("/api/v1/findings", async (c) => {
    const path = c.req.query("path");
    const openOnly = c.req.query("open") === "1";
    let findings = await readFindings(root);
    if (path) findings = findings.filter((f) => f.path === path);
    if (openOnly) findings = findings.filter((f) => f.state === "open");
    return c.json({
      findings: [...findings].sort(bySeverityThenPlace),
      counts: countBySeverity(findings),
    });
  });

  /**
   * One finding with the paragraph it is about.
   *
   * Separate from the list because it reads the file: a queue of forty
   * findings across nine chapters would otherwise open nine files to draw a
   * list nobody has scrolled yet.
   */
  app.get("/api/v1/findings/:id", async (c) => {
    const finding = (await readFindings(root)).find((f) => f.id === c.req.param("id"));
    if (!finding) return c.json({ error: "no such finding" }, 404);
    return c.json(await readPassage(root, finding));
  });

  /**
   * Take the fix, leave it, or put it back in the queue.
   *
   * `text` is the reviewer writing the replacement themselves, which the mock
   * insists on and which matters: a proposal that is nearly right is the
   * common case, and having to either accept a wrong word or reject the whole
   * finding is how review tools make people stop reviewing.
   */
  app.post("/api/v1/findings/:id/settle", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      state?: string; text?: string; scope?: string;
    };
    const state = body.state === "accepted" || body.state === "ignored" || body.state === "open"
      ? body.state
      : null;
    if (!state) return c.json({ error: "state must be accepted, ignored or open" }, 400);

    const before = (await readFindings(root)).find((f) => f.id === c.req.param("id"));
    // Signing a file off makes it read-only for every other pass in this app;
    // accepting a fix writes to it, so it is the same lock.
    if (state === "accepted" && before && isApproved(await readAuditState(root), before.path)) {
      return c.json({
        error: "this file has been signed off — withdraw the sign-off before changing it",
      }, 409);
    }

    const outcome = await settleFinding(
      root,
      c.req.param("id"),
      state,
      body.text,
      body.scope === "paragraph" ? "paragraph" : "quote",
    );
    if (!outcome.ok) {
      const status = outcome.reason === "no-such-finding" ? 404 : 409;
      return c.json({ error: SETTLE_ERRORS[outcome.reason], reason: outcome.reason }, status);
    }

    if (outcome.wrote) {
      const markdown = await readFile(join(root, outcome.finding.path), "utf-8");
      // The reading panel beside the queue is showing the paragraph that just
      // changed. It finds out the same way it finds out about a revise pass.
      broadcast("audit:text", { path: outcome.finding.path, markdown });
    }
    broadcast("findings:changed", { path: outcome.finding.path });
    return c.json({ ok: true, finding: outcome.finding, wrote: outcome.wrote });
  });
}

/** Why a settle could not happen, said to the person who asked for it. */
const SETTLE_ERRORS: Readonly<Record<string, string>> = {
  "no-such-finding": "that finding is not on record any more",
  "no-fix": "this finding has no proposed wording — write the replacement yourself",
  drifted: "the words this was about have changed since the check ran",
  empty: "a replacement cannot be empty",
};

/** Worst first, then in reading order, which is the order a queue is worked. */
const SEVERITY_ORDER = { blocking: 0, warning: 1, note: 2 } as const;

function bySeverityThenPlace(
  a: { severity: keyof typeof SEVERITY_ORDER; path: string; start: number },
  b: { severity: keyof typeof SEVERITY_ORDER; path: string; start: number },
): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  const byPath = a.path.localeCompare(b.path);
  return byPath !== 0 ? byPath : a.start - b.start;
}

/* ------------------------------------------------------------------ projects
 *
 * A file is not the unit anyone works in.
 *
 * The screen listed every auditable `.md` on disk, flat, and offered to check
 * one of them. That is not how the work is shaped: a magazine is sixteen pages
 * and a short is one story in sixty-four files, and the state that says how far
 * either has got is already written down — just not anywhere this route looked.
 *
 * Two shapes, not eight. Every production except publication commits a
 * `ProductionRunSnapshot` to `<outDir>/<id>/status.json`, and publication keeps
 * a richer issue at `Magazine/issues/<id>/publication.json` that the publication
 * screen already knows how to derive stages and gates from. Both are read here;
 * a project with neither still lists its files, so nothing disappears because a
 * run predates the snapshot.
 */

export interface AuditProject {
  readonly kind: string;
  readonly kindLabel: string;
  readonly id: string;
  readonly files: number;
  readonly words: number;
  readonly modified: string;
}

export interface AuditItem {
  readonly path: string;
  readonly name: string;
  readonly words: number;
  readonly modified: string;
  /** What has been done to this file, and whether it is signed off. */
  readonly audit: FileAudit;
  /**
   * Whether a rewriting pass left `<name>.pre-audit.md` beside this file.
   *
   * The backup has always been written and the screen has never known about
   * it, so a person watching a de-AI pass replace their chapter had no way to
   * learn the original still existed. One `stat` per listed file; the listing
   * already does one each.
   */
  readonly backup: boolean;
}

export interface AuditProjectDetail {
  readonly kind: string;
  readonly kindLabel: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  /** Empty when the project keeps no run state — the file list still stands. */
  readonly stages: ReadonlyArray<{ stage: string; state: string; detail: string }>;
  readonly findings: ReadonlyArray<{
    page: number | null;
    severity: string;
    category: string;
    description: string;
    suggestion: string;
  }>;
  readonly items: ReadonlyArray<AuditItem>;
  /**
   * The approvals a publication's build reads, when this is one.
   *
   * Left off everything else because nothing else has them: a short is not
   * signed off in two halves. Omitted rather than sent empty, so the screen
   * shows the pair or shows nothing instead of two dead buttons.
   */
  readonly gates?: ReturnType<typeof gateState>;
  /**
   * The same question every kind of work answers: where has this got to, what
   * is it waiting on, and can it be called finished.
   *
   * This used to be a magazine's alone. A short, a script and a storyboard got
   * a list of files and no answer at all, which is why the audit screen could
   * show you findings but never tell you whether the thing was done.
   */
  readonly workflow: Workflow;
  /** Whether this kind's runner can be resumed at a stage, as a magazine's can. */
  readonly resumable: boolean;
}

/** The work, grouped the way it was made. */
export async function listAuditProjects(root: string): Promise<AuditProject[]> {
  const byKey = new Map<string, AuditProject>();
  for (const target of await listAuditTargets(root)) {
    if (!target.project) continue;
    const key = `${target.kind}/${target.project}`;
    const seen = byKey.get(key);
    byKey.set(key, {
      kind: target.kind,
      kindLabel: target.kindLabel,
      id: target.project,
      files: (seen?.files ?? 0) + 1,
      words: (seen?.words ?? 0) + target.words,
      // Targets arrive newest first, so the first one seen is the project's own.
      modified: seen?.modified ?? target.modified,
    });
  }
  return [...byKey.values()];
}


/**
 * What is actually in the workspace folder, kind by kind.
 *
 * The folder is the user's to point anywhere, so the screen that names it has
 * to be able to say what is in the one they picked — otherwise choosing a
 * folder is an act of faith and a wrong choice looks identical to a right one.
 *
 * Every count here uses the same vocabulary as the audit screen, deliberately:
 * read is `checked`, signed off is `approved`, open and blocking come from the
 * findings store. Two screens that count the same word differently are two
 * screens that will eventually disagree in front of someone.
 *
 * Kinds come from the production registry and every auditable one is listed
 * even when it is empty. A kind that vanishes when it has nothing in it cannot
 * answer "is there anything here", which is the question being asked.
 */
/**
 * One creation, with the same counts the kind rows carry.
 *
 * A file is not the unit anyone works in. "Forty-two files" is true and says
 * nothing; "three creations, one of them signed off" is the sentence a person
 * came to the screen for, and it is the only unit that lets a short, an issue
 * and a novel be counted together at all.
 */
export interface WorkspaceProject {
  readonly kind: string;
  readonly label: string;
  readonly id: string;
  /** The folder name made readable, for work that carries no title of its own. */
  readonly title: string;
  readonly files: number;
  readonly words: number;
  readonly read: number;
  readonly signedOff: number;
  readonly open: number;
  readonly blocking: number;
  readonly modified: string;
}

/** `the-lamp-room` is a folder; `The Lamp Room` is what it is called. */
function titleOf(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim() || id;
}

export interface WorkspaceKindSummary {
  readonly kind: string;
  readonly label: string;
  readonly projects: number;
  readonly files: number;
  readonly words: number;
  readonly read: number;
  readonly signedOff: number;
  readonly open: number;
  readonly blocking: number;
}

export interface WorkspaceSummary {
  readonly kinds: ReadonlyArray<WorkspaceKindSummary>;
  /** Newest first, so a screen can take the top few and be showing the live work. */
  readonly projects: ReadonlyArray<WorkspaceProject>;
  readonly totals: Omit<WorkspaceKindSummary, "kind" | "label">;
  /** When anything in it last changed, so a stale folder reads as stale. */
  readonly modified: string | null;
}

export async function workspaceSummary(root: string): Promise<WorkspaceSummary> {
  const [targets, state, findings] = await Promise.all([
    listAuditTargets(root),
    readAuditState(root),
    readFindings(root),
  ]);

  const openBy = new Map<string, { open: number; blocking: number }>();
  for (const finding of findings) {
    if (finding.state !== "open") continue;
    const row = openBy.get(finding.path) ?? { open: 0, blocking: 0 };
    row.open += 1;
    if (finding.severity === "blocking") row.blocking += 1;
    openBy.set(finding.path, row);
  }

  interface Bucket extends Omit<WorkspaceKindSummary, "projects"> {
    projects: Set<string>;
    files: number;
    words: number;
    read: number;
    signedOff: number;
    open: number;
    blocking: number;
  }
  const buckets = new Map<string, Bucket>();
  for (const { kind, label } of auditableRoots()) {
    buckets.set(kind, {
      kind, label, projects: new Set<string>(),
      files: 0, words: 0, read: 0, signedOff: 0, open: 0, blocking: 0,
    });
  }

  /* Per creation, alongside per kind. Same walk, same counts, grouped by the
     piece of work rather than by the form it takes. */
  interface Project {
    kind: string; label: string; id: string;
    files: number; words: number; read: number; signedOff: number;
    open: number; blocking: number; modified: string;
  }
  const byProject = new Map<string, Project>();

  let modified: string | null = null;
  for (const target of targets) {
    const bucket = buckets.get(target.kind);
    if (!bucket) continue;
    if (target.project) bucket.projects.add(target.project);
    bucket.files += 1;
    bucket.words += target.words;
    const audit = state.files[target.path];
    const isRead = Boolean(audit?.checked);
    const isSigned = Boolean(audit?.approved);
    if (isRead) bucket.read += 1;
    if (isSigned) bucket.signedOff += 1;
    const open = openBy.get(target.path);
    if (open) { bucket.open += open.open; bucket.blocking += open.blocking; }
    if (!modified || target.modified > modified) modified = target.modified;

    // A file loose in a production directory belongs to no creation; counted
    // in its kind, but there is nothing to name it as a piece of work.
    if (!target.project) continue;
    const key = `${target.kind}/${target.project}`;
    const row = byProject.get(key) ?? {
      kind: target.kind, label: target.kindLabel, id: target.project,
      files: 0, words: 0, read: 0, signedOff: 0, open: 0, blocking: 0,
      modified: target.modified,
    };
    row.files += 1;
    row.words += target.words;
    if (isRead) row.read += 1;
    if (isSigned) row.signedOff += 1;
    if (open) { row.open += open.open; row.blocking += open.blocking; }
    if (target.modified > row.modified) row.modified = target.modified;
    byProject.set(key, row);
  }

  const kinds = [...buckets.values()].map((b) => ({
    kind: b.kind, label: b.label,
    projects: b.projects.size,
    files: b.files, words: b.words,
    read: b.read, signedOff: b.signedOff,
    open: b.open, blocking: b.blocking,
  }));

  const add = (pick: (k: WorkspaceKindSummary) => number) =>
    kinds.reduce((n, k) => n + pick(k), 0);

  const projects = [...byProject.values()]
    .map((p) => ({ ...p, title: titleOf(p.id) }))
    .sort((a, b) => b.modified.localeCompare(a.modified));

  return {
    kinds,
    projects,
    totals: {
      projects: add((k) => k.projects),
      files: add((k) => k.files),
      words: add((k) => k.words),
      read: add((k) => k.read),
      signedOff: add((k) => k.signedOff),
      open: add((k) => k.open),
      blocking: add((k) => k.blocking),
    },
    modified,
  };
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf-8")) as T; } catch { return null; }
}

/** `expected`/`actual` are deliberately `unknown` in the contract. Say them anyway. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.value !== "undefined") return `${o.value}${o.unit ? ` ${o.unit}` : ""}`;
    if (typeof o.target !== "undefined") return `${o.target} (${o.min}–${o.max}${o.unit ? ` ${o.unit}` : ""})`;
    return JSON.stringify(value);
  }
  return String(value);
}

export async function readAuditProject(
  root: string,
  kind: string,
  id: string,
): Promise<AuditProjectDetail | null> {
  const spec = PRODUCTIONS.find((p) => p.id === kind);
  if (!spec || !spec.auditable) return null;

  const state = await readAuditState(root);
  const items: AuditItem[] = await Promise.all(
    (await listAuditTargets(root))
      .filter((t) => t.kind === kind && t.project === id)
      .map(async ({ path, name, words, modified }) => ({
        path, name, words, modified,
        audit: state.files[path] ?? {},
        backup: await exists(join(root, backupPathOf(path))),
      })),
  );
  if (items.length === 0) return null;

  const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));
  const base = { kind, kindLabel: spec.label, id, items: sorted };
  /* Read once and shared by both branches below: the gate that decides whether
     this project can be called finished reads the same store the queue does. */
  const findings = await readFindings(root);

  // A publication already has a screen that derives stages and gates from the
  // issue. Reuse that derivation rather than growing a second, drifting one.
  if (kind === "publication") {
    const issue = await readJson<PublicationIssue>(
      join(root, spec.outDir, "issues", id, "publication.json"),
    );
    if (issue) {
      return {
        ...base,
        title: issue.title || issue.subject || id,
        subtitle: `${issue.type} · ${issue.pages.length} pages · ${issue.status}`,
        stages: stageStates(issue),
        gates: gateState(issue),
        workflow: publicationWorkflow(issue, false),
        /* Only a publication keeps a ladder of stages its runner can re-enter. */
        resumable: true,
        findings: (issue.audit?.findings ?? []).map((f) => ({
          page: f.page,
          severity: f.severity,
          category: f.category,
          description: f.description,
          suggestion: f.suggestion,
        })),
      };
    }
  }

  const snapshot = await readJson<ProductionRunSnapshot>(join(root, spec.outDir, id, "status.json"));
  if (snapshot) {
    return {
      ...base,
      title: snapshot.id || id,
      subtitle: `${snapshot.kind} · ${items.length} files · ${snapshot.status}`,
      // One production writes one stage, not a ladder of them. Saying "stage:
      // complete" honestly beats inventing six rows it never claimed.
      stages: [{ stage: snapshot.stage, state: snapshot.status, detail: snapshot.error ?? "" }],
      workflow: projectWorkflow({
        kind, kindLabel: spec.label, items: sorted, findings,
        runStage: { stage: snapshot.stage, state: snapshot.status, detail: snapshot.error ?? "" },
        lastError: snapshot.error ? { stage: snapshot.stage, message: snapshot.error } : null,
      }),
      resumable: false,
      findings: snapshot.observations.map((o) => ({
        page: null,
        severity: o.severity,
        category: o.metric,
        description: `expected ${describe(o.expected)}, got ${describe(o.actual)}`,
        suggestion: o.evidence ?? (o.repairable ? "This can be fixed by re-running the stage." : ""),
      })),
    };
  }

  // No run state: older work, or work some skill wrote outside a runner. The
  // files are real, so list them rather than pretending the project is gone.
  return {
    ...base,
    title: id,
    subtitle: `${spec.label} · ${items.length} files · no run state on disk`,
    stages: [],
    /* No runner wrote anything, but the files are real and so is what has been
       read and signed off on them. That is a workflow, just a shorter one. */
    workflow: projectWorkflow({ kind, kindLabel: spec.label, items: sorted, findings }),
    resumable: false,
    findings: [],
  };
}
