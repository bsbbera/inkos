/**
 * What a conversation cost and who answered it.
 *
 * The chat panel could not say which model wrote the last reply. The
 * information was on disk the whole time — every assistant message in the
 * transcript carries its `provider`, `model` and `usage` — and the session
 * shape the API returns drops all three on the way out, because it was built
 * to render a message list and nothing else. So the topbar showed whichever
 * model the picker happened to be set to, which is the model the *next* turn
 * would use and not the one that produced the words on screen.
 *
 * Token counts are handled separately and deliberately. The shim estimates
 * them as characters over four, and only on its non-streaming path; a
 * streamed turn — which is every chat turn — reports nothing, so the stored
 * usage for a whole conversation is a run of zeroes. Adding those up gives
 * `0`, and `0` on a panel reads as a fact rather than as an absence. So
 * `tokens` is null when nothing reported any, and the screen says the machine
 * did not count rather than that the conversation was free.
 */
import { readTranscriptEvents } from "./session-transcript.js";

export interface SessionSummary {
  /** The model that produced the most recent assistant turn, not the one selected next. */
  readonly model: string | null;
  /** Which CLI or API carried it. */
  readonly provider: string | null;
  /** Every model that has answered in this conversation, in first-seen order. */
  readonly models: ReadonlyArray<string>;
  /** Null when nothing on record reported usage — never 0 standing in for "unknown". */
  readonly tokens: number | null;
  /** Model turns, which is what a person means by "how long has this been going". */
  readonly turns: number;
  readonly startedAt: number | null;
  readonly updatedAt: number | null;
}

export const EMPTY_SESSION_SUMMARY: SessionSummary = {
  model: null, provider: null, models: [], tokens: null,
  turns: 0, startedAt: null, updatedAt: null,
};

interface UsageLike {
  readonly totalTokens?: unknown;
  readonly input?: unknown;
  readonly output?: unknown;
}

/** Tokens for one message, or null when the adapter did not report any. */
export function tokensOf(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as UsageLike;
  const total = Number(u.totalTokens);
  if (Number.isFinite(total) && total > 0) return total;
  // Some adapters fill the halves and leave the total at zero.
  const halves = Number(u.input ?? 0) + Number(u.output ?? 0);
  return Number.isFinite(halves) && halves > 0 ? halves : null;
}

export function summarizeTranscriptEvents(
  events: ReadonlyArray<{
    readonly type?: string;
    readonly role?: string;
    readonly timestamp?: number;
    readonly message?: unknown;
  }>,
): SessionSummary {
  let model: string | null = null;
  let provider: string | null = null;
  let tokens: number | null = null;
  let turns = 0;
  let startedAt: number | null = null;
  let updatedAt: number | null = null;
  const models: string[] = [];

  for (const event of events) {
    if (typeof event.timestamp === "number") {
      startedAt = startedAt === null ? event.timestamp : Math.min(startedAt, event.timestamp);
      updatedAt = updatedAt === null ? event.timestamp : Math.max(updatedAt, event.timestamp);
    }
    if (event.type !== "message" || event.role !== "assistant") continue;

    turns += 1;
    const message = (event.message ?? {}) as Record<string, unknown>;

    if (typeof message.model === "string" && message.model) {
      // Last one wins: the panel is about the reply on screen.
      model = message.model;
      if (!models.includes(message.model)) models.push(message.model);
    }
    if (typeof message.provider === "string" && message.provider) provider = message.provider;

    const n = tokensOf(message.usage);
    if (n !== null) tokens = (tokens ?? 0) + n;
  }

  return { model, provider, models, tokens, turns, startedAt, updatedAt };
}

export async function summarizeSession(
  projectRoot: string,
  sessionId: string,
): Promise<SessionSummary> {
  return summarizeTranscriptEvents(await readTranscriptEvents(projectRoot, sessionId));
}
