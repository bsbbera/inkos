import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  activeDimensions, applyWordDelta, auditPackIn, customDimensionPrompt, noAuditPack,
  isSuppressed, parseAuditPack, readAuditPacks, readCatalogues, resolveAuditPack, DEFAULT_SCORING,
} from "../pipeline/audit-pack.js";
import { analyzeAITells } from "../agents/ai-tells.js";
import {
  buildFindingRewritePrompt, buildStoryAuditPrompt, STORY_DIMENSIONS,
} from "../pipeline/story-audit.js";

const pack = (over: Record<string, unknown>) => parseAuditPack({ id: "p", version: 1, ...over })!;

describe("the builtin catalogue", () => {
  it("ships every dimension the code used to hold", async () => {
    const cats = await readCatalogues();
    // 37 continuity dimensions and 30 story dimensions: the counts the audit
    // was built on, so a dropped entry fails here rather than in a book.
    expect(cats.get("core-37")?.dimensions).toHaveLength(37);
    expect(cats.get("story-30")?.dimensions).toHaveLength(30);
    expect(cats.get("core-37")?.dimensions.map((d) => d.id)).toEqual(
      Array.from({ length: 37 }, (_, i) => i + 1));
    expect(cats.get("story-30")?.dimensions.map((d) => d.id)).toEqual(
      STORY_DIMENSIONS.map((d) => d.n));
  });

  it("ships a default pack for every type that has one", async () => {
    const ids = (await readAuditPacks()).map((p) => p.id).sort();
    expect(ids).toEqual([
      "magazine-readability", "script-format", "short-arc", "storyboard-panels",
      "translation-fidelity",
    ]);
  });

  it("does not mistake a catalogue for a pack", async () => {
    const cats = await readCatalogues();
    expect(parseAuditPack({ ...cats.get("core-37") })).toBeNull();
  });
});

describe("resolving a pack", () => {
  it("changes nothing when there is no pack", () => {
    const none = noAuditPack();
    expect(none.packs).toEqual([]);
    expect(none.passThreshold).toBe(DEFAULT_SCORING.passThreshold);
    expect(activeDimensions([1, 2, 3], none)).toEqual(new Set([1, 2, 3]));
    expect(customDimensionPrompt(none)).toBe("");
  });

  it("applies a type default only to its own type", async () => {
    const available = await readAuditPacks();
    expect(resolveAuditPack({ type: "script", available }).packs).toEqual(["script-format"]);
    expect(resolveAuditPack({ type: "book", available }).packs).toEqual([]);
  });

  it("lets a later layer disable what an earlier one enabled", () => {
    const on = pack({ id: "on", appliesTo: ["book"], dimensions: { enable: [12] } });
    const off = pack({ id: "off", dimensions: { disable: [12] } });
    const out = resolveAuditPack({ type: "book", available: [on, off], selected: ["off"] });
    expect(out.enable.has(12)).toBe(false);
    expect(out.disable.has(12)).toBe(true);
    expect(activeDimensions([12, 13], out)).toEqual(new Set([13]));
  });

  it("keeps a dimension the user wrote into book_rules, whatever a pack says", () => {
    const off = pack({ id: "off", dimensions: { disable: [12] } });
    const out = resolveAuditPack({
      available: [off], selected: ["off"], bookRuleDimensions: [12],
    });
    expect(activeDimensions([], out).has(12)).toBe(true);
  });

  it("carries thresholds, blocking categories and custom dimensions through", () => {
    const p = pack({
      id: "warmth",
      dimensions: { custom: [{ id: "warmth", label: "Human warmth", instruction: "Flag stated emotion." }] },
      scoring: { passThreshold: 70, maxIterations: 3 },
      blocking: ["readability/over-cap"],
    });
    const out = resolveAuditPack({ available: [p], selected: ["warmth"] });
    expect(out.passThreshold).toBe(70);
    expect(out.maxIterations).toBe(3);
    expect(out.blocking.has("readability/over-cap")).toBe(true);
    expect(customDimensionPrompt(out)).toContain("Flag stated emotion.");
  });

  it("drops a custom dimension with no instruction, because a name is not a criterion", () => {
    const p = pack({ id: "x", dimensions: { custom: [{ id: "a", label: "A" }] } });
    expect(p.dimensions?.custom).toEqual([]);
  });
});

describe("deterministic lists a pack can move", () => {
  it("adds and removes words without duplicating them", () => {
    expect(applyWordDelta(["however", "still"], { add: ["nestled", "HOWEVER"], remove: ["still"] }))
      .toEqual(["however", "nestled"]);
  });

  it("flags a word the pack added and stops flagging one it removed", () => {
    const text = Array.from({ length: 12 }, () => "The lamp was nestled there.").join(" ");
    const added = analyzeAITells(text, "en", { hedgeWords: { add: ["nestled"] } });
    expect(added.issues.some((i) => i.category === "Hedge density")).toBe(true);
    expect(analyzeAITells(text, "en").issues.some((i) => i.category === "Hedge density")).toBe(false);
  });

  it("flags an over-long paragraph only when the pack sets a ceiling", () => {
    const long = "word ".repeat(200);
    expect(analyzeAITells(long, "en", { paragraphMaxChars: 200 }).issues
      .some((i) => i.category === "Paragraph length")).toBe(true);
    expect(analyzeAITells(long, "en").issues
      .some((i) => i.category === "Paragraph length")).toBe(false);
  });
});

