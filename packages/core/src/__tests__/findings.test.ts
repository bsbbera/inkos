import { describe, expect, it } from "vitest";
import {
  applyFix,
  applyParagraph,
  blocksApproval,
  countBySeverity,
  findingId,
  locate,
  locateQuote,
  mergeFindings,
  normalizeSeverity,
  paragraphAt,
  paragraphOf,
  paragraphSpan,
  type Finding,
} from "../pipeline/findings.js";

const DOC = [
  "# The Lamp Room",
  "",
  "Inside, everything was in its place. That was the first thing.",
  "",
  "He set the box down and favoured his right leg going up the last flight,",
  "and stood a while in the lamp room with his hand on the rail.",
  "",
  "The wick was trimmed.",
].join("\n");

function make(over: Partial<Finding> = {}): Finding {
  return {
    id: "x", path: "ch09.md", section: "", quote: "", severity: "warning",
    category: "voice", title: "t", description: "d", suggestion: "s",
    state: "open", at: "2026-01-01T00:00:00.000Z", para: -1, start: -1, end: -1,
    ...over,
  };
}

describe("normalizeSeverity", () => {
  it("folds the three vocabularies already in the codebase into one", () => {
    expect(normalizeSeverity("critical")).toBe("blocking");
    expect(normalizeSeverity("error")).toBe("blocking");
    expect(normalizeSeverity("info")).toBe("note");
    expect(normalizeSeverity("warning")).toBe("warning");
    // Anything unrecognised is a warning, not silently dropped or promoted.
    expect(normalizeSeverity(undefined)).toBe("warning");
    expect(normalizeSeverity("wildly-unknown")).toBe("warning");
  });
});

describe("locateQuote", () => {
  it("finds an exact quote and reports its paragraph", () => {
    const at = locateQuote(DOC, "The wick was trimmed.");
    expect(at).not.toBeNull();
    expect(DOC.slice(at!.start, at!.end)).toBe("The wick was trimmed.");
    expect(at!.para).toBe(3);
  });

  it("finds a quote the model re-wrapped across the original line break", () => {
    // The model returns one line; the file has a newline inside it.
    const at = locateQuote(DOC, "favoured his right leg going up the last flight, and stood a while");
    expect(at).not.toBeNull();
    expect(DOC.slice(at!.start, at!.end)).toContain("favoured his right leg");
    expect(DOC.slice(at!.start, at!.end)).toContain("and stood a while");
  });

  it("refuses a quote that is not in the file rather than guessing at a near match", () => {
    expect(locateQuote(DOC, "favoured his left leg going up the stairs")).toBeNull();
    expect(locateQuote(DOC, "   ")).toBeNull();
  });

  it("handles prose containing regex punctuation", () => {
    const doc = "He paused (a long pause) and said *nothing* at all.";
    const at = locateQuote(doc, "(a long pause) and said *nothing*");
    expect(at).not.toBeNull();
    expect(doc.slice(at!.start, at!.end)).toBe("(a long pause) and said *nothing*");
  });
});

describe("paragraphAt", () => {
  it("counts blank-line-separated blocks from zero", () => {
    expect(paragraphAt(DOC, 0)).toBe(0);
    expect(paragraphAt(DOC, DOC.indexOf("The wick"))).toBe(3);
  });
});

describe("findingId", () => {
  it("is the same complaint about the same words, however it is worded", () => {
    const a = findingId({ path: "ch09.md", section: "One", category: "continuity", quote: "his right leg" });
    const b = findingId({ path: "ch09.md", section: "One", category: "continuity", quote: "his  right   leg" });
    expect(a).toBe(b);
  });

  it("separates different words, files and categories", () => {
    const base = { path: "ch09.md", section: "", category: "continuity", quote: "his right leg" };
    expect(findingId(base)).not.toBe(findingId({ ...base, path: "ch08.md" }));
    expect(findingId(base)).not.toBe(findingId({ ...base, category: "voice" }));
    expect(findingId(base)).not.toBe(findingId({ ...base, quote: "his left leg" }));
  });
});

describe("locate", () => {
  it("attaches a span and falls back to a title when the checker wrote none", () => {
    const f = locate({
      path: "ch09.md", severity: "blocking", category: "continuity",
      quote: "The wick was trimmed.",
      description: "The limp changed legs. Chapter 3 puts the weight on his left.",
      suggestion: "Match chapter 3.",
    }, DOC);
    expect(f.start).toBeGreaterThan(-1);
    expect(f.title).toBe("The limp changed legs.");
    expect(f.state).toBe("open");
  });

  it("keeps a finding whose quote is gone, with no span", () => {
    const f = locate({
      path: "ch09.md", severity: "note", category: "shape",
      description: "Runs short of target.", suggestion: "Add 80 words.",
    }, DOC);
    expect(f.start).toBe(-1);
    expect(f.para).toBe(-1);
  });
});

