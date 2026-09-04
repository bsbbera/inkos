/**
 * What went wrong, as a value rather than a sentence.
 *
 * Retry policy here was a list of substrings: `isRetryableLLMError` matched
 * "terminated", "UND_ERR_SOCKET", "bad gateway", "overloaded" and a dozen more
 * against whatever text an error happened to carry. It worked, in the sense
 * that it usually guessed right, and it broke silently every time a provider
 * reworded a message — the failure mode being a run that gives up on something
 * transient, or hammers something permanent.
 *
 * There are two model backends and they now agree on one vocabulary. Quire's
 * shim classifies a CLI failure at the point where the evidence is (exit code,
 * stderr, its own timeout) and sends `error.code` on the wire; direct API
 * providers reach pi-ai, which does not, so those are still read from text —
 * but by the same rules, in one place, producing the same codes.
 *
 * The codes match `cli-shim/errors.mjs`. Two copies of eight strings is the
 * cheaper mistake here: the alternative is a shared package between a plain-JS
 * shim and a TypeScript engine that are built and shipped separately.
 */

export type LLMErrorCode =
  | "cancelled"
  | "timeout"
  | "rate-limit"
  | "upstream"
  | "auth"
  | "model-unavailable"
  | "cli-missing"
  | "cli-exit"
  | "bad-request"
  | "context-window"
  | "parse"
  | "unknown";

/**
 * Codes worth making the same call again for.
 *
 * `timeout` is in: a wedged CLI or a stalled stream usually clears on a fresh
 * spawn. `auth` and `model-unavailable` are out however tempting — retrying a
 * bad key or a model that is not on the provider only delays the real error,
 * which was the exact reasoning behind the old code's refusal to retry a bare
 * `MODEL_NOT_AVAILABLE`.
 */
const RETRYABLE: ReadonlySet<LLMErrorCode> = new Set<LLMErrorCode>([
  "timeout",
  "rate-limit",
  "upstream",
]);

export function isRetryableCode(code: LLMErrorCode): boolean {
  return RETRYABLE.has(code);
}

const KNOWN = new Set<string>([
  "cancelled", "timeout", "rate-limit", "upstream", "auth",
  "model-unavailable", "cli-missing", "cli-exit", "bad-request",
  "context-window", "parse", "unknown",
]);

/**
 * A code the shim already decided, if this error carries one.
 *
 * The body travels differently depending on how far it got: a non-streaming
 * failure arrives as a parsed object hanging off the error, a streamed one as
 * a JSON frame that ends up inside the message text. Both are checked, object
 * first, because a parsed field is evidence and a substring is a guess.
 */
function declaredCode(error: unknown, depth = 0): LLMErrorCode | null {
  if (!error || depth > 4) return null;

  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const own = record.code;
    if (typeof own === "string" && KNOWN.has(own)) return own as LLMErrorCode;
    for (const key of ["error", "body", "cause", "response", "data"]) {
      const found = declaredCode(record[key], depth + 1);
      if (found) return found;
    }
  }

  const text = typeof error === "string"
    ? error
    : error instanceof Error ? error.message : "";
  // The streamed frame, re-read out of whatever prose it was folded into.
  const quoted = /"code"\s*:\s*"([a-z-]+)"/.exec(text);
  if (quoted && KNOWN.has(quoted[1]!)) return quoted[1] as LLMErrorCode;
  return null;
}

/** Everything an error has to say, flattened, for the text fallback. */
function textOf(error: unknown, depth = 0): string {
  if (!error || depth > 4) return "";
  if (typeof error === "string") return error;
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message, error.name);
    parts.push(textOf((error as { cause?: unknown }).cause, depth + 1));
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "reason", "detail", "type", "statusText"]) {
      if (typeof record[key] === "string") parts.push(record[key] as string);
    }
    if (typeof record.status === "number") parts.push(String(record.status));
    for (const key of ["error", "body", "response", "data"]) {
      if (record[key]) parts.push(textOf(record[key], depth + 1));
    }
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * The code for an error, from its own declaration or from what it says.
 *
 * Order is the same as the shim's, and for the same reasons: a caller's abort
 * outranks any downstream symptom, and auth is read before rate-limit because
 * an expired key frequently mentions quota in the same breath — telling
 * someone to wait it out when they need to sign in costs them the afternoon.
 */
