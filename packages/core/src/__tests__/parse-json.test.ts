import { describe, expect, it } from "vitest";
import { parseJson } from "../publications/parse-json.js";

describe("parseJson", () => {
  it("takes plain JSON", () => {
    expect(parseJson('{"title":"Kolam"}')).toEqual({ title: "Kolam" });
  });

  it("takes JSON in a fence, with prose around it", () => {
    expect(parseJson('Here you go:\n```json\n{"title":"Kolam"}\n```\nHope that helps!'))
      .toEqual({ title: "Kolam" });
  });

  // The one that ended a sixteen-page run at page two: the model typed the
  // paragraph break it meant, inside the quotes.
  it("repairs a raw newline inside a prose field", () => {
    const reply = '{"title":"A Line That Comes Home","body":"One line, and it must come home.\n\nThat is the only rule."}';
    expect(parseJson(reply)).toEqual({
      title: "A Line That Comes Home",
      body: "One line, and it must come home.\n\nThat is the only rule.",
    });
  });

  it("repairs raw tabs and carriage returns too", () => {
    expect(parseJson('{"body":"a\tb\r\nc"}')).toEqual({ body: "a\tb\r\nc" });
  });

  it("leaves an already-escaped newline exactly as it was", () => {
    expect(parseJson('{"body":"one\\ntwo"}')).toEqual({ body: "one\ntwo" });
  });

  // A quote escaped inside a string must not read as the end of the string,
  // or everything after it would be treated as structure.
  it("keeps quote state through an escaped quote", () => {
    expect(parseJson('{"body":"she said \\"one line\\"\nand meant it"}')).toEqual({
      body: 'she said "one line"\nand meant it',
    });
  });

  it("does not touch newlines between fields, only inside them", () => {
    expect(parseJson('{\n  "a": 1,\n  "b": 2\n}')).toEqual({ a: 1, b: 2 });
  });

  it("still reports a reply that is broken beyond one repair", () => {
    expect(() => parseJson('{"title": }')).toThrow(/invalid JSON/);
  });

  it("still reports a reply with no JSON in it at all", () => {
    expect(() => parseJson("I could not write this page.")).toThrow(/no JSON/);
  });
});
