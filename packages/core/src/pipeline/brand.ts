/*
 * A brand: the fixed layer above the house (brands/<id>/, shipped with core).
 *
 * Without a brand, every issue and every section invents its own colours, faces and
 * art (house.ts, visual-language.ts). That is right for a one-off and wrong for a
 * magazine people should recognise. A work marked `brand: <id>` is held to the
 * brand's data in code, not asked to remember it:
 *
 *   brand    -> colours, faces, ladder, shapes and their rations, image style (fixed)
 *   series   -> the brand's house (margins, grid, folio)
 *   section  -> two of the brand's section colours, one lead signature
 *   spread   -> the device and composition: the only place variety is invented
 *
 * The model is told the brand (brandBlock) and chooses from it; whatever comes
 * back is snapped to it (holdBrandSpec, holdBrandWorld, holdBrandShapes).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { House } from "./house.js";
import type { DesignSpec } from "./publication-design.js";
import type { Language } from "./visual-language.js";

export interface BrandColour { readonly hex: string; readonly role: string; readonly bn: string; readonly means: string }
export interface BrandShape {
  readonly label: string; readonly bn: string; readonly means: string;
  readonly where: readonly string[]; readonly perSpread?: number; readonly perIssue?: number;
  readonly params: string; readonly rule?: string;
}
export interface Brand {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly mark: string;
  readonly tagline: { readonly bn: string; readonly en: string };
  readonly promise: string;
  readonly colours: Readonly<Record<string, BrandColour>>;
  readonly sectionColours: readonly string[];
  readonly pairsByTopic: ReadonlyArray<readonly [string, string, string]>;
  readonly text: { readonly body: Readonly<Record<string, readonly string[]>>; readonly heads: Readonly<Record<string, readonly string[]>> };
  readonly type: {
    readonly mark: string; readonly display: string; readonly text: string; readonly young: string;
    readonly files: Readonly<Record<string, string>>;
    readonly ladder: Readonly<Record<string, readonly [number, number]>>;
    readonly scale: readonly number[];
  };
  readonly bilingual: Readonly<Record<string, unknown>>;
  readonly house: {
    readonly marginMm: number; readonly gutterMm: number; readonly baselineMm: number; readonly columns: number;
    readonly grids: readonly string[]; readonly rule: string; readonly folio: string; readonly kicker: string;
  };
  readonly shapes: Readonly<Record<string, BrandShape>>;
  readonly imageStyle: { readonly style: string; readonly negative: string };
  readonly voice: string;
  /** Filled in by loadBrand. */
  readonly dir: string;
  readonly standard: string;
  readonly references: readonly string[];
}

/** core/brands, from src/pipeline (tests) and dist/pipeline (the app) alike. */
export const brandsDir = () => fileURLToPath(new URL("../../brands", import.meta.url));

const cache = new Map<string, Brand | null>();

export function loadBrand(id: string | null | undefined, root = brandsDir()): Brand | null {
  if (!id || !/^[a-z0-9-]+$/.test(id)) return null;
  const key = root + "|" + id;
  if (cache.has(key)) return cache.get(key)!;
  const dir = join(root, id), file = join(dir, "brand.json");
  let brand: Brand | null = null;
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf-8"));
      const std = join(dir, "DESIGN-SYSTEM.md"), refs = join(dir, "references");
      brand = {
        ...data, dir,
        standard: existsSync(std) ? readFileSync(std, "utf-8") : "",
        references: existsSync(refs) ? readdirSync(refs).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => join(refs, f)) : [],
      };
    } catch { brand = null; }
  }
  cache.set(key, brand);
  return brand;
}

export function listBrands(root = brandsDir()): Array<{ id: string; name: string; mark: string }> {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => loadBrand(d.name, root)).filter((b): b is Brand => !!b)
    .map((b) => ({ id: b.id, name: b.name, mark: b.mark }));
}

export const hexOf = (brand: Brand, name: string): string | null => brand.colours[name]?.hex ?? null;

/** The brand's house: approved by being the brand. The series cannot redraft it. */
export function brandHouse(brand: Brand): House {
  const body = brand.type.ladder.body?.[0] ?? 11;
  return {
    name: brand.name, status: "approved", approvedAt: "brand",
    type: { display: brand.type.display, text: brand.type.text },
    scale: { body, ratio: 1.5 },
    marginMm: brand.house.marginMm, gutterMm: brand.house.gutterMm, baselineMm: brand.house.baselineMm,
    grids: brand.house.grids as House["grids"],
    devices: { rule: brand.house.rule, folio: brand.house.folio, kicker: brand.house.kicker },
    notes: brand.promise,
  };
}

