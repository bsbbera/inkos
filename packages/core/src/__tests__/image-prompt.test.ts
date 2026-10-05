import { describe, expect, it } from "vitest";
import { artPolicyOf } from "../productions/registry.js";
import { composeImagePrompt, parseWorld, workDirOf } from "../pipeline/image-prompt.js";

describe("art policy", () => {
  it("illustrates books and forbids photographs; lets magazines use them", () => {
    expect(artPolicyOf("book")?.realism).toBe("forbidden");
    expect(artPolicyOf("storybook")?.surfaces).toEqual(["illustration"]);
    expect(artPolicyOf("publication")?.surfaces).toContain("photo");
    expect(artPolicyOf("publication")?.worldScope).toBe("section");
  });
});

describe("composeImagePrompt", () => {
  it("puts the anti-photo block on every book brief, and takes photo words out", () => {
    const out = composeImagePrompt({
      type: "book",
      prompt: "A photorealistic photo of a lighthouse at dusk",
      negative: "halos",
    });
    expect(out.negative).toContain("photorealistic");
    expect(out.negative.startsWith("halos")).toBe(true);
    expect(out.prompt).not.toMatch(/photo/i);
    expect(out.prompt).toContain("lighthouse at dusk");
  });

  it("leads with the style and keeps every part for a redesign", () => {
    const out = composeImagePrompt({
      type: "publication",
      prompt: "a tide pool at noon",
      treatment: "cutout",
      world: { imagePrompt: "riso print, two inks", technique: "riso", props: ["kelp"], negative: "gloss" },
    });
    // The style leads: a world paragraph in front of it buried the one phrase
    // that says what kind of picture this is.
    expect(out.prompt.startsWith("riso")).toBe(true);
    expect(out.prompt).toContain("riso print, two inks");
    expect(out.prompt).toContain("isolated on a plain flat ground");
    // The brief's own avoid-list, then the surface's — this picture is drawn,
    // so photorealism is refused — then the house one: lettering in a
    // generated picture is always wrong, the layout sets the type over it.
    expect(out.negative.startsWith("photorealistic")).toBe(true);
    expect(out.negative).toContain("gloss");
    expect(out.negative).toContain("lettering");
    expect(out.components.subject).toBe("a tide pool at noon");
  });
});

describe("parseWorld", () => {
  it("refuses a technique outside the type's pool", () => {
    expect(() => parseWorld("storybook", { technique: "blueprint" })).toThrow(/not a technique/);
  });

  it("keeps a good world and drops what is not a colour", () => {
    const w = parseWorld("book", {
      technique: "Linocut", idiom: "harbour woodcuts", paper: "#f4efe6", ink: "black",
      imagePrompt: "linocut, two colours, a photo of salt air", props: ["lamp", "rope"],
    });
    expect(w.technique).toBe("linocut");
    expect(w.paper).toBe("#f4efe6");
    expect(w.ink).toBeUndefined();
    expect(w.imagePrompt).not.toMatch(/photo/);
  });
});

describe("workDirOf", () => {
  it("puts a magazine issue under issues/", () => {
    expect(workDirOf("publication", "i1").replace(/\\/g, "/")).toBe("Magazine/issues/i1");
    expect(workDirOf("book", "b1").replace(/\\/g, "/")).toBe("books/b1");
  });
});

describe("a magazine picture shares its page with type", () => {
  // What the editor saw on the first real run: fifty near-photographs, edge to
  // edge and cluttered, with nowhere on the page a headline could be set.
  // Three causes, all mechanical: `surface` was read by the audit and by
  // nothing that composed a prompt, so every picture became the policy's first
  // surface; the design's own `imageSlot` never reached the art stage; and no
  // prompt ever asked for empty space.
  it("draws the surface it is told to, not always a photograph", () => {
    const drawn = composeImagePrompt({
      type: "publication", prompt: "a darkroom bench", surface: "illustration", treatment: "cutout",
    });
    expect(drawn.prompt).toMatch(/vector|painterly/i);
    expect(drawn.components.surface).toBe("illustration");

    const shot = composeImagePrompt({
      type: "publication", prompt: "a darkroom bench", surface: "photo", treatment: "full-bleed",
    });
    expect(shot.prompt).toMatch(/photograph/i);
  });

  it("asks for quiet space on any picture that is not the whole page", () => {
    const inset = composeImagePrompt({ type: "publication", prompt: "a lens", treatment: "cutout" });
    expect(inset.prompt).toContain("quiet space for type");
    const full = composeImagePrompt({ type: "publication", prompt: "a lens", treatment: "full-bleed" });
    expect(full.prompt).not.toContain("quiet space for type");
  });

  it("never lets a world ban the surface its own picture is drawn as", () => {
    // The photography issue's section world banned "painterly, illustration,
    // soft focus" — and that negative was then applied to the drawn pictures
    // in the same section.
    const out = composeImagePrompt({
      type: "publication", prompt: "a lens", surface: "illustration",
      world: { negative: "painterly, illustration, soft focus, gloss" },
    });
    expect(out.negative).not.toMatch(/painterly/);
    expect(out.negative).toContain("gloss");
  });

  it("refuses lettering in every picture, whatever the brief said", () => {
    const out = composeImagePrompt({ type: "publication", prompt: "a lens" });
    expect(out.negative).toContain("text");
    expect(out.negative).toContain("lettering");
  });
});

describe("a picture sits on paper, not in a room", () => {
  // Only `cutout` said what the ground was, and it was the only treatment that
  // produced a usable page. Every other one left the background to the model,
  // which put the subject in a room and lit it.
  it("says what the ground is, whatever the treatment", () => {
    for (const treatment of ["full-bleed", "half-bleed-top", "plate", "vignette", "duotone"]) {
      const out = composeImagePrompt({ type: "publication", prompt: "a lens", treatment });
      expect(out.prompt, treatment).toMatch(/flat|plain|uncluttered/);
    }
  });

  it("does not ask a magazine for a typographic picture", async () => {
    const { artPolicyOf } = await import("../productions/registry.js");
    const policy = artPolicyOf("publication");
    // Letterforms from a diffusion model, with lettering in every negative.
    expect(Object.keys(policy?.mix ?? {})).not.toContain("typographic");
    expect(policy?.surfaces).not.toContain("typographic");
  });
});

describe("the ground an element stands on", () => {
  // White was the only ground a cutout could be ordered on, in the prompt and
  // in the key alike. A magazine stands its elements on a flat colour that
  // belongs to the section, and the same colour is keyed away afterwards.
  it("names the section's colour, in words and in hex", () => {
    const out = composeImagePrompt({
      type: "publication", prompt: "a brass camera", treatment: "cutout", ground: "#F5EFEB",
    });
    expect(out.prompt).toContain("#f5efeb");
    expect(out.prompt).toMatch(/solid .*background/);
    expect(out.prompt).toContain("no scenery");
  });

  it("says nothing about a ground for a picture that fills the page", () => {
    const out = composeImagePrompt({
      type: "publication", prompt: "a brass camera", treatment: "full-bleed", ground: "#F5EFEB",
    });
    expect(out.prompt).not.toContain("#f5efeb");
  });
});
