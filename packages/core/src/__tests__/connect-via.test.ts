import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api, Model } from "@earendil-works/pi-ai";
import { setConnectVia, viaStream, SUBSCRIPTION_KEY } from "../llm/subscription.js";
import { getServiceApiKey } from "../llm/secrets.js";

const model = (provider: string, baseUrl: string, id = "claude-sonnet-4-5") =>
  ({ id, provider, baseUrl, api: "anthropic-messages" }) as unknown as Model<Api>;

beforeEach(async () => { process.env.QUIRE_CONFIG_HOME = await mkdtemp(join(tmpdir(), "via-")); });
afterEach(() => { delete process.env.QUIRE_CONFIG_HOME; });

it("sends a CLI-connected Anthropic request to the shim as claude/<alias>, with no key", async () => {
  await setConnectVia("anthropic", "cli");
  const send = vi.fn(() => "s" as never);
  viaStream(model("anthropic", "https://api.anthropic.com"), { messages: [] }, { apiKey: "sk-real" }, send);
  const [sent, , opts] = send.mock.calls[0] as unknown as [Model<Api>, unknown, { apiKey: string }];
  expect(sent).toMatchObject({ id: "claude/sonnet", api: "openai-completions", provider: "claudeCli" });
  expect(sent.baseUrl).toMatch(/\/claude\/v1$/);
  expect(opts.apiKey).toBe("local");
});

it("never moves a gateway that only calls itself openai", async () => {
  await setConnectVia("openai", "cli");
  const send = vi.fn(() => "s" as never);
  const gateway = model("openai", "https://api.deepseek.com/v1", "deepseek-v4");
  viaStream(gateway, { messages: [] }, { apiKey: "k" }, send);
  expect(send).toHaveBeenCalledWith(gateway, { messages: [] }, { apiKey: "k" });
});

it("asks for no saved key once a provider is connected another way", async () => {
  await setConnectVia("anthropic", "subscription");
  expect(await getServiceApiKey("/nowhere", "anthropic")).toBe(SUBSCRIPTION_KEY);
});
