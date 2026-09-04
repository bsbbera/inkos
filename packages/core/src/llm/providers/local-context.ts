/**
 * How much context a locally-served model actually has.
 *
 * A hosted vendor's models are known quantities and carry a card with the
 * number on it. A local one is whatever the user pulled this morning, and the
 * OpenAI-compatible `/v1/models` route both servers expose says nothing about
 * it — id, object, owned_by, and that is all.
 *
 * With nothing to read, `createLLMClient` fell back to assuming 128k. For a
 * remote model that is a fair guess. For `llama3.2:3b`, whose window is 8k, it
 * is wrong by a factor of sixteen in the dangerous direction: the pre-flight
 * guard compares against the assumption, passes, and the request is rejected
 * by the server after the whole context was built and sent. The guard exists
 * precisely to catch that before the round trip.
 *
 * Both servers do report the real number — just not on the OpenAI-shaped
 * route. Ollama has `POST /api/show`, LM Studio has `GET /api/v0/models`. So
 * ask them. It is loopback; the call costs nothing worth counting.
 *
 * Everything here fails soft: no answer means no entry, and the caller keeps
 * whatever it had. A wrong number would be worse than none.
 */

import { fetchWithProxy } from "../../utils/proxy-fetch.js";

/** Model id → context window in tokens. Missing means "still unknown". */
export type ContextWindows = ReadonlyMap<string, number>;

const EMPTY: ContextWindows = new Map();

function sane(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** Strip the `/v1` (or similar) suffix — the native routes sit at the root. */
function serverRoot(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

/**
 * Ollama keeps the window in `model_info`, under a key named for the
 * architecture — `llama.context_length`, `qwen3.context_length`, and so on.
 * The architecture is not known ahead of time, so the key is found by shape
 * rather than looked up.
 */
async function ollamaContextWindow(root: string, model: string, timeoutMs: number): Promise<number | null> {
  try {
    const res = await fetchWithProxy(`${root}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { model_info?: Record<string, unknown> };
    const info = json.model_info ?? {};
    for (const [key, value] of Object.entries(info)) {
      if (key.endsWith(".context_length")) {
        const n = sane(value);
        if (n) return n;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function ollamaContextWindows(
  baseUrl: string,
  ids: ReadonlyArray<string>,
  timeoutMs: number,
): Promise<ContextWindows> {
  const root = serverRoot(baseUrl);
  if (!root || ids.length === 0) return EMPTY;
  // One request per model, but they are concurrent and local. A machine with
  // fifty models pulled is the case to keep an eye on, not the common one.
  const entries = await Promise.all(
    ids.map(async (id) => [id, await ollamaContextWindow(root, id, timeoutMs)] as const),
  );
  const out = new Map<string, number>();
  for (const [id, window] of entries) if (window) out.set(id, window);
  return out;
}

/** LM Studio reports the whole catalogue, windows included, in one call. */
async function lmStudioContextWindows(baseUrl: string, timeoutMs: number): Promise<ContextWindows> {
  const root = serverRoot(baseUrl);
  if (!root) return EMPTY;
  try {
    const res = await fetchWithProxy(`${root}/api/v0/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as {
      data?: Array<{ id?: unknown; max_context_length?: unknown; loaded_context_length?: unknown }>;
    };
    const out = new Map<string, number>();
    for (const model of json.data ?? []) {
      if (typeof model?.id !== "string" || !model.id) continue;
      // `loaded_context_length` is what the running instance was actually
      // given, which can be lower than the model's ceiling and is the number
      // a request is measured against. Prefer it when it is there.
      const window = sane(model.loaded_context_length) ?? sane(model.max_context_length);
      if (window) out.set(model.id, window);
    }
    return out;
  } catch {
    return EMPTY;
  }
}

/**
 * Real context windows for a locally-served provider, or an empty map.
 *
 * `service` is the endpoint id, so an unrecognised one simply gets nothing —
 * this deliberately knows about the two local servers and no others.
 */
export async function probeLocalContextWindows(
  service: string,
  baseUrl: string,
  ids: ReadonlyArray<string>,
  timeoutMs = 5_000,
): Promise<ContextWindows> {
  if (!baseUrl) return EMPTY;
  if (service === "ollama") return ollamaContextWindows(baseUrl, ids, timeoutMs);
  if (service === "lmstudio") return lmStudioContextWindows(baseUrl, timeoutMs);
  return EMPTY;
}