/** What the design stage is told when a brand is in force: the whole system, and what it may choose. */
export function brandBlock(brand: Brand): string {
  const sec = brand.sectionColours.map((c) => `${c} ${brand.colours[c]!.hex} (${brand.colours[c]!.means})`).join("; ");
  return [
    `THIS WORK IS ${brand.name.toUpperCase()} (${brand.mark}). ITS DESIGN SYSTEM IS LAW: you choose inside it, you never invent outside it.`,
    brand.standard.trim(),
    "",
    "WHAT IS YOURS TO CHOOSE, AND HOW TO SAY IT:",
    `- The issue palette is fixed (paper ${hexOf(brand, "shankha")}, ink ${hexOf(brand, "kajol")}, accent ${hexOf(brand, "sindur")}) and the faces are fixed (${brand.type.display} / ${brand.type.text}). Return them as they are.`,
    `- Each section returns "pair": two names from [${brand.sectionColours.join(", ")}], first the one it is mostly made of. Choose from the section's copy: ${sec}.`,
    `  Neighbouring sections do not use the same pair. Starting points by topic: ${brand.pairsByTopic.map(([t, a, b]) => `${t} = ${a}+${b}`).join("; ")}.`,
    `- Each section returns "lead": the signature that leads it, one of ${Object.keys(brand.shapes).join(", ")}, chosen for what the section does (kantha for a journey or a connection, alpana for a ritual or an opening, the bird for a question, panel for explaining).`,
    "- Each section's register and motif are said in the brand's own vocabulary: its shapes, its finish, its gouache pictures. Never a foreign style (no Swiss, no Bauhaus, no neon, no gradients beyond a panel grading between two brand colours).",
    "- Variety lives in the spread: a device of its own per spread, never the same device twice running.",
    `- Pictures are made in the brand's style, not yours to change: "${brand.imageStyle.style}".`,
  ].join("\n");
}

/** Nearest brand colour name to a #rrggbb, by plain RGB distance. ponytail: RGB, not perceptual; fine for ten far-apart colours. */
export function nearestColour(brand: Brand, hex: string, among?: readonly string[]): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const want = /^#[0-9a-f]{6}$/i.test(hex) ? p(hex) : [0, 0, 0];
  let best = among?.[0] ?? "kajol", d = Infinity;
  for (const name of among ?? Object.keys(brand.colours)) {
    const c = p(brand.colours[name]!.hex), e = c.reduce((s, v, i) => s + (v - want[i]!) ** 2, 0);
    if (e < d) { d = e; best = name; }
  }
  return best;
}

