/**
 * Where and when a work is set, as material rather than an adjective.
 *
 * The old answer was two fields on a book — `eraConstraints.period` and
 * `.region` — written by the Architect from memory and read by one audit
 * dimension. Nothing concrete ever reached the Writer, so a story set in
 * Calcutta in 1943 got the year and then invented the century from training
 * averages: the exact generic texture the destyle pass then tried to scrub
 * off. Research in, slop out is the cheaper order (22 §Problem).
 *
 * This file owns the artefact — one folder per work, the same shape for every
 * production type — and the two pure operations over it that everything else
 * needs: turning a bible into a per-unit Setting Card, and turning a lexicon
 * into a list of words that must not appear.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { workDirOf } from "./image-prompt.js";

export const SETTINGS_DIR = "settings";
export const SERIES_DIR = "series";

/** How hard the audit bites when the text contradicts the research. */
export type Fidelity = "strict" | "flavour" | "loose";

/** What kind of world this is, which decides whether research is possible. */
export type SettingKind = "historical" | "contemporary" | "speculative" | "secondary-world";

export interface SettingPlace {
  readonly name: string;
  /** What it was called then, when that differs — "Calcutta" for Kolkata. */
  readonly then?: string;
  readonly country?: string;
  readonly scale?: string;
}

export interface SettingTime {
  readonly from?: string;
  readonly to?: string;
  readonly label?: string;
}

export interface SettingLens {
  readonly class?: string;
  readonly community?: string;
  readonly language?: string;
}

export interface Setting {
  readonly version: number;
  readonly enabled: boolean;
  readonly kind: SettingKind;
  readonly place: SettingPlace;
  readonly time: SettingTime;
  readonly lens?: SettingLens;
  readonly speech?: { readonly register?: string; readonly dialectNotes?: ReadonlyArray<string> };
  readonly fidelity: Fidelity;
  /** The library entry this was cloned from, when it was. */
  readonly reuseOf?: string | null;
  readonly researchedAt?: string | null;
  readonly at: string;
}

export interface LexiconPrefer {
  readonly term: string;
  readonly for?: string;
  readonly gloss?: string;
}

export interface LexiconForbidden {
  readonly term: string;
  readonly reason: string;
}

export interface Lexicon {
  readonly prefer: ReadonlyArray<LexiconPrefer>;
  readonly forbidden: ReadonlyArray<LexiconForbidden>;
  readonly addressForms: ReadonlyArray<{ readonly speaker: string; readonly to: string; readonly form: string }>;
  readonly currency?: { readonly unit?: string; readonly sub?: string };
}

export interface SourceRecord {
  readonly url: string;
  readonly title?: string;
  readonly section?: string;
  readonly at: string;
}

/** The fixed headings of `bible.md`, so a slice can be retrieved by name. */
export const BIBLE_SECTIONS = [
  "Daily life & objects",
  "Money, prices & work",
  "Speech & register",
  "Social norms & institutions",
  "Technology & media",
  "Place & senses",
  "Calendar",
  "Anachronism blacklist",
  "Open questions",
] as const;

export type BibleSection = (typeof BIBLE_SECTIONS)[number];

export const settingDirOf = (type: string, id: string): string => join(workDirOf(type, id), "setting");
export const settingPathOf = (type: string, id: string): string => join(settingDirOf(type, id), "setting.json");
export const biblePathOf = (type: string, id: string): string => join(settingDirOf(type, id), "bible.md");
export const lexiconPathOf = (type: string, id: string): string => join(settingDirOf(type, id), "lexicon.json");
export const sourcesPathOf = (type: string, id: string): string => join(settingDirOf(type, id), "sources.jsonl");
export const cardPathOf = (type: string, id: string, unit: number): string =>
  join(settingDirOf(type, id), "cards", `${unit}.md`);
/** Where the ask-once answer is remembered, so nothing asks twice (22 §2 Door B). */
export const askPathOf = (type: string, id: string): string => join(settingDirOf(type, id), "ask.json");

