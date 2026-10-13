/*
 * Page art, composed by the model from primitives (plan 26 rework).
 *
 * The art is no longer a generator Quire was taught: per page, the model is
 * given the page's copy, its section's language and the page's real geometry
 * (where the art goes, where the type sits) and draws the illustration as a
 * list of shapes in page millimetres. The shim draws them; code only holds
 * them to the page: on the trim, inside a node budget, and faint wherever they
 * run under running text.
 */
import type { Language } from "./visual-language.js";
import { ROLES } from "./visual-language.js";
import { BRAND_KINDS, brandArtBlock, holdBrandShapes, type Brand } from "./brand.js";

export const SHAPE_KINDS = ["rect", "circle", "blob", "poly", "path", "line", "star", "dots"] as const;

export interface Shape {
  /** A primitive, or one of the brand's own shapes (brand.ts BRAND_KINDS), drawn by its shape kit. */
  readonly s: typeof SHAPE_KINDS[number] | typeof BRAND_KINDS[number];
  /** A brand shape's parameters (Ochin Shape settings), colours by brand name. */
  readonly p?: Readonly<Record<string, unknown>>;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly pts?: ReadonlyArray<readonly [number, number]>;
  readonly fill?: string; readonly to?: string; readonly stroke?: string;
  readonly weight?: number; readonly opacity?: number; readonly rot?: number;
  readonly r?: number; readonly n?: number;
  /** back: under the page's panels and pictures. front: over them, under the type. */
  readonly layer?: "back" | "front";
  /** The shape the page's picture is held in, when the picture keeps its painted ground (a plate). */
  readonly hold?: boolean;
}

type Box = { x: number; y: number; w: number; h: number };
const meets = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const holds = (a: Box, b: Box) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
/** Type that is read line by line: art under it stays a whisper. */
const RUNNING = new Set(["body", "dropcap", "runhead", "folio"]);
/** Type that is looked at: art under it is fine when it is under all of it (the shim picks the type colour). */
const DISPLAY = new Set(["title", "deck", "kicker", "pull", "figure", "wordmark"]);

export const MAX_SHAPES = 80;

/**
 * The model's shapes, held to the page. `type` is every type block's box in
 * page mm; a shape that runs under running text drops to 15 % and goes back,
 * one that clips part of a title (not all of it) drops to 25 %.
 */
export function holdShapes(raw: unknown, type: ReadonlyArray<{ kind: string; box: Box }>, brand?: { brand: Brand; place: readonly string[]; notes?: string[] }): Shape[] {
  const list = Array.isArray((raw as { shapes?: unknown })?.shapes) ? (raw as { shapes: unknown[] }).shapes : Array.isArray(raw) ? raw : [];
  const roles = ROLES as readonly string[];
  // "ground" is the picture's own painted ground, measured from a plate (shim postprocess `ground`).
  const role = (v: unknown) => (roles.includes(String(v)) || v === "ground" ? String(v) : undefined);
  const out: Shape[] = [];
  for (const item of list.slice(0, MAX_SHAPES)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const branded = !!brand && (BRAND_KINDS as readonly string[]).includes(String(r.s));
    if (!branded && !(SHAPE_KINDS as readonly string[]).includes(String(r.s))) continue;
    const pts = Array.isArray(r.pts)
      ? (r.pts as unknown[]).slice(0, 48).filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && p.every((v) => typeof v === "number" && Number.isFinite(v)))
        .map(([x, y]) => [num(x, -10, 220, 0), num(y, -10, 307, 0)] as const)
      : undefined;
    // The box of a point shape is its points' box, whatever the model said.
    let box: Box = { x: num(r.x, -10, 220, 0), y: num(r.y, -10, 307, 0), w: num(r.w, 0.3, 230, 10), h: num(r.h, 0.3, 317, 10) };
    if (pts && pts.length >= 2) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(0.3, Math.max(...xs) - Math.min(...xs)), h: Math.max(0.3, Math.max(...ys) - Math.min(...ys)) };
    } else if (["blob", "poly", "path", "line", "kantha"].includes(String(r.s))) continue;
    if (branded) {
      // A brand shape carries its own colours (p); it is held by the brand's rations below.
      const p = r.p && typeof r.p === "object" ? r.p as Record<string, unknown> : {};
      out.push({ s: r.s as Shape["s"], ...box, ...(pts ? { pts } : {}), p, opacity: num(r.opacity, 0.05, 1, 1), rot: 0, layer: r.layer === "front" ? "front" : "back" });
      continue;
    }
    let opacity = num(r.opacity, 0.05, 1, 1);
    let layer: "back" | "front" = r.layer === "front" ? "front" : "back";
    const fill = role(r.fill), stroke = role(r.stroke);
    if (!fill && !stroke) continue;
    for (const t of type) {
      if (!meets(box, t.box)) continue;
      if (RUNNING.has(t.kind)) { opacity = Math.min(opacity, 0.15); layer = "back"; }
      else if (DISPLAY.has(t.kind) && !holds(box, t.box)) opacity = Math.min(opacity, 0.25);
    }
    out.push({
      s: r.s as Shape["s"], ...box, ...(pts ? { pts } : {}),
      ...(fill ? { fill } : {}), ...(role(r.to) ? { to: role(r.to)! } : {}), ...(stroke ? { stroke } : {}),
      weight: num(r.weight, 0.25, 12, 1), opacity, rot: num(r.rot, -180, 180, 0),
      r: num(r.r, 0, 60, 0), n: Math.round(num(r.n, 3, 24, 5)), layer,
      ...(r.hold === true ? { hold: true } : {}),
    });
  }
  if (!brand) return out;
  const held = holdBrandShapes(brand.brand, out, brand.place);
  brand.notes?.push(...held.notes);
  return held.shapes;
}

