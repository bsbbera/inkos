/**
 * Pull JSON out of a model reply.
 *
 * Agent CLIs wrap their output in prose and fences far too often to trust a
 * bare JSON.parse, and a stage that dies on a stray "Here you go:" costs the
 * whole run. Ported from the magazine engine, where every one of these cases
 * was met in practice.
 */
export function parseJson(text: unknown): Record<string, unknown> {
  // Not every provider returns a plain string: some hand back content blocks,
  // and the extractor then died on "body.search is not a function" — an error
  // that says nothing at all about the actual shape.
  const src = typeof text === "string"
    ? text
    : Array.isArray(text)
      ? text.map((b) => (typeof b === "string" ? b : (b as { text?: string })?.text ?? "")).join("")
      : JSON.stringify(text);

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(src);
  const body = fenced ? fenced[1] : src;

  const start = body.search(/[[{]/);
  if (start < 0) throw new Error(`model returned no JSON:\n${src.slice(0, 400)}`);
  const close = body[start] === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error(`model returned truncated JSON:\n${src.slice(0, 400)}`);

  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`model returned invalid JSON (${why}):\n${body.slice(start, start + 400)}`);
  }
}
