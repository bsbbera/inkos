import { describe, expect, it } from "vitest";
import { parseArtDirection } from "../pipeline/art-director.js";
import { castIn, parseCast, traitLine } from "../pipeline/cast.js";
import { composeImagePrompt } from "../pipeline/image-prompt.js";
import { kitAssetFor, mix, proposeKit, type KitManifest } from "../pipeline/kit.js";
import { pageCandidates, postProcessFor, rollTreatment } from "../pipeline/treatments.js";

describe("rollTreatment (09 §1)", () => {
  it("never repeats the unit before, and a book gets at most one full-bleed in three", () => {
    let previous: Array<string | undefined> = [];
    const seq: string[] = [];
    for (let unit = 1; unit <= 10; unit += 1) {
      const t = rollTreatment({ type: "book", id: "demo", unit, slot: "opener", previous });
      seq.push(t);
      previous = [t, previous[0]];
    }
    for (let i = 1; i < seq.length; i += 1) expect(seq[i]).not.toBe(seq[i - 1]);
    for (let i = 2; i < seq.length; i += 1) {
      expect(seq.slice(i - 2, i + 1).filter((t) => t === "full-bleed").length).toBeLessThanOrEqual(1);
    }
  });

  it("gives a storybook rhythm: full-bleed, then white ground, then full-bleed", () => {
    const one = rollTreatment({ type: "storybook", id: "fox", unit: 1, slot: "spread" });
    const two = rollTreatment({ type: "storybook", id: "fox", unit: 2, slot: "spread", previous: [one] });
    const three = rollTreatment({ type: "storybook", id: "fox", unit: 3, slot: "spread", previous: [two, one] });
    expect(one).toBe("full-bleed");
    expect(["vignette", "cutout"]).toContain(two);
    expect(three).toBe("full-bleed");
  });

  it("is the same answer every time for the same work and unit", () => {
    const a = rollTreatment({ type: "publication", id: "i1", unit: 7, slot: "page", candidates: pageCandidates("article") });
    const b = rollTreatment({ type: "publication", id: "i1", unit: 7, slot: "page", candidates: pageCandidates("article") });
    expect(a).toBe(b);
  });
});

describe("postProcessFor", () => {
  it("maps treatments to the ops the shim runs, in the world's colours", () => {
    expect(postProcessFor("cutout")).toEqual([{ op: "cutout" }]);
    expect(postProcessFor("ornament", { ink: "#112233" })).toEqual([{ op: "cutout" }, { op: "one-colour", ink: "#112233" }]);
    expect(postProcessFor("duotone", { ink: "#000000", paper: "#ffffff" }))
      .toEqual([{ op: "duotone", dark: "#000000", light: "#ffffff" }]);
    expect(postProcessFor("full-bleed")).toEqual([]);
  });
});

describe("Cast Sheet (08 §9)", () => {
  const cast = parseCast({
    characters: [
      { name: "Pip", species: "fox", age: "young", wardrobe: ["moss-green knit scarf"], palette: ["russet"], traits: ["small", "bright eyes"] },
      { name: "pip", species: "duplicate" },
      { name: "" },
    ],
  }, "2026-09-11T00:00:00.000Z");

  it("keeps one sheet per name and drops empties", () => {
    expect(cast.map((c) => c.id)).toEqual(["pip"]);
    expect(cast[0]!.version).toBe(1);
  });

  it("finds a character by whole word only", () => {
    expect(castIn("Pip lifts the lantern.", cast)).toHaveLength(1);
    expect(castIn("A pipe of smoke.", cast)).toHaveLength(0);
  });

  it("puts the trait line into the prompt and the recipe components", () => {
    const line = traitLine(cast[0]!);
    expect(line).toContain("moss-green knit scarf");
    const composed = composeImagePrompt({ type: "storybook", prompt: "Pip on the ice.", cast: [line] });
    expect(composed.prompt).toContain("moss-green knit scarf");
    expect(composed.components.cast).toEqual([line]);
  });
});

describe("Design Kit (07 §1b)", () => {
  it("spells the world out as swatches, tints and one effect set", () => {
    const kit = proposeKit({
      kitId: "storybook-fox", version: 1, type: "storybook", worldRef: "storybooks/fox/design/world.json",
      world: { technique: "gouache", paper: "#ffffff", ink: "#000000", hue: "#ff0000" },
    });
    expect(kit.swatches.tints["ink-50"]).toBe(mix("#ffffff", "#000000", 0.5));
    expect(kit.fx.allowed.map((f) => f.id)).toEqual(["soft-shadow"]);
    expect(proposeKit({ kitId: "b", version: 1, type: "book", worldRef: "", world: {} }).fx.allowed).toEqual([]);
  });

  it("reuses only an approved asset with the same subject", () => {
    const manifest = {
      id: "k", version: 1, world: "", technique: "", at: "", approvedAt: null,
      assets: [
        { id: "a", kind: "ornament", file: "design/kits/k@1/captured/a.png", subjectKey: "brass-lantern", state: "approved", origin: "captured", at: "" },
        { id: "b", kind: "ornament", file: "design/kits/k@1/captured/b.png", subjectKey: "tin-cup", state: "draft", origin: "captured", at: "" },
      ],
    } as KitManifest;
    expect(kitAssetFor(manifest, "Brass lantern")?.id).toBe("a");
    expect(kitAssetFor(manifest, "tin cup")).toBeUndefined();
  });
});

describe("parseArtDirection (08 §4)", () => {
  const cast = parseCast({ characters: [{ name: "Mira", traits: ["freckles"] }] });

  it("holds a book to its policy: no cover, one picture, allowed treatments only", () => {
    const { briefs } = parseArtDirection({
      type: "book", id: "demo", unit: 3, source: "books/demo/chapters/0003.md", cast,
      previous: ["vignette"],
      out: {
        images: [
          { slot: "cover", subject: "A cover." },
          { slot: "tailpiece", treatment: "full-bleed", subject: "An empty tin cup on the step.", subjectKey: "tin cup" },
          { slot: "opener", subject: "Mira lifts the lantern over the flooded stairs." },
        ],
      },
    });
    expect(briefs).toHaveLength(1);
    expect(briefs[0]!.slot).toBe("tailpiece");
    expect(["spot", "ornament", "fade-vignette"]).toContain(briefs[0]!.treatment);
    expect(briefs[0]!.subjectKey).toBe("tin-cup");
    expect([briefs[0]!.width, briefs[0]!.height]).toEqual([1024, 1024]);
  });

  it("names the cast who are in the picture", () => {
    const { briefs } = parseArtDirection({
      type: "book", id: "demo", unit: 2, source: "x", cast,
      out: { images: [{ slot: "opener", treatment: "vignette", subject: "Mira at the door.", characters: ["Mira"] }] },
    });
    expect(briefs[0]!.characters).toEqual(["mira"]);
    expect(briefs[0]!.treatment).toBe("vignette");
  });

  it("answers none with the reason when the model draws nothing", () => {
    const out = parseArtDirection({ type: "book", id: "d", unit: 4, source: "x", out: { images: [], reason: "a quiet chapter" } });
    expect(out.briefs).toHaveLength(0);
    expect(out.reason).toBe("a quiet chapter");
  });
});
