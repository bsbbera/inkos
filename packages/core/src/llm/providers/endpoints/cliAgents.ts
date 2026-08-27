/**
 * Agent CLIs installed on this machine, exposed as ordinary providers.
 *
 * Quire's shim owns the CLI processes and speaks OpenAI-completions on
 * 127.0.0.1, so each CLI is a normal openai-completions endpoint here — no
 * special-casing anywhere else in the stack. Because the host is loopback,
 * isApiKeyOptionalForEndpoint already lets these probe /models with no key,
 * exactly like Ollama.
 *
 * One base URL per CLI (/<cli>/v1) rather than the shared /v1: the shim
 * filters its catalogue by that prefix, so the four providers list their own
 * models instead of all four listing the same two hundred.
 *
 * `models` is a seed, not the catalogue. It carries the metadata a live
 * /models probe cannot report — mainly which models accept images — and the
 * probe supplies everything else. devin alone offers 183 models and they
 * change whenever the CLI updates, so hardcoding the full list would be stale
 * by the next `devin update`.
 */
import type { InkosEndpoint, InkosModel } from "../types.js";

// The port must follow the shim the surrounding app actually started: a dev
// build installed beside the release one runs its shim on a different port,
// and a baked-in 8787 would silently point it at the other app's shim.
const SHIM = `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`;

const text = (id: string, imageInput: boolean): InkosModel => ({
  id,
  maxOutput: 8192,
  contextWindowTokens: 200000,
  capabilities: { text: true, tools: true, imageInput },
});

export const CLAUDE_CLI: InkosEndpoint = {
  id: "claudeCli",
  label: "Claude Code (CLI)",
  group: "cli",
  api: "openai-completions",
  baseUrl: `${SHIM}/claude/v1`,
  checkModel: "claude/sonnet",
  // Each CLI browses on its own account — that is most of why someone runs
  // one. A probed model inherits this, which matters here more than
  // anywhere else: devin lists 183 and seeds ten.
  modelDefaults: { webSearch: true },
  models: [
    text("claude/default", true),
    text("claude/opus", true),
    text("claude/sonnet", true),
    text("claude/haiku", true),
  ],
};

export const CODEX_CLI: InkosEndpoint = {
  id: "codexCli",
  label: "Codex (CLI)",
  group: "cli",
  api: "openai-completions",
  baseUrl: `${SHIM}/codex/v1`,
  checkModel: "codex/gpt-5.5",
  // Each CLI browses on its own account — that is most of why someone runs
  // one. A probed model inherits this, which matters here more than
  // anywhere else: devin lists 183 and seeds ten.
  modelDefaults: { webSearch: true },
  models: [
    text("codex/gpt-5.6-terra", true),
    text("codex/gpt-5.6-luna", true),
    text("codex/gpt-5.5", true),
    text("codex/gpt-5.4-mini", true),
  ],
};

export const DEVIN_CLI: InkosEndpoint = {
  id: "devinCli",
  label: "Devin (CLI)",
  group: "cli",
  api: "openai-completions",
  baseUrl: `${SHIM}/devin/v1`,
  checkModel: "devin/claude-opus-5-medium",
  // Same CLI, same interface, different model capabilities: the glm-5-2 family
  // is text-only while kimi and the claude/gpt families take images. This is
  // the seed's whole reason for existing.
  // Each CLI browses on its own account — that is most of why someone runs
  // one. A probed model inherits this, which matters here more than
  // anywhere else: devin lists 183 and seeds ten.
  modelDefaults: { webSearch: true },
  models: [
    text("devin/glm-5-2", false),
    text("devin/glm-5-2-max", false),
    text("devin/glm-5-2-1m", false),
    text("devin/glm-5-2-max-1m", false),
    text("devin/kimi-k3-high", true),
    text("devin/kimi-k3-max", true),
    text("devin/kimi-k2-6", true),
    text("devin/claude-opus-5-medium", true),
    text("devin/claude-opus-5-high", true),
    text("devin/gpt-5-6-sol-medium", true),
  ],
};

export const ANTIGRAVITY_CLI: InkosEndpoint = {
  id: "antigravityCli",
  label: "Antigravity (CLI)",
  group: "cli",
  api: "openai-completions",
  baseUrl: `${SHIM}/antigravity/v1`,
  checkModel: "antigravity/default",
  // Each CLI browses on its own account — that is most of why someone runs
  // one. A probed model inherits this, which matters here more than
  // anywhere else: devin lists 183 and seeds ten.
  modelDefaults: { webSearch: true },
  models: [
    text("antigravity/default", true),
    text("antigravity/gemini-3.7-flash-high", true),
    text("antigravity/gemini-3.7-flash-medium", true),
  ],
};
