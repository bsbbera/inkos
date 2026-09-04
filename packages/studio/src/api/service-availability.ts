/**
 * Whether a provider from the endpoint bank should be offered to the user.
 *
 * This rule lived inline in two request handlers and drifted: a CLI provider
 * was only "connected" once it appeared in inkos.json's services list, which
 * nothing ever wrote it into. All four CLIs therefore reported disconnected,
 * the chat model picker filters on exactly this flag, and every message was
 * refused with "Select a model first" while the app looked configured.
 *
 * A CLI is installed, not configured. It runs on loopback and needs no key, so
 * availability is simply "no key required". Whether the binary is actually
 * present shows up as an empty model list, which the pickers already drop.
 *
 * Ollama and LM Studio are the same kind of thing and the same argument
 * applies to them: installed, on loopback, no key. Holding them to the
 * configured-in-inkos.json rule meant a running local server reported
 * disconnected until someone hand-wrote an entry for it, which is the
 * configuration step neither of them has. Running or not running is the only
 * question, and it is answered where it can be - by whether the server
 * returned any models.
 */
export function isServiceAvailable(params: {
  readonly group?: string | undefined;
  readonly apiKeyOptional: boolean;
  readonly hasApiKey: boolean;
  readonly isConfigured: boolean;
}): boolean {
  if (params.group === "cli" || params.group === "local") return params.apiKeyOptional;
  return params.hasApiKey || (params.apiKeyOptional && params.isConfigured);
}
