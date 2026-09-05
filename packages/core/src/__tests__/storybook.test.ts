import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.fn();
vi.mock("../agent/worker-agent.js", () => ({
  runWorkerAgent: (...args: unknown[]) => chat(...args),
  runWorkerAgentTool: () => { throw new Error("not used"); },
}));

const {
  buildStorybookProof, createStorybook, planStorybook, renderSpread,
  spreadArtNote, spreadPath, spreadWords, writeStorybookSpread,
} = await import("../pipeline/storybook-runner.js");
const { StorybookAgent } = await import("../agents/storybook.js");
const { PRODUCTIONS, refFromPath } = await import("../productions/registry.js");
const { stageSequence } = await import("../pipeline/pipeline-state.js");

/** Enough of an AgentContext for an agent that only ever calls chat. */
const agent = {
  client: { provider: "openai", apiFormat: "chat", stream: false, defaults: {} },
  model: "test",
  projectRoot: "/nowhere",
} as never;

function reply(content: string): void {
  chat.mockResolvedValueOnce({ content, usage: undefined });
}

let root: string;
beforeEach(async () => {
  chat.mockReset();
  root = await mkdtemp(join(tmpdir(), "storybook-"));
});

describe("a spread on disk", () => {
  it("survives the round trip through markdown", () => {
    const file = renderSpread(3, "The fox looked up.", "A red fox, snow, one crow watching.");
    expect(spreadWords(file)).toBe("The fox looked up.");
    expect(spreadArtNote(file)).toBe("A red fox, snow, one crow watching.");
  });

  it("keeps the heading out of the words", () => {
    expect(spreadWords(renderSpread(1, "Once.", "art"))).not.toContain("#");
  });
});

describe("the plan stage", () => {
  it("writes the map once and finds it there the second time", async () => {
    await createStorybook({ projectRoot: root, id: "fox", title: "Fox", brief: "a fox in snow", spreads: 3 });
    reply(JSON.stringify([
      { spread: 1, beat: "fox wakes", art: "fox in a den" },
      { spread: 2, beat: "fox walks", art: "fox on snow" },
      { spread: 3, beat: "fox sleeps", art: "fox curled up" },
    ]));

    const first = await planStorybook({ projectRoot: root, id: "fox", unit: 1, agent });
    expect(first).toEqual(["storybooks/fox/plan.json"]);
    expect(chat).toHaveBeenCalledTimes(1);

    // Unit 2 of the same stage must not plan the book a second time.
    const second = await planStorybook({ projectRoot: root, id: "fox", unit: 2, agent });
    expect(second).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("returns exactly the spreads the book has, whatever the model sent", async () => {
    reply("```json\n[{\"spread\":1,\"beat\":\"one\",\"art\":\"a\"}]\n```");
    const plan = await new StorybookAgent(agent).planSpreads({
      title: "Fox", brief: "b", audience: "3-6", spreads: 4,
    });
    expect(plan.map((p) => p.spread)).toEqual([1, 2, 3, 4]);
    expect(plan[0]?.beat).toBe("one");
  });
});

describe("the write stage", () => {
  beforeEach(async () => {
    await createStorybook({ projectRoot: root, id: "fox", title: "Fox", brief: "a fox", spreads: 2 });
    await writeFile(
      join(root, "storybooks", "fox", "plan.json"),
      JSON.stringify([
        { spread: 1, beat: "fox wakes", art: "fox in a den" },
        { spread: 2, beat: "fox sleeps", art: "fox curled up" },
      ]),
      "utf-8",
    );
  });

  it("writes the spread and skips one already written", async () => {
    reply(JSON.stringify({ text: "The fox woke.", art: "A den at dawn." }));
    const made = await writeStorybookSpread({ projectRoot: root, id: "fox", unit: 1, agent });
    expect(made).toEqual(["storybooks/fox/spreads/0001.md"]);

    const onDisk = await readFile(join(root, spreadPath("fox", 1)), "utf-8");
    expect(spreadWords(onDisk)).toBe("The fox woke.");

    expect(await writeStorybookSpread({ projectRoot: root, id: "fox", unit: 2 - 1, agent })).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("shows the writer what the spread before said", async () => {
    reply(JSON.stringify({ text: "The fox woke.", art: "A den." }));
    await writeStorybookSpread({ projectRoot: root, id: "fox", unit: 1, agent });
    reply(JSON.stringify({ text: "The fox slept.", art: "A den, dark." }));
    await writeStorybookSpread({ projectRoot: root, id: "fox", unit: 2, agent });

    const second = chat.mock.calls[1]?.[2] as Array<{ content: string }>;
    expect(second.some((m) => m.content.includes("The fox woke."))).toBe(true);
  });

  it("refuses a spread the plan does not have", async () => {
    await expect(writeStorybookSpread({ projectRoot: root, id: "fox", unit: 9, agent }))
      .rejects.toThrow(/not in the plan/);
  });
});

describe("the proof copy", () => {
  it("puts every spread in, and says which pictures are missing", async () => {
    await createStorybook({ projectRoot: root, id: "fox", title: "Fox & Crow", brief: "b", spreads: 2 });
    await mkdir(join(root, "storybooks", "fox", "spreads"), { recursive: true });
    await writeFile(join(root, spreadPath("fox", 1)), renderSpread(1, "The fox woke.", "a"), "utf-8");
    await writeFile(join(root, spreadPath("fox", 2)), renderSpread(2, "The fox slept.", "b"), "utf-8");
    await mkdir(join(root, "storybooks", "fox", "art", "generated"), { recursive: true });
    await writeFile(join(root, "storybooks", "fox", "art", "generated", "1-spread.png"), "png", "utf-8");

    const made = await buildStorybookProof({ projectRoot: root, id: "fox" });
    expect(made).toEqual(["storybooks/fox/build/fox.html"]);

    const html = await readFile(join(root, "storybooks", "fox", "build", "fox.html"), "utf-8");
    expect(html).toContain("The fox woke.");
    expect(html).toContain("The fox slept.");
    expect(html).toContain("../art/generated/1-spread.png");
    expect(html).toContain("No picture for spread 2 yet");
    // The title is a person's words in an HTML document.
    expect(html).toContain("Fox &amp; Crow");
  });
});

describe("the type on the rails", () => {
  it("declares a graph that ends somewhere this app can reach", () => {
    const spec = PRODUCTIONS.find((p) => p.id === "storybook");
    expect(spec?.pipeline?.build).toEqual(["export"]);
    expect(spec?.pipeline?.outputs).toEqual(["html"]);
    expect(stageSequence(spec!.pipeline!)).toEqual([
      "content.plan", "content.write", "content.audit", "gate:content",
      "design.artplan", "design.generate", "design.review", "gate:design",
      "build.export", "gate:build", "done",
    ]);
  });

  it("maps an audited spread back to its unit", () => {
    expect(refFromPath("storybooks/fox/spreads/0003.md"))
      .toEqual({ type: "storybook", id: "fox", unit: 3 });
  });
});
