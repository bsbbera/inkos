/**
 * One way to turn a brief into what the generator is sent (08 §3).
 *
 * Every call site built its prompt itself — the magazine page, the art stage,
 * the storyboard — and every one of them sent the brief raw. The design spec's
 * image direction was generated and never reached a render, and nothing at all
 * stopped a storybook brief from asking for a photograph. This is the single
 * place that joins the work's world, the type's art policy and the brief, and
 * it hands back every part it used so the recipe beside the picture can say
 * exactly how it was made — and a redesign can change one part and re-compose.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { artPolicyOf, PRODUCTIONS, type Surface } from "../productions/registry.js";
import { safeChildPath } from "../utils/path-safety.js";

/** How a work looks, as far as a picture is concerned (08 §2). */
export interface ImageWorld {
  /** Prepended to every brief in this world. No single subject. */
  readonly imagePrompt?: string;
  readonly technique?: string;
  /** This world's own avoid-list, beyond the policy's. */
  readonly negative?: string;
  /** Recurring objects and motifs. */
  readonly props?: ReadonlyArray<string>;
  readonly surfaceDefaults?: Partial<Record<Surface, { readonly technique?: string }>>;
}

/** The techniques a world of each pool may choose from (08 §2). */
export const TECHNIQUE_POOLS = {
  narrative: [
    "watercolor", "gouache", "ink-and-wash", "linocut", "riso", "coloured pencil",
    "paper-cut", "woodcut", "pastel", "digital-painterly",
  ],
  editorial: [
    "watercolor", "gouache", "ink-and-wash", "linocut", "riso", "coloured pencil",
    "paper-cut", "woodcut", "pastel", "digital-painterly",
    "photo-documentary", "studio-still", "collage", "vector-flat", "isometric", "data-viz", "typographic",
  ],
  children: ["gouache", "crayon", "paper-cut", "felt", "soft-digital"],
  technical: ["line", "blueprint", "cross-hatch"],
} as const;

/** What `realism` in a policy appends to the negative prompt. */
export const POLICY_NEGATIVE = {
  photo: "photorealistic, photo, photograph, 3d render, cgi, stock photo, dslr, bokeh",
  illustration: "illustration, drawing, painting, cartoon, anime, sketch",
} as const;

/** What each treatment asks of the picture itself (09 §1). */
/*
 * Every treatment says what the ground is.
 *
 * Only `cutout` used to — "isolated on plain white" — and it was the only
 * treatment that produced a usable magazine picture. The others said how the
 * picture was framed and left the background to the model, which invented a
 * room, a wall or studio falloff every time and buried the subject in it. A
 * page picture sits on paper, so the ground is flat or it is nothing.
 */
export const TREATMENT_SUFFIX: Readonly<Record<string, string>> = {
  "full-bleed": "edge to edge composition, no border, flat uncluttered background",
  "half-bleed-top": "subject in the lower half, flat plain background, empty above",
  "half-bleed-side": "subject to one side, flat plain background, empty on the other",
  vignette: "subject centred on a flat plain ground, soft edges fading to plain paper",
  "fade-vignette": "subject centred on a flat plain ground, soft edges fading to plain paper",
  cutout: "isolated on a plain flat ground, full figure, no ground shadow",
  "spot-cutout": "small single object isolated on a plain flat ground",
  spot: "small single object isolated on a plain flat ground",
  ornament: "simple one-colour ornament on a plain flat ground",
  plate: "centred subject on a flat plain ground, thin framing rule, no room around it",
  "watercolor-bleed": "painted edges bleeding into white paper",
  tile: "seamless repeating pattern",
  wash: "subtle low-contrast texture",
  duotone: "two-tone, high contrast, flat plain background",
};

/**
 * What each surface asks for in the picture itself.
 *
 * `surface` decided which engines could draw a brief and nothing else, so
 * every magazine picture was composed as a photograph — the first surface in
 * the policy list — however the brief was written. A fifty-page issue of
 * near-photographic clutter is the result, and none of it is what a magazine
 * is: mostly drawn, sometimes photographed.
 */
