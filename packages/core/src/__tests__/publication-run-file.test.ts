import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createIssue, removeIssue, type RunnerContext } from "../pipeline/publication-runner.js";
import { ensurePipeline, loadPipeline, pipelinePath, reportUnitDone } from "../pipeline/orchestrator.js";
import { findPublicationDefinition } from "../publications/registry.js";

async function ctxFor(): Promise<RunnerContext> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pub-run-"));
  const definition = await findPublicationDefinition(projectRoot, "magazine");
  if (!definition) throw new Error("magazine definition missing");
  return { projectRoot, definition, ask: async () => ({}), shimUrl: "http://127.0.0.1:1" };
}

describe("an issue's run file", () => {
  it("goes with the issue when it is removed, so a new issue starts clean", async () => {
    // Reproduces the photography-film case: the old run had written 14 pages
    // and failed; a new issue with the same subject showed that on the run
    // screen while writing its own first page.
    const ctx = await ctxFor();
    const ref = { type: "publication", id: "photography-film" } as const;
    const { id } = await createIssue(ctx, { subject: "Photography", angle: "Film" });
    expect(id).toBe(ref.id);
    await ensurePipeline({ projectRoot: ctx.projectRoot, ref, totalUnits: 50 });
    for (const unit of [1, 2, 3]) {
      await reportUnitDone({ projectRoot: ctx.projectRoot, ref, unit, satisfies: "content.write" });
    }

    await removeIssue(ctx, id);
    expect(existsSync(pipelinePath(ctx.projectRoot, ref))).toBe(false);

    await createIssue(ctx, { subject: "Photography", angle: "Film" });
    await ensurePipeline({ projectRoot: ctx.projectRoot, ref, totalUnits: 50 });
    const fresh = await loadPipeline(ctx.projectRoot, ref);
    expect(fresh?.units.done).toEqual([]);
  });

  it("does not survive into a new issue even when the folder was removed by hand", async () => {
    const ctx = await ctxFor();
    const ref = { type: "publication", id: "photography-film" } as const;
    await ensurePipeline({ projectRoot: ctx.projectRoot, ref, totalUnits: 50 });
    await reportUnitDone({ projectRoot: ctx.projectRoot, ref, unit: 1, satisfies: "content.write" });

    await createIssue(ctx, { subject: "Photography", angle: "Film" });
    expect(existsSync(pipelinePath(ctx.projectRoot, ref))).toBe(false);
  });
});