describe("mergeFindings", () => {
  const settled = make({ id: "a", path: "ch09.md", state: "accepted" });
  const openOld = make({ id: "b", path: "ch09.md" });
  const otherFile = make({ id: "c", path: "ch08.md" });

  it("keeps settled findings settled when the run reports them again", () => {
    const out = mergeFindings([settled], [make({ id: "a", path: "ch09.md" })], ["ch09.md"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.state).toBe("accepted");
  });

  it("drops an open finding the re-read no longer reports", () => {
    const out = mergeFindings([openOld], [], ["ch09.md"]);
    expect(out).toHaveLength(0);
  });

  it("leaves findings for files this run did not read alone", () => {
    const out = mergeFindings([otherFile, openOld], [], ["ch09.md"]);
    expect(out.map((f) => f.id)).toEqual(["c"]);
  });
});

describe("applyFix", () => {
  const finding = locate({
    path: "ch09.md", severity: "blocking", category: "continuity",
    quote: "favoured his right leg",
    description: "The limp changed legs.", suggestion: "Use left.",
    fix: "favoured his left leg",
  }, DOC);

  it("replaces the quoted span and leaves the rest of the file alone", () => {
    const out = applyFix(DOC, finding, "favoured his left leg");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("favoured his left leg going up the last flight");
    expect(out.markdown).toContain("The wick was trimmed.");
    expect(out.markdown).not.toContain("his right leg");
  });

  it("re-finds the quote when something else moved the offsets", () => {
    const shifted = `An inserted opening line.\n\n${DOC}`;
    const out = applyFix(shifted, finding, "favoured his left leg");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.markdown).toContain("favoured his left leg");
  });

  it("refuses rather than writing to the wrong place when the words are gone", () => {
    const rewritten = DOC.replace("favoured his right leg", "climbed slowly");
    const out = applyFix(rewritten, finding, "favoured his left leg");
    expect(out).toEqual({ ok: false, reason: "drifted" });
  });

  it("refuses an empty replacement and a finding with no span", () => {
    expect(applyFix(DOC, finding, "   ")).toEqual({ ok: false, reason: "empty" });
    expect(applyFix(DOC, make(), "anything")).toEqual({ ok: false, reason: "no-span" });
  });
});

describe("paragraphOf", () => {
  it("returns the whole paragraph the finding sits in", () => {
    const f = locate({
      path: "ch09.md", severity: "warning", category: "voice",
      quote: "favoured his right leg",
      description: "d", suggestion: "s",
    }, DOC);
    const para = paragraphOf(DOC, f);
    expect(para).toContain("He set the box down");
    expect(para).toContain("hand on the rail.");
    expect(para).not.toContain("The wick was trimmed.");
  });
});

describe("applyParagraph", () => {
  const finding = locate({
    path: "ch09.md", severity: "blocking", category: "continuity",
    quote: "favoured his right leg",
    description: "The limp changed legs.", suggestion: "Use left.",
  }, DOC);

  it("replaces the whole paragraph, not only the quoted words", () => {
    const out = applyParagraph(DOC, finding, "He climbed, favouring the left, and said nothing.");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("He climbed, favouring the left, and said nothing.");
    expect(out.markdown).not.toContain("He set the box down");
    // The paragraphs on either side are untouched, and still separated.
    expect(out.markdown).toContain("Inside, everything was in its place.");
    expect(out.markdown).toContain("The wick was trimmed.");
    expect(out.markdown.split(/\n\s*\n/)).toHaveLength(DOC.split(/\n\s*\n/).length);
  });

  it("re-anchors on the quote when something else moved the offsets", () => {
    const shifted = `An inserted opening line.\n\n${DOC}`;
    const out = applyParagraph(shifted, finding, "Rewritten.");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("An inserted opening line.");
    expect(out.markdown).toContain("Rewritten.");
    expect(out.markdown).not.toContain("He set the box down");
  });

  it("refuses when the words it was anchored on are gone", () => {
    const rewritten = DOC.replace("favoured his right leg", "climbed slowly");
    expect(applyParagraph(rewritten, finding, "Anything.")).toEqual({ ok: false, reason: "drifted" });
  });

  it("refuses an empty paragraph and a finding with no location at all", () => {
    expect(applyParagraph(DOC, finding, "  ")).toEqual({ ok: false, reason: "empty" });
    expect(applyParagraph(DOC, make(), "Anything.")).toEqual({ ok: false, reason: "no-span" });
  });
});

describe("paragraphSpan", () => {
  it("stops at the paragraph and not at the blank lines around it", () => {
    const f = locate({
      path: "ch09.md", severity: "note", category: "voice",
      quote: "The wick was trimmed.", description: "d", suggestion: "s",
    }, DOC);
    const span = paragraphSpan(DOC, f)!;
    expect(DOC.slice(span.start, span.end)).toBe("The wick was trimmed.");
  });
});

describe("counts and the approval gate", () => {
  it("counts only what is still open", () => {
    const list = [
      make({ id: "1", severity: "blocking" }),
      make({ id: "2", severity: "blocking", state: "ignored" }),
      make({ id: "3", severity: "warning" }),
      make({ id: "4", severity: "note" }),
    ];
    expect(countBySeverity(list)).toEqual({ blocking: 1, warning: 1, note: 1, open: 3 });
  });

  it("only an open blocking finding stands in the way", () => {
    expect(blocksApproval(make({ severity: "blocking" }))).toBe(true);
    expect(blocksApproval(make({ severity: "blocking", state: "ignored" }))).toBe(false);
    expect(blocksApproval(make({ severity: "warning" }))).toBe(false);
  });
});
