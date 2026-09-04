import { describe, expect, it } from "vitest";
import { estimate, fileState, placeOf, queueOf } from "./AuditPage";

type Finding = Parameters<typeof queueOf>[0][number];
type Item = Parameters<typeof fileState>[0];

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "a", path: "books/tide/chapters/0009_nine.md", section: "", quote: "q",
    severity: "warning", category: "voice", title: "t", description: "d",
    suggestion: "s", state: "open", para: 0, start: 10, end: 20,
    ...over,
  } as Finding;
}

function item(over: Partial<Item> = {}): Item {
  return {
    path: "books/tide/chapters/0009_nine.md", name: "0009_nine.md",
    words: 3120, modified: "2026-08-30T00:00:00.000Z", audit: {}, backup: false,
    ...over,
  } as Item;
}

describe("queueOf", () => {
  it("keeps what has been settled, after everything still open", () => {
    const list = [
      finding({ id: "2", state: "accepted", start: 10 }),
      finding({ id: "3", state: "ignored", start: 20 }),
      finding({ id: "1", start: 30 }),
    ];
    expect(queueOf(list, "all").map((f) => f.id)).toEqual(["1", "2", "3"]);
  });

  it("puts what blocks approval at the top, then reading order", () => {
    const list = [
      finding({ id: "note", severity: "note", start: 5 }),
      finding({ id: "late", severity: "warning", start: 900 }),
      finding({ id: "early", severity: "warning", start: 100 }),
      finding({ id: "blocks", severity: "blocking", start: 800 }),
    ];
    expect(queueOf(list, "all").map((f) => f.id)).toEqual(["blocks", "early", "late", "note"]);
  });

  it("orders across files by file, so a queue is worked one chapter at a time", () => {
    const list = [
      finding({ id: "ch9", path: "books/tide/chapters/0009.md", start: 1 }),
      finding({ id: "ch8", path: "books/tide/chapters/0008.md", start: 900 }),
    ];
    expect(queueOf(list, "all").map((f) => f.id)).toEqual(["ch8", "ch9"]);
  });

  it("filters to one severity", () => {
    const list = [finding({ id: "1", severity: "blocking" }), finding({ id: "2", severity: "note" })];
    expect(queueOf(list, "note").map((f) => f.id)).toEqual(["2"]);
  });
});

describe("fileState", () => {
  const path = "books/tide/chapters/0009_nine.md";

  it("says never read before anything has looked at it", () => {
    expect(fileState(item(), []).dot).toBe("dot dot-never");
  });

  it("says clean once it has been read and nothing is open", () => {
    const read = item({ audit: { checked: "2026-08-30T00:00:00.000Z" } });
    expect(fileState(read, []).dot).toBe("dot dot-clean");
  });

  it("counts only its own open findings", () => {
    const list = [
      finding({ id: "1", path }),
      finding({ id: "2", path, state: "ignored" }),
      finding({ id: "3", path: "books/tide/chapters/0008.md" }),
    ];
    expect(fileState(item(), list)).toEqual({ dot: "dot dot-warn", note: "1 open" });
  });

  it("a blocking finding outranks the rest of the dots", () => {
    const list = [
      finding({ id: "1", path }),
      finding({ id: "2", path, severity: "blocking" }),
    ];
    const state = fileState(item({ audit: { checked: "x" } }), list);
    expect(state.dot).toBe("dot dot-bad");
    expect(state.note).toContain("blocks approval");
  });
});

describe("placeOf", () => {
  it("reads a numbered chapter file as a chapter", () => {
    expect(placeOf("books/tide/chapters/0009_nine.md")).toBe("ch09");
    expect(placeOf("Magazine/issues/kolam/pages/03-opening.md")).toBe("ch03");
  });

  it("falls back to the name for anything unnumbered", () => {
    expect(placeOf("dramas/closing-time/script.md")).toBe("script");
  });
});

describe("estimate", () => {
  it("is a sentence, and never says zero minutes", () => {
    expect(estimate(0)).toBe("nothing selected");
    expect(estimate(400)).toBe("about 1 min");
    expect(estimate(12_240)).toBe("about 4 min");
  });
});
