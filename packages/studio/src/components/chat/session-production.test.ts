/**
 * A session that made a short has to be able to say so.
 *
 * The subject is derived from the paths the run wrote rather than stored on
 * the session, so these are the cases that decide whether the chat column
 * describes the work or falls back to naming an empty shelf.
 */
import { describe, expect, it } from "vitest";
import { sessionProduction } from "./chat-session-files";
import type { Message } from "../../store/chat/types";

function said(text: string): Message {
  return { role: "assistant", content: text, timestamp: 1 } as Message;
}

describe("sessionProduction", () => {
  it("names the production a finished run wrote to", () => {
    const messages = [
      said(
        [
          'Short fiction "the-second-law" completed.',
          "Final: shorts/the-second-law/final/full.md",
          "Sales package: shorts/the-second-law/final/sales-package.md",
        ].join("\n"),
      ),
    ];
    expect(sessionProduction(messages)).toEqual({ dir: "shorts", id: "the-second-law" });
  });

  it("takes the production it wrote most, not the one it read once", () => {
    const messages = [
      said(
        [
          "Reference: shorts/the-lamp-room/final/full.md",
          "Outline: shorts/the-second-law/outline/v002.md",
          "Final: shorts/the-second-law/final/full.md",
        ].join("\n"),
      ),
    ];
    expect(sessionProduction(messages)).toEqual({ dir: "shorts", id: "the-second-law" });
  });

  it("has no subject when nothing has been written", () => {
    expect(sessionProduction([said("Thinking about it.")])).toBeNull();
    expect(sessionProduction(undefined)).toBeNull();
  });

  it("ignores a loose file that names no production", () => {
    // `notes.md` at the workspace root is not a production, and treating its
    // first segment as one would name the column after a stray file.
    expect(sessionProduction([said("Notes: notes.md")])).toBeNull();
  });
});