export function classifyLLMError(error: unknown): LLMErrorCode {
  const declared = declaredCode(error);
  if (declared) return declared;

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return error.name === "AbortError" ? "cancelled" : "timeout";
  }

  const text = textOf(error).toLowerCase();
  if (!text) return "unknown";

  if (/(aborted|abortederror|operation was cancelled|canceled by caller)/.test(text)) return "cancelled";
  if (/(context window|context length|maximum context|too many tokens)/.test(text)) return "context-window";
  if (/(timed? ?out|etimedout|deadline exceeded|inactivity|stream ended without)/.test(text)) return "timeout";

  if (/\b(401|403)\b/.test(text)
    || /(invalid api key|unauthorized|not logged in|please (log ?in|authenticate)|session expired|no credentials)/.test(text)) {
    return "auth";
  }
  // Everyone words an exhausted quota differently — "quota exceeded",
  // "weekly usage quota has been exhausted", `resource_exhausted`. Matching one
  // phrasing sends a run that only had to wait down the non-retryable path.
  if (/\b429\b/.test(text)
    || /(rate.?limit|too many requests|usage limit|overloaded|try again later|please retry)/.test(text)
    || /(quota|credits?|balance).{0,24}(exceeded|exhausted|depleted|run out|used up)/.test(text)
    || /resource[_ ]exhausted/.test(text)) {
    return "rate-limit";
  }
  if (/(model_not_available|model not available|unknown model|unsupported model|model .* (not found|does not exist))/.test(text)) {
    return "model-unavailable";
  }
  // Before the network branch, which would otherwise take it: a spawn failure
  // is worded like one ("spawn devin ENOENT"), and ENOENT sits next to
  // ECONNREFUSED in every list of them. Read as a network fault, an
  // uninstalled CLI became "the model service is temporarily unreachable,
  // retry shortly" - retryable, and wrong on both counts. The shim declares
  // this code where it can watch the spawn; over ACP only the message text
  // survives, so it is read here too.
  if (/\benoent\b|is not recognized as an internal or external command|command not found|no such file or directory/.test(text)) {
    return "cli-missing";
  }
  if (/\b(502|503|504)\b/.test(text)
    || /(econnrefused|econnreset|enotfound|epipe|und_err_socket|socket hang up|other side closed|network socket disconnected|fetch failed|terminated|bad gateway|service unavailable|temporarily unavailable|connection error|unable to connect)/.test(text)) {
    return "upstream";
  }
  if (/\b400\b/.test(text)) return "bad-request";
  // "json" on its own matched any error that merely named a .json file, so
  // `EACCES: permission denied, open 'book.json'` was reported as a model
  // parse failure. The word only means that beside parse language.
  if (/(unexpected token|failed to parse|could not parse|unable to parse|invalid json|malformed|unexpected end of json|not valid json)/.test(text)) {
    return "parse";
  }
  return "unknown";
}

/** Whether making the same call again could plausibly succeed. */
export function isRetryableLLMErrorCode(error: unknown): boolean {
  return isRetryableCode(classifyLLMError(error));
}

/**
 * What to tell the person, for each way a model call can fail.
 *
 * The code was only ever used to decide whether to retry. What reached the
 * screen was whatever string the failure happened to carry, so an exhausted
 * devin quota arrived as
 * `{"code":-32011,"message":"Your weekly usage quota has been exhausted.","data":{"cognition.ai/errorKind":"resource_exhausted"}}`
 * — the answer is in there, and nobody should have to read JSON to find it.
 *
 * So: one sentence naming the cause and what to do about it, then the
 * provider's own text kept underneath, because the specifics (which quota,
 * which model, how many tokens) only exist there. Both, not either.
 */
