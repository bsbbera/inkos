/*
 * The page score (design-skill §12b, 09 §0.3b): how good a page is, and which
 * craft is at fault, so the fix is chosen and not guessed.
 *
 * One function, three checkpoints. They differ only in what has been measured
 * by the time they run, so each is `scorePage` with the inputs it has:
 *
 *   spec-lint    after layout, before any render      spec problems, word caps
 *   asset-check  after post-processing, before layout the placed pictures
 *   page-score   after the page is rendered             all of it, from pixels
 *
 * A dimension nothing has measured is `null`, not 100. A page is never credited
 * for a check that did not run: the total is taken over the dimensions that
 * did, with their weights renormalised, and `unmeasured` says which were left.
 * G (grid) and H (hierarchy) are read from the frame geometry Affinity's
 * inspector reports when the page is laid out (`LayoutReport`); without a
 * layout they are unmeasured.
 *
 * Pure: pixels are measured by the shim (`cli-shim/score.mjs`) and handed in.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type Dim = "G" | "H" | "W" | "C" | "T" | "I" | "R";
export const DIMS: ReadonlyArray<Dim> = ["G", "H", "W", "C", "T", "I", "R"];
export const DIM_NAME: Readonly<Record<Dim, string>> = {
  G: "Grid & geometry", H: "Hierarchy", W: "Whitespace & balance", C: "Colour",
  T: "Typography", I: "Image fit", R: "Rules & breaks",
};

export type ScoreType = "magazine" | "storybook" | "book" | "cover";
type Weighted = Exclude<Dim, "R">;
/** Per production type; each row sums to 1. R is a gate, not a weight. */
export const WEIGHTS: Readonly<Record<ScoreType, Readonly<Record<Weighted, number>>>> = {
  magazine: { G: 0.10, H: 0.20, W: 0.15, C: 0.15, T: 0.15, I: 0.25 },
  storybook: { G: 0.10, H: 0.15, W: 0.20, C: 0.15, T: 0.10, I: 0.30 },
  book: { G: 0.20, H: 0.10, W: 0.20, C: 0.10, T: 0.35, I: 0.05 },
  cover: { G: 0.05, H: 0.30, W: 0.15, C: 0.20, T: 0.10, I: 0.20 },
};

export const PASS_TOTAL = 80;
export const PASS_EACH = 55;

export type Checkpoint = "spec-lint" | "asset-check" | "page-score";

/** What the shim measured on the render (`measureRender`). */
export interface MeasuredPage {
  readonly whitespace: number;
  readonly balance: number;
  readonly lean?: { readonly x: number; readonly y: number };
  readonly shares: Readonly<Record<string, number>>;
  readonly offPalette: number;
  /** Visual weight (mm² x contrast) of each laid frame, when frames were handed in. */
  readonly weights?: ReadonlyArray<{ readonly role: string; readonly weight: number }>;
}

/** A frame as Affinity's inspector found it, in mm on the page; `role` from its tag. */
export interface LaidFrame {
  readonly role: string; readonly text: boolean;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
}

/** What laying the page out reported (`cli-shim/affinity.mjs` INSPECT + buildPage). */
export interface LayoutReport {
  readonly frames: ReadonlyArray<LaidFrame>;
  readonly grid: { readonly x0: number; readonly x1: number; readonly top: number; readonly foot: number; readonly col: number; readonly gut: number; readonly ncol: number };
  readonly findings?: ReadonlyArray<{ readonly level: string; readonly what: string; readonly area?: number }>;
  /** Words per body column after balancing, and the words that did not fit. */
  readonly cols?: { readonly words: ReadonlyArray<number>; readonly overset: number } | null;
  /** Markup that reached the page as characters ("###", "**"). */
  readonly leaks?: ReadonlyArray<string>;
}

/** What the shim measured on one placed picture (`assetCheck`). */
export interface MeasuredAsset {
  readonly slot: string;
  readonly kind?: "cutout" | "plate" | "other";
  readonly fill?: number;
  readonly haloShare?: number;
  readonly deltaE?: number | null;
  readonly dpi?: number;
}

