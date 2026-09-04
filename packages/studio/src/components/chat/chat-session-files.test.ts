import { describe, expect, it } from "vitest";
import { sessionFiles, whenAgo } from "./chat-session-files";
import type { Message, ToolExecution } from "../../store/chat/types";

const NOW = 1_700_000_000_000;

function exec(over: Partial<ToolExecution>): ToolExecution {
  return {
    id: "x", tool: "write", label: "Write", status: "completed",
    startedAt: NOW - 60_000, ...over,
  } as ToolExecution;
}

function msg(executions: ToolExecution[]): Message {
  return { role: "assistant", content: "", timestamp: NOW, toolExecutions: executions };
}

describe("sessionFiles", () => {
  it("names a file from whichever argument carried it", () => {
    const files = sessionFiles([msg([
      exec({ id: "a", args: { path: "story/ch09.draft.md" } }),
      exec({ id: "b", args: { filename: "scene-notes.md" } }),
    ])], NOW);
    expect(files.map((f) => f.name).sort()).toEqual(["ch09.draft.md", "scene-notes.md"]);
  });

  it("ignores prose arguments that merely contain a dot", () => {
    const files = sessionFiles([msg([
      exec({ args: { path: "Write the scene. Keep it short." } }),
    ])], NOW);
    expect(files).toEqual([]);
  });

  it("shows one row per file, at its most recent state", () => {
    const files = sessionFiles([msg([
      exec({ id: "a", args: { path: "ch09.md" }, startedAt: NOW - 600_000, completedAt: NOW - 600_000 }),
      exec({ id: "b", args: { path: "ch09.md" }, status: "running", startedAt: NOW - 5_000 }),
    ])], NOW);
    expect(files).toHaveLength(1);
    // A file being written has a state, not an age.
    expect(files[0]!.meta).toBe("writing now");
    expect(files[0]!.busy).toBe(true);
  });

  it("tells an audit result apart from a draft", () => {
    const files = sessionFiles([msg([
      exec({ id: "a", args: { path: "ch09.findings.json" } }),
      exec({ id: "b", args: { path: "ch09.draft.md" } }),
      exec({ id: "c", args: { path: "memory.json" } }),
    ])], NOW);
    const byName = Object.fromEntries(files.map((f) => [f.name, f.kind]));
    expect(byName["ch09.findings.json"]).toBe("audit");
    expect(byName["ch09.draft.md"]).toBe("file");
    expect(byName["memory.json"]).toBe("edit");
  });

  it("puts the most recent file first", () => {
    const files = sessionFiles([msg([
      exec({ id: "a", args: { path: "old.md" }, completedAt: NOW - 900_000 }),
      exec({ id: "b", args: { path: "new.md" }, completedAt: NOW - 60_000 }),
    ])], NOW);
    expect(files.map((f) => f.name)).toEqual(["new.md", "old.md"]);
  });

  it("survives a session that has run nothing", () => {
    expect(sessionFiles(undefined)).toEqual([]);
    expect(sessionFiles([msg([])])).toEqual([]);
  });
});

describe("whenAgo", () => {
  it("reads in the units a person would say", () => {
    expect(whenAgo(NOW - 30_000, NOW)).toBe("just now");
    expect(whenAgo(NOW - 60_000, NOW)).toBe("1 minute ago");
    expect(whenAgo(NOW - 9 * 60_000, NOW)).toBe("9 minutes ago");
    expect(whenAgo(NOW - 3 * 3_600_000, NOW)).toBe("3 hours ago");
  });
});
