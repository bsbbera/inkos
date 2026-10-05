import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProviderCatalogue, loadSecrets, saveSecrets } from "@actalk/quire-core";
import { FAIL_TTL, OK_TTL, isStale, readChecks, writeCheck } from "./connections";
import { stoppedAnswering } from "../store/service/types";
import { statusLine } from "../pages/Connections";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "quire-conn-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("connection results", () => {
  it("keep every result when two tests finish together", async () => {
    const at = new Date().toISOString();
    await Promise.all([
      writeCheck(root, "a", { ok: true, at, models: 3 }),
      writeCheck(root, "b", { ok: false, at, models: 0, error: "No key yet." }),
    ]);
    const checks = await readChecks(root);
    expect(Object.keys(checks).sort()).toEqual(["a", "b"]);
    await writeCheck(root, "a", null);
    expect(Object.keys(await readChecks(root))).toEqual(["b"]);
  });

  it("go stale sooner when they failed", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(isStale(undefined, now)).toBe(true);
    expect(isStale({ ok: true, at: ago(OK_TTL - 1000), models: 1 }, now)).toBe(false);
    expect(isStale({ ok: true, at: ago(OK_TTL + 1000), models: 1 }, now)).toBe(true);
    expect(isStale({ ok: false, at: ago(FAIL_TTL + 1000), models: 0 }, now)).toBe(true);
  });
});

describe("the provider catalogue", () => {
  it("ships three kinds and takes the machine's own entries over it", async () => {
    const shipped = await loadProviderCatalogue(root);
    expect(new Set(shipped.map((p) => p.kind))).toEqual(new Set(["api", "cli", "local"]));
    await writeFile(join(root, "providers.json"), JSON.stringify({
      providers: [{ id: "ollama", kind: "local", label: "Ollama at home" }, { id: "mistral", kind: "api", label: "Mistral" }, { id: "bad" }],
    }));
    const merged = await loadProviderCatalogue(root);
    expect(merged.find((p) => p.id === "ollama")?.label).toBe("Ollama at home");
    expect(merged.find((p) => p.id === "mistral")?.kind).toBe("api");
    expect(merged.find((p) => p.id === "bad")).toBeUndefined();
  });
});

describe("keys", () => {
  it("round-trip in the store (under test, inside the temp root, never the real home)", async () => {
    await saveSecrets(root, { services: { openai: { apiKey: "sk-test" } } });
    expect((await loadSecrets(root)).services.openai?.apiKey).toBe("sk-test");
    expect(JSON.parse(await readFile(join(root, ".quire", "secrets.json"), "utf-8")).services.openai.apiKey).toBe("sk-test");
  });
});

describe("what the screens say", () => {
  const base = { service: "x", label: "X", kind: "api" as const, hasKey: true, connected: false };
  it("names a failure and asks for a key that is missing", () => {
    expect(statusLine({ ...base, check: { ok: false, at: new Date().toISOString(), models: 0, error: "Invalid key." } })).toBe("Invalid key.");
    expect(statusLine({ ...base, hasKey: false, check: null })).toBe("No key yet.");
    expect(statusLine({ ...base, connected: true, check: { ok: true, at: new Date().toISOString(), models: 1 } })).toBe("1 model · tested just now");
  });
  it("greys out only what worked before and stopped", () => {
    const at = new Date().toISOString();
    expect(stoppedAnswering([
      { service: "ollama", label: "Ollama", connected: false, check: { ok: false, at, models: 0, error: "Not running.", lastOk: at } },
      { service: "lmstudio", label: "LM Studio", connected: false, check: { ok: false, at, models: 0, error: "Not running." } },
      { service: "openai", label: "OpenAI", connected: true, check: { ok: true, at, models: 9 } },
    ])).toEqual([{ label: "Ollama", reason: "Not running." }]);
  });
});
