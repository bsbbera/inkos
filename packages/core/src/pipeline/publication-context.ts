/**
 * A runner context for an issue that already exists.
 *
 * Everything the publication runner does needs a RunnerContext, and until now
 * the only place one was ever built was inside `publication_create` — which is
 * why nothing could be done to an issue after the run that made it ended. The
 * art, design and build stages were reachable exactly once, in order, from the
 * call that created the publication; a run stopped at `write` was finished for
 * good, and the two issues already in the workspace could not be touched at
 * all.
 *
 * The link back is `issue.type`, which names the definition the issue was made
 * from. With that, an id is enough to reconstruct everything a stage needs.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { findPublicationDefinition, loadPublicationRegistry } from "../publications/registry.js";
import type { PublicationDefinition } from "../publications/types.js";
import type { PublicationIssue, RunnerContext, AskFn, PublicationEvent } from "./publication-runner.js";

export interface OpenIssueOptions {
  /**
   * Only stages that call the model need this. Omitted, a stage that tries is
   * told so plainly rather than failing somewhere further in with a type error.
   */
  readonly ask?: AskFn;
  readonly onEvent?: (event: PublicationEvent) => void;
  readonly shimUrl?: string;
}

const refuseToAsk = (why: string): AskFn => async (_prompt, tag) => {
  throw new Error(`${tag}: ${why}`);
};

/**
 * Find an issue across every installed publication type.
 *
 * Definitions each own an output directory, and an id is only unique within
 * one, so the search is by definition and the first match wins. Two types
 * holding the same id is a workspace someone has hand-edited; picking the
 * first is no worse than any other answer and does not warrant a failure.
 */
export async function findIssue(
  projectRoot: string,
  issueId: string,
): Promise<{ issue: PublicationIssue; dir: string; definition: PublicationDefinition } | undefined> {
  const registry = await loadPublicationRegistry(projectRoot);
  for (const { definition } of registry.definitions) {
    const dir = join(projectRoot, definition.outDir, "issues", issueId);
    try {
      const raw = await readFile(join(dir, "publication.json"), "utf-8");
      return { issue: JSON.parse(raw) as PublicationIssue, dir, definition };
    } catch {
      // Not this type's; try the next.
    }
  }
  return undefined;
}

/** Every issue id in the workspace, for naming them back when one is not found. */
export async function listIssueIds(projectRoot: string): Promise<string[]> {
  const registry = await loadPublicationRegistry(projectRoot);
  const out: string[] = [];
  for (const { definition } of registry.definitions) {
    try {
      out.push(...await readdir(join(projectRoot, definition.outDir, "issues")));
    } catch {
      // A type with nothing made from it yet.
    }
  }
  return out;
}

/**
 * The context for an existing issue, and the issue itself.
 *
 * Returned together because every caller needs both, and reading the file
 * twice to get them separately is how the two drift.
 */
export async function openIssueContext(
  projectRoot: string,
  issueId: string,
  options: OpenIssueOptions = {},
): Promise<{ ctx: RunnerContext; issue: PublicationIssue }> {
  const found = await findIssue(projectRoot, issueId);
  if (!found) {
    const known = await listIssueIds(projectRoot);
    throw new Error(
      `no publication issue "${issueId}". `
      + (known.length ? `In this workspace: ${known.join(", ")}` : "This workspace has none yet."),
    );
  }

  // An issue made before the file carried a `type` at all still has one: the
  // definition whose output directory it was found in. Refusing those means an
  // issue in the workspace has a detail page that only ever returns a 500.
  const definition = found.issue.type
    ? await findPublicationDefinition(projectRoot, found.issue.type)
    : found.definition;
  if (!definition) {
    throw new Error(
      `issue "${issueId}" was made as type "${found.issue.type}", which is no longer installed. `
      + "Reinstall that publication definition, or the issue cannot be worked on.",
    );
  }

  return {
    issue: found.issue,
    ctx: {
      projectRoot,
      definition,
      ask: options.ask ?? refuseToAsk("this operation does not call the model"),
      onEvent: options.onEvent,
      shimUrl: options.shimUrl
        ?? `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`,
    },
  };
}
