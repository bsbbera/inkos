import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLocalContextWindows } from "../llm/providers/local-context.js";

const fetchMock = vi.fn();
vi.mock("../utils/proxy-fetch.js", () => ({
  fetchWithProxy: (...args: unknown[]) => fetchMock(...args),
}));

const ok = (body: unknown) => ({ ok: true, json: async () => body });

afterEach(() => fetchMock.mockReset());

describe("probeLocalContextWindows", () => {
  it("reads Ollama's window out of the architecture-named key", async () => {
    fetchMock.mockResolvedValue(ok({
      // The key is named for the architecture, which is not known in advance.
      model_info: { "llama.context_length": 8192, "llama.block_count": 28 },
    }));
    const windows = await probeLocalContextWindows("ollama", "http://localhost:11434/v1", ["llama3.2:3b"]);
    expect(windows.get("llama3.2:3b")).toBe(8192);
    // Asked the native route at the server root, not the /v1 one it was given.
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://localhost:11434/api/show");
  });

  it("prefers what LM Studio actually loaded over what the model supports", async () => {
    fetchMock.mockResolvedValue(ok({
      data: [
        { id: "qwen3-8b", max_context_length: 131072, loaded_context_length: 8192 },
        { id: "gemma-3-4b", max_context_length: 32768 },
      ],
    }));
    const windows = await probeLocalContextWindows("lmstudio", "http://localhost:1234/v1", []);
    // A request is measured against the running instance, not the ceiling.
    expect(windows.get("qwen3-8b")).toBe(8192);
    expect(windows.get("gemma-3-4b")).toBe(32768);
  });

  it("says nothing rather than guessing when the server is down", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const windows = await probeLocalContextWindows("ollama", "http://localhost:11434/v1", ["llama3.2:3b"]);
    expect(windows.size).toBe(0);
  });

  it("leaves providers it does not know about alone", async () => {
    const windows = await probeLocalContextWindows("openai", "https://api.openai.com/v1", ["gpt-5.5"]);
    expect(windows.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
