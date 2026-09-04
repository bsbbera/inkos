import { describe, expect, it } from "vitest";
import { modelVendor } from "./model-vendor";

describe("modelVendor", () => {
  it("reads the lab from the model, not the CLI that served it", () => {
    // All four arrive through devin. None of them are devin's.
    expect(modelVendor("devin/claude-opus-5-high")?.id).toBe("anthropic");
    expect(modelVendor("devin/gpt-5-6-sol-xhigh")?.id).toBe("openai");
    expect(modelVendor("devin/glm-5-2")?.id).toBe("zhipu");
    expect(modelVendor("devin/kimi-k2-6")?.id).toBe("moonshot");
  });

  it("gives the same answer however the model arrived", () => {
    expect(modelVendor("claude-opus-5")?.id).toBe("anthropic");
    expect(modelVendor("anthropic/claude-opus-5")?.id).toBe("anthropic");
    expect(modelVendor("openrouter/claude-opus-5")?.id).toBe("anthropic");
  });

  it("matches the bare family aliases a CLI offers", () => {
    expect(modelVendor("claude/sonnet")?.id).toBe("anthropic");
    expect(modelVendor("claude/opus")?.id).toBe("anthropic");
  });

  it("keeps gpt-oss with OpenAI", () => {
    expect(modelVendor("gpt-oss-120b")?.id).toBe("openai");
  });

  it("says nothing rather than inventing a mark", () => {
    // A local fine-tune belongs to nobody in the table.
    expect(modelVendor("my-finetune:latest")).toBeNull();
    expect(modelVendor("ollama/")).toBeNull();
    expect(modelVendor("")).toBeNull();
  });

  it("keeps every mark short enough to be a mark", () => {
    for (const id of ["claude-opus-5", "gpt-5.6", "glm-5.2", "deepseek-v4", "minimax-m2"]) {
      const vendor = modelVendor(id);
      expect(vendor).not.toBeNull();
      expect(vendor!.initials.length).toBeLessThanOrEqual(2);
    }
  });
});
