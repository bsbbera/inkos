/**
 * Voices, kept by name, so one can be studied once and given to anything.
 *
 * A voice used to exist only as a side effect of importing it: paste a sample
 * at a short story and `style_guide.md` appeared inside that story's folder.
 * Nothing held the voice itself. Two consequences, both of which people hit
 * immediately. Giving the same voice to a second piece of work meant finding
 * the original passage and pasting it again, and the two extractions were not
 * the same voice - the model is asked afresh each time. And nothing could
 * name it: the only label on record was `sourceName` on the fingerprint,
 * which is a note about where the sample came from, typed once, never shown
 * back, and wrong the moment the voice was refined.
 *
 * So the library. A voice is a folder under `styles/` with the guide, the
 * fingerprint, and a name the person chose. Works receive a copy plus a note
 * saying which voice it was, which is the thing the audit screen reads when it
 * says a chapter is "in Mercer's voice".
 *
 * A copy rather than a reference on purpose. A work's guide is part of the
 * work: editing the library voice next month must not silently change what
 * fourteen already-restyled chapters claim to be written in.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StyleProfile } from "../models/style-profile.js";

/** Where the library lives, relative to the workspace. */
export const STYLES_DIR = "styles";

/** What a work keeps beside its guide to say which voice it was given. */
export const STYLE_MARK = "style.json";

export interface StyleMeta {
  /** Folder name. Derived from the name, stable once created. */
  readonly id: string;
  /** What the person called this voice. The only label any screen shows. */
  readonly name: string;
  /** Where the sample came from, if they said. A note, not an identity. */
  readonly sourceName?: string;
  readonly language: "zh" | "en";
  readonly createdAt: string;
  readonly sampleChars: number;
  /** True when the guide is the fingerprint alone - no model extraction. */
  readonly deterministic: boolean;
}

/** What a work records when a voice is given to it. */
export interface StyleMark {
  readonly id: string;
  readonly name: string;
  readonly appliedAt: string;
}

/**
 * A folder name from a name a person typed.
 *
 * Deliberately lossy and deliberately not unique-ified with a number: two
 * voices called the same thing are the same voice being re-imported, and
 * replacing it is what somebody who typed the same name again meant.
 */
export function styleSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `voice-${Date.now()}`;
}

function styleDir(root: string, id: string): string {
  return join(root, STYLES_DIR, id);
}

export async function listStyles(root: string): Promise<ReadonlyArray<StyleMeta>> {
  const entries = await readdir(join(root, STYLES_DIR), { withFileTypes: true }).catch(() => []);
  const out: StyleMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const meta = await readStyleMeta(root, entry.name);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readStyleMeta(root: string, id: string): Promise<StyleMeta | null> {
  const raw = await readFile(join(styleDir(root, id), STYLE_MARK), "utf-8").catch(() => null);
  if (raw === null) return null;
  try {
    const meta = JSON.parse(raw) as StyleMeta;
    return meta && typeof meta.name === "string" ? { ...meta, id } : null;
  } catch {
    return null;
  }
}

/**
 * Put a studied voice in the library.
 *
 * The guide and the fingerprint are handed in already made - `writeStyleGuide`
 * owns extraction and this owns keeping it, so the library gains nothing that
 * can drift from what a work receives.
 */
export async function saveStyle(input: {
  readonly root: string;
  readonly name: string;
  readonly guide: string;
  readonly profile: StyleProfile;
  readonly language: "zh" | "en";
  readonly sampleChars: number;
  readonly deterministic: boolean;
  readonly sourceName?: string;
}): Promise<StyleMeta> {
  const id = styleSlug(input.name);
  const dir = styleDir(input.root, id);
  await mkdir(dir, { recursive: true });

  const meta: StyleMeta = {
    id,
    name: input.name.trim(),
    ...(input.sourceName ? { sourceName: input.sourceName } : {}),
    language: input.language,
    createdAt: new Date().toISOString(),
    sampleChars: input.sampleChars,
    deterministic: input.deterministic,
  };

  await writeFile(join(dir, "style_guide.md"), input.guide, "utf-8");
  await writeFile(join(dir, "style_profile.json"), JSON.stringify(input.profile, null, 2), "utf-8");
  await writeFile(join(dir, STYLE_MARK), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  return meta;
}

export async function deleteStyle(root: string, id: string): Promise<boolean> {
  const meta = await readStyleMeta(root, id);
  if (!meta) return false;
  await rm(styleDir(root, id), { recursive: true, force: true });
  return true;
}

/**
 * Give a library voice to a piece of work.
 *
 * `dir` is where that kind of work keeps its rule stack, which the caller
 * knows and this does not. The work gets its own copy of both files plus the
 * mark naming the voice, so every screen downstream can say whose hand the
 * prose is in without reading the library at all.
 */
export async function applyStyleTo(input: {
  readonly root: string;
  readonly id: string;
  readonly dir: string;
}): Promise<StyleMeta | null> {
  const meta = await readStyleMeta(input.root, input.id);
  if (!meta) return null;
  const from = styleDir(input.root, input.id);

  const guide = await readFile(join(from, "style_guide.md"), "utf-8").catch(() => null);
  if (guide === null) return null;
  const profile = await readFile(join(from, "style_profile.json"), "utf-8").catch(() => null);

  await mkdir(input.dir, { recursive: true });
  await writeFile(join(input.dir, "style_guide.md"), guide, "utf-8");
  if (profile !== null) {
    await writeFile(join(input.dir, "style_profile.json"), profile, "utf-8");
  }
  const mark: StyleMark = { id: meta.id, name: meta.name, appliedAt: new Date().toISOString() };
  await writeFile(join(input.dir, STYLE_MARK), `${JSON.stringify(mark, null, 2)}\n`, "utf-8");
  return meta;
}

/**
 * What to call the voice a work is carrying.
 *
 * The mark first, because it is the name somebody chose. `sourceName` on the
 * fingerprint is the fallback for work given a voice before the library
 * existed - it is where the sample came from, which is usually close enough to
 * be worth showing rather than showing nothing.
 */
export async function voiceNameFor(dir: string): Promise<string | undefined> {
  const mark = await readFile(join(dir, STYLE_MARK), "utf-8")
    .then((raw) => (JSON.parse(raw) as StyleMark).name)
    .catch(() => undefined);
  if (mark) return mark;
  return await readFile(join(dir, "style_profile.json"), "utf-8")
    .then((raw) => (JSON.parse(raw) as { sourceName?: string }).sourceName)
    .catch(() => undefined);
}
