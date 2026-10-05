import { describe, expect, it } from "vitest";
import {
  coverGeometry, defaultProfile, ean13, gutterFor, interiorPage, isbnDigits, normaliseProfile,
  preflight, spineWidth, TRIMS, type PdfFacts, type PrintProfile,
} from "../pipeline/print.js";
import { inline, interiorSource, lit, prose, screenplaySource } from "../pipeline/typeset.js";
import { isDownstreamOf } from "../pipeline/jobs.js";

const kdp6x9: PrintProfile = {
  trim: TRIMS["6x9in"]!, binding: "perfect", stock: "cream", colour: "mono", service: "kdp", bleed: false,
};

describe("spine and cover", () => {
  it("uses KDP's published per-page thickness", () => {
    // 300 cream pages × 0.0025 in = 0.75 in = 19.05 mm
    expect(spineWidth(kdp6x9, 300)).toBeCloseTo(19.05, 1);
    expect(spineWidth({ ...kdp6x9, stock: "white" }, 300)).toBeCloseTo(300 * 0.002252 * 25.4, 1);
  });

  it("gives a saddle-stitched booklet no spine", () => {
    expect(spineWidth({ ...defaultProfile("publication") }, 48)).toBe(0);
  });

  it("lays out back, spine and front with bleed on the outside", () => {
    const geo = coverGeometry(kdp6x9, 300);
    expect(geo.width).toBeCloseTo(3.175 + 152.4 + 19.05 + 152.4 + 3.175, 1);
    expect(geo.height).toBeCloseTo(228.6 + 2 * 3.175, 1);
    // Each coordinate is rounded to 0.01 mm, so the sum may drift by one step.
    expect(geo.front.x).toBeCloseTo(geo.spineAt.x + geo.spine, 1);
    expect(geo.spineText).toBe(true);
    expect(coverGeometry(kdp6x9, 60).spineText).toBe(false);
  });

  it("widens the gutter as the book gets thicker", () => {
    expect(gutterFor(500)).toBeGreaterThan(gutterFor(100));
  });

  it("adds KDP bleed to three edges and everyone else's to four", () => {
    const kdp = interiorPage({ ...kdp6x9, bleed: true });
    const lulu = interiorPage({ ...kdp6x9, service: "lulu", bleed: true });
    expect(kdp.w).toBeCloseTo(152.4 + 3.175, 1);
    expect(lulu.w).toBeCloseTo(152.4 + 6.35, 1);
    expect(kdp.h).toBeCloseTo(lulu.h, 2);
  });
});

describe("profiles", () => {
  it("falls back to a binding the service actually offers", () => {
    const p = normaliseProfile({ service: "kdp", binding: "saddle" }, "book");
    expect(p.binding).toBe("perfect");
  });

  it("takes a trim by preset name", () => {
    expect(normaliseProfile({ trim: "A5" }, "book").trim.w).toBe(148);
  });
});

describe("the barcode", () => {
  it("accepts a valid ISBN-13 and names a bad check digit", () => {
    expect(isbnDigits("978-0-306-40615-7")).toBe("9780306406157");
    expect(isbnDigits("9780306406158")).toEqual({ error: "the check digit should be 7" });
  });

  it("encodes 95 modules with guard bars in place", () => {
    const bars = ean13("9780306406157");
    expect(bars).toHaveLength(95);
    expect(bars.startsWith("101")).toBe(true);
    expect(bars.slice(45, 50)).toBe("01010");
    expect(bars.endsWith("101")).toBe(true);
  });
});

