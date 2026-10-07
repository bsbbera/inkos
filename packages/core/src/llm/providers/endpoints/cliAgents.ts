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
 * filters its catalogue by that prefix, so the providers list their own
 * models instead of all of them listing the same two hundred.
 *
 * Built from the cli entries of providers.json rather than one constant per
 * CLI, so a CLI added there by JSON alone has an endpoint too. `models` is
 * empty on purpose: the shim owns the model list, live and fallback both.
 */
import { readProviderCatalogue } from "../../provider-catalogue.js";
import type { QuireEndpoint } from "../types.js";

// The port must follow the shim the surrounding app actually started: a dev
// build installed beside the release one runs its shim on a different port,
// and a baked-in 8787 would silently point it at the other app's shim.
const SHIM = `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`;

/** `devinCli` → `devin`: the shim's agent id is the catalogue id without "Cli". */
export const shimAgentOf = (id: string) => id.replace(/Cli$/, "");

export function cliEndpoints(): QuireEndpoint[] {
  return readProviderCatalogue()
    .filter((p) => p.kind === "cli" && p.id.endsWith("Cli"))
    .map((p) => ({
      id: p.id,
      label: `${p.label} (CLI)`,
      group: "cli",
      api: "openai-completions",
      baseUrl: `${SHIM}/${shimAgentOf(p.id)}/v1`,
      checkModel: `${shimAgentOf(p.id)}/default`,
      // Each CLI browses on its own account — that is most of why someone runs one.
      modelDefaults: { webSearch: true },
      models: [],
    }));
}