export const SURFACE_TECHNIQUE: Readonly<Record<string, string>> = {
  illustration: "flat vector illustration or painterly digital illustration, clean shapes, limited palette",
  photo: "documentary photograph, available light",
  infographic: "diagram, data visualisation, isometric, flat vector, labelled",
  typographic: "typographic composition, letterforms as the image",
  texture: "flat paper texture, no subject",
};

/**
 * What a surface must NOT have banned, whatever the world says.
 *
 * A section world written for photographs banned "painterly, illustration,
 * soft focus", and that negative was then applied to every picture in the
 * section — including the drawn ones. The negative may not contradict the
 * surface the picture is being drawn as.
 */
const SURFACE_KEEPS: Readonly<Record<string, RegExp>> = {
  illustration: /^(painterly|illustration|drawing|painting|vector|flat colou?r|cartoon|sketch|soft focus|impressionism|pictorialism)$/i,
  photo: /^(photo(graph(ic|y|s)?)?|photorealistic|dslr|bokeh|stock photo)$/i,
  infographic: /^(diagram|chart|vector|flat colou?r|illustration)$/i,
  typographic: /^(type|typography|letters|words|text|caption)$/i,
};

/** Treatments that fill the page. Everything else has to leave room for type. */
const FULL_PAGE = new Set(["full-bleed", "tile", "wash", "duotone"]);

export interface ComposedPrompt {
  readonly prompt: string;
  readonly negative: string;
  /** Every part, so a redesign can change one and re-compose. */
  readonly components: {
    readonly subject: string;
    readonly world: string;
    readonly technique: string;
    readonly treatment: string;
    readonly props: ReadonlyArray<string>;
    readonly briefNegative: string;
    readonly policyNegative: string;
    readonly worldNegative: string;
    readonly surface: Surface | null;
    readonly realism: string | null;
    /** The Cast Sheet trait lines of everyone in the picture (08 §9). */
    readonly cast: ReadonlyArray<string>;
  };
}

/** Words that ask for a photograph, removed where the policy forbids one. */
const REALISM = /\b(photo-?realistic|photorealism|hyper-?realistic|photograph(?:ic|y|s)?|photos?|dslr|35 ?mm|bokeh|cgi|3d render)\b/gi;

/*
 * The rest of a camera direction.
 *
 * Removing the word "photograph" is not enough. The magazine's briefs were
 * written as shot lists — "raking natural window light", "cinematic still
 * life", "shallow depth of field", "high resolution" — and a photoreal model
 * obeys that description whatever style word follows it. A brief says what is
 * in the picture; how the picture is made is the surface's business.
 */
const CAMERA = /\b(cinematic|filmic|macro|close-?up hero|studio (?:lighting|still life|shot)|raking (?:natural )?(?:window )?light|natural window light|available light|shallow depth of field|depth of field|golden hour|softbox|high resolution|ultra-?detailed|8k|4k|sharp focus|film grain|lens flare)\b/gi;

/** The opening of a long paragraph, so a 120-word world cannot bury the style. */
function firstWords(text: string, limit: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= limit ? text.trim() : words.slice(0, limit).join(" ").replace(/[,;:.]$/, "");
}

function scrub(text: string, forbid: boolean): string {
  const out = forbid ? text.replace(REALISM, "").replace(CAMERA, "") : text;
  return out.replace(/\s+([,.;])/g, "$1").replace(/([,;])\s*\1+/g, "$1").replace(/\s{2,}/g, " ").trim();
}

function mergeList(parts: ReadonlyArray<string>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of parts.join(",").split(",")) {
    const t = term.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.join(", ");
}

/** Treatments whose subject stands on a flat ground the layout later keys away. */
const KEYED = new Set(["cutout", "spot", "spot-cutout", "ornament", "cutout-on-field"]);

/** A colour said in words as well as hex, so the model has something to hold. */
function groundWords(ground: string): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(ground)?.[1];
  if (!hex) return ground;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!);
  // The hex is always said: the words steer the model, the number is what the
  // key looks for, and a picture drawn on "off-white" is not keyable on its own.
  const name = max - min < 18
    ? (max > 218 ? "off-white" : max > 120 ? "flat grey" : "near-black")
    : `${max > 200 ? "pale " : max < 110 ? "deep " : ""}`
      + `${r! >= g! && g! >= b! ? "warm" : b! >= g! && g! >= r! ? "cool" : "green"} flat colour`;
  return `${name} (#${hex.toLowerCase()})`;
}

