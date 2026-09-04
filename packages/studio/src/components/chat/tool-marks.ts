/**
 * Tool use a CLI already performed, pulled back out of the text it reported in.
 *
 * A CLI runs its own tool loop: by the time the shim sees a tool event the work
 * is done, so re-emitting it as an OpenAI tool_call would tell Studio to run
 * something that already ran. The shim writes a marker line into the stream
 * instead — and a marker is all that survives, because the OpenAI client
 * library drops the unknown fields a side channel would have used.
 *
 * So the marker is the protocol, and this is its parser. Without it a
 * CLI-backed conversation shows "› Read file" as a stray line of prose and the
 * mock's "Reading first" block never appears at all.
 */
export interface ToolMark {
  readonly name: string;
  readonly target: string | null;
}

export type Segment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tools"; readonly marks: ReadonlyArray<ToolMark> };

/** `› Read file · story/ch08.md` */
const MARK = /^›\s+(.+?)(?:\s+·\s+(.+))?$/;

export function parseToolMarks(content: string): ReadonlyArray<Segment> {
  const out: Segment[] = [];
  let text: string[] = [];

  const flushText = () => {
    const joined = text.join("\n").trim();
    if (joined) out.push({ kind: "text", text: joined });
    text = [];
  };

  for (const line of content.split(/\r?\n/)) {
    const m = MARK.exec(line.trim());
    if (!m) { text.push(line); continue; }
    flushText();
    const mark: ToolMark = { name: m[1]!.trim(), target: m[2]?.trim() ?? null };
    // Consecutive tool lines are one block, the way the mock groups them.
    const last = out[out.length - 1];
    if (last?.kind === "tools") out[out.length - 1] = { kind: "tools", marks: [...last.marks, mark] };
    else out.push({ kind: "tools", marks: [mark] });
  }
  flushText();
  return out;
}

/** Every file a marker named, in order, without duplicates. */
export function markedFiles(content: string): ReadonlyArray<string> {
  const seen = new Set<string>();
  for (const segment of parseToolMarks(content)) {
    if (segment.kind !== "tools") continue;
    for (const mark of segment.marks) {
      // A path has an extension; "Ran command" names no file and must not
      // become a row in the artifacts rail.
      if (mark.target && /\.[A-Za-z0-9]{1,8}$/.test(mark.target)) seen.add(mark.target);
    }
  }
  return [...seen];
}

/**
 * `Final: shorts/the-second-law/final/full.md`
 *
 * A production tool does not report a marker line and does not carry its
 * outputs in its arguments - it writes them and then names them in the prose
 * of its result. So a run that put three files on disk left the artifacts rail
 * saying "Nothing written to disk yet", which is the one thing the rail exists
 * to be right about.
 *
 * Deliberately narrow: a label, a colon, then one workspace-relative path with
 * an extension and no spaces. Prose that merely mentions a filename mid-
 * sentence does not match, because the path has to be the whole value.
 */
const NAMED_PATH = /^[ 	]*[A-Z][\w &'-]{0,40}:[ 	]+([\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,8})[ 	]*$/gm;

/** Every file the prose of a result named, in order, without duplicates. */
export function namedFiles(content: string): ReadonlyArray<string> {
  const seen = new Set<string>();
  for (const m of content.matchAll(NAMED_PATH)) seen.add(m[1]!);
  return [...seen];
}