const readJson = async <T>(file: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(file, "utf-8")) as T; } catch { return null; }
};

export async function readSetting(root: string, type: string, id: string): Promise<Setting | null> {
  return await readJson<Setting>(join(root, settingPathOf(type, id)));
}

export async function writeSetting(root: string, type: string, id: string, setting: Setting): Promise<void> {
  const file = join(root, settingPathOf(type, id));
  await mkdir(join(root, settingDirOf(type, id)), { recursive: true });
  await writeFile(file, `${JSON.stringify(setting, null, 2)}\n`, "utf-8");
}

export async function readLexicon(root: string, type: string, id: string): Promise<Lexicon | null> {
  return await readJson<Lexicon>(join(root, lexiconPathOf(type, id)));
}

/**
 * The same three files, addressed by the work's own folder.
 *
 * Agents are handed a directory, not a production type and id — the Writer
 * knows `books/x`, not that `books` is what `workDirOf("book", …)` returns —
 * and threading the type through every agent to reach a folder they already
 * hold would be plumbing for its own sake.
 */
export async function settingIn(workDir: string): Promise<{
  setting: Setting | null; bible: string; lexicon: Lexicon | null;
}> {
  const dir = join(workDir, "setting");
  const setting = await readJson<Setting>(join(dir, "setting.json"));
  if (!setting?.enabled) return { setting, bible: "", lexicon: null };
  let bible = "";
  try { bible = await readFile(join(dir, "bible.md"), "utf-8"); } catch { bible = ""; }
  return { setting, bible, lexicon: await readJson<Lexicon>(join(dir, "lexicon.json")) };
}

/** The card for one unit, straight from the work's folder. Empty when unset. */
export async function settingCardIn(workDir: string, plan: string): Promise<string> {
  const { setting, bible, lexicon } = await settingIn(workDir);
  if (!setting?.enabled || !bible.trim()) return "";
  return buildSettingCard({ setting, bible, lexicon, plan });
}

export async function readBible(root: string, type: string, id: string): Promise<string> {
  try { return await readFile(join(root, biblePathOf(type, id)), "utf-8"); } catch { return ""; }
}

/**
 * Pin a setting from whatever the person typed.
 *
 * Free text is the input everywhere — a creation form, a chat answer, a
 * clarification card — so normalising it here means only one place has to know
 * that "Calcutta, 1943" is a place and a year.
 */
export function makeSetting(input: {
  readonly place?: string;
  readonly then?: string;
  readonly country?: string;
  readonly time?: string;
  readonly from?: string;
  readonly to?: string;
  readonly kind?: string;
  readonly fidelity?: string;
  readonly lens?: SettingLens;
  readonly reuseOf?: string | null;
  readonly enabled?: boolean;
  readonly at?: string;
}): Setting {
  const label = String(input.time ?? "").trim();
  const years = label.match(/\d{3,4}/g) ?? [];
  const kind = (["historical", "contemporary", "speculative", "secondary-world"] as const)
    .find((k) => k === input.kind) ?? kindFromYears(years);
  return {
    version: 1,
    enabled: input.enabled !== false,
    kind,
    place: {
      name: String(input.place ?? "").trim(),
      ...(input.then ? { then: String(input.then).trim() } : {}),
      ...(input.country ? { country: String(input.country).trim() } : {}),
    },
    time: {
      ...(input.from ? { from: String(input.from).trim() } : years[0] ? { from: years[0] } : {}),
      ...(input.to ? { to: String(input.to).trim() } : years[1] ? { to: years[1] } : {}),
      ...(label ? { label } : {}),
    },
    ...(input.lens ? { lens: input.lens } : {}),
    fidelity: (["strict", "flavour", "loose"] as const).find((f) => f === input.fidelity) ?? "flavour",
    reuseOf: input.reuseOf ?? null,
    researchedAt: null,
    at: input.at ?? new Date().toISOString(),
  };
}

