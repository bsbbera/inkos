import { getAppLanguage } from "./app-language";

const KNOWN_RUNTIME_REPLACEMENTS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly replacement: string;
}> = [
  {
    pattern: /Latest chapter (\d+) is state-degraded\. Repair state or rewrite that chapter before continuing\./g,
    replacement: "最新第 $1 章处于状态降级（state-degraded）。继续写下一章前，请先修复状态，或重写这一章。",
  },
  {
    pattern: /Chapter (\d+) is not state-degraded\./g,
    replacement: "第 $1 章不是状态降级（state-degraded），无需按状态修复。",
  },
  {
    pattern: /Only the latest state-degraded chapter can be repaired safely \(latest is (\d+)\)\./g,
    replacement: "只能安全修复最新的状态降级（state-degraded）章节；当前最新章是第 $1 章。",
  },
  {
    pattern: /State repair still failed for chapter (\d+)\./g,
    replacement: "第 $1 章状态修复仍然失败。",
  },
  {
    pattern: /Studio LLM API key not set\. Open Studio services and save an API key for the selected service\./g,
    replacement: "Studio 模型 API Key 未设置。请打开“模型配置”，为当前服务保存 API Key。",
  },
  {
    pattern: /QUIRE_LLM_API_KEY not set\. Run 'quire config set-global' or add it to project \.env file\./g,
    replacement: "QUIRE_LLM_API_KEY 未设置。请运行 `quire config set-global`，或在项目 .env 文件中添加它。",
  },
];

export function localizeKnownRuntimeMessage(message: string): string {
  // Runtime messages arrive in English; in English mode show them as-is.
  if (getAppLanguage() === "en") return message;
  let localized = message;
  for (const entry of KNOWN_RUNTIME_REPLACEMENTS) {
    localized = localized.replace(entry.pattern, entry.replacement);
  }
  return localized;
}

/*
 * A run error in words a writer acts on. Provider failures arrive as
 * "page-8: antigravity: rate-limit — error: … AGY_ERROR: {json}"; the
 * person needs who failed, why, and what to do, not the JSON. The raw text
 * stays available behind "Details" so nothing is hidden.
 */
export interface PlainError {
  /** Where it stopped, e.g. "page 8". Empty when the message does not say. */
  readonly where: string;
  /** One or two sentences: what happened and what to do. */
  readonly text: string;
  /** True when `text` is a rewrite, so the raw message is worth offering. */
  readonly rewritten: boolean;
  /** Where the fix lives: the model settings, or running it again. */
  readonly fix?: "models" | "resume";
  /** A usage limit that says when it lifts: how long after the error, in ms. */
  readonly resetMs?: number;
}

/** "2h30m", "45m", "1h" -> ms. Undefined when there is no number to read. */
export function durationMs(s: string): number | undefined {
  const h = /(\d+)\s*h/i.exec(s)?.[1];
  const m = /(\d+)\s*m/i.exec(s)?.[1];
  if (!h && !m) return undefined;
  return (Number(h ?? 0) * 60 + Number(m ?? 0)) * 60_000;
}

/**
 * A run the person stopped. Records written before the `stopped` flag existed
 * carry only the runner's message, so that counts too.
 */
export function isStop(e: { readonly message: string; readonly stopped?: boolean } | null | undefined): boolean {
  return !!e && (e.stopped === true || /^stopped by user\.?$/i.test(e.message.trim()));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function plainError(message: string): PlainError {
  const head = /^([\w.-]+):\s*([\w.-]+):\s*[\w-]+\s*[—-]\s*/.exec(message);
  const where = head ? head[1].replace(/-(\d+)$/, " $1") : "";
  const who = head ? cap(head[2]) : "The model";
  const reset = /resets? in\s*((?:\d+h)?\s*(?:\d+m)?)/i.exec(message)?.[1]?.trim();
  const m = message.toLowerCase();

  let text: string | null = null;
  let fix: PlainError["fix"];
  let resetMs: number | undefined;
  if (/429|rate.?limit|quota|resource_exhausted|too many requests/.test(m)) {
    text = `${who} has hit its usage limit.` + (reset ? ` It resets in ${reset}.` : "")
      + " Resume then, or pick another model in Settings.";
    fix = "models";
    resetMs = reset ? durationMs(reset) : undefined;
  } else if (/401|403|unauthori[sz]ed|forbidden|invalid.{0,12}key|api key/.test(m)) {
    text = `${who} refused the key. Check it in Settings → Models.`;
    fix = "models";
  } else if (/context.{0,20}(length|window)|too many tokens|maximum context/.test(m)) {
    text = `The text was too long for ${who}. Pick a model with a larger context, or split the page.`;
    fix = "models";
  } else if (/timed? ?out|etimedout/.test(m)) {
    text = `${who} took too long to answer. Resume to try again.`;
    fix = "resume";
  } else if (/econnrefused|enotfound|fetch failed|network|socket hang up/.test(m)) {
    text = `Could not reach ${who}. Check the connection or that the service is running, then resume.`;
    fix = "resume";
  } else if (/\b5\d\d\b|overloaded|unavailable|internal server error/.test(m)) {
    text = `${who} is down or overloaded. Resume in a few minutes.`;
    fix = "resume";
  }
  if (text) return { where, text, rewritten: true, ...(fix ? { fix } : {}), ...(resetMs ? { resetMs } : {}) };

  // Unknown: keep the person's words, drop the trailing machine payload.
  const prose = message.slice(head ? head[0].length : 0).split(/\s(?:[A-Z_]{3,}:|\{)/)[0].trim();
  const short = prose.length > 220 ? `${prose.slice(0, 217)}…` : prose;
  return { where, text: short || message, rewritten: short !== message };
}
