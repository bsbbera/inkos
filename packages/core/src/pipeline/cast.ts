/**
 * The same character on every page (08 §9).
 *
 * The visible failure of every generated picture book is that the fox's scarf
 * changes colour between spreads. A Cast Sheet is the fix at the one place it
 * can be fixed: each recurring character is described once, in visible terms,
 * kept in the work's design folder, and that description rides along with
 * every brief the character appears in. A chosen reference picture sits beside
 * it — for the Cast card, and for reference conditioning once the render seam
 * has a workflow that can take one.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeChildPath } from "../utils/path-safety.js";
import { workDirOf } from "./image-prompt.js";

export interface CastSheet {
  readonly id: string;
  readonly name: string;
  readonly species?: string;
  readonly age?: string;
  readonly wardrobe: ReadonlyArray<string>;
  readonly palette: ReadonlyArray<string>;
  readonly traits: ReadonlyArray<string>;
  /** The approved reference picture, workspace-relative. */
  readonly chosen?: string | null;
  readonly approvedAt?: string | null;
  /** Bumped whenever the sheet changes, so a recipe can say which one it drew from. */
  readonly version: number;
  readonly at: string;
}

export function castDirOf(type: string, id: string): string {
  return join(workDirOf(type, id), "design", "cast");
}

export function slugOf(name: string): string {
  return name.normalize("NFKD").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "character";
}

/** Ask a model who recurs, and what they look like — nothing else. */
export function buildCastPrompt(input: {
  readonly label: string;
  readonly excerpt: string;
  readonly known?: ReadonlyArray<string>;
}): string {
  return [
    `List the recurring characters of this ${input.label.toLowerCase()} as an illustrator needs them:`
      + " what they look like, so every picture draws the same one.",
    "Only characters who appear in more than one place. Only what can be seen — no personality, no plot.",
    "Use only what the text says or plainly implies; leave a field empty rather than invent.",
    input.known?.length ? `The work's own cast files name: ${input.known.join(", ")}.` : "",
    "",
    "Return JSON only:",
    '{"characters":[{"name":"...","species":"human | fox | …","age":"child | about 40 | …",'
      + '"wardrobe":["what they wear"],"palette":["colour words or #rrggbb"],'
      + '"traits":["visible traits: build, face, hair or fur, marks"]}]}',
    "At most 6 characters. An empty list is a fine answer for a work with no recurring cast.",
    "",
    "THE WORK:",
    input.excerpt.slice(0, 12_000),
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
}

export function parseCast(out: Record<string, unknown>, at = new Date().toISOString()): CastSheet[] {
  const list = Array.isArray(out.characters) ? out.characters : [];
  const trim = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);
  const seen = new Set<string>();
  const sheets: CastSheet[] = [];
  for (const raw of list.slice(0, 6)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    const id = slugOf(name);
    if (!name || seen.has(id)) continue;
    seen.add(id);
    const species = String(r.species ?? "").trim();
    const age = String(r.age ?? "").trim();
    sheets.push({
      id,
      name,
      ...(species ? { species } : {}),
      ...(age ? { age } : {}),
      wardrobe: trim(r.wardrobe, 4),
      palette: trim(r.palette, 4),
      traits: trim(r.traits, 6),
      chosen: null,
      approvedAt: null,
      version: 1,
      at,
    });
  }
  return sheets;
}

export async function readCast(root: string, type: string, id: string): Promise<CastSheet[]> {
  const dir = castDirOf(type, id);
  let names: string[];
  try {
    names = await readdir(safeChildPath(root, dir));
  } catch {
    return [];
  }
  const out: CastSheet[] = [];
  for (const name of names.sort()) {
    try {
      out.push(JSON.parse(await readFile(safeChildPath(root, join(dir, name, "sheet.json")), "utf-8")) as CastSheet);
    } catch { /* a folder without a sheet is a half-made one; skip it */ }
  }
  return out;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Who is in this text: a full name, or its first word, as a whole word. */
export function castIn(text: string, cast: ReadonlyArray<CastSheet>): CastSheet[] {
  return cast.filter((c) => {
    const names = [c.name, c.name.split(/\s+/)[0] ?? ""].filter((n) => n.length >= 2);
    return names.some((n) => new RegExp(`(^|[^\\p{L}])${escapeRegex(n)}($|[^\\p{L}])`, "iu").test(text));
  });
}

/** The line appended to a brief the character appears in. */
export function traitLine(sheet: CastSheet): string {
  const who = [sheet.age, sheet.species].filter(Boolean).join(" ");
  return [
    `${sheet.name}${who ? ` (${who})` : ""}`,
    sheet.traits.join(", "),
    sheet.wardrobe.length ? `wearing ${sheet.wardrobe.join(", ")}` : "",
    sheet.palette.length ? `colours ${sheet.palette.join(", ")}` : "",
  ].filter(Boolean).join(", ");
}

/** What a reference candidate is asked to show: the character, whole, and nothing else. */
export function sheetPrompt(sheet: CastSheet): string {
  return `character reference of ${traitLine(sheet)}, full figure, neutral standing pose, three-quarter view, whole body in frame`;
}
