/**
 * Researching a world before writing in it.
 *
 * The Writer cannot invent 1943 Calcutta's tram fare, and asking it to try is
 * how a story gets its generic texture. So this runs first: a fixed set of
 * questions per bible section, real searches, and claims that are dropped
 * unless a source actually said them — the same discipline the magazine's
 * fact-checked research already uses, applied to setting instead of subject.
 *
 * What comes out is markdown a person can read and edit, plus one machine-
 * readable list — the lexicon — which is what makes the anachronism pass exact
 * and free (22 §3).
 */
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { searchAllSources, type SearchSource } from "../utils/search-sources.js";
import type { SearchResult } from "../utils/web-search.js";
import {
  BIBLE_SECTIONS, type Lexicon, type Setting,
  biblePathOf, lexiconPathOf, settingDirOf, sourcesPathOf,
} from "./setting.js";

export type AskJson = (prompt: string, label: string) => Promise<Record<string, unknown>>;

const RESULTS_PER_SOURCE = 4;

/** The questions each section is researched with, as query templates. */
const QUERIES: Record<string, ReadonlyArray<string>> = {
  "Daily life & objects": ["{where} {when} everyday objects household", "{where} {when} clothing transport street life"],
  "Money, prices & work": ["{where} {when} wages prices cost of living", "{where} {when} currency denominations"],
  "Speech & register": ["{where} {when} forms of address honorifics", "{where} {when} slang idioms speech"],
  "Social norms & institutions": ["{where} {when} social customs family religion", "{where} {when} law schooling class"],
  "Technology & media": ["{where} {when} technology newspapers radio", "{where} {when} what was new invented"],
  "Place & senses": ["{where} {when} neighbourhoods streets landmarks", "{where} {when} weather climate by month"],
  "Calendar": ["{where} {when} major events timeline", "{where} {when} festivals holidays"],
};

const fill = (template: string, where: string, when: string): string =>
  template.replace(/\{where\}/g, where).replace(/\{when\}/g, when);

/** What the model is asked to turn search results into, one section at a time. */
export function buildSectionPrompt(input: {
  readonly section: string;
  readonly where: string;
  readonly when: string;
  readonly results: ReadonlyArray<SearchResult>;
}): string {
  const sources = input.results
    .map((r, i) => `[${i + 1}] ${r.title || r.url}\n${r.url}\n${String(r.snippet ?? "").slice(0, 1200)}`)
    .join("\n\n");
  return [
    `You are writing one section of a setting bible for a story set in ${input.where}, ${input.when}.`,
    `Section: "${input.section}".`,
    "",
    "Write 6-12 short bullet lines of concrete, usable material — nouns a writer can put on the page,",
    "not adjectives. Every number, price or date must come from the sources below; anything you cannot",
    "source, leave out and list under `unknown` instead. Cite with [n] matching the sources.",
    "",
    "Answer as JSON only:",
    '{ "lines": ["…", "…"], "unknown": ["…"], "sources": [1, 2] }',
    "",
    "SOURCES",
    sources || "(none — say so in `unknown` rather than inventing material)",
  ].join("\n");
}

/**
 * The lexicon prompt: what to say, and what could not exist yet.
 *
 * Asked separately from the prose sections because its output is consumed by a
 * machine. A blacklist mixed into readable bullets would have to be parsed
 * back out of English, and would be wrong the first time someone wrote a line
 * with a comma in it.
 */
export function buildLexiconPrompt(input: {
  readonly where: string;
  readonly when: string;
  readonly bible: string;
}): string {
  return [
    `Story setting: ${input.where}, ${input.when}.`,
    "From the researched material below, write the word list a writer and a checker both need.",
    "",
    "`forbidden` is the important half: words, objects and attitudes that did NOT exist then or there,",
    "including modern generic English a careless writer would reach for. Each needs a one-line reason.",
    "Only list terms that would plausibly appear in prose — no rare technical words.",
    "",
    "Answer as JSON only:",
    '{ "prefer": [{"term":"tram","for":"streetcar"},{"term":"dada","gloss":"elder brother"}],',
    '  "forbidden": [{"term":"okay","reason":"Americanism, not in this speech"}],',
    '  "addressForms": [{"speaker":"child","to":"father","form":"Baba"}],',
    '  "currency": {"unit":"rupee","sub":"anna"} }',
    "",
    "MATERIAL",
    input.bible.slice(0, 12000),
  ].join("\n");
}