export interface PageScoreInput {
  readonly type: ScoreType;
  readonly checkpoint: Checkpoint;
  readonly measured?: MeasuredPage;
  /** Declared 60-30-10 shares, paper/ink/hue. Defaults to .6/.3/.1. */
  readonly declared?: Readonly<Record<string, number>>;
  /** Whitespace floor for this archetype; 0.25 on editorial pages. */
  readonly whitespaceFloor?: number;
  readonly words?: number;
  readonly cap?: number;
  /** The page declares a break from the rules (08 §5 rule 7). */
  readonly breakDeclared?: boolean;
  /** Spec problems from `goldenRules`: any of them is a hard fail on R. */
  readonly specProblems?: ReadonlyArray<string>;
  readonly contrastFailures?: number;
  readonly assets?: ReadonlyArray<MeasuredAsset>;
  readonly layout?: LayoutReport;
  /** The least share of the page's visual weight the dominant must hold (math `dominantMin`, default 0.4). */
  readonly dominantMin?: number;
}

export interface SubMetric { readonly dim: Dim; readonly penalty: number; readonly says: string }

export type Fix = "repair" | "re-archetype" | "recolour" | "redo-image";
/** Cheapest-first routing from the dimension at fault (design-skill §12b). */
export const FIX_FOR: Readonly<Record<Dim, Fix>> = {
  G: "repair", T: "repair", R: "repair", H: "re-archetype", W: "re-archetype", C: "recolour", I: "redo-image",
};

export interface PageScore {
  readonly at: string;
  readonly checkpoint: Checkpoint;
  readonly total: number;
  /** null: nothing measured it. */
  readonly dims: Readonly<Record<Dim, number | null>>;
  readonly unmeasured: ReadonlyArray<Dim>;
  readonly pass: boolean;
  readonly cause: Dim | null;
  /** "W 48 - ink centroid 31% left of centre, no break declared". */
  readonly causeLine: string;
  readonly fix: Fix | null;
  /** Only an image cause sends a slot back to be drawn again. */
  readonly rerenderImages: boolean;
  readonly notes: ReadonlyArray<SubMetric>;
}

