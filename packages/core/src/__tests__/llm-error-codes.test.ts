import { describe, expect, it } from "vitest";
import {
  classifyLLMError,
  isRetryableCode,
  isRetryableLLMErrorCode,
  describeLLMError,
} from "../llm/error-codes.js";

describe("a code the shim already decided", () => {
  it("is taken from the parsed body of a non-streaming failure", () => {
    const error = new Error("Request failed");
    (error as { error?: unknown }).error = {
      code: "rate-limit", retryable: true, agent: "claude", detail: "429 slow down",
    };
    expect(classifyLLMError(error)).toBe("rate-limit");
  });

  it("is read back out of a streamed frame folded into the message", () => {
    const error = new Error(
      'stream error: {"error":{"code":"auth","retryable":false,"agent":"codex"}}',
    );
    expect(classifyLLMError(error)).toBe("auth");
  });

  it("wins over what the text would otherwise suggest", () => {
    // The shim saw the exit code and the stderr; this side sees only prose that
    // happens to mention a 429. The side that had the evidence decides.
    const error = new Error("upstream said 429");
    (error as { error?: unknown }).error = { code: "model-unavailable" };
    expect(classifyLLMError(error)).toBe("model-unavailable");
  });

  it("ignores a code that is not one of ours", () => {
    const error = new Error("ECONNRESET");
    (error as { code?: string }).code = "ECONNRESET";
    expect(classifyLLMError(error)).toBe("upstream");
  });
});

describe("classifying a direct-API error from what it says", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["API 返回 401 (未授权)", "auth"],
    ["invalid api key", "auth"],
    ["403 forbidden: quota exceeded for this key", "auth"],
    ["429 too many requests", "rate-limit"],
    ["the model is overloaded, please retry", "rate-limit"],
    // Devin's real wording, read as cli-exit by the first version of this file.
    ["Your weekly usage quota has been exhausted", "rate-limit"],
    ["cognition.ai/errorKind: resource_exhausted", "rate-limit"],
    ["insufficient balance, credits exhausted", "rate-limit"],
    ["MODEL_NOT_AVAILABLE", "model-unavailable"],
    ["503 service unavailable", "upstream"],
    ["UND_ERR_SOCKET: other side closed", "upstream"],
    ["fetch failed", "upstream"],
    ["LLM stream ended without a terminal event", "timeout"],
    ["stream inactivity: no event for 120000ms", "timeout"],
    ["API 返回 400（请求参数错误）", "bad-request"],
    ["maximum context length exceeded", "context-window"],
    ["Unexpected token < in JSON at position 0", "parse"],
    ["something nobody has seen before", "unknown"],
  ];

  for (const [text, code] of cases) {
    it(`reads "${text.slice(0, 44)}" as ${code}`, () => {
      expect(classifyLLMError(new Error(text))).toBe(code);
    });
  }

  it("reads auth before rate-limit when a message carries both", () => {
    // An expired key that also mentions quota is still an expired key. Told to
    // wait, someone waits an hour for a state that will never change.
    expect(classifyLLMError(new Error("403: rate limit for expired credentials")))
      .toBe("auth");
  });

  it("follows a cause chain", () => {
    const inner = new Error("ECONNREFUSED 127.0.0.1:8788");
    expect(classifyLLMError(new Error("call failed", { cause: inner }))).toBe("upstream");
  });

  it("names an abort as a cancel, not a fault", () => {
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";
    expect(classifyLLMError(aborted)).toBe("cancelled");
  });
});

describe("retry policy", () => {
  it("retries what waiting or respawning can fix", () => {
    expect(isRetryableCode("timeout")).toBe(true);
    expect(isRetryableCode("rate-limit")).toBe(true);
    expect(isRetryableCode("upstream")).toBe(true);
  });

  it("does not retry a wrong key, a wrong model, or the caller's own cancel", () => {
    expect(isRetryableCode("auth")).toBe(false);
    expect(isRetryableCode("model-unavailable")).toBe(false);
    expect(isRetryableCode("cancelled")).toBe(false);
    expect(isRetryableCode("context-window")).toBe(false);
    expect(isRetryableCode("unknown")).toBe(false);
  });

  it("decides straight from an error", () => {
    expect(isRetryableLLMErrorCode(new Error("503 service unavailable"))).toBe(true);
    expect(isRetryableLLMErrorCode(new Error("invalid api key"))).toBe(false);
  });

  it("honours the shim's own verdict on a cancelled run", () => {
    // The old string matcher saw a killed child's "terminated" and retried it,
    // which restarted work the user had just stopped.
    const error = new Error('{"error":{"code":"cancelled"}} terminated');
    expect(isRetryableLLMErrorCode(error)).toBe(false);
  });
});

describe("describeLLMError", () => {
  it("says what an exhausted quota is, and keeps the provider's own words", () => {
    // Verbatim from devin's ACP pipe, which is how it used to reach the screen.
    const raw = '{"code":-32011,"message":"Your weekly usage quota has been exhausted.","data":{"cognition.ai/errorKind":"resource_exhausted"}}';
    const described = describeLLMError(new Error(raw), "en");
    expect(described.code).toBe("rate-limit");
    expect(described.retryable).toBe(true);
    expect(described.summary).toContain("quota");
    // The JSON is unwrapped, not shown as JSON, and not thrown away either.
    expect(described.detail).toBe("Your weekly usage quota has been exhausted.");
    expect(described.message).not.toContain("{");
    expect(described.message).toContain("Your weekly usage quota has been exhausted.");
  });

  it("names a context window overrun", () => {
    const described = describeLLMError(
      Object.assign(new Error("estimated input 300000 tokens exceeds context window 8192"), { code: "context-window" }),
      "en",
    );
    expect(described.code).toBe("context-window");
    expect(described.retryable).toBe(false);
    expect(described.summary).toContain("context window");
  });

  it("names a missing CLI rather than blaming the network", () => {
    const described = describeLLMError(new Error("spawn devin ENOENT"), "en");
    expect(described.code).toBe("cli-missing");
    expect(described.summary).toContain("not found");
  });

  it("does not invent an explanation for something it cannot place", () => {
    const described = describeLLMError(new Error("EACCES: permission denied, open 'book.json'"), "en");
    expect(described.code).toBe("unknown");
    // The raw text still survives — that is the only real information here.
    expect(described.message).toContain("EACCES");
  });

  it("answers in Chinese when asked", () => {
    const described = describeLLMError(new Error("401 unauthorized"), "zh");
    expect(described.code).toBe("auth");
    expect(described.summary).toContain("认证失败");
  });
});
