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
 * `models` is empty on purpose. It used to hold a seed — ten devin ids, four
 * codex ids — described as metadata the probe could not report. It was pinned
 * version ids, so it went stale on the next `devin update`, and because a
 * failed probe fell through to it silently, the picker offered those ten as if
 * they were the catalogue while the CLI had 183.
 *
 * The shim owns the model list, live and fallback both. Nothing about which
 * models exist is compiled into this file any more.
 */
import type { InkosEndpoint } from "../types.js";

// The port must follow the shim the surrounding app actually started: a dev
// build installed beside the release one runs its shim on a different port,
// and a baked-in 8787 would silently point it at the other app's shim.
const SHIM = `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`;

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
  models: [],
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
  models: [],
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
  models: [],
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
  models: [],
};
