/**
 * The model half of a publication run, with tools.
 *
 * It used to be `PublicationAgent extends BaseAgent`, which routes through
 * runWorkerAgent — and that constructs its Agent with `tools: []`. Every stage
 * of a forty-page issue therefore ran as a single completion with no way to
 * look anything up, render anything, or check anything: research could not
 * search, a page could not read what an earlier page established, and the art
 * stage could only be a hardcoded HTTP call made by the host afterwards.
 *
 * That constraint is upstream Quire's, and it is the right one for chapters:
 * a chapter pipeline is deterministic by design and the host owns every
 * capability. Publications inherited it by accident, because the class was
 * there. This module is the correction — the same stages, driven through
 * runAgentSession, which carries a tool table and runs the host's own
 * confirmation and persistence around every call.
 *
 * What does not change: one session per stage, so a page is still written from
 * its prompt rather than from an ever-growing transcript. Carrying memory
 * across pages is a real improvement and a separate one; conflating it with
 * this change would make a context-growth bug look like a tools bug.
 */

import { runAgentSession } from "../agent/agent-session.js";
import { agentForStage } from "./publication-agents.js";
import { workerModel } from "../agent/worker-agent.js";
import { parseJson } from "../publications/parse-json.js";
import type { PipelineRunner } from "./runner.js";
import type { AskFn } from "./publication-runner.js";

export interface PublicationSessionOptions {
  /** Supplies the configured client/model and backs sub-agent delegation. */
  readonly pipeline: PipelineRunner;
  readonly projectRoot: string;
  /**
   * Scopes this run's sessions. Stage sessions are keyed by issue and tag, so
   * two issues in flight never share a transcript and a re-run of one stage
   * does not inherit the last attempt's.
   *
   * A getter is allowed because the issue is created *from* the context that
   * carries this — the id does not exist when the context is built, and no
   * stage runs before creation, so it is always resolved by the time a session
   * needs naming.
   */
  readonly issueId: string | (() => string);
  readonly language?: string;
  /** Cancels an in-flight stage; the runner already threads one through. */
  readonly signal?: AbortSignal;
}

/**
 * A stage's session id.
 *
 * Tags are already unique per stage and per page (`plan`, `page-7`, `design`),
 * which is what makes one-session-per-stage expressible at all.
 *
 * Separated by `--` rather than `:`, because a session id becomes a filename:
 * transcripts are written to `.inkos/sessions/<id>.jsonl`. On Windows a colon
 * in a path is the alternate-data-stream separator, so every publication stage
 * failed to persist with ENOENT — which surfaced as the audit being unable to
 * read a single page. Anything outside the safe set is folded down for the
 * same reason: an issue id comes from a user-supplied subject.
 */
export const publicationSessionId = (issueId: string, tag: string) =>
  `publication--${issueId}--${tag}`.replace(/[^A-Za-z0-9._-]+/g, "-");

/**
 * Which stage this is, and what it owes back.
 *
 * The session's own system prompt (buildPublicationPrompt) already establishes
 * the role and the tool contract, so this adds only what that prompt cannot
 * know. The last lines earn their place: a model that has just used a tool
 * tends to narrate the call and lose the JSON envelope the runner must parse.
 */
const stageSystemPrompt = (tag: string) => [
  `This is the "${tag}" stage.`,
  "",
  "Your final message must be the JSON this stage asks for, and nothing else.",
  "Tool results inform that JSON; they do not replace it. Do not describe the",
  "work instead of doing it, and do not narrate the calls you made.",
].join("\n");

/**
 * The runner's `ask`, backed by a real agent session.
 *
 * Signature-compatible with the old one on purpose: the runner's stages are
 * unchanged by this, which keeps the diff about where the model runs rather
 * than about what it is asked.
 */
export function createPublicationAsk(options: PublicationSessionOptions): AskFn {
  const { pipeline, projectRoot, issueId, language, signal } = options;

  return async (prompt: string, tag: string): Promise<Record<string, unknown>> => {
    signal?.throwIfAborted();

    // The pipeline's own client and model, not a fresh registry lookup — a run
    // configured against one endpoint must not silently move to another
    // halfway through.
    const id = typeof issueId === "function" ? issueId() : issueId;
    if (!id) throw new Error(`${tag}: no issue id yet — a stage ran before the issue was created`);

    // The stage decides the model, not the pipeline. `tag` is already the
    // stage, so routing costs one lookup and no new plumbing; an unrecognised
    // tag falls back to "publication", the id every older config pinned.
    const agentCtx = pipeline.createAgentContext(agentForStage(tag));
    const model = workerModel(agentCtx.client, agentCtx.model);

    const result = await runAgentSession(
      {
        sessionId: publicationSessionId(id, tag),
        // Publications live under the workspace's own output directory, not
        // under books/. Nothing in the session path requires a book except
        // interactive-film authoring, which is not this.
        bookId: null,
        sessionKind: "publication",
        language: language ?? "en",
        pipeline,
        projectRoot,
        model,
      },
      prompt,
      [{ role: "system", content: stageSystemPrompt(tag) }],
    );

    if (result.errorMessage) {
      throw new Error(`${tag}: ${result.errorMessage}`);
    }

    try {
      return parseJson(result.responseText);
    } catch (error) {
      // The raw text matters here: a stage that fails to produce JSON has
      // usually said why, and swallowing it leaves only "invalid JSON".
      const said = result.responseText.trim().slice(0, 400);
      throw new Error(
        `${tag}: ${error instanceof Error ? error.message : String(error)}`
        + (said ? `\n\nThe model said:\n${said}` : ""),
      );
    }
  };
}