/** The section's two colours: what it asked for when valid, else read from the colours it wrote. */
export function pairOf(brand: Brand, raw: unknown, fallbackHexes: readonly string[] = []): [string, string] {
  const allowed = brand.sectionColours;
  const asked = Array.isArray(raw) ? raw.map((v) => String(v).toLowerCase().trim()).filter((v) => allowed.includes(v)) : [];
  const read = fallbackHexes.filter((h) => /^#[0-9a-f]{6}$/i.test(h)).map((h) => nearestColour(brand, h, allowed));
  const out = [...new Set([...asked, ...read, ...allowed])];
  return [out[0]!, out[1]!];
}

/**
 * A section's language, rebuilt from its pair: every colour role is a brand colour.
 * The model's panel and kicker are kept only where the brand allows them (no rounded,
 * rotated, shadowed or cut panels: an Ochin panel is cloth, its edge is a profile).
 */
export function brandLanguage(brand: Brand, pair: readonly [string, string], model?: Partial<Language> | null): Language {
  const h = (n: string) => hexOf(brand, n)!;
  return {
    paper: h("shankha"), ink: h("kajol"), accent: h(pair[0]), second: h(pair[1]), third: h("sindur"), field: h("paper"),
    panel: { fill: model?.panel?.fill === "second" ? "second" : "accent", stroke: null, weight: 0, radius: 0, cut: 0, shadow: null, rotate: 0 },
    title: "ink",
    kicker: { ground: null, bar: null, track: 0.14 },
    motif: String(model?.motif ?? "").slice(0, 400),
  };
}

/** The spec held to the brand: palette, faces and ladder are the brand's, whatever came back. */
export function holdBrandSpec(spec: DesignSpec, brand: Brand): DesignSpec {
  return {
    ...spec,
    palette: { ...(spec.palette ?? {}), paper: hexOf(brand, "shankha")!, ink: hexOf(brand, "kajol")!, accent: hexOf(brand, "sindur")! },
    type: { ...(spec.type ?? {}), display: brand.type.display, text: brand.type.text, scale: [...brand.type.scale] },
    imageDirection: brand.imageStyle.style,
  };
}

/** Every #rrggbb in a value that is not a brand colour (the brand check's colour test). */
export function offBrandColours(brand: Brand, value: unknown): string[] {
  const ok = new Set(Object.values(brand.colours).map((c) => c.hex.toLowerCase()));
  const found = JSON.stringify(value ?? null).match(/#[0-9a-f]{6}\b/gi) ?? [];
  return [...new Set(found.map((h) => h.toLowerCase()).filter((h) => !ok.has(h)))];
}

/* ---- the brand's shapes on a page (page-art.ts) ------------------------------------------ */

/** Page-art kinds a brand adds to the primitives; drawn in Affinity by the brand's shape kit. */
export const BRAND_KINDS = ["lalpaar", "matra", "kantha", "alpana", "bird", "bpanel", "ornament"] as const;
export type BrandKind = typeof BRAND_KINDS[number];
/** brand.json shape key for a page-art kind. */
const SHAPE_KEY: Record<BrandKind, string> = { lalpaar: "lalpaar", matra: "matra", kantha: "kantha", alpana: "alpana", bird: "bird", bpanel: "panel", ornament: "ornament" };
/** Where on an issue a page sits, as the rations name it. */
export function placeOf(pageType: string, isLastOfSection = false): string[] {
  const t = pageType.toLowerCase();
  const out = ["any"];
  if (t === "cover") out.push("cover");
  if (t === "back" || t === "back-cover" || t === "closing") out.push("back", "end");
  if (t === "opener" || t === "section-opener") out.push("opener");
  if (isLastOfSection) out.push("end");
  return out;
}

/** Whether a brand kind may appear on a page of this place, and how many times. */
export function rationOf(brand: Brand, kind: BrandKind, place: readonly string[]): number {
  const s = brand.shapes[SHAPE_KEY[kind]];
  if (!s) return 0;
  const where = s.where;
  const allowed = where.includes("any") || where.some((w) => place.includes(w)) || (where.includes("frame") && kind === "alpana");
  if (!allowed) return 0;
  return s.perSpread ?? s.perIssue ?? 1;
}

/** The page-art prompt's brand section: the kinds, what each means, where it may go, and its params. */
export function brandArtBlock(brand: Brand, place: readonly string[]): string {
  const colourNames = Object.keys(brand.colours).join(", ");
  const lines = BRAND_KINDS.map((k) => {
    const s = brand.shapes[SHAPE_KEY[k]]!, n = rationOf(brand, k, place);
    return `- "${k}" ${s.label} (${s.bn}): ${s.means}. ${n ? `Up to ${n} on this page.` : "NOT ALLOWED on this page."} p: {${s.params}}${s.rule ? ` Rule: ${s.rule}.` : ""}`;
  });
  return [
    `THE BRAND'S OWN SHAPES (${brand.name}). Prefer these to primitives: they carry the brand. A shape used without its meaning is decoration, and decoration is a fault.`,
    ...lines,
    `Brand shapes take "p": their parameters, colours by NAME from: ${colourNames}. Box (x, y, w, h) as for any shape; "kantha" also takes "pts" (the path, page mm).`,
    "Primitives (rect, circle, blob, ...) still take roles; on this brand a role is one of the section's brand colours.",
  ].join("\n");
}

/** Drop brand shapes that break the ration or name a colour the brand does not have. Returns notes. */
export function holdBrandShapes<T extends { s: string; p?: Record<string, unknown> }>(brand: Brand, shapes: T[], place: readonly string[]): { shapes: T[]; notes: string[] } {
  const used = new Map<string, number>(), notes: string[] = [], out: T[] = [];
  const names = new Set(Object.keys(brand.colours));
  for (const s of shapes) {
    if (!(BRAND_KINDS as readonly string[]).includes(s.s)) { out.push(s); continue; }
    const k = s.s as BrandKind, max = rationOf(brand, k, place), n = (used.get(k) ?? 0) + 1;
    if (n > max) { notes.push(max ? `${k} over its ration of ${max}` : `${k} is not allowed on this page`); continue; }
    used.set(k, n);
    const p: Record<string, unknown> = { ...(s.p ?? {}) };
    for (const [key, v] of Object.entries(p)) {
      if (typeof v === "string" && /^#?[a-z]/i.test(v) && !/^[0-9.]+$/.test(v) && !names.has(v.toLowerCase())) {
        if (/^#[0-9a-f]{6}$/i.test(v)) p[key] = nearestColour(brand, v);
        else if (["ink", "solid", "pfill", "endcol", "body", "wing", "beak", "eye", "pupil", "wstitch", "pcol", "gcol"].includes(key)) {
          notes.push(`${k}.${key} "${v}" is not a brand colour`); delete p[key];
        }
      } else if (typeof v === "string" && names.has(v.toLowerCase())) p[key] = v.toLowerCase();
    }
    out.push({ ...s, p });
  }
  return { shapes: out, notes };
}

/** Bengali digits for a folio. */
export const bengaliDigits = (n: number | string) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]!);

/*
 * The workspace's selected brand: what a new issue is held to (createIssue).
 * One file, `.quire/brand.json`, so the Brand page and the runner read the same thing.
 */
const selectionFile = (projectRoot: string) => join(projectRoot, ".quire", "brand.json");

export function selectedBrand(projectRoot: string): string | null {
  try {
    const id = JSON.parse(readFileSync(selectionFile(projectRoot), "utf-8"))?.brand;
    return typeof id === "string" && loadBrand(id) ? id : null;
  } catch { return null; }
}

export function selectBrand(projectRoot: string, id: string | null): string | null {
  if (id !== null && !loadBrand(id)) throw new Error(`no brand "${id}"`);
  mkdirSync(join(projectRoot, ".quire"), { recursive: true });
  writeFileSync(selectionFile(projectRoot), JSON.stringify({ brand: id }, null, 2) + "\n");
  return id;
}