/** A year in the past is history; no year at all is somewhere made up. */
function kindFromYears(years: ReadonlyArray<string>): SettingKind {
  if (!years.length) return "secondary-world";
  const year = Number(years[0]);
  const now = new Date().getUTCFullYear();
  if (year > now) return "speculative";
  return year < now - 25 ? "historical" : "contemporary";
}

/**
 * The old two-field era block, read as a setting.
 *
 * Existing books keep working without being migrated: whatever the Architect
 * wrote into `book_rules.md` is still the answer until someone pins a real
 * one. `enabled` deliberately does not carry over — that flag is set by the
 * mere presence of an "Era Constraints" heading, which is not the same thing
 * as a person choosing to research a world.
 */
export function settingFromEra(
  era: { readonly enabled?: boolean; readonly period?: string; readonly region?: string } | undefined | null,
): Setting | null {
  if (!era || (!era.period && !era.region)) return null;
  return makeSetting({
    ...(era.region ? { place: era.region } : {}),
    ...(era.period ? { time: era.period } : {}),
    fidelity: "flavour",
    enabled: false,
  });
}

/* ------------------------------------------------------------ bible slices */

/** Split `bible.md` into its fixed sections, keyed by heading. */
export function bibleSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = String(markdown ?? "").split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const cut = part.indexOf("\n");
    const heading = (cut < 0 ? part : part.slice(0, cut)).trim().replace(/^\d+\.\s*/, "");
    const body = cut < 0 ? "" : part.slice(cut + 1).trim();
    if (heading) out[heading] = body;
  }
  return out;
}

/** Every line of a section, as bullets without their markers. */
const bulletsOf = (body: string): ReadonlyArray<string> =>
  String(body ?? "").split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

/**
 * The Setting Card: what this one unit needs, not the whole bible.
 *
 * A researched bible runs 5–15k tokens and would drown the chapter plan, so
 * the card is a retrieval problem rather than a summarisation one — the plan's
 * own words decide which lines come along. Keeping it deterministic means the
 * same chapter always gets the same card, which is what makes a drifting
 * chapter a real finding rather than a re-roll (22 §4).
 */
export function buildSettingCard(input: {
  readonly setting: Setting;
  readonly bible: string;
  readonly lexicon?: Lexicon | null;
  readonly plan?: string;
  readonly limit?: number;
}): string {
  const { setting, bible, lexicon } = input;
  const limit = input.limit ?? 600;
  const sections = bibleSections(bible);
  const keywords = new Set(
    String(input.plan ?? "").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)?.slice(0, 60) ?? [],
  );

  const score = (line: string): number => {
    const words = line.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
    return words.reduce((n, w) => n + (keywords.has(w) ? 1 : 0), 0);
  };
  const pick = (heading: string, count: number): ReadonlyArray<string> => {
    const lines = bulletsOf(sections[heading] ?? "");
    if (!keywords.size) return lines.slice(0, count);
    // Ties keep the bible's own order, so a card is stable between runs.
    return [...lines]
      .map((line, i) => ({ line, i, s: score(line) }))
      .sort((a, b) => (b.s - a.s) || (a.i - b.i))
      .slice(0, count)
      .map((x) => x.line);
  };

  const where = [setting.place.then || setting.place.name, setting.time.label || setting.time.from]
    .filter(Boolean).join(", ");
  const rows: string[] = [`SETTING CARD — ${where} · ${setting.fidelity}`];
  if (input.plan) rows.push(`Scene needs: ${input.plan.trim().replace(/\s+/g, " ").slice(0, 180)}`);

  const objects = pick("Daily life & objects", 8);
  if (objects.length) rows.push(`Objects: ${objects.join("; ")}`);
  const speech = pick("Speech & register", 4);
  if (speech.length) rows.push(`Speech: ${speech.join("; ")}`);
  const money = pick("Money, prices & work", 3);
  if (money.length) rows.push(`Money: ${money.join("; ")}`);
  const senses = pick("Place & senses", 4);
  if (senses.length) rows.push(`Senses: ${senses.join("; ")}`);
  const norms = pick("Social norms & institutions", 3);
  if (norms.length) rows.push(`Norms: ${norms.join("; ")}`);

  const address = (lexicon?.addressForms ?? []).slice(0, 4)
    .map((a) => `${a.speaker} → ${a.to}: "${a.form}"`);
  if (address.length) rows.push(`Address: ${address.join("; ")}`);
  const prefer = (lexicon?.prefer ?? []).slice(0, 8)
    .map((p) => (p.for ? `${p.term} (not ${p.for})` : p.gloss ? `${p.term} — ${p.gloss}` : p.term));
  if (prefer.length) rows.push(`Say: ${prefer.join("; ")}`);
  const forbidden = (lexicon?.forbidden ?? []).slice(0, 12).map((f) => f.term);
  if (forbidden.length) rows.push(`Do not: ${forbidden.join(", ")}`);

  // One card, one budget. Cutting whole lines rather than mid-sentence keeps
  // every surviving line usable.
  const out: string[] = [];
  let spend = 0;
  for (const row of rows) {
    const cost = Math.ceil(row.length / 4);
    if (out.length && spend + cost > limit) break;
    out.push(row);
    spend += cost;
  }
  return out.join("\n");
}