const clamp = (n: number) => Math.round(Math.max(0, Math.min(100, n)));
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function scorePage(input: PageScoreInput): PageScore {
  const notes: SubMetric[] = [];
  const penalty = (dim: Dim, p: number, says: string) => { if (p > 0) notes.push({ dim, penalty: p, says }); };

  // W — whitespace and balance (render).
  const m = input.measured;
  let W: number | null = null;
  if (m) {
    const floor = input.whitespaceFloor ?? 0.25;
    const ceil = floor + 0.25;
    if (m.whitespace < floor) penalty("W", 40 * ((floor - m.whitespace) / floor), `whitespace ${pct(m.whitespace)}, under the ${pct(floor)} floor`);
    else if (m.whitespace > ceil) penalty("W", 40 * ((m.whitespace - ceil) / Math.max(1 - ceil, 0.01)), `whitespace ${pct(m.whitespace)}, over ${pct(ceil)} - the page is dead`);
    // A declared break excuses the lean up to a quarter of the half-diagonal.
    const d = input.breakDeclared ? Math.max(0, m.balance - 0.25) : m.balance;
    const side = m.lean ? (Math.abs(m.lean.x) >= Math.abs(m.lean.y)
      ? `${pct(Math.abs(m.lean.x))} ${m.lean.x < 0 ? "left" : "right"} of centre`
      : `${pct(Math.abs(m.lean.y))} ${m.lean.y < 0 ? "above" : "below"} the optical centre`) : `${pct(m.balance)} off centre`;
    penalty("W", 60 * d, `weight sits ${side}${input.breakDeclared ? "" : ", no break declared"}`);
    W = clamp(100 - sum(notes, "W"));
  }

  // C — colour (render + spec).
  let C: number | null = null;
  if (m) {
    // 60-30-10 is an order (dominant, secondary, accent) and an accent kept
    // small, not pixel shares: body text is ink, yet covers a tenth of a page.
    const declared = input.declared ?? { paper: 0.6, ink: 0.3, hue: 0.1 };
    const roles = Object.keys(declared).sort((a, b) => (declared[b] ?? 0) - (declared[a] ?? 0));
    const onPalette = roles.reduce((s, r) => s + (m.shares[r] ?? 0), 0) || 1;
    const share = (r: string) => (m.shares[r] ?? 0) / onPalette;
    const said = roles.map((r) => `${r} ${pct(share(r))}`).join(" / ");
    for (let i = 1; i < roles.length; i++) {
      if (share(roles[i]!) > share(roles[i - 1]!) + 0.02) penalty("C", 25, `${roles[i]} outweighs ${roles[i - 1]} (${said})`);
    }
    const accent = roles[roles.length - 1]!, cap = (declared[accent] ?? 0.1) * 1.5;
    if (share(accent) > cap) penalty("C", 40 * Math.min(1, (share(accent) - cap) / cap), `the accent covers ${pct(share(accent))}, over ${pct(cap)} (${said})`);
    penalty("C", 35 * m.offPalette, `${pct(m.offPalette)} of the page is outside the palette`);
    if (input.contrastFailures) penalty("C", 15 * input.contrastFailures, `${input.contrastFailures} contrast failure${input.contrastFailures === 1 ? "" : "s"}`);
    C = clamp(100 - sum(notes, "C"));
  } else if (input.contrastFailures !== undefined) {
    penalty("C", 15 * input.contrastFailures, `${input.contrastFailures} contrast failure${input.contrastFailures === 1 ? "" : "s"}`);
    C = clamp(100 - sum(notes, "C"));
  }

  // T — typography (what the spec and text can say without a render).
  let T: number | null = null;
  if (input.words !== undefined && input.cap !== undefined) {
    if (input.words > input.cap) penalty("T", 30, `${input.words} words; a page like this holds ${input.cap}`);
    T = clamp(100 - sum(notes, "T"));
  }

  // I — image fit (asset-check).
  let I: number | null = null;
  if (input.assets?.length) {
    const each = input.assets.map((a) => {
      let p = 0;
      const said: string[] = [];
      if (a.kind === "cutout" && a.fill !== undefined && (a.fill < 0.55 || a.fill > 0.85)) { p += 30; said.push(`fill ${a.fill.toFixed(2)}, outside 0.55-0.85 of its frame`); }
      if (a.haloShare !== undefined && a.haloShare > 0.02) { p += 20; said.push(`a halo: ${pct(a.haloShare)} of its soft pixels sit away from the edge`); }
      if (a.deltaE !== null && a.deltaE !== undefined && a.deltaE > 0.15) { p += 20; said.push(`palette is ${a.deltaE.toFixed(2)} from the world's`); }
      if (a.dpi !== undefined && a.dpi < 150) { p += 30; said.push(`${a.dpi} dpi at slot size`); }
      if (said.length) penalty("I", p, `${a.slot}: ${said.join("; ")}`);
      return clamp(100 - p);
    });
    I = Math.round(each.reduce((s, v) => s + v, 0) / each.length);
  }

  // G and H — from the frames the layout placed.
  let G: number | null = null, H: number | null = null;
  const lay = input.layout;
  if (lay?.frames.length) {
    const { grid } = lay;
    for (const f of lay.findings ?? []) {
      if (f.what === "two text frames overlap") penalty("G", 30, `two text frames overlap by ${f.area ?? "?"} mm²`);
      else if (f.what === "type outside the live area") penalty("G", 15, "type outside the live area");
    }
    // Placed frames start on a column edge (1.2 mm of slack).
    const edges = Array.from({ length: grid.ncol + 1 }, (_, i) => grid.x0 + i * (grid.col + grid.gut));
    const onGrid = (x: number) => edges.some((e) => Math.abs(x - e) <= 1.2) || edges.some((e) => Math.abs(x - (e - grid.gut)) <= 1.2);
    const placed = lay.frames.filter((f) => ["title", "deck", "body", "pull", "image"].includes(f.role) && f.w < 205);
    const off = placed.filter((f) => !onGrid(f.x) && !onGrid(f.x + f.w));
    if (off.length) penalty("G", 10 * off.length, `${off.length} frame${off.length === 1 ? "" : "s"} off the column grid (${off.map((f) => f.role).join(", ")})`);
    G = clamp(100 - sum(notes, "G"));

    // One dominant (design-skill §12b): the leading picture, head or pull holds
    // 40-60 % of the page's visual weight (area x contrast, measured on the
    // render; frame area when there is none). Body text is the field it sits
    // in, counted in the whole but never the dominant. A rival at 80 % of the
    // dominant's weight competes with it.
    const weighed = m?.weights?.length
      ? m.weights.filter((x) => x.role && x.role !== "ground" && x.role !== "folio")
      : lay.frames.filter((f) => f.role && f.role !== "ground" && f.role !== "folio").map((f) => ({ role: f.role, weight: f.w * f.h }));
    const total = weighed.reduce((t, x) => t + x.weight, 0) || 1;
    const leads = weighed.filter((x) => ["image", "title", "pull", "deck"].includes(x.role)).sort((a, b) => b.weight - a.weight);
    const lo = input.dominantMin ?? 0.4, hi = Math.max(lo, 0.6);
    const dom = leads[0];
    const share = dom ? dom.weight / total : 0;
    if (!dom) penalty("H", 50, "no picture, head or pull: nothing dominates");
    else if (share < lo) penalty("H", 50 * (lo - share) / lo, `the ${dom.role} leads with ${pct(share)} of the page's weight, under ${pct(lo)}: nothing dominates`);
    else if (share > hi) penalty("H", 50 * (share - hi) / hi, `the ${dom.role} holds ${pct(share)} of the page's weight, over ${pct(hi)}`);
    for (const rival of leads.slice(1)) if (dom && rival.weight >= 0.8 * dom.weight) penalty("H", 25, `the ${rival.role} competes with the ${dom.role}`);
    const title = lay.frames.find((f) => f.role === "title");
    const body = lay.frames.filter((f) => f.role === "body");
    if (title && body.some((b) => b.y < title.y - 1)) penalty("H", 30, "the body starts above the head");
    H = clamp(100 - sum(notes, "H"));

    // T, from what actually went onto the page.
    if (lay.leaks?.length) penalty("T", 45, `markup printed on the page: ${lay.leaks.join(" ")}`);
    const cols = lay.cols;
    if (cols && cols.overset > 0) penalty("T", 30, `${cols.overset} words overset`);
    if (cols && cols.words.length === 2) {
      const [a, b] = cols.words as [number, number];
      const ratio = Math.min(a, b) / Math.max(a, b, 1);
      if (a + b > 60 && ratio < 0.7) penalty("T", 30 * (0.7 - ratio) / 0.7, `columns unbalanced: ${a} words against ${b}`);
    }
    if ((lay.findings ?? []).some((f) => f.what === "text frame oversets") && !(cols && cols.overset)) penalty("T", 20, "a text frame oversets");
    T = clamp(100 - sum(notes, "T"));
  }

  // R — rules (a gate): any spec problem is a hard fail.
  let R: number | null = null;
  if (input.specProblems !== undefined) {
    for (const p of input.specProblems) penalty("R", 100, p);
    R = input.specProblems.length ? 0 : 100;
  }

  const dims: Record<Dim, number | null> = { G, H, W, C, T, I, R };
  const w = WEIGHTS[input.type];
  const measured = (Object.keys(w) as Weighted[]).filter((d) => dims[d] !== null);
  const weightSum = measured.reduce((s, d) => s + w[d], 0);
  const total = weightSum ? Math.round(measured.reduce((s, d) => s + w[d] * (dims[d] as number), 0) / weightSum) : 100;

  const present = DIMS.filter((d) => dims[d] !== null);
  const eachOk = present.every((d) => (dims[d] as number) >= PASS_EACH);
  const pass = total >= PASS_TOTAL && eachOk && (R === null || R > 0);

  // The cause is the lowest-scoring dimension, named with its worst sub-metric.
  const lowest = present.filter((d) => (dims[d] as number) < 100)
    .sort((a, b) => (dims[a] as number) - (dims[b] as number))[0] ?? null;
  const worst = lowest ? notes.filter((n) => n.dim === lowest).sort((a, b) => b.penalty - a.penalty)[0] : undefined;
  return {
    at: new Date().toISOString(),
    checkpoint: input.checkpoint,
    total,
    dims,
    unmeasured: DIMS.filter((d) => dims[d] === null),
    pass,
    cause: pass ? null : lowest,
    causeLine: pass || !lowest ? "" : `${lowest} ${dims[lowest]} - ${worst?.says ?? DIM_NAME[lowest]}`,
    fix: pass || !lowest ? null : FIX_FOR[lowest],
    rerenderImages: !pass && lowest === "I",
    notes,
  };
}

