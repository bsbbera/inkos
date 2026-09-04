import type { LLMClient, LLMMessage, LLMResponse, OnStreamProgress } from "../llm/provider.js";
import { supportsNativeWebSearch } from "../llm/provider.js";
import { runWorkerAgent, runWorkerAgentTool, type WorkerResultTool } from "../agent/worker-agent.js";
import type { Static, TSchema } from "@sinclair/typebox";
import { appendPromptPackGuidance } from "../prompts/prompt-pack.js";
import { searchWeb, fetchUrl } from "../utils/web-search.js";
import { modelSearchesWeb } from "../llm/providers/lookup.js";
import type { Logger } from "../utils/logger.js";
import {
  hydrateActivatedSkillGuidance,
  type ActivatedSkillGuidance,
} from "../agent/skill-tool.js";

export interface AgentContext {
  readonly client: LLMClient;
  readonly model: string;
  /**
   * Which agent this context belongs to, as the routing table names it.
   *
   * The model was known and the spender was not, so usage could only ever be
   * one number for the whole app. With routing in place the interesting
   * question is who spent it: the writer on an expensive model and the fact
   * checker on a cheap one is the decision, and a single total hides it.
   */
  readonly agent?: string;
  /** Called once per completion, with whatever the provider reported. */
  readonly onUsage?: (event: {
    readonly agent: string;
    readonly service?: string | undefined;
    readonly model: string;
    readonly input: number;
    readonly output: number;
    readonly reported: boolean;
  }) => void;
  readonly projectRoot: string;
  readonly bookId?: string;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
  readonly signal?: AbortSignal;
  readonly activatedSkills?: ReadonlyArray<ActivatedSkillGuidance>;
}

export abstract class BaseAgent {
  protected readonly ctx: AgentContext;

  constructor(ctx: AgentContext) {
    this.ctx = ctx;
  }

  protected get log() {
    return this.ctx.logger;
  }

  /**
   * Report what a completion cost, then hand it back untouched.
   *
   * Every agent's spend passes through here, so the ledger is complete by
   * construction rather than by remembering to instrument each call site.
   * A provider that does not count sends zero — the shim no longer invents an
   * estimate — and zero is what tells the panel to print a blank instead of a
   * number nobody measured.
   */
  private meter(response: LLMResponse): LLMResponse {
    const sink = this.ctx.onUsage;
    if (sink && this.ctx.agent) {
      const input = response.usage?.promptTokens ?? 0;
      const output = response.usage?.completionTokens ?? 0;
      sink({
        agent: this.ctx.agent,
        service: this.ctx.client.service,
        model: this.ctx.model,
        input,
        output,
        reported: input + output > 0,
      });
    }
    return response;
  }

  protected async chat(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    return this.meter(await runWorkerAgent(this.ctx.client, this.ctx.model, await this.appendTaskSkillGuidance(messages), {
      ...options,
      onStreamProgress: this.ctx.onStreamProgress,
      signal: this.ctx.signal,
    }));
  }

