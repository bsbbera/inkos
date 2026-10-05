/**
 * The Design Kit: a world made concrete, approved once, reused forever (07 §1b).
 *
 * A world says how things look. A kit is the pieces that look like that —
 * swatches and their tints, named gradients, text styles, the one effect set
 * the world allows, masks, a paper tile, and every ornament or texture that has
 * already been drawn and approved. The rule it enforces is the user's: once a
 * thing is made and approved, it is never made again. A brief that names a
 * `subjectKey` the kit already holds gets that picture back instead of a render.
 *
 * Kits live in the workspace library (`design/kits/<id>@<v>/`), not inside the
 * work, so a kit can outlive the book it was made for and travel in a Taste Pack.
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { safeChildPath } from "../utils/path-safety.js";

export const KITS_DIR = "design/kits";

export interface KitAsset {
  readonly id: string;
  readonly kind: "mask" | "pattern" | "ornament" | "texture" | "picture";
  /** Workspace-relative. */
  readonly file: string;
  readonly subjectKey?: string;
  readonly state: "draft" | "approved";
  /** Made with the kit, captured on first use from an approved picture, or read from the user's final. */
  readonly origin: "kit" | "captured" | "final";
  readonly from?: string;
  readonly at: string;
}

export interface KitSwatches {
  readonly paper: string;
  readonly ink: string;
  readonly hue: string;
  readonly tints: Readonly<Record<string, string>>;
  readonly gradients: ReadonlyArray<{
    readonly id: string;
    readonly stops: ReadonlyArray<{ readonly at: number; readonly hex: string }>;
  }>;
}

export interface KitTextStyles {
  readonly display: string;
  readonly text: string;
  readonly scale: ReadonlyArray<number>;
  readonly styles: ReadonlyArray<{
    readonly id: string;
    readonly font: string;
    readonly size: number;
    readonly lead: number;
    readonly weight?: string;
  }>;
}

export interface KitFx {
  /** Anything not in here is a validator error. Most worlds allow nothing. */
  readonly allowed: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly params: Readonly<Record<string, number | string>>;
  }>;
}

export interface KitManifest {
  readonly id: string;
  readonly version: number;
  /** Which world it was made from: the world file, or the section of an issue. */
  readonly world: string;
  readonly technique: string;
  readonly idiom?: string;
  readonly at: string;
  readonly approvedAt: string | null;
  readonly assets: ReadonlyArray<KitAsset>;
}

export interface Kit {
  /** Workspace-relative folder, `design/kits/<id>@<v>`. */
  readonly dir: string;
  readonly manifest: KitManifest;
  readonly swatches: KitSwatches;
  readonly textStyles: KitTextStyles;
  readonly fx: KitFx;
}

export function kitIdOf(type: string, id: string, section?: number): string {
  return `${type}-${id}${section ? `-s${section}` : ""}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

export function kitDirOf(kitId: string, version: number): string {
  return `${KITS_DIR}/${kitId}@${version}`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const hexOr = (v: string | undefined, fallback: string) => (v && HEX.test(v) ? v.toLowerCase() : fallback);

/** `t` of the way from `a` to `b`, both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
    .toString(16).padStart(2, "0")).join("")}`;
}

const DEFAULT_FACES: Readonly<Record<string, { display: string; text: string; scale: number[] }>> = {
  storybook: { display: "Fraunces", text: "Andika", scale: [14, 18, 24, 32, 48] },
  publication: { display: "Fraunces", text: "Source Serif 4", scale: [8, 9.5, 12, 16, 24, 36, 54] },
  default: { display: "Cormorant Garamond", text: "Literata", scale: [9, 11, 14, 18, 24, 36] },
};

/**
 * The kit a world implies, before anything is drawn for it. Deterministic:
 * the model already chose the world, and a kit is that choice spelled out.
 */