const MESSAGES: Record<LLMErrorCode, { zh: string; en: string }> = {
  "cancelled": {
    zh: "已取消。",
    en: "Cancelled.",
  },
  "timeout": {
    zh: "模型响应超时。重试通常可以，或换一个更快的模型。",
    en: "The model timed out. Retrying usually works, or pick a faster model.",
  },
  "rate-limit": {
    zh: "该模型的额度或速率上限已用尽。等待额度重置，或改选另一个模型。",
    en: "This model's quota or rate limit is used up. Wait for it to reset, or switch to another model.",
  },
  "upstream": {
    zh: "模型服务暂时不可用。这是对方的问题，稍后重试。",
    en: "The model service is temporarily unreachable. That is their end — retry shortly.",
  },
  "auth": {
    zh: "认证失败。请检查该服务的 API Key，或重新登录对应 CLI。",
    en: "Authentication failed. Check this service's API key, or sign in to its CLI again.",
  },
  "model-unavailable": {
    zh: "该模型在此服务上不存在或已下线。请另选一个模型。",
    en: "This model is not offered by this service any more. Pick a different one.",
  },
  "cli-missing": {
    zh: "找不到该 CLI 的可执行文件。请先安装它，或将其加入 PATH。",
    en: "That CLI's executable was not found. Install it, or put it on PATH.",
  },
  "cli-exit": {
    zh: "CLI 异常退出。下方是它自己的输出。",
    en: "The CLI exited unexpectedly. Its own output is below.",
  },
  "bad-request": {
    zh: "模型拒绝了这个请求。下方是它给出的原因。",
    en: "The model rejected the request. Its reason is below.",
  },
  "context-window": {
    zh: "内容超出了该模型的上下文窗口。请压缩上下文，或改用窗口更大的模型。",
    en: "The content is larger than this model's context window. Compress the context, or use a model with a bigger one.",
  },
  "parse": {
    zh: "模型返回的内容无法解析。",
    en: "The model's reply could not be parsed.",
  },
  "unknown": {
    zh: "模型调用失败。",
    en: "The model call failed.",
  },
};

export interface DescribedLLMError {
  readonly code: LLMErrorCode;
  /** The sentence to lead with. */
  readonly summary: string;
  /** The provider's own words, kept verbatim. Empty when it said nothing. */
  readonly detail: string;
  /** Summary and detail joined, for the many places that want one string. */
  readonly message: string;
  readonly retryable: boolean;
}

/** Strip a JSON wrapper down to the message a person would have wanted. */
function readableDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.trim();
  if (!text) return "";
  // Providers hand back their error as a JSON object more often than not,
  // either as the whole message or folded into the end of one.
  const brace = text.indexOf("{");
  if (brace !== -1) {
    try {
      const parsed = JSON.parse(text.slice(brace)) as Record<string, unknown>;
      const inner = (parsed.error ?? parsed) as Record<string, unknown>;
      const message = inner?.message ?? parsed.message;
      if (typeof message === "string" && message.trim()) {
        const prefix = text.slice(0, brace).trim();
        return prefix ? `${prefix} ${message.trim()}` : message.trim();
      }
    } catch {
      // Not JSON after all, or truncated mid-object. Keep the text as it came.
    }
  }
  return text;
}

export function describeLLMError(error: unknown, language: "zh" | "en" = "en"): DescribedLLMError {
  const code = classifyLLMError(error);
  const summary = MESSAGES[code][language];
  // The context-window guard already writes a better sentence than any generic
  // one here — it knows the token counts — so it speaks for itself.
  const detail = code === "cancelled" ? "" : readableDetail(error);
  return {
    code,
    summary,
    detail,
    message: detail && detail !== summary ? `${summary}\n${detail}` : summary,
    retryable: isRetryableCode(code),
  };
}
