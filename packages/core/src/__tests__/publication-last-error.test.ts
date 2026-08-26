import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createIssue, setLastError } from "../pipeline/publication-runner.js";
import type { RunnerContext } from "../pipeline/publication-runner.js";
import { findPublicationDefinition } from "../publications/registry.js";

async function ctxFor(): Promise<RunnerContext> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pub-err-"));
  const definition = await findPublicationDefinition(projectRoot, "magazine");
  if (!definition) throw new Error("magazine definition missing");
  return { projectRoot, definition, ask: async () => "", shimUrl: "http://127.0.0.1:1" };
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

  it("never throws over a missing issue: the run's own error is the one that matters", async () => {
    const ctx = await ctxFor();
    await expect(setLastError(ctx, "no-such-issue", { message: "boom" })).resolves.toBeUndefined();
  });
});
