/**
 * The ArtDirector decides what is drawn; the world decides how (08 §4).
 *
 * The art plan for a book was a passthrough: every chapter got the same cover
 * prompt, so a ten-chapter book asked for ten covers. This reads the unit's own
 * approved text and answers with briefs in the contract every render path
 * understands — surface, slot, treatment, a subject a reader could point to —
 * or with none, which for most chapters of a book is the right answer.
 */
import { artPolicyOf, type Surface } from "../productions/registry.js";
import { castIn, type CastSheet } from "./cast.js";
import type { ArtBrief } from "./executors.js";
import { keyOf } from "./kit.js";
import { KIT_SLOTS, rollTreatment, TREATMENTS_BY_SLOT } from "./treatments.js";

const SENSING: Readonly<Record<string, string>> = {
  book: "Read the chapter. At most one picture, and many chapters get none — restraint is the design."
    + " An opener when a new place or person enters; a tailpiece when the chapter ends on a beat you could"
    + " draw; a plate only for a set-piece.",
  short: "Read the story. At most one picture besides its cover: an opener where the story turns, or a"
    + " tailpiece on its last image. None is a good answer.",
  "interactive-film": "One picture for this node: the moment a player would remember.",
};

export const ASPECT_SIZE: Readonly<Record<string, readonly [number, number]>> = {
  "3:2": [1344, 896],
  "2:3": [896, 1344],
  "1:1": [1024, 1024],
  "16:9": [1344, 768],
};

export function buildArtDirectorPrompt(input: {
  readonly type: string;
  readonly label: string;
  readonly unit: number;
  readonly text: string;
  readonly previous?: ReadonlyArray<string | undefined>;
  readonly cast?: ReadonlyArray<CastSheet>;
  /** The researched world, when the work has one (22 §4). */
  readonly setting?: { readonly where: string; readonly when: string; readonly props: ReadonlyArray<string> } | null;
  /** Rules this person accepted from their verdicts on pictures (18 §4). */
  readonly rules?: ReadonlyArray<string>;
}): string {
  const policy = artPolicyOf(input.type);
  const slots = (policy?.slots ?? []).filter((s) => s !== "cover");
  const last = input.previous?.find(Boolean);
  const setting = input.setting;
  return [
    `You are the art director of this ${input.label.toLowerCase()}. Decide what, if anything, is drawn for unit ${input.unit}.`,
    "The design world already decides how every picture looks; you decide what is shown and where it sits.",
    SENSING[input.type] ?? "At most one picture, and only where the text earns it.",
    `Slots and how each may sit: ${slots.map((s) => `${s}: ${(TREATMENTS_BY_SLOT[s] ?? []).join(" | ")}`).join("; ")}.`,
    `At most ${policy?.imagesPerUnit.max ?? 1} picture${(policy?.imagesPerUnit.max ?? 1) === 1 ? "" : "s"}.`,
    last ? `The unit before was treated "${last}" — do not repeat it.` : "",
    input.cast?.length ? `Recurring characters: ${input.cast.map((c) => c.name).join(", ")}. Name any who are in the picture.` : "",
    // The century a picture shows is decided here or not at all: a costume or
    // a telephone from the wrong decade survives every later stage.
    setting ? `This is set in ${setting.where}, ${setting.when}. Everything shown — clothes, objects, transport, signage — must belong there.` : "",
    setting?.props.length ? `Objects of this world you may draw: ${setting.props.slice(0, 12).join(", ")}.` : "",
    input.rules?.length ? `House rules from this person's own verdicts:\n${input.rules.map((r) => `- ${r}`).join("\n")}` : "",
    "subject is ONE sentence a reader could point to in the text: the beat, an action, a face — never a mood;"
      + " mood belongs to the world. No real people, no words in the picture.",
    "For a tailpiece or margin give subjectKey: two or three words naming the object, so it is drawn once and reused.",
    "",
    "Return JSON only:",
    '{"images":[{"slot":"...","treatment":"...","subject":"...","subjectKey":"","characters":["name"],'
      + '"aspect":"3:2 | 2:3 | 1:1 | 16:9","reason":"why here, why this"}],"reason":"when images is empty, why"}',
    "",
    "THE TEXT:",
    input.text.slice(0, 14_000),
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

/**
 * A model's direction, held to the type's policy: slots it may use, treatments
 * each slot may take, the per-unit cap. A treatment it asked for that breaks
 * the rules (or repeats the last unit) is replaced by the seeded roll.
 */
export function parseArtDirection(input: {
  readonly type: string;
  readonly id: string;
  readonly unit: number;
  readonly source: string;
  readonly out: Record<string, unknown>;
  readonly cast?: ReadonlyArray<CastSheet>;
  readonly previous?: ReadonlyArray<string | undefined>;
}): { readonly briefs: ReadonlyArray<ArtBrief>; readonly reason: string } {
  const policy = artPolicyOf(input.type);
  const allowed = new Set((policy?.slots ?? []).filter((s) => s !== "cover"));
  const max = policy?.imagesPerUnit.max ?? 1;
  const surface: Surface = policy?.surfaces[0] ?? "illustration";
  const raw = Array.isArray(input.out.images) ? input.out.images : [];
  const briefs: ArtBrief[] = [];

  for (const [k, item] of raw.entries()) {
    if (briefs.length >= max) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const slot = String(r.slot ?? "").trim().toLowerCase();
    const subject = String(r.subject ?? "").trim();
    if (!allowed.has(slot) || !subject) continue;

    const options = TREATMENTS_BY_SLOT[slot] ?? ["full-bleed"];
    const asked = String(r.treatment ?? "").trim().toLowerCase();
    const treatment = options.includes(asked) && asked !== input.previous?.[0]
      ? asked
      : rollTreatment({
        type: input.type, id: input.id, unit: input.unit, slot, k,
        candidates: options, ...(input.previous ? { previous: input.previous } : {}),
      });
    const small = slot === "tailpiece" || slot === "margin" || slot === "texture";
    const [width, height] = ASPECT_SIZE[String(r.aspect ?? "")] ?? ASPECT_SIZE[small ? "1:1" : "3:2"]!;
    const named = Array.isArray(r.characters) ? r.characters.map(String).join(" ") : "";
    const characters = castIn(`${named} ${subject}`, input.cast ?? []).map((c) => c.id);
    const key = KIT_SLOTS.includes(slot) ? keyOf(String(r.subjectKey || subject)) : "";
    const reason = String(r.reason ?? "").trim();

    briefs.push({
      slot,
      unit: input.unit,
      subject,
      prompt: subject,
      negative: "",
      width,
      height,
      workflow: "default",
      source: input.source,
      surface,
      treatment,
      ...(key ? { subjectKey: key } : {}),
      ...(characters.length ? { characters } : {}),
      ...(reason ? { reason } : {}),
    });
  }
  return { briefs, reason: String(input.out.reason ?? "").trim() };
}
