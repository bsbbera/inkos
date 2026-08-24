import { describe, expect, it } from "vitest";
import { isServiceAvailable } from "./service-availability.js";

// The regression this exists for: the four CLI providers were listed in the
// endpoint bank but never written into inkos.json, so the old rule reported
// every one of them disconnected and chat had no model to select.
describe("isServiceAvailable", () => {
  it("offers a CLI provider that needs no key, configured or not", () => {
    expect(isServiceAvailable({
      group: "cli", apiKeyOptional: true, hasApiKey: false, isConfigured: false,
    })).toBe(true);
  });

  it("does not offer a CLI provider that would need a key", () => {
    expect(isServiceAvailable({
      group: "cli", apiKeyOptional: false, hasApiKey: false, isConfigured: false,
    })).toBe(false);
  });

  it("still requires a key or explicit config for a hosted provider", () => {
    expect(isServiceAvailable({
      group: "chat", apiKeyOptional: false, hasApiKey: false, isConfigured: true,
    })).toBe(false);
    expect(isServiceAvailable({
      group: "chat", apiKeyOptional: false, hasApiKey: true, isConfigured: false,
    })).toBe(true);
    expect(isServiceAvailable({
      group: "chat", apiKeyOptional: true, hasApiKey: false, isConfigured: true,
    })).toBe(true);
    expect(isServiceAvailable({
      group: "chat", apiKeyOptional: true, hasApiKey: false, isConfigured: false,
    })).toBe(false);
  });
});
