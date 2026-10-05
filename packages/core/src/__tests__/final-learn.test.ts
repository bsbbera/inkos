import { describe, expect, it } from "vitest";
import { diffSentences, driftProposals, pageChanges, styleDrift } from "../pipeline/final-learn.js";

describe("diffSentences (04 §6)", () => {
  const draft = "The door was old. It creaked loudly in the wind at night. She went in. Nobody followed her.";
  const final = "The door was old. It creaked in the wind. She went in. A dog barked somewhere below the hill.";

  it("pairs an edited sentence with the one it came from, and counts the rest", () => {
    const d = diffSentences(draft, final);
    expect(d.edits).toEqual([{ before: "It creaked loudly in the wind at night.", after: "It creaked in the wind." }]);
    expect(d.removed).toEqual(["Nobody followed her."]);
    expect(d.added).toEqual(["A dog barked somewhere below the hill."]);
    expect(d.kept).toBe(2);
  });

  it("does not call a moved sentence an edit", () => {
    const d = diffSentences("One two three. Four five six.", "Four five six. One two three.");
    expect(d.edits).toHaveLength(0);
    expect(d.kept).toBe(2);
  });
});

describe("styleDrift", () => {
  it("proposes shorter sentences when the final cut them", () => {
    const long = Array.from({ length: 12 }, () => "The long grey road wound on and on past the silent fields toward a town nobody could name.").join(" ");
    const short = Array.from({ length: 12 }, () => "The road wound on. Nobody knew the town.").join(" ");
    const drift = styleDrift(long, short);
    const sentence = drift.find((d) => d.feature === "avgSentenceLength");
    expect(sentence && sentence.change).toBeLessThan(-0.2);
    expect(driftProposals(drift)[0]!.text).toMatch(/^Keep sentences near/);
  });
});

describe("pageChanges", () => {
  it("names the printed pages whose words differ from the build", () => {
    expect(pageChanges(["alpha beta gamma", "delta epsilon"], ["alpha beta gamma", "something else entirely"]))
      .toEqual([{ page: 2, similarity: 0 }]);
  });
});
