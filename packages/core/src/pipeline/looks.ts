/*
 * Looks: the aesthetics an issue is designed to, chosen per issue, never imposed.
 *
 * Quire held every page of every work to one "minimal editorial standard"
 * (skill §16, the eye's prompt, the composition check, the planner's ranking
 * and the newest reference set the eye was shown), because the editor once
 * asked for that look on Rain. So a colourful magazine was sent back for its
 * coloured panels and its cut-out birds. A look is now a folder of the editor's
 * reference pages in the shared taste folder, `_taste/references/<look>/`, with
 * an optional STANDARD.md (what its best pages share, read by the design stage
 * and the eye) and look.json (the numbers the planner and the checks hold).
 * The issue names its look; an issue with none is judged by its own direction.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Look {
  readonly name: string;
  /** What the look's best pages share, in the editor's words; empty when not written. */
  readonly standard: string;
  /** Most of pull, figure and panel a page carries beside its body; null for no limit. */
  readonly extras: number | null;
  /** Pictures stand on drawn shapes and type on coloured grounds (layered colour). */
  readonly layers: boolean;
  readonly images: readonly string[];
}

/** What the issue keeps of its chosen look: its name and the numbers the checks read. */
export interface IssueLook {
  readonly name: string;
  readonly extras?: number | null;
  readonly layers?: boolean;
}

const base = (root: string) => join(root, "_taste", "references");

export async function lookOf(root: string, name?: string | null): Promise<Look | null> {
  if (!name || /[\\/]|\.\./.test(name)) return null;
  const dir = join(base(root), name);
  if (!existsSync(dir)) return null;
  const files = await readdir(dir).catch(() => [] as string[]);
  const standard = (await readFile(join(dir, "STANDARD.md"), "utf-8").catch(() => "")).trim();
  const raw = await readFile(join(dir, "look.json"), "utf-8").then((t) => JSON.parse(t) as Record<string, unknown>).catch(() => ({} as Record<string, unknown>));
  return {
    name,
    standard,
    extras: typeof raw.extras === "number" ? raw.extras : null,
    layers: raw.layers === true,
    images: files.filter((f) => /\.(jpe?g|png)$/i.test(f)).sort().map((f) => join(dir, f)),
  };
}

export async function listLooks(root: string): Promise<Look[]> {
  const dirs = (await readdir(base(root), { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory());
  return (await Promise.all(dirs.map((d) => lookOf(root, d.name)))).filter((l): l is Look => !!l);
}

/** The look as the issue keeps it. */
export const issueLook = (l: Look): IssueLook => ({ name: l.name, extras: l.extras, layers: l.layers });

/*
 * The picture style the editor chose, kept until they change it.
 *
 * Each design's worlds wrote their own image prompt, so a style the editor
 * liked on one issue was gone on the next (Birds: the gouache miniatures were
 * redrawn as stipple and pixel cells by the next design). The chosen style is
 * kept in the shared taste folder and every world's pictures are made in it.
 */
export interface ImageStyle {
  readonly style: string;
  readonly negative?: string;
  /** Where it was chosen from, for the editor's own reference. */
  readonly from?: string;
  readonly at: string;
}

const styleFile = (root: string) => join(root, "_taste", "image-style.json");

export async function imageStyleOf(root: string): Promise<ImageStyle | null> {
  const raw = await readFile(styleFile(root), "utf-8").then((t) => JSON.parse(t) as ImageStyle).catch(() => null);
  return raw && typeof raw.style === "string" && raw.style.trim() ? raw : null;
}

export async function saveImageStyle(root: string, s: { style: string; negative?: string; from?: string }): Promise<ImageStyle> {
  if (!s.style?.trim()) throw new Error("an image style needs its words");
  const out: ImageStyle = { style: s.style.trim(), ...(s.negative?.trim() ? { negative: s.negative.trim() } : {}), ...(s.from ? { from: s.from } : {}), at: new Date().toISOString() };
  await mkdir(join(root, "_taste"), { recursive: true });
  await writeFile(styleFile(root), JSON.stringify(out, null, 2) + "\n", "utf-8");
  return out;
}