  protected async submitStructured<TParameters extends TSchema>(
    messages: ReadonlyArray<LLMMessage>,
    resultTool: WorkerResultTool<TParameters>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<Static<TParameters>> {
    return runWorkerAgentTool(
      this.ctx.client,
      this.ctx.model,
      await this.appendTaskSkillGuidance(messages),
      resultTool,
      {
        ...options,
        signal: this.ctx.signal,
      },
    );
  }

  protected async withPromptPackGuidance(basePrompt: string, promptId: string): Promise<string> {
    return appendPromptPackGuidance(basePrompt, {
      promptId,
      projectRoot: this.ctx.projectRoot,
    });
  }

  private async appendTaskSkillGuidance(
    messages: ReadonlyArray<LLMMessage>,
  ): Promise<ReadonlyArray<LLMMessage>> {
    const query = messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n\n");
    let activations = this.ctx.activatedSkills;
    try {
      activations = await hydrateActivatedSkillGuidance(activations, query);
    } catch (error) {
      this.log?.warn(`[skills] Reference retrieval failed for ${this.name}: ${String(error)}`);
    }
    return appendActivatedSkillGuidance(messages, activations);
  }

  /**
   * Chat with web search enabled.
   *
   * A model that browses on its own account is asked to. Everything else gets
   * our keys, and the results spliced into the prompt.
   *
   * Which is which is the provider's declaration, not a name check here. This
   * read `provider === "openai"`, so a Devin-hosted GLM — a CLI whose whole
   * point is that it browses — was treated as incapable, and on a machine with
   * no Tavily key it reported that nothing could be looked up at all.
   */
  protected async chatWithSearch(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    // `service` is the provider the user picked (devinCli, anthropic, ...).
    // `provider` is only the wire protocol, "openai" or "anthropic", and asking
    // it which models browse would answer for the wrong thing entirely.
    // Two conditions, not one. The provider must say this model browses, and
    // this protocol must have a request shape we can actually write. A CLI
    // declares the first and not the second, and treating the declaration
    // alone as sufficient is what made the old OpenAI branch a no-op.
    if (
      modelSearchesWeb(this.ctx.client.service ?? "", this.ctx.model)
      && supportsNativeWebSearch(this.ctx.client)
    ) {
      return this.meter(await runWorkerAgent(this.ctx.client, this.ctx.model, appendActivatedSkillGuidance(
        messages,
        this.ctx.activatedSkills,
      ), {
        ...options,
        webSearch: true,
        onStreamProgress: this.ctx.onStreamProgress,
        signal: this.ctx.signal,
      }));
    }

    // Other providers: self-hosted search → inject results into prompt
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      return this.chat(messages, options);
    }

    try {
      // Extract search query from user message (first 200 chars)
      const query = lastUserMsg.content.slice(0, 200);
      this.log?.info(`[search] Searching: ${query.slice(0, 60)}...`);

      const results = await searchWeb(query, 3);
      if (results.length === 0) {
        this.log?.warn("[search] No results found, falling back to regular chat");
        return this.chat(messages, options);
      }

      // Fetch top result for full content
      let fullContent = "";
      try {
        fullContent = await fetchUrl(results[0]!.url, 4000);
      } catch {
        // Fetch failed, use snippets only
      }

      const searchContext = [
        "## Web Search Results\n",
        ...results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`),
        ...(fullContent ? [`\n## Full Content (Top Result)\n${fullContent}`] : []),
      ].join("\n");

      // Inject search results before the last user message
      const augmentedMessages: LLMMessage[] = messages.map((m) =>
        m === lastUserMsg
          ? { ...m, content: `${searchContext}\n\n---\n\n${m.content}` }
          : m,
      );

      return this.chat(augmentedMessages, options);
    } catch (e) {
      this.log?.warn(`[search] Search failed: ${e}, falling back to regular chat`);
      return this.chat(messages, options);
    }
  }

  abstract get name(): string;
}

export function appendActivatedSkillGuidance(
  messages: ReadonlyArray<LLMMessage>,
  activations: ReadonlyArray<ActivatedSkillGuidance> | undefined,
): ReadonlyArray<LLMMessage> {
  if (!activations || activations.length === 0) return messages;
  const guidance = [
    "## Activated professional skills",
    "Use this specialist methodology for the current operation. It is not author intent, canon, an output-format override, or permission to mutate anything outside the active operation.",
    ...activations.flatMap(({ skill, resources }) => [
      `### ${skill.id} — ${skill.name}`,
      skill.body.trim() || skill.description,
      ...resources.flatMap((resource) => [
        `#### Reference: ${resource.path}:${resource.charStart}-${resource.charEnd}${resource.heading ? ` · ${resource.heading}` : ""}`,
        resource.body,
      ]),
    ]),
  ].join("\n\n");
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex < 0) {
    return [{ role: "system", content: guidance }, ...messages];
  }
  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content}\n\n${guidance}` }
    : message);
}