export function composeImagePrompt(input: {
  readonly type: string;
  readonly prompt: string;
  readonly negative?: string;
  readonly surface?: Surface;
  readonly treatment?: string;
  /**
   * The flat colour this element stands on, keyed away afterwards.
   *
   * White was the only ground a cutout could be asked for, and white is one
   * look among many: an element drawn on the section's own paper, or on a
   * panel colour chosen for it, sits differently on the page. Whatever is
   * named here is what the post-process keys, so the two cannot drift apart.
   */
  readonly ground?: string;
  readonly world?: ImageWorld | null;
  /** Trait lines of the recurring characters in this picture, from their sheets. */
  readonly cast?: ReadonlyArray<string>;
}): ComposedPrompt {
  const policy = artPolicyOf(input.type);
  const surface = input.surface ?? policy?.surfaces[0] ?? null;
  /*
   * Only a photograph may be worded as one.
   *
   * The briefs on the photography issue were written as camera directions —
   * "Macro studio photograph of a hand-cut glass plate, low raking light" —
   * and that wording went to the generator unchanged even when the picture was
   * meant to be drawn, which is most of them. A brief says what is in the
   * picture; the surface says what kind of picture it is, and it wins.
   */
  const forbid = policy?.realism === "forbidden" || (surface !== null && surface !== "photo");
  const world = input.world ?? {};

  const worldText = scrub(world.imagePrompt ?? "", forbid);
  const technique = (surface ? world.surfaceDefaults?.[surface]?.technique : undefined)
    || world.technique
    || (surface ? SURFACE_TECHNIQUE[surface] ?? "" : "");
  const subject = scrub(input.prompt, forbid);
  const treatment = input.treatment ? TREATMENT_SUFFIX[input.treatment] ?? "" : "";
  const props = (world.props ?? []).slice(0, 4);
  const cast = (input.cast ?? []).map((line) => scrub(line, forbid)).filter(Boolean);
  const policyNegative = forbid
    ? POLICY_NEGATIVE.photo
    : policy?.realism === "preferred" && surface === "photo" ? POLICY_NEGATIVE.illustration : "";

  /*
   * Room for the words.
   *
   * A magazine page is type first: the picture shares it with a headline, a
   * deck and a column of copy. Every picture came back edge-to-edge and busy,
   * so there was nowhere on the page a line could be set — which is what
   * "the images are messy and no text is writable" means in practice.
   */
  const space = input.treatment && !FULL_PAGE.has(input.treatment)
    ? "generous quiet space for type, uncluttered composition"
    : "";
  // Name the ground in the prompt itself, so what is drawn is what is keyed.
  const ground = input.ground && input.treatment && KEYED.has(input.treatment)
    ? `on a solid ${groundWords(input.ground)} background, no scenery, no shadow`
    : "";
  // The world's own avoid-list may not ban the surface this picture is drawn as.
  const keep = surface ? SURFACE_KEEPS[surface] : undefined;
  const worldNegative = keep
    ? (world.negative ?? "").split(",").map((t) => t.trim()).filter((t) => t && !keep.test(t)).join(", ")
    : world.negative ?? "";
  // Lettering in a generated picture is always wrong and always has to be
  // covered by the layout, so it is refused in every negative.
  const houseNegative = "text, lettering, words, captions, watermark, signature";

  return {
    /*
     * The style leads, and the scene is kept short.
     *
     * The world paragraph ran to 120 words of atmosphere and the brief to 90
     * of staging, so "flat vector illustration" sat in the middle of 230 words
     * of photographic description and counted for nothing. What kind of
     * picture this is goes first; the subject is trimmed to what it is of.
     */
    prompt: [technique, firstWords(worldText, 35), firstWords(subject, 55), ...cast, treatment, ground, space, props.join(", ")]
      .filter(Boolean).join(", "),
    negative: mergeList([input.negative ?? "", policyNegative, worldNegative, houseNegative]),
    components: {
      subject,
      world: worldText,
      technique,
      treatment,
      props,
      briefNegative: input.negative ?? "",
      policyNegative,
      worldNegative,
      surface,
      realism: policy?.realism ?? null,
      cast,
    },
  };
}

