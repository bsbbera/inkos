/*
 * "Connect via": how Anthropic and OpenAI are reached (20 §2, Phase 2 step 5).
 *
 * - api-key: the saved key, through the transport every other API uses.
 * - subscription: the user's Claude Pro/Max or ChatGPT plan, signed in through
 *   pi's own OAuth flow. pi keeps the token fresh; the token is stored in
 *   ~/.quire/credentials.json and never in a workspace.
 * - cli: the installed Claude Code / Codex CLI, through the shim. The fallback
 *   if a provider ever stops honouring subscription tokens in third-party apps.
 *
 * Applied at the transport (`viaStream`), the one place both the agent loop and
 * the pipelines' chatCompletion send a request, so nothing upstream changes.
 * Only requests to the official hosts are touched: a gateway that pi calls
 * "openai" must never end up on somebody's ChatGPT login.
 */
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createModels,
  InMemoryCredentialStore,
  type Api,
  type AssistantMessageEventStream,
  type AuthInteraction,
  type AuthOperationOptions,
  type Context,
  type Credential,
  type CredentialInfo,
  type Model,
  type MutableModels,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { GLOBAL_CONFIG_DIR } from "../utils/llm-env.js";

export type ConnectVia = "api-key" | "subscription" | "cli";

/** The two providers with a subscription login, the official host, and the CLI that stands in for each. */
export const VIA_PROVIDERS = {
  anthropic: { host: "api.anthropic.com", cli: "claude" },
  openai: { host: "api.openai.com", cli: "codex" },
} as const;
export type ViaProvider = keyof typeof VIA_PROVIDERS;
export const isViaProvider = (id: string): id is ViaProvider => id in VIA_PROVIDERS;

/** Marks a config as subscription-backed. Never sent: `viaStream` drops it so pi's OAuth auth is used. */
export const SUBSCRIPTION_KEY = "quire-subscription";

// ponytail: tests never read the real home; pass `home` to exercise the files.
const homeOf = (home?: string) => home ?? process.env.QUIRE_CONFIG_HOME ?? (process.env.VITEST ? null : GLOBAL_CONFIG_DIR);

function readVia(home?: string): Partial<Record<ViaProvider, ConnectVia>> {
  const dir = homeOf(home);
  if (!dir) return {};
  try { return JSON.parse(readFileSync(join(dir, "connect-via.json"), "utf-8")) ?? {}; } catch { return {}; }
}

/** Sync because the transport decides per request; the file is a few bytes. */
export function connectVia(provider: string, home?: string): ConnectVia {
  return isViaProvider(provider) ? readVia(home)[provider] ?? "api-key" : "api-key";
}

export async function setConnectVia(provider: ViaProvider, via: ConnectVia, home?: string): Promise<void> {
  const dir = homeOf(home) ?? GLOBAL_CONFIG_DIR;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "connect-via.json"), `${JSON.stringify({ ...readVia(dir), [provider]: via }, null, 2)}\n`, "utf-8");
}

/**
 * pi's in-memory store, persisted to one file after every write.
 * ponytail: one process (the Studio) owns it; a second writer would need a file lock.
 */
class FileCredentialStore extends InMemoryCredentialStore {
  private readonly ready: Promise<void>;
  constructor(private readonly file: string) {
    super();
    this.ready = (async () => {
      try {
        const all = JSON.parse(await readFile(file, "utf-8")) as Record<string, Credential>;
        for (const [id, credential] of Object.entries(all)) await super.modify(id, async () => credential);
      } catch { /* no file yet */ }
    })();
  }
  override async read(id: string, o?: AuthOperationOptions) { await this.ready; return super.read(id, o); }
  override async list(o?: AuthOperationOptions): Promise<readonly CredentialInfo[]> { await this.ready; return super.list(o); }
  override async modify(
    id: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    o?: AuthOperationOptions,
  ) {
    await this.ready;
    const out = await super.modify(id, fn, o);
    await this.save();
    return out;
  }
  override async delete(id: string, o?: AuthOperationOptions) { await this.ready; await super.delete(id, o); await this.save(); }
  private async save() {
    const all: Record<string, Credential> = {};
    for (const { providerId } of await super.list()) {
      const c = await super.read(providerId);
      if (c) all[providerId] = c;
    }
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`, "utf-8");
    await chmod(this.file, 0o600).catch(() => { /* Windows: ACLs, not modes */ });
  }
}

const collections = new Map<string, MutableModels>();
export function subscriptionModels(home?: string): MutableModels {
  const dir = homeOf(home) ?? GLOBAL_CONFIG_DIR;
  let models = collections.get(dir);
  if (!models) {
    models = createModels({ credentials: new FileCredentialStore(join(dir, "credentials.json")) });
    models.setProvider(anthropicProvider());
    models.setProvider(openaiProvider());
    collections.set(dir, models);
  }
  return models;
}

/** Signed in with a subscription, as pi's own store says. */
export async function hasSubscription(provider: ViaProvider, home?: string): Promise<boolean> {
  const list = await subscriptionModels(home).getAuth(provider).catch(() => undefined);
  return list?.source === "OAuth";
}

export function subscriptionLogin(provider: ViaProvider, interaction: AuthInteraction, home?: string) {
  return subscriptionModels(home).login(provider, "oauth", interaction);
}

export function subscriptionLogout(provider: ViaProvider, home?: string) {
  return subscriptionModels(home).logout(provider);
}

const onHost = (model: Model<Api>, provider: ViaProvider) =>
  model.provider === provider && (!model.baseUrl || model.baseUrl.includes(VIA_PROVIDERS[provider].host));

/** A model id the CLI accepts: Claude Code takes the family alias, Codex takes the id. */
export function cliModelFor(provider: ViaProvider, id: string): string {
  if (provider === "openai") return id || "default";
  return /opus/i.test(id) ? "opus" : /haiku/i.test(id) ? "haiku" : /sonnet/i.test(id) ? "sonnet" : "default";
}

/**
 * The request as connect-via says to send it.
 *
 * `send` is the caller's own transport (compat streamSimple); it is used as is
 * for api-key and, with the model moved to the shim, for cli.
 */
export function viaStream(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  send: typeof streamSimple = streamSimple,
): AssistantMessageEventStream {
  const provider = model.provider;
  if (!isViaProvider(provider) || !onHost(model, provider)) return send(model, context, options);
  const via = connectVia(provider);
  if (via === "subscription") {
    const models = subscriptionModels();
    // pi's own catalogue entry carries the api and host the OAuth path expects.
    const native = models.getModel(provider, model.id) ?? model;
    const { apiKey: _drop, ...rest } = options ?? {};
    return models.streamSimple(native, context, rest);
  }
  if (via === "cli") {
    const cli = VIA_PROVIDERS[provider].cli;
    const shim = `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}/${cli}/v1`;
    return send({
      ...model,
      // The shim reads the CLI from the id: a bare alias would run whatever is selected.
      id: `${cli}/${cliModelFor(provider, model.id)}`,
      api: "openai-completions" as Api,
      provider: `${cli}Cli`,
      baseUrl: shim,
    }, context, { ...options, apiKey: "local" });
  }
  return send(model, context, options);
}
