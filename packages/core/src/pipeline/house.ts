/*
 * The house book (Phase 7, analysis/26-design-engine.md; reworked).
 *
 * The house is only what a reader recognises the magazine by and what must
 * never drift: the masthead, the type pair and scale, the margins, the grid
 * systems it composes with, its rule and its folio. Colour, panels and art are
 * NOT here: each section's language is written by the model from its own copy
 * (visual-language.ts), which is what keeps one brand from looking the same
 * on every subject.
 *
 * Until a house is approved the design stage decides everything per issue;
 * once one is, the stage may choose only what a house leaves open.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignSpec } from "./publication-design.js";

export const GRID_SYSTEMS = ["columns", "modular", "thirds", "golden", "canon"] as const;
export type GridSystem = typeof GRID_SYSTEMS[number];
/** The fallback vector generators `T.drawn` knows (cli-shim/affinity/tk.js), used only when a page's art call fails. */
export const GENERATORS = [
  "contours", "rain", "rings", "flow", "hatch", "halftone", "burst", "spiral",
  "hex", "tri", "voronoi", "blobs", "bauhaus",
] as const;
export const RULE_STYLES = ["hairline", "double", "dashed", "dotted", "thick-thin"] as const;

export interface House {
  /** The masthead: what the wordmark sets and the running head names. */
  readonly name: string;
  readonly status: "draft" | "approved";
  readonly approvedAt?: string;
  readonly type: { readonly display: string; readonly text: string };
  /** Body size in points and the ratio each step of the scale climbs by. */
  readonly scale: { readonly body: number; readonly ratio: number };
  readonly marginMm: number;
  readonly gutterMm: number;
  readonly baselineMm: number;
  /** The composition systems an issue may choose from. */
  readonly grids: readonly GridSystem[];
  readonly devices: {
    readonly rule: string;
    /** One sentence each: how the folio and the kicker are set. */
    readonly folio: string;
    readonly kicker: string;
  };
  readonly notes?: string;
}

export const houseFile = (brandDir: string) => join(brandDir, "house.json");

export async function readHouse(brandDir: string): Promise<House | null> {
  const file = houseFile(brandDir);
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, "utf-8")) as House; } catch { return null; }
}

export async function writeHouse(brandDir: string, house: House): Promise<void> {
  await mkdir(brandDir, { recursive: true });
  await writeFile(houseFile(brandDir), JSON.stringify(house, null, 2) + "\n", "utf-8");
}

/** The house in force: an approved one, or none. A draft decides nothing. */
export async function houseInForce(brandDir: string): Promise<House | null> {
  const h = await readHouse(brandDir);
  return h?.status === "approved" ? h : null;
}

/** What is wrong with a house, as sentences. Empty means it can be approved. */
export function checkHouse(house: Partial<House> | null | undefined, fonts?: readonly string[]): string[] {
  const bad: string[] = [];
  if (!house) return ["no house"];
  if (!house.name?.trim()) bad.push("the masthead has no name");
  for (const k of ["display", "text"] as const) {
    const f = house.type?.[k];
    if (!f) bad.push(`no ${k} face`);
    else if (fonts?.length && !fonts.includes(f)) bad.push(`${f} is not installed`);
  }
  const s = house.scale;
  if (!s || !(s.body >= 8.5 && s.body <= 11)) bad.push("body size must be 8.5-11 pt");
  if (!s || !(s.ratio >= 1.125 && s.ratio <= 1.8)) bad.push("the scale ratio must be 1.125-1.8");
  for (const [k, lo, hi] of [["marginMm", 10, 30], ["gutterMm", 3, 8], ["baselineMm", 3.5, 6]] as const) {
    const v = house[k];
    if (!(typeof v === "number" && v >= lo && v <= hi)) bad.push(`${k} must be ${lo}-${hi}`);
  }
  const grids = house.grids ?? [];
  if (!grids.length) bad.push("no grid system allowed");
  for (const g of grids) if (!(GRID_SYSTEMS as readonly string[]).includes(String(g))) bad.push(`"${g}" is not a grid system`);
  if (!(RULE_STYLES as readonly string[]).includes(house.devices?.rule ?? "")) bad.push("the rule style is not one Quire draws");
  return bad;
}