describe("the auditor prompt", () => {
  const section = { heading: "One", body: "He walked in." };

  it("asks only for the dimensions the pack left on, and for its own", () => {
    const p = resolveAuditPack({
      available: [pack({
        id: "q",
        dimensions: {
          disable: [1],
          custom: [{ id: "warmth", label: "Human warmth", instruction: "Flag stated emotion." }],
        },
        rules: ["Keep paragraphs under four sentences."],
      })],
      selected: ["q"],
    });
    const out = buildStoryAuditPrompt(section, 0, 1, "en", p);
    expect(out).not.toContain("1. Promise kept");
    expect(out).toContain("2. Scene, not summary");
    expect(out).toContain("Human warmth");
    expect(out).toContain("Keep paragraphs under four sentences.");
    // With no pack the prompt is the thirty, exactly as before.
    expect(buildStoryAuditPrompt(section, 0, 1, "en")).toContain("1. Promise kept");
  });
});

describe("never flag this again", () => {
  it("silences a category and the family under it, and nothing else", () => {
    const out = resolveAuditPack({
      available: [pack({ id: "s", dimensions: { disable: ["ai-tell", "readability/grade"] } })],
      selected: ["s"],
    });
    expect(isSuppressed(out, "ai-tell")).toBe(true);
    expect(isSuppressed(out, "ai-tell/Hedge density")).toBe(true);
    expect(isSuppressed(out, "readability/grade")).toBe(true);
    expect(isSuppressed(out, "readability/sentence")).toBe(false);
    expect(isSuppressed(out, "continuity")).toBe(false);
    // A name in `disable` is a category, not a catalogue entry, so the
    // numbered dimensions are untouched by it.
    expect(out.disable.size).toBe(0);
  });

  it("un-silences when a later layer asks for it back", () => {
    const out = resolveAuditPack({
      available: [
        pack({ id: "off", dimensions: { disable: ["ai-tell"] } }),
        pack({ id: "on", dimensions: { enable: ["ai-tell"] } }),
      ],
      selected: ["off", "on"],
    });
    expect(isSuppressed(out, "ai-tell/Hedge density")).toBe(false);
  });
});

describe("the rewrite prompt", () => {
  const one = {
    category: "pacing", title: "The middle sags", description: "Three beats, no turn.",
    suggestion: "Cut the second.",
  };

  it("replaces three paragraphs for a beat, and one for a paragraph", () => {
    const beat = buildFindingRewritePrompt({
      finding: one, scope: "beat", span: "A\n\nB\n\nC", paragraph: "B",
      before: "before", after: "after", language: "en",
    });
    expect(beat).toContain("PASSAGE:");
    expect(beat).toContain("A\n\nB\n\nC");
    expect(beat).not.toContain("MARKED WORDS:");

    const para = buildFindingRewritePrompt({
      finding: one, scope: "paragraph", span: "B", paragraph: "B",
      before: "before", after: "after", language: "en",
    });
    expect(para).toContain("PARAGRAPH:");
    expect(para).not.toContain("PASSAGE:");
  });

  it("carries every finding in the paragraph into one call", () => {
    const out = buildFindingRewritePrompt({
      finding: one,
      also: [{ category: "ai-tell", title: "Hedged", description: "Four hedges.", suggestion: "Cut them." }],
      scope: "paragraph", span: "B", paragraph: "B", before: "", after: "", language: "en",
    });
    expect(out).toContain("FINDINGS — answer every one of them:");
    expect(out).toContain("The middle sags");
    expect(out).toContain("Hedged");
  });
});

describe("reading a work's pack off disk", () => {
  let dir = "";
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("finds the workspace, the chosen packs and the work's own override", async () => {
    dir = await mkdtemp(join(tmpdir(), "quire-pack-"));
    const work = join(dir, "books", "one");
    await mkdir(join(dir, ".quire"), { recursive: true });
    await mkdir(join(dir, "audit", "packs", "mine"), { recursive: true });
    await mkdir(join(work, "audit"), { recursive: true });
    await writeFile(join(dir, "audit", "packs", "mine", "pack.json"), JSON.stringify({
      id: "mine", version: 2, scoring: { passThreshold: 60 },
    }));
    await writeFile(join(work, "audit", "packs.json"), JSON.stringify({ packs: ["mine"] }));
    await writeFile(join(work, "audit", "pack.json"), JSON.stringify({
      id: "just-this-book", version: 1, dimensions: { disable: [7] },
    }));

    const out = await auditPackIn(work, "book");
    expect(out.packs).toEqual(["mine", "just-this-book"]);
    expect(out.passThreshold).toBe(60);
    expect(out.disable.has(7)).toBe(true);

    // A folder outside any workspace still audits, with the defaults.
    expect((await auditPackIn(tmpdir(), "book")).packs).toEqual([]);
  });
});
