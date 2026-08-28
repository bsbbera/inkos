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
import { copyFile, readFile, readdir, stat } from "node:fs/promises";
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
  storyAuditReport,
} from "@actalk/quire-core";
import { gateState, stageStates } from "./publications.js";
import {
  isApproved, readAuditState, updateFileAudit, type FileAudit,
} from "./audit-state.js";

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

  app.get("/api/v1/audit/project/:kind/:id", async (c) => {
    const detail = await readAuditProject(root, c.req.param("kind"), c.req.param("id"));
    return detail ? c.json(detail) : c.json({ error: "no such project" }, 404);
  });

  /**
   * Check one artifact.
   *
   * `revise: false` reports and changes nothing, which is the honest default
   * for work the user did not just ask to be rewritten. `deslop` acts only on
   * the findings about prose sounding machine-made and leaves a plot hole
   * reported but untouched.
   */
  app.post("/api/v1/audit/run", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      path?: string; revise?: boolean; deslop?: boolean;
    };
    const path = String(body.path ?? "").trim();
    if (!path) return c.json({ error: "an artifact path is required" }, 400);
    if (running.has(path)) return c.json({ error: "this artifact is already being audited" }, 409);

    /*
     * A signed-off file is not rewritten by a button.
     *
     * The editor was made read-only on approval and every pass beside it went
     * on working, so the lock stopped typing and permitted the model to
     * replace the whole chapter — which is the larger of the two edits.
     * Reporting is still allowed: it changes nothing.
     */
    const rewriting = body.revise === true || body.deslop === true;
    if (rewriting && !(body as { force?: boolean }).force) {
      const state = await readAuditState(root);
      if (isApproved(state, path)) {
        return c.json({
          error: "this file has been signed off — withdraw the sign-off, or reopen it, before rewriting it",
        }, 409);
      }
    }

    const control = new AbortController();
    running.set(path, control);
    broadcast("audit:run", { path, state: "start" });
    try {
      const pipeline = await deps.pipeline();
      const options = {
        projectRoot: root,
        path,
        signal: control.signal,
        ask: createStoryAsk(pipeline, control.signal),
        onProgress: (message: string) => broadcast("audit:progress", { path, message }),
        // The rewrite is minutes long and the editor beside it was showing the
        // text being replaced. Each finished section goes out as it lands.
        onText: (markdown: string) => broadcast("audit:text", { path, markdown }),
        // The heading of each section as it lands. `audit:text` carries the
        // whole document, which is what the editor needs and useless as a
        // progress signal.
        onSection: (heading: string) => broadcast("audit:section", { path, heading }),
      };
      const audit = body.deslop
        ? await runStoryDeslop(options)
        : await runStoryAudit({ ...options, revise: body.revise === true });
      broadcast("audit:run", { path, state: "done" });
      // What the tree needs to stop showing twenty-two identical rows: which
      // of them have been through this, and which of them were rewritten.
      const warnings = audit.findings.filter((f) => f.severity === "warning").length;
      await updateFileAudit(root, path, {
        checked: new Date().toISOString(),
        findings: audit.findings.length,
        warnings,
        rewritten: audit.rounds && audit.rounds > 0 ? new Date().toISOString() : undefined,
      });
      broadcast("audit:state", { path });
      return c.json({ audit, report: storyAuditReport(audit) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A pass the user stopped is not a failure, and saying "AbortError" to a
      // novelist who just clicked Stop is the app blaming them for it.
      const stopped = control.signal.aborted;
      broadcast("audit:run", { path, state: stopped ? "cancelled" : "error", message });
      return stopped
        ? c.json({ cancelled: true }, 200)
        : c.json({ error: message }, 500);
    } finally {
      running.delete(path);
    }
  });

  /**
   * Stop the pass running against one artifact.
   *
   * There was no way to. A de-AI pass on a long chapter is minutes of model
   * time writing over the user's prose, and the only options were to watch it
   * finish or kill the app.
   */
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

  const base = {
    kind,
    kindLabel: spec.label,
    id,
    items: [...items].sort((a, b) => a.path.localeCompare(b.path)),
  };

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
    findings: [],
  };
}
