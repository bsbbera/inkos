import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createIssue, run, setLastError } from "../pipeline/publication-runner.js";
import { ensurePipeline, loadPipeline } from "../pipeline/orchestrator.js";
import type { RunnerContext } from "../pipeline/publication-runner.js";
import { findPublicationDefinition } from "../publications/registry.js";

async function ctxFor(): Promise<RunnerContext> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pub-err-"));
  const definition = await findPublicationDefinition(projectRoot, "magazine");
  if (!definition) throw new Error("magazine definition missing");
  return { projectRoot, definition, ask: async () => ({}), shimUrl: "http://127.0.0.1:1" };
}

const stored = async (ctx: RunnerContext, id: string) => JSON.parse(
  await readFile(join(ctx.projectRoot, ctx.definition.outDir, "issues", id, "publication.json"), "utf-8"),
) as { lastError?: { stage?: string; message: string } | null };

describe("setLastError", () => {
  // A run that died at page two used to leave the issue saying "writing, 1/16"
  // and nothing else: the reason existed only in an SSE frame.
  it("records why a run stopped, so it survives the run", async () => {
    const ctx = await ctxFor();
    const { id } = await createIssue(ctx, { subject: "kolam", angle: "the maths of it" });
    await setLastError(ctx, id, { stage: "write", message: "page 2 failed to parse" });
    const issue = await stored(ctx, id);
    expect(issue.lastError?.stage).toBe("write");
    expect(issue.lastError?.message).toBe("page 2 failed to parse");
  });

  it("clears when a run starts again", async () => {
    const ctx = await ctxFor();
    const { id } = await createIssue(ctx, { subject: "kolam", angle: "the maths of it" });
    await setLastError(ctx, id, { message: "boom" });
    await setLastError(ctx, id, null);
    expect((await stored(ctx, id)).lastError).toBeNull();
  });

  // The Run page read "fact-check, running" after the issue page said failed.
  it("tells the run file too: failed with the reason, idle after a stop, cleared on a new run", async () => {
    const ctx = await ctxFor();
    const { id } = await createIssue(ctx, { subject: "kolam", angle: "the maths of it" });
    const ref = { type: "publication", id } as const;
    await ensurePipeline({ projectRoot: ctx.projectRoot, ref, totalUnits: 2 });

    const failing = { ...ctx, ask: async () => { throw new Error("model returned no JSON"); } };
    await expect(run(failing, id, { from: "plan", stopAt: "plan" })).rejects.toThrow();
    const failed = await loadPipeline(ctx.projectRoot, ref);
    expect(failed?.status).toBe("failed");
    expect(failed?.units.failed.find((f) => f.unit === 0)?.error).toMatch(/^plan: /);

    const stop = new AbortController();
    stop.abort();
    await expect(run({ ...failing, signal: stop.signal }, id, { from: "plan", stopAt: "plan" })).rejects.toThrow();
    const stopped = await loadPipeline(ctx.projectRoot, ref);
    expect(stopped?.status).toBe("idle");
    expect(stopped?.units.failed.some((f) => f.unit === 0)).toBe(false);
    expect((await stored(ctx, id)).lastError).toMatchObject({ stage: "plan", stopped: true });
  });

  it("never throws over a missing issue: the run's own error is the one that matters", async () => {
    const ctx = await ctxFor();
    await expect(setLastError(ctx, "no-such-issue", { message: "boom" })).resolves.toBeUndefined();
  });
});
