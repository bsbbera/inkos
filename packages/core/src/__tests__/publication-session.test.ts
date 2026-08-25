import { describe, expect, it, vi, beforeEach } from "vitest";

const runAgentSession = vi.fn();
vi.mock("../agent/agent-session.js", () => ({ runAgentSession }));
vi.mock("../agent/worker-agent.js", () => ({
  workerModel: (client: unknown, id: string) => ({ id, api: "openai-completions" }),
}));

const { createPublicationAsk, publicationSessionId } = await import("../pipeline/publication-session.js");

const pipeline = {
  createAgentContext: () => ({ client: { provider: "custom" }, model: "devin/glm-5-2" }),
} as never;

const base = { pipeline, projectRoot: "/root", issueId: "issue-1" };
const ok = (text: string) => runAgentSession.mockResolvedValue({ responseText: text, messages: [] });

describe("publication stages run as agent sessions", () => {
  beforeEach(() => runAgentSession.mockReset());

  it("names a session per issue and stage, so two pages never share a transcript", () => {
    expect(publicationSessionId("issue-1", "page-7")).toBe("publication:issue-1:page-7");
    expect(publicationSessionId("issue-1", "plan"))
      .not.toBe(publicationSessionId("issue-2", "plan"));
  });

  // The whole point of the change: a stage must reach the tool-carrying path,
  // not runWorkerAgent, and must announce itself as a publication so the
  // session hands it the publication tool set rather than the chat one.
  it("runs on the session path with the publication kind and no book", async () => {
    ok('{"ok":true}');
    await createPublicationAsk(base)("write page 7", "page-7");

    const [config, prompt] = runAgentSession.mock.calls[0];
    expect(config.sessionKind).toBe("publication");
    expect(config.bookId).toBeNull();
    expect(config.sessionId).toBe("publication:issue-1:page-7");
    expect(config.projectRoot).toBe("/root");
    expect(prompt).toBe("write page 7");
  });

  it("uses the pipeline's own client and model rather than resolving afresh", async () => {
    ok('{"ok":true}');
    await createPublicationAsk(base)("plan it", "plan");
    expect(runAgentSession.mock.calls[0][0].model).toMatchObject({ id: "devin/glm-5-2" });
  });

  it("tells the stage which stage it is", async () => {
    ok('{"ok":true}');
    await createPublicationAsk(base)("plan it", "plan");
    const seed = runAgentSession.mock.calls[0][2];
    expect(seed[0].role).toBe("system");
    expect(seed[0].content).toContain('"plan" stage');
  });

  // The id does not exist when the runner context is built — createIssue needs
  // that context to make it — so a getter has to be allowed.
  it("resolves a deferred issue id at call time", async () => {
    ok('{"ok":true}');
    let id = "";
    const ask = createPublicationAsk({ ...base, issueId: () => id });
    id = "made-later";
    await ask("plan it", "plan");
    expect(runAgentSession.mock.calls[0][0].sessionId).toBe("publication:made-later:plan");
  });

  it("refuses to run a stage before the issue exists", async () => {
    const ask = createPublicationAsk({ ...base, issueId: () => "" });
    await expect(ask("plan it", "plan")).rejects.toThrow(/no issue id yet/);
    expect(runAgentSession).not.toHaveBeenCalled();
  });

  it("returns the stage's JSON", async () => {
    ok('here you go\n```json\n{"pages":3}\n```');
    await expect(createPublicationAsk(base)("plan it", "plan")).resolves.toEqual({ pages: 3 });
  });

  // A stage that could not produce JSON has usually said why, and that reason
  // is worth more than "invalid JSON".
  it("carries the model's own words into a parse failure", async () => {
    ok("I could not find any sources for this subject.");
    await expect(createPublicationAsk(base)("research it", "research"))
      .rejects.toThrow(/research:[\s\S]*could not find any sources/);
  });

  it("surfaces an upstream model error against its stage", async () => {
    runAgentSession.mockResolvedValue({ responseText: "", messages: [], errorMessage: "429 rate limited" });
    await expect(createPublicationAsk(base)("write it", "page-2"))
      .rejects.toThrow("page-2: 429 rate limited");
  });

  it("does not start a stage that was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const ask = createPublicationAsk({ ...base, signal: controller.signal });
    await expect(ask("plan it", "plan")).rejects.toThrow();
    expect(runAgentSession).not.toHaveBeenCalled();
  });
});
