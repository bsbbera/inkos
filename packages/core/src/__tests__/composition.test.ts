import { describe, expect, it } from "vitest";
import { checkComposition, composePrompt, gridSheet, slotManifest } from "../pipeline/composition.js";
import { DEFAULT_DESIGN_PROMPT } from "../pipeline/publication-design.js";
import { LANGUAGE_GUIDE, holdLanguage } from "../pipeline/visual-language.js";
import { pageArtPrompt } from "../pipeline/page-art.js";
import { proposeHousePrompt } from "../pipeline/house.js";
import type { DesignSpec } from "../pipeline/publication-design.js";

const spec = {
  grid: { system: "columns", columns: 12, gutterMm: 4, marginMm: 15, baselineMm: 4.5 },
  type: { display: "D", text: "T", scale: [40, 20, 9.5] },
} as unknown as DesignSpec;
const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
const page = { n: 3, type: "feature", title: "Nine brains", deck: "A short standfirst.", body: words(300) };

describe("a composed page", () => {
  it("passes when every frame is on the grid, apart, and holds its copy", () => {
    const c = checkComposition({ idea: "x", blocks: [
      { kind: "image", col: 1, span: 12, row: 0, rows: 20, bleed: true, brief: { shows: "an octopus arm", crop: "tight" } },
      { kind: "title", col: 1, span: 10, row: 22, rows: 6 },
      { kind: "deck", col: 1, span: 8, row: 29, rows: 3 },
      { kind: "body", col: 1, span: 12, row: 33, rows: 21, columns: 2 },
    ] }, page, spec);
    expect(c.problems).toEqual([]);
    expect(c.blocks.find((b) => b.kind === "image")!.brief).toMatchObject({ id: "p3-1", route: "generate", shows: "an octopus arm", tone: "mid" });
    expect(c.blocks.find((b) => b.kind === "image")!.box.x).toBe(0);    // bleed reaches the trim
  });

  it("sends back a page-wide measure, three extras and a hole mid-page (Rain l2)", () => {
    const full = { ...page, pullQuote: "A bun.", furniture: [{ kind: "pull-number", text: "4.5 mm" }, { kind: "sidefact", text: "Weber number: air against skin" }] };
    const blocks = [
      { kind: "title", col: 1, span: 8, row: 0, rows: 6 },
      { kind: "deck", col: 1, span: 8, row: 7, rows: 3 },
      { kind: "figure", col: 9, span: 4, row: 0, rows: 4 },
      { kind: "pull", col: 9, span: 4, row: 5, rows: 4 },
      { kind: "panel", col: 9, span: 4, row: 10, rows: 10 },
      { kind: "body", col: 1, span: 12, row: 30, rows: 24, columns: 1 },
    ];
    // Rain chose the minimal look, which carries two extras beside the body.
    const minimal = { paper: "#ffffff", field: "#ffffff", ink: "#111111", accent: "#c00000", extras: 2 };
    const c = checkComposition({ blocks }, full, spec, minimal);
    const said = c.problems.join("\n");
    expect(said).toMatch(/lines run about \d+ characters; a line reads at 35-75/);
    expect(said).toMatch(/sets figure, pull, panel: the chosen look carries 2/);
    expect(said).toMatch(/rows 20-30 are empty across the whole page/);
    // No look chosen: the extras are not limited.
    expect(checkComposition({ blocks }, full, spec).problems.join("\n")).not.toMatch(/chosen look carries/);
  });

  it("sends back type on type, overflow, body on a picture, and missing frames", () => {
    const c = checkComposition({ blocks: [
      { kind: "image", col: 1, span: 12, row: 0, rows: 30, brief: { shows: "" } },
      { kind: "title", col: 1, span: 2, row: 0, rows: 1 },
      { kind: "body", col: 1, span: 6, row: 20, rows: 5 },
      { kind: "kicker", col: 2, span: 3, row: 21, rows: 1 },
      { kind: "pull", col: 1, span: 3, row: 40, rows: 4 },
      { kind: "rule", col: 13, span: 2, row: 40, rows: 4 },
    ] }, page, spec);
    const said = c.problems.join("\n");
    expect(said).toMatch(/no brief/);
    expect(said).toMatch(/title frame .* only holds the title/);
    expect(said).toMatch(/body frame holds about \d+ of the 300 words/);
    expect(said).toMatch(/kicker cover each other|body and the kicker cover/);
    expect(said).toMatch(/body is set on a picture slot/);
    expect(said).toMatch(/no deck frame/);
    expect(said).toMatch(/runs off the 12 cells/);
    expect(c.notes.join(" ")).toMatch(/dropped the pull/);              // no pull quote on this page
  });

  it("holds type on a picture to the tone promised, and a panel to its notes", () => {
    const withNotes = { ...page, furniture: [
      { kind: "sidefact", text: "Neurons: about 500 million, two-thirds of them in the arms" },
      { kind: "did-you-know", text: "An octopus can taste with its suckers" },
    ] };
    const c = checkComposition({ blocks: [
      { kind: "image", col: 1, span: 12, row: 0, rows: 20, brief: { shows: "night water", tone: "light" } },
      { kind: "title", col: 1, span: 10, row: 2, rows: 6, color: "paper" },
      { kind: "deck", col: 1, span: 8, row: 21, rows: 3 },
      { kind: "body", col: 1, span: 9, row: 25, rows: 30, columns: 2 },
      { kind: "panel", col: 10, span: 3, row: 25, rows: 3 },
    ] }, withNotes, spec);
    const said = c.problems.join("\n");
    expect(said).toMatch(/title is set in paper on a light picture/);
    expect(said).toMatch(/panel is 13.5 mm tall; its 2 notes need about/);
  });

  it("sends back type set in its own ground's colour", () => {
    const c = checkComposition({ blocks: [
      { kind: "drawn", col: 1, span: 12, row: 0, rows: 10 },
      { kind: "kicker", col: 1, span: 4, row: 2, rows: 1, color: "field" },
      { kind: "title", col: 1, span: 10, row: 12, rows: 6 },
      { kind: "deck", col: 1, span: 8, row: 19, rows: 3, color: "paper" },
      { kind: "body", col: 1, span: 12, row: 23, rows: 30, columns: 2 },
    ] }, page, spec);
    const said = c.problems.join("\n");
    expect(said).toMatch(/deck is set in paper, the page's own ground colour/);
    expect(said).toMatch(/kicker is set in field on drawn art/);
  });

  it("sends back type that does not read on its ground, and a runhead too narrow for its words (Rain p2, p3)", () => {
    const setting = { paper: "#d9cbb8", field: "#978776", ink: "#232020", accent: "#d9693a", runhead: "Rain — Rain", section: "The shape of falling water" };
    const blocks = [
      { kind: "drawn", col: 1, span: 12, row: 0, rows: 10 },
      { kind: "kicker", col: 1, span: 6, row: 2, rows: 1, color: "paper" },
      { kind: "runhead", col: 11, span: 2, row: 12, rows: 1 },
      { kind: "title", col: 1, span: 10, row: 14, rows: 6 },
      { kind: "deck", col: 1, span: 8, row: 21, rows: 3, color: "ink" },
      { kind: "body", col: 1, span: 12, row: 25, rows: 30, columns: 2 },
    ];
    const said = checkComposition({ blocks }, page, spec, setting).problems.join("\n");
    expect(said).toMatch(/kicker is set in paper on the field at 2\.\d:1; it needs 4\.5:1/);
    expect(said).toMatch(/runhead is [\d.]+ mm wide; its words need about \d+ mm/);
    expect(said).not.toMatch(/deck is set/);   // ink on kraft reads
    // Without the setting the old checks stand alone: nothing here is wrong by name.
    expect(checkComposition({ blocks }, page, spec).problems.join("\n")).not.toMatch(/kicker|runhead/);
    // A runhead across the page holds the same words.
    const wide = blocks.map((b) => b.kind === "runhead" ? { ...b, col: 1, span: 12 } : b);
    expect(checkComposition({ blocks: wide }, page, spec, setting).problems.join("\n")).not.toMatch(/runhead/);
  });

  it("tells the model the grid in millimetres and how much body a frame holds", () => {
    const g = gridSheet(spec, 3);
    expect(g).toMatch(/Cells across .*1: x 15/);
    expect(g).toMatch(/words per row/);
  });

  it("lists picture slots at their print size for ComfyUI", () => {
    const c = checkComposition({ blocks: [{ kind: "image", col: 1, span: 6, row: 0, rows: 20, brief: { shows: "a reef" } }] }, page, spec);
    const s = { ...spec, imageDirection: "flat gouache", pages: { "3": { layout: "", imageSlot: "inset", blocks: c.blocks } } } as unknown as DesignSpec;
    const [slot] = slotManifest(s, () => ({ imagePrompt: "deep blues" }));
    expect(slot).toMatchObject({ id: "p3-1", page: 3, shows: "a reef", style: "flat gouache deep blues" });
    expect((slot!.px as { w: number }).w).toBeGreaterThan(900);
  });
});

/*
 * The prompts give vocabulary, geometry and the score's rules, never a look.
 * A word here is a style instruction that would make every issue alike
 * (the depth recipe in the old art prompt gave three covers one structure).
 */
const STYLE_WORDS = [
  /\bbold\b/i, /\bdepth\b/i, /foreground/i, /middle layer/i, /bleeds? off/i, /\bminimal/i, /\belegant/i,
  /\bdramatic/i, /\bcalm\b/i, /classical/i, /\bplayful/i, /\bvibrant/i, /\bwarm\b/i, /\bairy\b/i,
  /give it/i, /personality/i, /be bold/i, /recognisable subject/i,
];

describe("design prompts carry no style", () => {
  const { language } = holdLanguage({}, { paper: "#ffffff", ink: "#111111", accent: "#c0392b" });
  const prompts: Record<string, string> = {
    design: DEFAULT_DESIGN_PROMPT,
    language: LANGUAGE_GUIDE,
    art: pageArtPrompt({ title: "t", body: "b", type: "feature", language, art: [], blocks: [] }),
    compose: composePrompt({ issueTitle: "i", page, spec, direction: "" }),
    house: proposeHousePrompt({ brandBook: "", issues: [], fonts: [] }),
  };
  for (const [name, text] of Object.entries(prompts)) {
    it(`the ${name} prompt`, () => {
      const hits = STYLE_WORDS.filter((w) => w.test(text)).map(String);
      expect(hits).toEqual([]);
    });
  }
});
