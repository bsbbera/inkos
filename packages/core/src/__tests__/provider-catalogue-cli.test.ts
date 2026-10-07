import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readProviderCatalogue } from "../llm/provider-catalogue.js";

// 20 §6 step 1: a CLI that speaks ACP is added by one JSON entry, no code.
it("adds a CLI from ~/.quire/providers.json and keeps shipped fields under a rename", async () => {
  const home = await mkdtemp(join(tmpdir(), "catalogue-"));
  await writeFile(join(home, "providers.json"), JSON.stringify({ providers: [
    { id: "geminiCli", kind: "cli", label: "Gemini", protocol: "acp", bins: ["gemini"], acpArgs: ["--experimental-acp"] },
    { id: "devinCli", kind: "cli", label: "Devin (work)" },
  ] }), "utf-8");

  const list = readProviderCatalogue(home);
  expect(list.find((p) => p.id === "geminiCli")).toMatchObject({ protocol: "acp", acpArgs: ["--experimental-acp"] });
  expect(list.find((p) => p.id === "devinCli")).toMatchObject({ label: "Devin (work)", protocol: "acp", bins: expect.arrayContaining(["devin"]) });
});