/** A generated world as stored in `design/world.json`. */
export interface StoredWorld extends ImageWorld {
  readonly technique: string;
  readonly idiom: string;
  readonly paper?: string;
  readonly ink?: string;
  readonly hue?: string;
  readonly mood?: ReadonlyArray<string>;
  readonly at: string;
}

/**
 * The prompt that chooses one world for a work (08 §2, `design.system`).
 *
 * Read from the approved text, not a synopsis: the world is how every picture
 * in this work looks, and the pictures are of this text.
 */
export function buildWorldPrompt(input: {
  readonly type: string;
  readonly label: string;
  readonly excerpt: string;
  readonly voice?: string;
  /** A re-world: what the person said about the world they did not keep. */
  readonly note?: string;
  readonly previous?: string;
}): string {
  const policy = artPolicyOf(input.type);
  const pool = TECHNIQUE_POOLS[policy?.techniques ?? "narrative"];
  return [
    `Choose ONE design world for this ${input.label.toLowerCase()}: how every picture in it looks.`,
    input.previous ? `The last world was "${input.previous}" and it was not kept — choose a different one.` : "",
    input.note ? `What the person said about it: ${input.note}` : "",
    `Pictures here are ${(policy?.surfaces ?? ["illustration"]).join(" / ")} only.`,
    policy?.realism === "forbidden"
      ? "It is illustrated, never photographed: nothing photographic, no 3D render."
      : "",
    `technique must be exactly one of: ${pool.join(", ")}.`,
    input.voice ? `The prose is written in the voice of ${input.voice}.` : "",
    "",
    "Return JSON only:",
    '{"technique":"...","idiom":"a named visual idiom","paper":"#rrggbb","ink":"#rrggbb","hue":"#rrggbb",'
      + '"imagePrompt":"under 60 words: medium, palette, light, mood — no single subject, no names",'
      + '"negative":"what this world\'s pictures must avoid","props":["2-5 recurring objects from the text"],'
      + '"mood":["three","mood","words"]}',
    "",
    "THE WORK:",
    input.excerpt.slice(0, 8000),
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

/** A model's world, checked and trimmed before anything renders from it. */
export function parseWorld(type: string, out: Record<string, unknown>, at = new Date().toISOString()): StoredWorld {
  const policy = artPolicyOf(type);
  const pool: ReadonlyArray<string> = TECHNIQUE_POOLS[policy?.techniques ?? "narrative"];
  const technique = String(out.technique ?? "").trim().toLowerCase();
  if (!pool.includes(technique)) {
    throw new Error(`"${technique || "(none)"}" is not a technique this work may use — one of: ${pool.join(", ")}`);
  }
  const hex = (v: unknown) => (/^#[0-9a-f]{6}$/i.test(String(v ?? "")) ? String(v) : undefined);
  const words = scrub(String(out.imagePrompt ?? ""), policy?.realism === "forbidden").split(/\s+/);
  const list = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);
  const paper = hex(out.paper);
  const ink = hex(out.ink);
  const hue = hex(out.hue);
  return {
    technique,
    idiom: String(out.idiom ?? "").trim(),
    imagePrompt: words.slice(0, 60).join(" "),
    negative: String(out.negative ?? "").trim(),
    props: list(out.props, 6),
    mood: list(out.mood, 5),
    ...(paper ? { paper } : {}),
    ...(ink ? { ink } : {}),
    ...(hue ? { hue } : {}),
    at,
  };
}

/** Where a creation's files live, relative to the workspace. */
export function workDirOf(type: string, id: string): string {
  const spec = PRODUCTIONS.find((p) => p.id === type);
  if (!spec) throw new Error(`Unknown production type: ${type}`);
  // The magazine keeps its issues one level below its out dir (`refFromPath`).
  return type === "publication" ? join(spec.outDir, "issues", id) : join(spec.outDir, id);
}

/** A work's one world, for every type whose world is per work (08 §2). */
export function worldPathOf(type: string, id: string): string {
  return join(workDirOf(type, id), "design", "world.json");
}

export async function readWorld(projectRoot: string, type: string, id: string): Promise<ImageWorld | null> {
  try {
    return JSON.parse(await readFile(safeChildPath(projectRoot, worldPathOf(type, id)), "utf-8")) as ImageWorld;
  } catch {
    return null;
  }
}
