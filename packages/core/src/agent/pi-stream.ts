import { streamSimple } from "@earendil-works/pi-ai/compat";
import { viaStream } from "../llm/subscription.js";
import { priceOf, recordLlmCall, roughTokens } from "../llm/telemetry.js";
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  assertWithinContextWindow,
  estimatePiContextTokens,
  guardAssistantMessageStream,
} from "../llm/provider.js";
import {
  agentTrajectoryHeaders,
  beginAgentModelCall,
} from "../llm/agent-trajectory.js";

/**
 * The single Pi transport boundary used by both conversational and worker
 * agents. Pi keeps native tool calls; Quire adds context guards, trajectory
 * headers, cancellation, and stream deadlines around the request.
 */
export function guardedPiStream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const reservedOutputTokens = Number.isFinite(options?.maxTokens)
    ? options!.maxTokens!
    : Number.isFinite(model.maxTokens)
      ? model.maxTokens
      : 4096;
  assertWithinContextWindow({
    piModel: model,
    model: model.id,
    estimatedInputTokens: estimatePiContextTokens(context),
    reservedOutputTokens,
  });
  const modelCall = beginAgentModelCall();
  const traceHeaders = agentTrajectoryHeaders(model.baseUrl, modelCall, 1, {
    effort: String(options?.reasoning ?? (model.reasoning ? "enabled" : "disabled")),
  });
  return guardAssistantMessageStream(
    model,
    (signal) => viaStream(model, context, {
      ...options,
      headers: { ...(options?.headers ?? {}), ...traceHeaders },
      signal,
    }, streamSimple),
    options?.signal,
    undefined,
    // Agent turns meter here, where the request is still in hand (telemetry.ts).
    (message) => {
      const u = message.usage;
      const reported = (u?.input ?? 0) + (u?.output ?? 0) > 0;
      const input = reported ? u!.input : estimatePiContextTokens(context);
      const output = reported ? u!.output : roughTokens(message.content
        .map((b) => (b.type === "text" ? b.text : b.type === "toolCall" ? JSON.stringify(b.arguments) : "")).join("").length);
      recordLlmCall({
        service: model.provider, model: model.id, input, output,
        costUsd: (reported && u?.cost?.total) || priceOf(model.cost, input, output),
        ...(reported ? {} : { estimated: true }),
      });
    },
  );
}