/** The art call for one page. Vocabulary and geometry only: the look comes from the direction and the copy. */
export function pageArtPrompt(args: {
  readonly title: string; readonly deck?: string | null; readonly body: string;
  readonly type: string; readonly language: Language; readonly section?: string;
  readonly art: ReadonlyArray<Box>; readonly blocks: ReadonlyArray<{ kind: string; box: Box }>;
  /** The issue's design direction and this page's reading, both written by the model earlier. */
  readonly direction?: string; readonly reading?: string; readonly idea?: string;
  /** Why the last proof of this page was sent back (page-look.ts), so the art fixes what was seen. */
  readonly note?: string;
  /** The brand in force and where this page sits (brand.ts placeOf): adds the brand's shapes and rations. */
  readonly brand?: { readonly brand: Brand; readonly place: readonly string[] };
}): string {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const b = (x: Box) => `x ${r1(x.x)} y ${r1(x.y)} w ${r1(x.w)} h ${r1(x.h)}`;
  const L = args.language;
  return `You are the illustrator of one page. Draw its art as vector shapes.

THE PAGE (${args.type}${args.section ? `, section "${args.section}"` : ""}):
Title: ${args.title}
${args.deck ? `Standfirst: ${args.deck}
` : ""}Copy: ${args.body.replace(/\s+/g, " ").slice(0, 900)}
${args.reading ? `
HOW THIS PAGE READS (your own reading of it): ${args.reading}` : ""}
${args.idea ? `THE PAGE'S COMPOSITION (your own): ${args.idea}` : ""}
${args.direction ? `
THE ISSUE'S DIRECTION (your own; follow it):
${args.direction}
` : ""}
${args.note ? `THE LAST PROOF OF THIS PAGE WAS SENT BACK. Fix every point about the art:
${args.note}
` : ""}THE SECTION'S LANGUAGE:
Colours by role: paper ${L.paper}, ink ${L.ink}, accent ${L.accent}, second ${L.second}, third ${L.third}, field ${L.field}.
Motif: ${L.motif || "(none given)"}

THE PAGE IS 210 x 297 mm, origin top left. Where things already are:
${args.blocks.map((x) => `- ${x.kind}: ${b(x.box)}`).join("\n")}
${args.art.length ? `The art areas: ${args.art.map(b).join("; ")}` : "There is no art area on this page."}
Picture slots (kind image) are filled later by a generated picture; draw around them, not in them.
Running text (body) is read line by line: a shape under it is faded to 15 % by the builder.
Up to ${MAX_SHAPES} shapes, or none if the direction calls for none.

Each shape: {"s": "${SHAPE_KINDS.join("|")}", "x","y","w","h" (its box, mm),
"pts": [[x,y],...] for blob (smooth closed), poly (straight closed), path (smooth open), line (straight open),
"fill": role, "to": role (a gradient to this colour), "stroke": role, "weight": pt,
"opacity": 0-1, "rot": degrees, "r": corner radius mm (rect) or dot size (dots),
"n": points (star) or dots per row (dots), "layer": "back"|"front"}.
Roles: paper, ink, accent, second, third, field. Shapes are drawn in order, first at the back.
${args.brand ? `
${brandArtBlock(args.brand.brand, args.brand.place)}
` : ""}
Return ONLY JSON: {"idea": "one line: what the art shows", "shapes": [...]}`;
}
