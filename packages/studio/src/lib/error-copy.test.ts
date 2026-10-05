import { describe, expect, it, beforeEach } from "vitest";
import { setAppLanguage } from "./app-language";
import { localizeKnownRuntimeMessage, plainError } from "./error-copy";

/*
 * These cases assert the Chinese copy. They were written when the global app
 * language defaulted to zh and so never had to say so; English is the default
 * now, and a test that depends on a global default should name it either way.
 * Cases below that want English set it themselves, and win: an inner beforeEach
 * runs after this one.
 */
beforeEach(() => {
  setAppLanguage("zh");
});

describe("localizeKnownRuntimeMessage", () => {
  it("localizes the state-degraded continuation blocker", () => {
    expect(localizeKnownRuntimeMessage(
      "Latest chapter 1 is state-degraded. Repair state or rewrite that chapter before continuing.",
    )).toBe("最新第 1 章处于状态降级（state-degraded）。继续写下一章前，请先修复状态，或重写这一章。");
  });

  it("localizes related state repair errors while preserving unknown messages", () => {
    expect(localizeKnownRuntimeMessage("Chapter 3 is not state-degraded.")).toBe(
      "第 3 章不是状态降级（state-degraded），无需按状态修复。",
    );
    expect(localizeKnownRuntimeMessage(
      "Only the latest state-degraded chapter can be repaired safely (latest is 5).",
    )).toBe("只能安全修复最新的状态降级（state-degraded）章节；当前最新章是第 5 章。");
    expect(localizeKnownRuntimeMessage("Bad request")).toBe("Bad request");
  });

  it("localizes common LLM configuration errors", () => {
    const studioMessage = localizeKnownRuntimeMessage(
      "Studio LLM API key not set. Open Studio services and save an API key for the selected service.",
    );
    expect(studioMessage).toContain("Studio 模型 API Key 未设置");
    expect(studioMessage).not.toMatch(/kkaiapi/i);

    const cliMessage = localizeKnownRuntimeMessage(
      "QUIRE_LLM_API_KEY not set. Run 'quire config set-global' or add it to project .env file.",
    );
    expect(cliMessage).toContain("QUIRE_LLM_API_KEY 未设置");
    expect(cliMessage).not.toMatch(/kkaiapi/i);
  });
});

describe("plainError", () => {
  it("turns a provider quota error into a sentence with the reset time", () => {
    const e = plainError(
      'page-8: antigravity: rate-limit — error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 2h30m50s. (response may be truncated) AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429)"}',
    );
    expect(e.where).toBe("page 8");
    expect(e.text).toBe("Antigravity has hit its usage limit. It resets in 2h30m. Resume then, or pick another model in Settings.");
    expect(e.rewritten).toBe(true);
    // The fix is the model settings, and the limit lifts 2h30m after the error.
    expect(e.fix).toBe("models");
    expect(e.resetMs).toBe(150 * 60_000);
  });
  it("points a timeout at resuming, not at the settings", () => {
    const e = plainError("write: claude: timeout — ETIMEDOUT");
    expect(e.fix).toBe("resume");
    expect(e.resetMs).toBeUndefined();
  });
  it("keeps an unknown message but drops the machine payload", () => {
    expect(plainError('Outline missing for section 2 AGY_ERROR: {"x":1}').text).toBe("Outline missing for section 2");
    expect(plainError("Outline missing").rewritten).toBe(false);
  });
});
