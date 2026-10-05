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
import { designSkillBrief } from "../skills/design-skills.js";
import { runWorkerAgent, workerModel } from "../agent/worker-agent.js";
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
 * transcripts are written to `.quire/sessions/<id>.jsonl`. On Windows a colon
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
const stageSystemPrompt = (tag: string, skill = "") => [
  ...(skill ? [skill, ""] : []),
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

    /*
     * A judging stage gets no tools and no workbench prompt.
     *
     * Fact-check reads text and search results it has already been handed.
     * On the session path it arrived wrapped in ~54k characters of workbench
     * prompt and tool table, and a CLI agent took that as licence to go
     * searching the workspace itself: up to 22 steps for a prompt that only
     * asked for a list, until the CLI's own five-minute deadline cut it off
     * with an empty reply. Two of those in a row failed a 50-page run.
     */
    const judging = tag.startsWith("factcheck");
    // The magazine's design and art stages read the same two skills every
    // other type's do — they are stage-bound, not magazine-bound.
    const skill = await designSkillBrief(tag);
    const talk = async (text: string, suffix: string): Promise<{ responseText: string; errorMessage?: string }> => {
      if (judging) {
        const response = await runWorkerAgent(agentCtx.client, agentCtx.model, [
          {
            role: "system",
            content: `${skill ? `${skill}

` : ""}This is the "${tag}" stage. `
              + "Your reply is the JSON asked for and nothing else.",
          },
          { role: "user", content: text },
        ], { signal });
        return { responseText: response.content };
      }
      return runAgentSession(
        {
          sessionId: publicationSessionId(id, `${tag}${suffix}`),
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
        text,
        [{ role: "system", content: stageSystemPrompt(tag, skill) }],
      );
    };

    const result = await talk(prompt, "");
    if (result.errorMessage) {
      throw new Error(`${tag}: ${result.errorMessage}`);
    }

    try {
      return parseJson(result.responseText);
    } catch (error) {
      /*
       * One unreadable envelope should not cost the run.
       *
       * A fifty-page issue died at its first research stage because the reply
       * carried a control character inside a string. The findings were fine;
       * the punctuation around them was not. So the stage is asked once more,
       * told what broke, before the run is given up on.
       */
      const said = result.responseText.trim().slice(0, 400);
      const why = error instanceof Error ? error.message : String(error);
      signal?.throwIfAborted();
      const retry = await talk(
        `${prompt}\n\nYour last answer could not be read as JSON (${why}). `
        + "Send the same answer again as one valid JSON document and nothing else: "
        + "no prose around it, no code fence, and every newline inside a string written as \\n.",
        "-repair",
      );
      if (!retry.errorMessage) {
        try {
          return parseJson(retry.responseText);
        } catch { /* the first failure is the one worth reporting */ }
      }
      throw new Error(
        `${tag}: ${why} (asked again once, still unreadable)`
        + (said ? `\n\nThe model said:\n${said}` : ""),
      );
    }
  };
}
