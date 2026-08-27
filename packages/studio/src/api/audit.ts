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
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Hono } from "hono";
import {
  PipelineRunner,
  auditableRoots,
  createStoryAsk,
  runStoryAudit,
  runStoryDeslop,
  storyAuditReport,
} from "@actalk/quire-core";

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

/** Directories that hold working state rather than finished work. */
const SKIP = new Set([
  "node_modules", "assets", "source", "generated", "selected", "_trash",
  ".inkos", ".quire", "truth", "chapters-raw", "cache",
]);

/** Files that are scaffolding for a run rather than the thing it produced. */
const SKIP_FILE = /^(book_rules|story_bible|author_intent|current_focus|series_rules|house_style|volume_outline|README|notes)\.md$/i;

/** A backup the audit itself left behind. Auditing one would be circular. */
const IS_BACKUP = /\.pre-audit\.[^.]+$/;

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
          // Close enough to order by, and far cheaper than reading every file.
          words: Math.round(info.size / 6),
          modified: info.mtime.toISOString(),
        });
      } catch { /* vanished between listing and stat: not worth failing over */ }
    }
  }
  return targets.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** One audit at a time per file, so a second click cannot race the first. */
const running = new Set<string>();

export function registerAuditRoutes(app: Hono, deps: AuditRouteDeps): void {
  const { root, broadcast } = deps;

  app.get("/api/v1/audit/targets", async (c) => {
    return c.json({ targets: await listAuditTargets(root) });
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

    running.add(path);
    broadcast("audit:run", { path, state: "start" });
    try {
      const pipeline = await deps.pipeline();
      const options = {
        projectRoot: root,
        path,
        ask: createStoryAsk(pipeline),
        onProgress: (message: string) => broadcast("audit:progress", { path, message }),
      };
      const audit = body.deslop
        ? await runStoryDeslop(options)
        : await runStoryAudit({ ...options, revise: body.revise === true });
      broadcast("audit:run", { path, state: "done" });
      return c.json({ audit, report: storyAuditReport(audit) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      broadcast("audit:run", { path, state: "error", message });
      return c.json({ error: message }, 500);
    } finally {
      running.delete(path);
    }
  });
}