/** The scale, largest first: body times the ratio, five steps up. */
export function scaleOf(house: House): number[] {
  const { body, ratio } = house.scale;
  return [5, 3, 2, 1, 0].map((k) => Math.round(body * ratio ** k * 2) / 2);
}

/** The house, said to the art director: what is fixed, and what is theirs to choose. */
export function houseBlock(house: House): string {
  return [
    "THE HOUSE (fixed for every issue - do not choose these, they are filled in for you):",
    `- Masthead: "${house.name}". Type: ${house.type.display} for display, ${house.type.text} for text.`,
    `- Scale ${scaleOf(house).join(" / ")} pt. ${house.devices.rule} rules. Folio: ${house.devices.folio}. Kicker: ${house.devices.kicker}.`,
    "Yours to choose for this issue:",
    `- grid.system, one of: ${house.grids.join(", ")}. Choose the one that carries this subject's feeling, and say why in "fixed.grid".`,
    "- Every colour, panel and picture: each section's language, below. The house is recognised by its",
    "  type and furniture, never by keeping every subject in the same colours.",
    house.notes ? `House notes: ${house.notes}` : "",
  ].filter(Boolean).join("\n");
}

/** Hold a spec to the house: the model is told what is fixed; this makes it so, whatever came back. */
export function applyHouse(spec: DesignSpec, house: House): DesignSpec {
  const system = (house.grids as readonly string[]).includes(String(spec.grid?.system)) ? spec.grid.system! : house.grids[0]!;
  return {
    ...spec,
    type: { display: house.type.display, text: house.type.text, scale: scaleOf(house) },
    grid: { ...spec.grid, system, marginMm: house.marginMm, gutterMm: house.gutterMm, baselineMm: house.baselineMm },
  };
}

/** The prompt that drafts a house, for a person to edit and approve. */
export function proposeHousePrompt(args: {
  brandBook: string; issues: readonly string[]; fonts: readonly string[];
  /** Other houses in the workspace: this one must not wear their type. */
  taken?: readonly { name: string; display: string; text: string }[];
  /** Why the last draft was refused. */
  refused?: string;
}): string {
  return `You are the founding art director of a magazine. Draft its HOUSE BOOK: the few
things that never change between issues, so any page is recognisably this magazine
whatever its subject. Colour and illustration are NOT house decisions: every section
invents its own from its copy. The house is type, proportion and furniture.

THE BRAND BOOK (who the magazine is):
${args.brandBook.slice(0, 6000) || "(none written yet)"}
${args.issues.length ? `\nWHAT IT HAS PUBLISHED OR IS WRITING:\n${args.issues.map((t) => `- ${t}`).join("\n")}\n` : ""}
Choose, for THIS magazine and its readers (not a generic one):
- name: the masthead, 1-2 words, ownable, not the name of a known magazine.
- type.display and type.text from the INSTALLED FONTS below, spelled exactly, chosen for
  what this magazine writes about. The text face is read at body size.
- scale: body 8.5-11 pt and a ratio 1.2-1.618 (a modular scale).
- marginMm 12-25, gutterMm 4-6, baselineMm 4-5.
- grids: 3-5 of ${GRID_SYSTEMS.join(", ")} the magazine may compose with.
- devices.rule one of ${RULE_STYLES.join(", ")}; devices.folio and devices.kicker one sentence each.

INSTALLED FONTS (in no order): ${args.fonts.join(", ") || "(unknown - use widely available faces)"}
${args.taken?.length ? `\nOTHER MAGAZINES IN THIS WORKSPACE (this one must not share their display face, their text face or their masthead):\n${args.taken.map((t) => `- ${t.name}: ${t.display} / ${t.text}`).join("\n")}\n` : ""}${args.refused ? `\nYOUR LAST DRAFT WAS REFUSED: ${args.refused}\n` : ""}
Return ONLY JSON:
{"name":"","type":{"display":"","text":""},"scale":{"body":9.5,"ratio":1.333},
 "marginMm":16,"gutterMm":5,"baselineMm":4.5,"grids":["columns","golden"],
 "devices":{"rule":"","folio":"","kicker":""},"notes":"one paragraph: what makes a page ours"}`;
}