export function proposeKit(input: {
  readonly kitId: string;
  readonly version: number;
  readonly type: string;
  readonly worldRef: string;
  readonly world: {
    readonly technique?: string; readonly idiom?: string;
    readonly paper?: string; readonly ink?: string; readonly hue?: string;
  };
  readonly faces?: { readonly display?: string; readonly text?: string; readonly scale?: ReadonlyArray<number> };
  readonly at?: string;
}): Omit<Kit, "dir"> {
  const at = input.at ?? new Date().toISOString();
  const paper = hexOr(input.world.paper, "#f4efe6");
  const ink = hexOr(input.world.ink, "#1d1b18");
  const hue = hexOr(input.world.hue, "#b0412e");
  const base = DEFAULT_FACES[input.type] ?? DEFAULT_FACES.default!;
  const display = input.faces?.display || base.display;
  const text = input.faces?.text || base.text;
  const scale = input.faces?.scale?.length ? [...input.faces.scale] : base.scale;
  const step = (i: number) => scale[Math.min(i, scale.length - 1)]!;

  const tints: Record<string, string> = {};
  for (const t of [10, 25, 50, 75, 90]) tints[`ink-${t}`] = mix(paper, ink, t / 100);
  for (const t of [20, 50, 80]) tints[`hue-${t}`] = mix(paper, hue, t / 100);

  return {
    manifest: {
      id: input.kitId,
      version: input.version,
      world: input.worldRef,
      technique: input.world.technique ?? "",
      ...(input.world.idiom ? { idiom: input.world.idiom } : {}),
      at,
      approvedAt: null,
      assets: [],
    },
    swatches: {
      paper, ink, hue, tints,
      gradients: [
        { id: "paper-to-hue", stops: [{ at: 0, hex: paper }, { at: 1, hex: hue }] },
        { id: "hue-to-ink", stops: [{ at: 0, hex: hue }, { at: 1, hex: ink }] },
        { id: "duotone", stops: [{ at: 0, hex: ink }, { at: 1, hex: paper }] },
      ],
    },
    textStyles: {
      display, text, scale,
      styles: [
        { id: "caption", font: text, size: step(0), lead: +(step(0) * 1.3).toFixed(1) },
        { id: "body", font: text, size: step(1), lead: +(step(1) * 1.45).toFixed(1) },
        { id: "kicker", font: text, size: step(0), lead: +(step(0) * 1.2).toFixed(1), weight: "bold" },
        { id: "deck", font: display, size: step(2), lead: +(step(2) * 1.25).toFixed(1) },
        { id: "head", font: display, size: step(4), lead: +(step(4) * 1.1).toFixed(1) },
        { id: "display", font: display, size: step(6), lead: +(step(6) * 1.0).toFixed(1) },
      ],
    },
    fx: {
      // An effect is earned, not defaulted: only a children's world gets the one
      // soft shadow a cutout on white needs to sit on the page.
      allowed: input.type === "storybook"
        ? [{ id: "soft-shadow", kind: "shadow", params: { blur: 6, offset: 2, opacity: 0.18 } }]
        : [],
    },
  };
}

async function readJson<T>(root: string, file: string): Promise<T> {
  return JSON.parse(await readFile(safeChildPath(root, file), "utf-8")) as T;
}

/** The newest version of a kit, or null when the work has none yet. */
export async function latestKit(root: string, kitId: string): Promise<Kit | null> {
  let names: string[];
  try {
    names = await readdir(safeChildPath(root, KITS_DIR));
  } catch {
    return null;
  }
  const versions = names
    .map((n) => new RegExp(`^${kitId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@(\\d+)$`).exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a);
  for (const v of versions) {
    const dir = kitDirOf(kitId, v);
    try {
      return {
        dir,
        manifest: await readJson<KitManifest>(root, `${dir}/kit.json`),
        swatches: await readJson<KitSwatches>(root, `${dir}/swatches.json`),
        textStyles: await readJson<KitTextStyles>(root, `${dir}/text-styles.json`),
        fx: await readJson<KitFx>(root, `${dir}/fx.json`),
      };
    } catch { /* a half-written version; fall back to the one before */ }
  }
  return null;
}

export async function writeKit(root: string, kit: Kit): Promise<void> {
  await mkdir(safeChildPath(root, kit.dir), { recursive: true });
  const put = (name: string, body: unknown) =>
    writeFile(safeChildPath(root, `${kit.dir}/${name}`), `${JSON.stringify(body, null, 2)}\n`, "utf-8");
  await put("kit.json", kit.manifest);
  await put("swatches.json", kit.swatches);
  await put("text-styles.json", kit.textStyles);
  await put("fx.json", kit.fx);
}

export const keyOf = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 4).join("-");

/** An approved picture the kit already holds for this subject, if any. */
export function kitAssetFor(manifest: KitManifest, subjectKey: string): KitAsset | undefined {
  const key = keyOf(subjectKey);
  return manifest.assets.find((a) => a.state === "approved" && a.subjectKey && keyOf(a.subjectKey) === key);
}

/**
 * Keep a picture in the kit (capture on first use). Copied rather than linked:
 * the kit outlives the work, and a deleted chapter must not take its ornament
 * with it. Returns null when the work has no kit to capture into.
 */
export async function captureIntoKit(root: string, kitId: string, input: {
  readonly file: string;
  readonly kind: KitAsset["kind"];
  readonly origin: KitAsset["origin"];
  readonly state: KitAsset["state"];
  readonly subjectKey?: string;
}): Promise<KitAsset | null> {
  const kit = await latestKit(root, kitId);
  if (!kit) return null;
  const name = basename(input.file);
  const file = `${kit.dir}/captured/${name}`;
  await mkdir(safeChildPath(root, `${kit.dir}/captured`), { recursive: true });
  await copyFile(safeChildPath(root, input.file), safeChildPath(root, file));
  const asset: KitAsset = {
    id: `${input.origin}-${name.replace(/\.[^.]+$/, "")}`,
    kind: input.kind,
    file,
    ...(input.subjectKey ? { subjectKey: keyOf(input.subjectKey) } : {}),
    state: input.state,
    origin: input.origin,
    from: input.file,
    at: new Date().toISOString(),
  };
  await writeKit(root, {
    ...kit,
    manifest: { ...kit.manifest, assets: [...kit.manifest.assets.filter((a) => a.file !== file), asset] },
  });
  return asset;
}
