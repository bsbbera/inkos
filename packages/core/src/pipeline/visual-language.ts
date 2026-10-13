/*
 * A section's visual language (plan 26, rework after the Phase 7-8 review).
 *
 * The model writes it from the section's copy: its colours, how its panels
 * and kickers are made, what its art is built from. Nothing here chooses a
 * look. Code only holds the language to what print can carry: ink on paper at
 * 7:1, and every coloured ground able to take type at 4.5:1.
 */
import { contrast } from "../publications/styles.js";

export const ROLES = ["paper", "ink", "accent", "second", "third", "field"] as const;
export type Role = typeof ROLES[number];

export interface Language {
  readonly paper: string;
  readonly ink: string;
  readonly accent: string;
  readonly second: string;
  readonly third: string;
  /** The ground art and coloured bands sit on. */
  readonly field: string;
  /** How a panel is drawn, as numbers the model sets (no menu of styles). */
  readonly panel: Panel;
  readonly title: Role;
  /** How a kicker is set: an optional filled ground behind it, an optional bar before it, its tracking. */
  readonly kicker: { readonly ground: Role | null; readonly bar: Role | null; readonly track: number };
  /** What this section's art is built from, in the model's own words. */
  readonly motif: string;
}

export interface Panel {
  readonly fill: Role | null;
  readonly stroke: Role | null;
  /** Stroke weight in pt. */
  readonly weight: number;
  /** Corner radius in mm. */
  readonly radius: number;
  /** A corner cut off, in mm (0: none). */
  readonly cut: number;
  /** A solid copy behind it, offset by dx/dy mm, in a role (null: none). */
  readonly shadow: { readonly dx: number; readonly dy: number; readonly colour: Role } | null;
  /** Rotation in degrees. */
  readonly rotate: number;
}

const HEX = /^#[0-9a-f]{6}$/i;
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  (list as readonly string[]).includes(String(v)) ? v as T : fallback;
const roleOr = (v: unknown): Role | null => ((ROLES as readonly string[]).includes(String(v)) ? v as Role : null);
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Mix two #rrggbb colours: t = 0 is a, 1 is b. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("");
}

/** The colour moved toward black or white, whichever it is nearer, until it holds `floor` against `bg`. */
function holdAgainst(c: string, bg: string, floor: number): string {
  if ((contrast(c, bg) ?? 0) >= floor) return c;
  const toward = (contrast("#000000", bg) ?? 0) >= (contrast("#ffffff", bg) ?? 0) ? "#000000" : "#ffffff";
  for (let t = 0.1; t <= 1; t += 0.1) {
    const m = mix(c, toward, t);
    if ((contrast(m, bg) ?? 0) >= floor) return m;
  }
  return toward;
}

/** Whether type can be set on this ground in the section's ink or paper. */
const carries = (bg: string, l: { paper: string; ink: string }) =>
  Math.max(contrast(l.ink, bg) ?? 0, contrast(l.paper, bg) ?? 0) >= 4.5;

/**
 * The model's language, held to print. Returns what was changed, as sentences,
 * so a mended colour is said rather than silently different.
 */
export function holdLanguage(raw: unknown, fallback: { paper: string; ink: string; accent: string }): { language: Language; notes: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const notes: string[] = [];
  const hex = (k: string, d: string) => (HEX.test(String(r[k])) ? String(r[k]).toLowerCase() : d);
  const paper = hex("paper", fallback.paper);
  let ink = hex("ink", fallback.ink);
  const held = holdAgainst(ink, paper, 7);
  if (held !== ink) { notes.push(`ink ${ink} darkened to ${held} for 7:1 on ${paper}`); ink = held; }
  const accent = hex("accent", fallback.accent);
  const colours: Record<Role, string> = {
    paper, ink, accent,
    second: hex("second", mix(accent, ink, 0.4)),
    third: hex("third", mix(accent, paper, 0.55)),
    field: hex("field", mix(paper, accent, 0.18)),
  };
  // A coloured ground that neither ink nor paper reads on is moved toward paper.
  for (const k of ["accent", "second", "third", "field"] as const) {
    let c = colours[k];
    for (let t = 0.15; !carries(c, colours) && t < 1; t += 0.15) c = mix(colours[k], paper, t);
    if (c !== colours[k]) { notes.push(`${k} ${colours[k]} eased to ${c} so type reads on it`); colours[k] = c; }
  }
  const p = (r.panel && typeof r.panel === "object" ? r.panel : {}) as Record<string, unknown>;
  const sh = (p.shadow && typeof p.shadow === "object" ? p.shadow : null) as Record<string, unknown> | null;
  const k = (r.kicker && typeof r.kicker === "object" ? r.kicker : {}) as Record<string, unknown>;
  const fill = "fill" in p ? roleOr(p.fill) : "field";
  const stroke = roleOr(p.stroke);
  return {
    language: {
      ...colours,
      panel: {
        // A panel with neither fill nor stroke would be invisible: it keeps the field.
        fill: fill ?? (stroke ? null : "field"), stroke,
        weight: clamp(p.weight, 0.25, 4, 0.75),
        radius: clamp(p.radius, 0, 20, 0),
        cut: clamp(p.cut, 0, 20, 0),
        shadow: sh && roleOr(sh.colour) ? { dx: clamp(sh.dx, -6, 6, 0), dy: clamp(sh.dy, -6, 6, 0), colour: roleOr(sh.colour)! } : null,
        rotate: clamp(p.rotate, -6, 6, 0),
      },
      title: pick(r.title, ROLES, "ink"),
      kicker: { ground: roleOr(k.ground), bar: roleOr(k.bar), track: clamp(k.track, 0, 0.4, 0.12) },
      motif: String(r.motif ?? "").slice(0, 400),
    },
    notes,
  };
}

/**
 * What the art director is asked for, per section. Vocabulary only: what can
 * be set and in what units. How it should look is the model's to decide from
 * the copy and the issue's direction; nothing here suggests a look.
 */
export const LANGUAGE_GUIDE = `VISUAL LANGUAGE, per section ("language"), decided from the section's copy and the
issue's direction:
- paper, ink: the ground and the text colour (#rrggbb; ink on paper must reach 7:1).
- accent, second, third: three more colours. field: the ground for art areas and bands.
- panel: {"fill": role|null, "stroke": role|null, "weight": pt, "radius": mm, "cut": mm (one
  corner cut off, 0 for none), "shadow": {"dx": mm, "dy": mm, "colour": role}|null, "rotate": degrees}.
- title: the role titles are set in.
- kicker: {"ground": role|null (a filled ground behind it), "bar": role|null (a short bar
  before it), "track": letter-spacing 0-0.4}.
- motif: one or two sentences: what this section's art is built from.
Roles: ${ROLES.join(", ")}. Neighbouring sections must not share a palette or a motif.`;
