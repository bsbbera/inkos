/**
 * What the conversation has put on disk, derived from what it ran.
 *
 * The mock's right rail is a file list, not a message list, "because files are
 * the truth in this product". There is no `session:file` event to carry that,
 * and inventing one would mean a server change for something the client can
 * already see: every tool that touches a file names it in its own arguments.
 *
 * So this reads the executions the session already has. It is a derivation,
 * not a new source of truth, which also means it cannot drift from what
 * actually ran.
 */
import type { Message, ToolExecution } from "../../store/chat/types";
import { markedFiles, namedFiles } from "./tool-marks";

export interface SessionFile {
  readonly path: string;
  /** Basename, which is what a person recognises in a list. */
  readonly name: string;
  /** "writing now", "9 minutes ago" — state first, age second. */
  readonly meta: string;
  readonly kind: "file" | "audit" | "edit";
  /** True while the tool that writes it is still running. */
  readonly busy: boolean;
  readonly at: number;
}

const PATH_KEYS = ["path", "file", "filename", "output", "outputPath", "target"] as const;

/** A path-shaped string, not a prose argument that happens to contain a dot. */
function pathish(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /\s/.test(trimmed)) return null;
  return /\.[A-Za-z0-9]{1,8}$/.test(trimmed) ? trimmed : null;
}

function pathOf(execution: ToolExecution): string | null {
  const args = execution.args ?? {};
  for (const key of PATH_KEYS) {
    const found = pathish(args[key]);
    if (found) return found;
  }
  return null;
}

/**
 * Which glyph the row carries. An audit result and a written chapter are not
 * the same kind of thing, and the mock draws them differently.
 */
function kindOf(execution: ToolExecution, path: string): SessionFile["kind"] {
  if (/findings|audit|report/i.test(path) || /audit|detect|eval/i.test(execution.tool)) return "audit";
  if (/memory|truth|state/i.test(path)) return "edit";
  return "file";
}

export function whenAgo(at: number, now = Date.now()): string {
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString();
}

export function sessionFiles(
  messages: ReadonlyArray<Message> | undefined,
  now = Date.now(),
): ReadonlyArray<SessionFile> {
  if (!messages) return [];
  const latest = new Map<string, ToolExecution>();
  // A CLI reports its tool use as markers in the text, never as executions, so
  // a CLI-backed session would otherwise show an empty rail after writing files.
  const fromMarks: SessionFile[] = [];
  const marked = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      /* Markers first, then the paths a production tool named in its result -
         it reports neither a marker nor a path argument, so without the second
         source a finished short story showed an empty rail. */
      for (const path of [...markedFiles(message.content), ...namedFiles(message.content)]) {
        if (marked.has(path)) continue;
        marked.add(path);
        fromMarks.push({
          path,
          name: path.split("/").pop() ?? path,
          meta: whenAgo(message.timestamp, now),
          kind: kindOf({ tool: "", args: {} } as ToolExecution, path),
          busy: false,
          at: message.timestamp,
        });
      }
    }
    for (const execution of message.toolExecutions ?? []) {
      const path = pathOf(execution);
      if (!path) continue;
      // The same file written twice is one row, at its most recent state.
      const previous = latest.get(path);
      if (!previous || execution.startedAt >= previous.startedAt) latest.set(path, execution);
    }
  }
  const fromExecutions = [...latest.entries()]
    .map(([path, execution]) => {
      const busy = execution.status === "running" || execution.status === "processing";
      return {
        path,
        name: path.split("/").pop() ?? path,
        // A file being written now has no age worth printing; it has a state.
        meta: busy ? "writing now" : whenAgo(execution.completedAt ?? execution.startedAt, now),
        kind: kindOf(execution, path),
        busy,
        at: execution.completedAt ?? execution.startedAt,
      };
    });
  // An execution knows more than a marker, so it wins where both saw the file.
  const seen = new Set(fromExecutions.map((f) => f.path));
  return [...fromExecutions, ...fromMarks.filter((f) => !seen.has(f.path))]
    .sort((a, b) => b.at - a.at);
}

/**
 * Which production this conversation is about.
 *
 * A session records `bookId` and nothing else, so a run that made a short, an
 * issue or a storyboard had no subject the UI could name — and since a book is
 * the only subject the chat column knew how to describe, every one of those
 * sessions showed an empty rail. The run does say what it made, though: it
 * wrote `shorts/the-second-law/final/full.md` and named it in its result.
 *
 * So the subject is read back off the work rather than stored twice. The first
 * two segments of the most-written-to directory are the production, and the
 * server maps the directory to a kind — this side deliberately keeps no copy
 * of that mapping.
 */
export function sessionProduction(
  messages: ReadonlyArray<Message> | undefined,
): { readonly dir: string; readonly id: string } | null {
  const counts = new Map<string, number>();
  for (const file of sessionFiles(messages)) {
    const [dir, id] = file.path.split("/");
    if (!dir || !id || !file.path.includes("/", dir.length + 1)) continue;
    const key = `${dir}/${id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Most files wins: a run reads a file or two from elsewhere before it writes
  // its own, and the thing it wrote the most of is the thing it is about.
  let best: string | null = null;
  for (const [key, n] of counts) if (!best || n > counts.get(best)!) best = key;
  if (!best) return null;
  const [dir, id] = best.split("/");
  return { dir: dir!, id: id! };
}
