import { describe, expect, it } from "vitest";
import { parseJson } from "../publications/parse-json.js";

describe("parseJson repairs what a model actually sends", () => {
  it("takes a raw newline inside a string", () => {
    const raw = `{"claim": "one\ntwo"}`;
    expect(parseJson(raw)).toEqual({ claim: "one\ntwo" });
  });

  it("takes any other control character inside a string", () => {
    // A run died on exactly this: the repair knew newlines and nothing else,
    // so a stray 0x0b ended a fifty-page issue at its first stage.
    const raw = `{"claim": "one\u000btwo"}`;
    expect(parseJson(raw)).toEqual({ claim: "one\u000btwo" });
  });

  it("still refuses a reply with no JSON in it", () => {
    expect(() => parseJson("I could not do that")).toThrow(/no JSON/);
  });
});
