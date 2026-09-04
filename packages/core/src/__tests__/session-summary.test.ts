import { describe, expect, it } from "vitest";
import {
  summarizeTranscriptEvents, tokensOf, EMPTY_SESSION_SUMMARY,
} from "../interaction/session-summary.js";

function assistant(over: Record<string, unknown> = {}, timestamp = 1000) {
  return {
    type: "message", role: "assistant", timestamp,
    message: { role: "assistant", provider: "openai", model: "devin/glm-5-2", ...over },
  };
}

describe("tokensOf", () => {
  it("is null when the adapter reported nothing, never zero", () => {
    expect(tokensOf(undefined)).toBeNull();
    expect(tokensOf({})).toBeNull();
    // Every streamed turn stores exactly this, and summing it gives 0 — which
    // on a panel reads as a fact rather than as an absence.
    expect(tokensOf({ totalTokens: 0, input: 0, output: 0 })).toBeNull();
  });

  it("takes the total, or adds the halves when only those are filled", () => {
    expect(tokensOf({ totalTokens: 240 })).toBe(240);
    expect(tokensOf({ totalTokens: 0, input: 100, output: 40 })).toBe(140);
  });
});

describe("summarizeTranscriptEvents", () => {
  it("says nothing about an empty transcript rather than inventing a default", () => {
    expect(summarizeTranscriptEvents([])).toEqual(EMPTY_SESSION_SUMMARY);
  });

  it("reports the model that wrote the last reply, and every one that answered", () => {
    const summary = summarizeTranscriptEvents([
      assistant({ model: "devin/glm-5-2" }, 1000),
      { type: "message", role: "user", timestamp: 1500, message: { role: "user" } },
      assistant({ model: "claude/sonnet" }, 2000),
    ]);
    expect(summary.model).toBe("claude/sonnet");
    expect(summary.provider).toBe("openai");
    expect(summary.models).toEqual(["devin/glm-5-2", "claude/sonnet"]);
    expect(summary.turns).toBe(2);
  });

  it("counts model turns, not messages", () => {
    const summary = summarizeTranscriptEvents([
      { type: "session_created", timestamp: 500 },
      { type: "message", role: "user", timestamp: 600, message: { role: "user" } },
      assistant({}, 700),
      { type: "request_committed", timestamp: 800 },
    ]);
    expect(summary.turns).toBe(1);
  });

  it("spans the whole conversation, whatever kind of event bounds it", () => {
    const summary = summarizeTranscriptEvents([
      { type: "session_created", timestamp: 500 },
      assistant({}, 700),
      { type: "request_committed", timestamp: 9000 },
    ]);
    expect(summary.startedAt).toBe(500);
    expect(summary.updatedAt).toBe(9000);
  });

  it("adds up usage where it exists, and stays null where nothing reported any", () => {
    expect(summarizeTranscriptEvents([
      assistant({ usage: { totalTokens: 240 } }, 1000),
      assistant({ usage: { totalTokens: 60 } }, 2000),
    ]).tokens).toBe(300);

    // What a real streamed conversation looks like on disk today.
    expect(summarizeTranscriptEvents([
      assistant({ usage: { totalTokens: 0, input: 0, output: 0 } }, 1000),
      assistant({ usage: { totalTokens: 0, input: 0, output: 0 } }, 2000),
    ]).tokens).toBeNull();
  });
});