const asLines = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.map((v) => String(v ?? "").trim()).filter(Boolean) : [];

/** Model output → lexicon, with every field made safe to iterate. */
export function parseLexicon(out: Record<string, unknown>): Lexicon {
  const prefer = Array.isArray(out.prefer) ? out.prefer : [];
  const forbidden = Array.isArray(out.forbidden) ? out.forbidden : [];
  const addressForms = Array.isArray(out.addressForms) ? out.addressForms : [];
  const currency = (out.currency ?? {}) as { unit?: unknown; sub?: unknown };
  const seen = new Set<string>();
  return {
    prefer: prefer.slice(0, 60).map((p) => {
      const row = p as Record<string, unknown>;
      return {
        term: String(row.term ?? "").trim(),
        ...(row.for ? { for: String(row.for).trim() } : {}),
        ...(row.gloss ? { gloss: String(row.gloss).trim() } : {}),
      };
    }).filter((p) => p.term),
    forbidden: forbidden.slice(0, 80).map((f) => {
      const row = f as Record<string, unknown>;
      return { term: String(row.term ?? "").trim(), reason: String(row.reason ?? "").trim() || "not of this time or place" };
    }).filter((f) => {
      const key = f.term.toLowerCase();
      if (!f.term || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    addressForms: addressForms.slice(0, 20).map((a) => {
      const row = a as Record<string, unknown>;
      return { speaker: String(row.speaker ?? "").trim(), to: String(row.to ?? "").trim(), form: String(row.form ?? "").trim() };
    }).filter((a) => a.form),
    ...(currency.unit ? { currency: { unit: String(currency.unit), ...(currency.sub ? { sub: String(currency.sub) } : {}) } } : {}),
  };
}

export interface ResearchResult {
  readonly bible: string;
  readonly lexicon: Lexicon;
  readonly sources: number;
  readonly openQuestions: ReadonlyArray<string>;
  readonly artifacts: ReadonlyArray<string>;
}

/**
 * Research one world and write the folder.
 *
 * Sections are researched in order and written as they land, so an interrupted
 * run leaves a partial bible rather than nothing — the same reason the
 * publication research caches per pillar.
 */
export async function researchSetting(input: {
  readonly projectRoot: string;
  readonly type: string;
  readonly id: string;
  readonly setting: Setting;
  readonly ask: AskJson;
  readonly sources?: ReadonlyArray<SearchSource>;
  readonly onProgress?: (message: string) => void;
  readonly signal?: AbortSignal;
}): Promise<ResearchResult> {
  const { projectRoot, type, id, setting, ask } = input;
  const where = [setting.place.then || setting.place.name, setting.place.country].filter(Boolean).join(", ");
  const when = setting.time.label || [setting.time.from, setting.time.to].filter(Boolean).join("–") || "unspecified";
  const dir = join(projectRoot, settingDirOf(type, id));
  await mkdir(dir, { recursive: true });

  const sourcesFile = join(projectRoot, sourcesPathOf(type, id));
  const bibleFile = join(projectRoot, biblePathOf(type, id));
  const chapters: string[] = [`# Setting bible — ${where}, ${when}`, ""];
  const unknowns: string[] = [];
  let sourceCount = 0;

  const researchable = BIBLE_SECTIONS.filter((s) => QUERIES[s]);
  for (const [index, section] of researchable.entries()) {
    input.signal?.throwIfAborted();
    input.onProgress?.(`Researching ${section} (${index + 1}/${researchable.length})…`);

    const results: SearchResult[] = [];
    for (const template of QUERIES[section] ?? []) {
      const sweep = await searchAllSources(input.sources ?? [], fill(template, where, when), RESULTS_PER_SOURCE);
      for (const hit of sweep.results) {
        if (!results.some((r) => r.url === hit.url)) results.push(hit);
      }
    }

    const out = await ask(
      buildSectionPrompt({ section, where, when, results }),
      `setting-${section.toLowerCase().replace(/\W+/g, "-")}`,
    );
    const lines = asLines(out.lines);
    unknowns.push(...asLines(out.unknown));
    chapters.push(`## ${section}`, "", ...(lines.length ? lines.map((l) => `- ${l}`) : ["- (nothing sourced)"]), "");

    // Sources are appended as they are used, so a claim can always be traced
    // back even if a later section fails and the run stops here.
    const at = new Date().toISOString();
    for (const hit of results) {
      await appendFile(sourcesFile,
        `${JSON.stringify({ url: hit.url, title: hit.title ?? "", section, at })}\n`, "utf-8");
      sourceCount += 1;
    }
    await writeFile(bibleFile, `${chapters.join("\n")}\n`, "utf-8");
  }

  // The blacklist is derived from what was just written, not researched
  // separately: a forbidden list that disagrees with the bible beside it is
  // worse than none.
  input.onProgress?.("Building the word list…");
  const lexicon = parseLexicon(await ask(
    buildLexiconPrompt({ where, when, bible: chapters.join("\n") }),
    "setting-lexicon",
  ));
  chapters.push(
    "## Anachronism blacklist", "",
    ...(lexicon.forbidden.length
      ? lexicon.forbidden.map((f) => `- **${f.term}** — ${f.reason}`)
      : ["- (nothing listed)"]),
    "",
    "## Open questions", "",
    ...(unknowns.length ? unknowns.map((u) => `- ${u}`) : ["- (none)"]),
    "",
  );
  await writeFile(bibleFile, `${chapters.join("\n")}\n`, "utf-8");
  await writeFile(join(projectRoot, lexiconPathOf(type, id)),
    `${JSON.stringify(lexicon, null, 2)}\n`, "utf-8");

  const artifacts = [biblePathOf(type, id), lexiconPathOf(type, id)];
  if (existsSync(sourcesFile)) artifacts.push(sourcesPathOf(type, id));
  return {
    bible: chapters.join("\n"),
    lexicon,
    sources: sourceCount,
    openQuestions: unknowns,
    artifacts: artifacts.map((a) => a.replace(/\\/g, "/")),
  };
}

/* ------------------------------------------------------- ask once, up front */

export interface SettingGuess {
  readonly place?: string;
  readonly time?: string;
  readonly confidence: number;
}

/** What the intake text looks like it is set in, if anything (22 §2 Door B). */
export function buildDetectPrompt(text: string): string {
  return [
    "Read the story brief below. Is it set in a REAL place and time a researcher could look up?",
    "A made-up world, a fantasy kingdom or a cultivation realm is not — answer confidence 0 for those.",
    "",
    'Answer as JSON only: { "place": "Calcutta", "time": "1943", "confidence": 0.0 }',
    "",
    "BRIEF",
    String(text ?? "").slice(0, 4000),
  ].join("\n");
}

export function parseGuess(out: Record<string, unknown>): SettingGuess {
  const confidence = Number(out.confidence);
  return {
    ...(out.place ? { place: String(out.place).trim() } : {}),
    ...(out.time ? { time: String(out.time).trim() } : {}),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  };
}

/** Whatever the work's own text says about itself, for the detector to read. */
export async function intakeTextOf(projectRoot: string, type: string, id: string, workDir: string): Promise<string> {
  const candidates = [
    join(workDir, "outline", "v001.md"),
    join(workDir, "story", "story_frame.md"),
    join(workDir, "brief.md"),
    join(workDir, "publication.json"),
  ];
  for (const file of candidates) {
    const absolute = join(projectRoot, file);
    if (!existsSync(absolute)) continue;
    try { return (await readFile(absolute, "utf-8")).slice(0, 6000); } catch { /* next */ }
  }
  return "";
}
