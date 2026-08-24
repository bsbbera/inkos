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
 */
export function isServiceAvailable(params: {
  readonly group?: string | undefined;
  readonly apiKeyOptional: boolean;
  readonly hasApiKey: boolean;
  readonly isConfigured: boolean;
}): boolean {
  if (params.group === "cli") return params.apiKeyOptional;
  return params.hasApiKey || (params.apiKeyOptional && params.isConfigured);
}
