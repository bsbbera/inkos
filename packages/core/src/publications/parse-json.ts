/**
 * Pull JSON out of a model reply.
 *
 * Agent CLIs wrap their output in prose and fences far too often to trust a
 * bare JSON.parse, and a stage that dies on a stray "Here you go:" costs the
 * whole run. Ported from the magazine engine, where every one of these cases
 * was met in practice.
 */
/**
 * Escape raw control characters that appear inside string literals.
 *
 * A model writing prose into a JSON field types the paragraph break it means:
 * a real newline, inside the quotes. That is invalid JSON, and it ended a
 * sixteen-page run at page two — the copy was fine, the punctuation of the
 * envelope around it was not.
 *
 * Only characters inside a string are touched, so the structure the model
 * produced is left as it wrote it. Quote state honours backslash escapes, so
 * an escaped quote within a string does not read as the end of one.
 */
function escapeControlsInStrings(json: string): string {
  const escapes: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\" && inString) { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    out += inString && escapes[ch] ? escapes[ch] : ch;
  }
  return out;
}

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

  const candidate = body.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch (error) {
    // One repair, then give up. Raw newlines inside a prose field are the
    // common case and worth recovering; anything else is a genuinely broken
    // reply and is better reported than guessed at.
    try {
      return JSON.parse(escapeControlsInStrings(candidate)) as Record<string, unknown>;
    } catch { /* report the original failure: it describes the real text */ }
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`model returned invalid JSON (${why}):\n${candidate.slice(0, 400)}`);
  }
}