const sum = (notes: ReadonlyArray<SubMetric>, dim: Dim) => notes.filter((n) => n.dim === dim).reduce((s, n) => s + n.penalty, 0);

/*
 * ------------------------------------------------------------- the two passes
 */

export interface ImprovePass { readonly cause: Dim; readonly fix: Fix; readonly before: number; readonly after: number }
export interface Improved {
  readonly final: PageScore;
  readonly passes: ReadonlyArray<ImprovePass>;
  readonly stopped: "passed" | "no-fix" | "passes-used";
}

/**
 * Redesign a failing page by its cause, at most twice (design-skill §12b).
 *
 * `fix` returns false when it has no automatic repair for that cause - an
 * image cause that must go back to the illustration step, say - and the loop
 * stops there: the person sees the page with its score card and cause line.
 */
export async function improvePage(input: {
  readonly score: () => Promise<PageScore>;
  readonly fix: (cause: Dim, fix: Fix, current: PageScore) => Promise<boolean>;
  readonly maxPasses?: number;
}): Promise<Improved> {
  const max = input.maxPasses ?? 2;
  const passes: ImprovePass[] = [];
  let current = await input.score();
  while (!current.pass && current.cause && current.fix) {
    if (passes.length >= max) return { final: current, passes, stopped: "passes-used" };
    const applied = await input.fix(current.cause, current.fix, current);
    if (!applied) return { final: current, passes, stopped: "no-fix" };
    const next = await input.score();
    passes.push({ cause: current.cause, fix: current.fix, before: current.total, after: next.total });
    current = next;
  }
  return { final: current, passes, stopped: "passed" };
}

/*
 * ------------------------------------------------------------------- storage
 */

export interface ScoreFile { readonly latest: PageScore; readonly history: ReadonlyArray<PageScore> }

/** `<issue>/pages/<nn>/score.json`, where the page bundle keeps its score (Phase 5). */
export const scorePath = (issueDir: string, n: number) => join(issueDir, "pages", String(n).padStart(2, "0"), "score.json");

export async function readScore(issueDir: string, n: number): Promise<ScoreFile | null> {
  try { return JSON.parse(await readFile(scorePath(issueDir, n), "utf-8")) as ScoreFile; } catch { return null; }
}

/** Keep the new score as `latest` and append it to the page's history. */
export async function saveScore(issueDir: string, n: number, score: PageScore): Promise<ScoreFile> {
  const before = await readScore(issueDir, n);
  const file: ScoreFile = { latest: score, history: [...(before?.history ?? []), score].slice(-40) };
  const path = scorePath(issueDir, n);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2), "utf-8");
  return file;
}
