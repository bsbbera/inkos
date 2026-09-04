import { describe, expect, it } from "vitest";
import { markedFiles, namedFiles, parseToolMarks } from "./tool-marks";

describe("parseToolMarks", () => {
  it("splits a marker off from the prose around it", () => {
    const out = parseToolMarks("Let me look.\n› Read file · story/ch08.md\nIt is a log.");
    expect(out).toEqual([
      { kind: "text", text: "Let me look." },
      { kind: "tools", marks: [{ name: "Read file", target: "story/ch08.md" }] },
      { kind: "text", text: "It is a log." },
    ]);
  });

  it("groups consecutive markers into one block, as the mock draws them", () => {
    const out = parseToolMarks("› Read file · a.md\n› Read file · b.md\n› Ran command");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "tools",
      marks: [
        { name: "Read file", target: "a.md" },
        { name: "Read file", target: "b.md" },
        { name: "Ran command", target: null },
      ],
    });
  });

  it("leaves ordinary prose alone", () => {
    expect(parseToolMarks("A sentence · with a middot.")).toEqual([
      { kind: "text", text: "A sentence · with a middot." },
    ]);
  });

  it("survives content with no markers at all", () => {
    expect(parseToolMarks("plain")).toEqual([{ kind: "text", text: "plain" }]);
    expect(parseToolMarks("")).toEqual([]);
  });
});

describe("markedFiles", () => {
  it("collects each named file once", () => {
    expect(markedFiles("› Read file · a.md\n› Write · a.md\n› Read file · b.json"))
      .toEqual(["a.md", "b.json"]);
  });

  it("ignores a marker that names no file", () => {
    // "Ran command" is real tool use and worth a row; it is not an artifact.
    expect(markedFiles("› Ran command\n› Ran command · ls -la")).toEqual([]);
  });
});

/**
 * The artifacts rail read tool markers and tool arguments, and a production
 * tool reports neither: it writes the files and names them in the prose of its
 * result. A finished short story left three files on disk and a rail that said
 * "Nothing written to disk yet".
 */
describe("namedFiles", () => {
  const result = [
    'Short fiction "the-second-law" completed.',
    "Final: shorts/the-second-law/final/full.md",
    "Sales package: shorts/the-second-law/final/sales-package.md",
    "Cover prompt: shorts/the-second-law/final/cover-prompt.md",
    "Cover image: not generated yet — art is a separate step.",
  ].join("\n");

  it("takes every path a result named", () => {
    expect(namedFiles(result)).toEqual([
      "shorts/the-second-law/final/full.md",
      "shorts/the-second-law/final/sales-package.md",
      "shorts/the-second-law/final/cover-prompt.md",
    ]);
  });

  it("leaves a line whose value is prose, not a path", () => {
    expect(namedFiles("Cover image: not generated yet — art is a separate step.")).toEqual([]);
  });

  it("does not take a filename mentioned mid-sentence", () => {
    expect(namedFiles("I read story/ch08.md and it was fine.")).toEqual([]);
  });

  it("needs a directory, so a bare word with a dot is not a path", () => {
    expect(namedFiles("Model: gpt-4.1")).toEqual([]);
  });
});