describe("preflight", () => {
  const facts = (pages: number, w: number, h: number, fonts: boolean | null = true): PdfFacts => ({
    pages, sizes: Array.from({ length: pages }, () => ({ w, h })), fontsEmbedded: fonts,
  });

  it("passes a well-made interior", () => {
    const out = preflight({ profile: { ...kdp6x9, isbn: "9780306406157" }, interior: facts(200, 152.4, 228.6) });
    expect(out.filter((f) => f.severity === "blocking")).toEqual([]);
  });

  it("blocks a saddle-stitched booklet whose pages do not divide by four", () => {
    const out = preflight({ profile: defaultProfile("publication"), interior: facts(30, 216, 303) });
    expect(out.map((f) => f.code)).toContain("pages-four");
  });

  it("blocks a page size that does not match the trim", () => {
    const out = preflight({ profile: kdp6x9, interior: facts(200, 148, 210) });
    expect(out.find((f) => f.code === "page-size")?.severity).toBe("blocking");
  });

  it("blocks missing fonts and soft pictures", () => {
    const out = preflight({
      profile: kdp6x9,
      interior: facts(200, 152.4, 228.6, false),
      images: [{ file: "cover.png", px: { w: 896, h: 1152 }, placedMm: 155 }],
    });
    expect(out.find((f) => f.code === "fonts")?.severity).toBe("blocking");
    expect(out.find((f) => f.code === "dpi")?.severity).toBe("blocking");
  });

  it("checks the cover against the spine the page count implies", () => {
    const geo = coverGeometry(kdp6x9, 200);
    const good = preflight({ profile: kdp6x9, interior: facts(200, 152.4, 228.6), cover: facts(1, geo.width, geo.height) });
    const bad = preflight({ profile: kdp6x9, interior: facts(200, 152.4, 228.6), cover: facts(1, geo.width - 5, geo.height) });
    expect(good.map((f) => f.code)).not.toContain("cover-size");
    expect(bad.map((f) => f.code)).toContain("cover-size");
  });
});

describe("typesetting", () => {
  it("keeps manuscript characters out of Typst markup", () => {
    expect(lit('a "quote" and \\ back')).toBe('"a \\"quote\\" and \\\\ back"');
    const out = inline("A # hash, $5, // not a comment, and **bold** and *soft*.");
    expect(out).toContain('#"A # hash, $5, // not a comment, and "');
    expect(out).toContain('#strong("bold")');
    expect(out).toContain('#emph("soft")');
  });

  it("turns headings, scene breaks and quotes into structure", () => {
    const out = prose("# One\n\nFirst para.\n\n***\n\n> Said once.");
    expect(out).toContain("#heading(level: 1)");
    expect(out).toContain('#align(center)');
    expect(out).toContain("#quote(block: true)");
  });

  it("opens every chapter on a right-hand page", () => {
    const src = interiorSource({
      title: "The Lamp Room",
      chapters: [{ title: "One", body: "Words." }, { title: "Two", body: "More words." }],
      profile: kdp6x9,
    });
    expect(src.match(/pagebreak\(to: "odd"/g)).toHaveLength(2);
    expect(src).toContain("costs: (widow: 100%, orphan: 100%)");
    expect(src).toContain("width: 152.4mm");
  });

  it("reads a screenplay's scenes, cues and dialogue", () => {
    const src = screenplaySource({ title: "T", text: "INT. KITCHEN - NIGHT\n\nShe waits.\n\nMARA\n(quietly)\nIt's late.\n\nCUT TO:" });
    expect(src).toContain('#scene("INT. KITCHEN - NIGHT")');
    expect(src).toContain('#cue("MARA")');
    expect(src).toContain('#paren("(quietly)")');
    expect(src).toContain(`#dialogue("It's late.")`);
    expect(src).toContain('#transition("CUT TO:")');
  });

  it("reads a Chinese script's name-colon lines as cues", () => {
    const src = screenplaySource({ title: "T", text: "第1场 厨房\n\n林然：你来了。" });
    expect(src).toContain('#cue("林然")');
    expect(src).toContain('#dialogue("你来了。")');
  });
});

describe("withdrawing stops what the approval started", () => {
  it("counts only stages behind the gate", () => {
    expect(isDownstreamOf("content", "design.generate")).toBe(true);
    expect(isDownstreamOf("content", "build.export")).toBe(true);
    expect(isDownstreamOf("design", "design.generate")).toBe(false);
    expect(isDownstreamOf("design", "build.layout")).toBe(true);
    expect(isDownstreamOf("content", "content.write")).toBe(false);
  });
});