export async function writeSettingCard(
  root: string, type: string, id: string, unit: number, card: string,
): Promise<string> {
  const rel = cardPathOf(type, id, unit);
  await mkdir(join(root, settingDirOf(type, id), "cards"), { recursive: true });
  await writeFile(join(root, rel), `${card}\n`, "utf-8");
  return rel.replace(/\\/g, "/");
}

export async function readSettingCard(
  root: string, type: string, id: string, unit: number,
): Promise<string> {
  try { return await readFile(join(root, cardPathOf(type, id, unit)), "utf-8"); } catch { return ""; }
}

/* ----------------------------------------------------------------- library */

/** A researched world, reusable by every work set there (22 §2 Door C). */
export const libraryDirOf = (id: string): string => join(SETTINGS_DIR, id);

export function settingSlug(name: string): string {
  return String(name ?? "").toLowerCase().normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "setting";
}

export async function listLibrarySettings(root: string): Promise<ReadonlyArray<{ id: string; setting: Setting }>> {
  const dir = join(root, SETTINGS_DIR);
  if (!existsSync(dir)) return [];
  const out: Array<{ id: string; setting: Setting }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const setting = await readJson<Setting>(join(dir, entry.name, "setting.json"));
    if (setting) out.push({ id: entry.name, setting });
  }
  return out;
}

/**
 * Copy a library world into a work, or a work's world up into the library.
 *
 * Copy rather than reference, for the same reason the style library copies: a
 * work that has been written against a world must not change under it when
 * someone edits the library entry months later. `reuseOf` keeps the link for
 * anything that wants to roll improvements forward deliberately.
 */
export async function copySetting(input: {
  readonly fromDir: string;
  readonly toDir: string;
  readonly reuseOf?: string | null;
}): Promise<boolean> {
  const files = ["setting.json", "bible.md", "lexicon.json", "sources.jsonl"];
  if (!existsSync(join(input.fromDir, "setting.json"))) return false;
  await mkdir(input.toDir, { recursive: true });
  for (const file of files) {
    if (!existsSync(join(input.fromDir, file))) continue;
    const body = await readFile(join(input.fromDir, file), "utf-8");
    if (file === "setting.json" && input.reuseOf !== undefined) {
      const parsed = JSON.parse(body) as Setting;
      await writeFile(join(input.toDir, file),
        `${JSON.stringify({ ...parsed, reuseOf: input.reuseOf }, null, 2)}\n`, "utf-8");
      continue;
    }
    await writeFile(join(input.toDir, file), body, "utf-8");
  }
  return true;
}
