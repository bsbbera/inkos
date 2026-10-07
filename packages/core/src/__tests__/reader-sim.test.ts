import { describe, expect, it } from "vitest";
import { paragraphAt } from "../pipeline/findings.js";
import {
  buildReaderPrompt, paragraphsOf, parseReaderMap, readerFindings, READER_PERSONAS, personasFor,
} from "../pipeline/reader-sim.js";

const TEXT = [
  "# One",
  "",
  "The door was open. Nobody came.",
  "",
  "He described the wallpaper for a long while, pattern by pattern.",
  "",
  "Then the lamp went out.",
].join("\n");

describe("reader map", () => {
  it("numbers paragraphs the way findings do", () => {
    const at = TEXT.indexOf("He described");
    expect(paragraphsOf(TEXT)[paragraphAt(TEXT, at)]!.text.startsWith("He described")).toBe(true);
  });

  it("clamps attention and drops duplicates and junk", () => {
    const map = parseReaderMap(READER_PERSONAS[0]!, {
      paragraphs: [{ para: 2, attention: 7, reason: "ok" }, { para: "x" }, { para: 2, attention: 0 }],
    });
    expect(map.points).toEqual([{ para: 2, attention: 1, reason: "ok", wouldStopHere: false }]);
  });

  it("turns only the cold paragraph into a located note", () => {
    const findings = readerFindings("x.md", TEXT, [{
      persona: "casual",
      label: "Casual reader",
      points: [
        { para: 2, attention: 0.2, reason: "wallpaper again", wouldStopHere: false },
        { para: 1, attention: 0.9, reason: "", wouldStopHere: false },
      ],
    }]);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.severity).toBe("note");
    expect(f.category).toBe("reader/casual");
    expect(TEXT.slice(f.start, f.end)).toBe(f.quote);
  });

  it("leaves headings out of what the reader is given", () => {
    const prompt = buildReaderPrompt(READER_PERSONAS[0]!, TEXT, "en");
    expect(prompt).not.toContain("# One");
    expect(prompt).toContain("[2] He described");
  });
});

describe("personas follow the audience", () => {
  it("makes the readers that audience, and adds a listener for young ones", () => {
    expect(personasFor("book").map((p) => p.id)).toEqual(["patient", "casual"]);

    const kids = personasFor("publication", "readers aged 8 to 10");
    expect(kids.map((p) => p.id)).toEqual(["patient", "casual", "child"]);
    expect(kids[0]!.brief).toContain("readers aged 8 to 10");
    expect(kids[2]!.label).toBe("Nine-year-old listener");

    expect(personasFor("publication", "specialist engineers").map((p) => p.id)).toEqual(["patient", "casual"]);
    expect(personasFor("storybook")[2]!.label).toBe("Seven-year-old listener");
  });
});
