/*
 * The page score run against a real issue (Phase 4): read what exists for a
 * page — its layout report, its render, its pictures — have the shim measure
 * the pixels, and score it. `layoutScored` is the loop the layout stage runs:
 * place, render, score, and on a failure mend the page by its cause and try
 * again, at most twice, so a bad page is redesigned before anyone sees it.
 *
 * What each cause can do on its own:
 *   repair        golden-rule repair of the spec; a smaller picture band on overset
 *   re-archetype  another arrangement of the page (PageVariant), honoured by the build
 *   recolour      nothing automatic: a world's colours are the person's decision
 *   redo-image    nothing automatic yet: the picture goes back to the illustration step
 */
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { goldenRules, readMath, repairGoldenRules, type DesignMath } from "./design-rules.js";
import { pageCap } from "./magazine-bar.js";
import { blockRules, gridOf, placedBlocks, type PageBlock } from "./page-blocks.js";
import {
  improvePage, saveScore, scorePage,
  type Checkpoint, type Dim, type Fix, type Improved, type LayoutReport, type MeasuredAsset,
  type MeasuredPage, type PageScore, type PageScoreInput,
} from "./page-score.js";
import type { PageVariant } from "./publication-design.js";
import { issueDir, placePage, readIssue, renderPage, type PublicationIssue, type RunnerContext } from "./publication-runner.js";

/** Where an image frame sits, as page fractions, when no layout report says. */
const FRAME: Readonly<Record<string, { x: number; y: number; w: number; h: number }>> = {
  "full-bleed": { x: 0, y: 0, w: 1, h: 1 },
  top: { x: 0, y: 0, w: 1, h: 0.5 },
  bottom: { x: 0, y: 0.5, w: 1, h: 0.5 },
  left: { x: 0, y: 0, w: 0.5, h: 1 },
  right: { x: 0.5, y: 0, w: 0.5, h: 1 },
  inset: { x: 0.2, y: 0.2, w: 0.6, h: 0.4 },
};

const pageDir = (ctx: RunnerContext, id: string, n: number) => join(issueDir(ctx, id), "pages", String(n).padStart(2, "0"));

/** Spec problems that are about this page: "pages 4-6 ..." or "page 7 ...". */
export function problemsFor(problems: ReadonlyArray<string>, n: number): string[] {
  return problems.filter((p) => {
    const m = /^pages? (\d+)(?:-(\d+))?/.exec(p);
    if (!m) return false;
    const from = Number(m[1]), to = Number(m[2] ?? m[1]);
    return n >= from && n <= to;
  });
}

const wordCount = (text: string | null | undefined) => (text ?? "").trim().split(/\s+/).filter(Boolean).length;

async function shimPost<T>(shimUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${shimUrl}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const out = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `the shim answered ${res.status}`);
  return out;
}

/** The world of the section a page sits in, or the spec's own palette. */
function paletteOf(issue: PublicationIssue, n: number): Record<string, string> {
  const section = (issue.sections ?? []).find((s) => n >= s.from && n <= s.to);
  const world = (issue.design?.sections ?? []).find((w) => w.n === section?.n);
  const spec = issue.design?.spec?.palette;
  const pick = (a?: string, b?: string) => a || b || "";
  // A section that wrote its own language is scored against all of it.
  const l = world?.language;
  if (l) return { paper: l.paper, ink: l.ink, accent: l.accent, second: l.second, third: l.third, field: l.field };
  return {
    paper: pick(world?.paper, spec?.paper), ink: pick(world?.ink, spec?.ink),
    hue: pick(world?.hue, spec?.accent), ...(world?.field ? { field: world.field } : {}),
  };
}

const mathOf = (ctx: RunnerContext, id: string, issue: PublicationIssue) =>
  readMath(ctx.projectRoot, { type: "publication", id, worlds: (issue.design?.sections ?? []).map((w) => w.register) });

async function readLayout(ctx: RunnerContext, id: string, n: number): Promise<LayoutReport | null> {
  try { return JSON.parse(await readFile(join(pageDir(ctx, id, n), "layout.json"), "utf-8")) as LayoutReport; } catch { return null; }
}

/** Score one page from whatever exists for it. Which checkpoint runs follows what is on disk. */
export async function scoreIssuePage(
  ctx: RunnerContext, id: string, n: number, opts: { checkpoint?: Checkpoint; render?: string } = {},
): Promise<{ score: PageScore; math: DesignMath } | null> {
  const issue = await readIssue(ctx, id);
  const page = issue.pages.find((p) => p.n === n);
  if (!page) return null;
  const dir = issueDir(ctx, id);
  const spec = issue.design?.spec ?? null;
  const layout = spec?.pages?.[String(n)];
  const math = await mathOf(ctx, id, issue);
  const palette = paletteOf(issue, n);
  const laid = await readLayout(ctx, id, n);

  const render = opts.render ?? join(pageDir(ctx, id, n), "render.png");
  const rendered = existsSync(render);
  const checkpoint: Checkpoint = opts.checkpoint ?? (rendered ? "page-score" : "spec-lint");

  const input: { -readonly [K in keyof PageScoreInput]: PageScoreInput[K] } = {
    type: "magazine", checkpoint,
    breakDeclared: Boolean(layout?.breaks?.length),
    words: page.words ?? wordCount(page.body),
    cap: pageCap(ctx.definition.densities, page.density, issue.audience) || undefined,
    ...(math.minWhitespace !== undefined ? { whitespaceFloor: math.minWhitespace } : {}),
    ...(math.dominantMin !== undefined ? { dominantMin: math.dominantMin } : {}),
  };
  if (spec) {
    input.specProblems = problemsFor(goldenRules(spec, issue.sections, math), n);
    const blockNotes = blockRules(spec, n, {
      paper: palette.paper ?? "", ink: palette.ink ?? "", accent: spec.palette?.accent || palette.hue || "",
      ...(palette.field ? { field: palette.field } : {}),
    }, math);
    if (blockNotes.length) input.blockNotes = blockNotes;
  }
  if (math.measureMin !== undefined || math.measureMax !== undefined) {
    input.measure = { min: math.measureMin ?? 35, max: math.measureMax ?? 75 };
  }
  if (laid && checkpoint !== "spec-lint") input.layout = laid;

  if (checkpoint === "page-score" && rendered) {
    if (!ctx.shimUrl) throw new Error("scoring a render needs the shim");
    // The image frames as laid, else where the spec says the picture goes.
    const placed = (laid?.frames ?? []).filter((f) => f.role === "image")
      .map((f) => ({ x: f.x / 210, y: f.y / 297, w: f.w / 210, h: f.h / 297 }));
    const slot = layout ? FRAME[layout.imageSlot] : undefined;
    input.measured = await shimPost<MeasuredPage>(ctx.shimUrl, "/score/measure", {
      file: render, palette, frames: placed.length ? placed : slot ? [slot] : [],
      // Every laid frame, for its visual weight (H).
      boxes: (laid?.frames ?? []).map((f) => ({ role: f.role, x: f.x / 210, y: f.y / 297, w: f.w / 210, h: f.h / 297 })),
    });
  }
  if (checkpoint !== "spec-lint" && ctx.shimUrl) {
    const assets: MeasuredAsset[] = [];
    for (const [i, file] of (page.images ?? []).entries()) {
      if (!file) continue;
      const abs = isAbsolute(file) ? file : join(dir, file);
      if (!existsSync(abs)) continue;
      const a = await shimPost<MeasuredAsset & { hasAlpha?: boolean }>(ctx.shimUrl, "/score/asset", { file: abs, palette });
      assets.push({ ...a, slot: `p${n}-${i + 1}`, kind: a.hasAlpha ? "cutout" : "plate" });
    }
    if (assets.length) input.assets = assets;
  }
  return { score: scorePage(input), math };
}

/** One line per scored page into its own stream: a machine's verdict is not a person's, and must not count against a rule on trial. */
export async function logScore(root: string, id: string, n: number, score: PageScore): Promise<void> {
  const dir = join(root, "_taste");
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "score.jsonl"), `${JSON.stringify({
    at: score.at, ref: { type: "publication", id, unit: n }, surface: "score", source: "score",
    checkpoint: score.checkpoint, total: score.total, dims: score.dims,
    cause: score.cause, fix: score.fix, pass: score.pass,
  })}\n`, "utf-8");
}

/** Score, keep it on the page, and log it. */
export async function scoreAndSave(
  ctx: RunnerContext, id: string, n: number, opts: { checkpoint?: Checkpoint; render?: string } = {},
): Promise<PageScore | null> {
  const out = await scoreIssuePage(ctx, id, n, opts);
  if (!out) return null;
  await saveScore(issueDir(ctx, id), n, out.score);
  await logScore(ctx.projectRoot, id, n, out.score).catch(() => undefined);
  return out.score;
}

/** Which arrangement a W or H failure asks for, given what the page has. Null: nothing new to try. */
export function variantFor(cause: Dim, score: PageScore, page: { readonly pullQuote?: string | null; readonly deck?: string | null }, hasImage: boolean, current?: PageVariant): PageVariant | null {
  const says = (score.notes.find((n) => n.dim === cause)?.says ?? "");
  let want: PageVariant | null = null;
  if (hasImage) {
    if (cause === "W") want = /under the/.test(says) ? "small-band" : "large-band";
    else if (cause === "H") want = "large-band";
  } else if (page.pullQuote && current !== "pull") want = "pull";
  else if (page.deck) want = "big-deck";
  return want && want !== current ? want : null;
}

async function writeSpecPage(ctx: RunnerContext, id: string, n: number, change: (s: NonNullable<PublicationIssue["design"]>["spec"]) => typeof s): Promise<boolean> {
  const file = join(issueDir(ctx, id), "publication.json");
  const current = JSON.parse(await readFile(file, "utf-8")) as PublicationIssue;
  if (!current.design?.spec) return false;
  const next = change(current.design.spec);
  if (!next || next === current.design.spec) return false;
  await writeFile(file, JSON.stringify({ ...current, design: { ...current.design, spec: next } }, null, 2), "utf-8");
  return true;
}

/**
 * Lay one page out, render it, score it, and mend it by its cause at most
 * twice. What cannot be mended automatically is left with its score card and
 * cause line for the design gate (`stopped: "no-fix"`).
 */
export async function layoutScored(
  ctx: RunnerContext, id: string, n: number, opts: { maxPasses?: number; onProgress?: (line: string) => void } = {},
): Promise<{ findings: ReadonlyArray<string>; result: Improved }> {
  let findings: ReadonlyArray<string> = [];
  const lay = async () => {
    findings = (await placePage(ctx, id, n)).findings;
    const r = await renderPage(ctx, id, n);
    const target = join(pageDir(ctx, id, n), "render.png");
    if (r.image) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(r.image, target);
    } else {
      opts.onProgress?.(`p${n}: no render (${r.error ?? "Affinity gave no image"}), scored without pixels`);
    }
  };

  await lay();
  const result = await improvePage({
    maxPasses: opts.maxPasses ?? 2,
    score: async () => (await scoreAndSave(ctx, id, n))!,
    fix: async (cause: Dim, fix: Fix, current: PageScore) => {
      const issue = await readIssue(ctx, id);
      const page = issue.pages.find((p) => p.n === n)!;
      const spec = issue.design?.spec;
      if (!spec) return false;
      const cur = spec.pages?.[String(n)];
      const hasImage = (page.images ?? []).some(Boolean);
      let changed = false;
      if (fix === "repair") {
        const math = await mathOf(ctx, id, issue);
        const mended = repairGoldenRules(spec, issue.sections, math);
        if (mended.repairs.length) {
          changed = await writeSpecPage(ctx, id, n, () => mended.spec);
          opts.onProgress?.(`p${n}: repaired - ${mended.repairs.join("; ")}`);
        } else if (cause === "T" && /overset/.test(current.causeLine) && placedBlocks(cur).length) {
          changed = await growBody(ctx, id, n);
        } else if (cause === "T" && hasImage && cur?.variant !== "small-band" && /overset/.test(current.causeLine)) {
          changed = await setVariant(ctx, id, n, "small-band");
        }
      } else if (fix === "re-archetype" && !placedBlocks(cur).length) {
        // A page built from its spec's blocks is the designer's arrangement:
        // variants rearrange the type's default, so there is nothing to swap.
        const v = variantFor(cause, current, page, hasImage, cur?.variant);
        if (v) changed = await setVariant(ctx, id, n, v);
      }
      if (!changed) return false;
      opts.onProgress?.(`p${n}: ${current.causeLine} - laying it out again`);
      await lay();
      return true;
    },
  });
  return { findings, result };
}

/**
 * Overset on a page built from blocks: run the body down to the foot of the
 * grid, as far as no other block of the page's columns is in the way. False
 * when there is no room, so the page stops with its cause for the editor.
 */
async function growBody(ctx: RunnerContext, id: string, n: number): Promise<boolean> {
  return writeSpecPage(ctx, id, n, (spec) => {
    const key = String(n), page = spec?.pages?.[key];
    const blocks = placedBlocks(page);
    const body = blocks.find((b) => b.kind === "body");
    if (!spec || !page || !body) return spec;
    const end = body.slot.row + body.slot.rows;
    const below = blocks.filter((b) => b !== body && b.kind !== "folio" && b.slot.row >= end
      && b.slot.col < body.slot.col + body.slot.span && body.slot.col < b.slot.col + b.slot.span);
    const limit = Math.min(gridOf(spec).rows, ...below.map((b) => b.slot.row));
    if (limit <= end) return spec;
    const grown = (page.blocks ?? []).map((b): PageBlock => (b === body ? { ...b, slot: { ...body.slot, rows: limit - body.slot.row } } : b));
    return { ...spec, pages: { ...spec.pages, [key]: { ...page, blocks: grown } } };
  });
}

async function setVariant(ctx: RunnerContext, id: string, n: number, variant: PageVariant): Promise<boolean> {
  return writeSpecPage(ctx, id, n, (spec) => {
    const key = String(n);
    const page = spec?.pages?.[key] ?? { layout: "editorial", imageSlot: "none" as const };
    return { ...spec!, pages: { ...(spec?.pages ?? {}), [key]: { ...page, variant } } };
  });
}

/* ---------------------------------------------------------- the page made right */

/** The eye's dimensions as the design chips a redesign and the taste stream know. */
const CHIP_OF: Readonly<Record<string, string>> = {
  hierarchy: "hierarchy", space: "whitespace", type: "typography", craft: "typography",
  colour: "colour", picture: "image fit", language: "rules",
};

export interface Perfected {
  readonly n: number;
  readonly pass: boolean;
  /** Pixels and eye together, the higher-is-better number the rounds chase. */
  readonly total: number;
  readonly pixels: number;
  readonly eye: number | null;
  readonly rounds: number;
  readonly faults: ReadonlyArray<string>;
  readonly lessons: ReadonlyArray<string>;
}

/**
 * Make one page right by itself: lay it out, render it, score the pixels, show
 * the proof to the eye (page-look.ts), and while either says no, redesign the
 * page told everything that was found - at most `rounds` times. The best
 * composition seen is the one that stays, laid out again if a later round was
 * worse. A page already judged a pass on this very composition is not redone.
 */
export async function perfectPage(
  ctx: RunnerContext, id: string, n: number,
  opts: { rounds?: number; onProgress?: (line: string) => void } = {},
): Promise<Perfected> {
  const { lookAtPage, readLook, layoutHash, proposeLesson } = await import("./page-look.js");
  const { redesignPage, replanPage } = await import("./publication-runner.js");
  const say = (l: string) => opts.onProgress?.(l);
  const layoutNow = async () => (await readIssue(ctx, id)).design?.spec?.pages?.[String(n)];

  const done = await readLook(issueDir(ctx, id), n);
  const known = await readScoreFile(ctx, id, n);
  const now = await layoutNow();
  if (done?.latest.pass && done.latest.layout === layoutHash(now) && known?.latest?.pass && !now?.composed?.problems?.length) {
    say(`p${n}: already right (pixels ${known.latest.total}, eye ${done.latest.score})`);
    return { n, pass: true, total: Math.round((known.latest.total + done.latest.score) / 2), pixels: known.latest.total, eye: done.latest.score, rounds: 0, faults: [], lessons: [] };
  }

  const max = opts.rounds ?? 3;
  const tried = new Set<string>();
  const lessons: string[] = [];
  let best: { total: number; layout: unknown; out: Perfected; note: string; cause: string[] } | null = null;
  for (let round = 0; ; round++) {
    ctx.signal?.throwIfAborted();
    const { findings, result } = await layoutScored(ctx, id, n, opts.onProgress ? { onProgress: opts.onProgress } : {});
    const errors = findings.filter((f) => f.startsWith("error:")).map((f) => f.slice(7));
    const look = await lookAtPage(ctx, id, n, errors);
    const pixels = result.final;
    const eye = look?.score ?? null;
    const total = eye === null ? pixels.total : Math.round((pixels.total + eye) / 2);
    // The composer's own unresolved problems ("no body frame for the 58 words") hold the build too.
    const composed = (await layoutNow())?.composed?.problems ?? [];
    const faults = [
      ...composed.map((e) => `composition: ${e}`),
      ...errors.map((e) => `measured: ${e}`),
      ...(pixels.pass ? [] : [`pixels ${pixels.causeLine}`]),
      ...(look?.defects ?? []).map((d) => `${d.severity}: ${d.what}${d.where ? ` (${d.where})` : ""}${d.fix ? ` - fix: ${d.fix}` : ""}`),
    ];
    // Without an eye a page is not known to be right, only not known to be wrong.
    const pass = pixels.pass && !errors.length && !composed.length && Boolean(look?.pass);
    if (look?.lesson) lessons.push(look.lesson);
    say(`p${n} round ${round + 1}: pixels ${pixels.total}, eye ${eye ?? "none"}${pass ? " - right" : ` - ${faults.length} fault${faults.length === 1 ? "" : "s"}`}`);
    const out: Perfected = { n, pass, total, pixels: pixels.total, eye, rounds: round + 1, faults, lessons };
    const layout = await layoutNow();
    if (layout?.plan) tried.add(layout.plan);
    const cause = [...new Set(Object.entries(look?.dims ?? {}).filter(([, v]) => v < 80).map(([k]) => CHIP_OF[k]).filter(Boolean))] as string[];
    if (!pixels.pass && pixels.cause) cause.push(({ G: "grid", H: "hierarchy", W: "whitespace", C: "colour", T: "typography", I: "image fit", R: "rules" } as const)[pixels.cause]);
    const note = `The proof was judged. Keep what works and fix every one of these: ${faults.join("; ")}.`
      + (look?.first ? ` The eye first lands on: ${look.first}.` : "");
    if (!best || (pass && !best.out.pass) || (pass === best.out.pass && total > best.total)) best = { total, layout, out, note, cause: [...new Set(cause)] };
    if (pass || round + 1 >= max + 1) break;

    // Each redesign starts from the best round, not the last: Rain l2 p2 went 58 -> 52 redesigning a worse one.
    if (layoutHash(best.layout) !== layoutHash(layout)) {
      const kept = best;
      await writeSpecPage(ctx, id, n, (spec) => (spec ? { ...spec, pages: { ...spec.pages, [String(n)]: kept.layout as NonNullable<typeof spec>["pages"][string] } } : spec));
    }
    // A planned page moves to its next arrangement, ranked for what the proof lacked: no
    // model call, so a round is a layout and a look. A composed page is composed again.
    const planned = (await layoutNow())?.plan;
    if (planned) {
      tried.add(planned);
      const moved = await replanPage(ctx, id, n, tried, best.out.faults);
      if (!moved) { say(`p${n}: every arrangement of this grid has been tried`); break; }
      say(`p${n}: next arrangement - ${moved}`);
    } else {
      await redesignPage(ctx, id, n, { note: best.note, cause: best.cause });
    }
  }

  // The best round stays: a redesign that made the page worse is undone.
  if (best && layoutHash(best.layout) !== layoutHash(await layoutNow())) {
    say(`p${n}: keeping round ${best.out.rounds} (${best.total}), laying it out again`);
    await writeSpecPage(ctx, id, n, (spec) => (spec ? { ...spec, pages: { ...spec.pages, [String(n)]: best!.layout as NonNullable<typeof spec>["pages"][string] } } : spec));
    await layoutScored(ctx, id, n, opts.onProgress ? { onProgress: opts.onProgress } : {});
    await lookAtPage(ctx, id, n);
  }
  for (const l of lessons) await proposeLesson(ctx.projectRoot, l, `publication/${id} p${n}`).catch(() => false);
  return best!.out;
}

/** Every page of an issue made right in turn; the pages that could not be, said. */
export async function perfectIssue(
  ctx: RunnerContext, id: string,
  opts: { rounds?: number; pages?: ReadonlyArray<number>; onProgress?: (line: string) => void } = {},
): Promise<ReadonlyArray<Perfected>> {
  const issue = await readIssue(ctx, id);
  const out: Perfected[] = [];
  for (const p of [...issue.pages].sort((a, b) => a.n - b.n)) {
    if (opts.pages && !opts.pages.includes(p.n)) continue;
    out.push(await perfectPage(ctx, id, p.n, opts));
  }
  return out;
}

async function readScoreFile(ctx: RunnerContext, id: string, n: number) {
  const { readScore } = await import("./page-score.js");
  return readScore(issueDir(ctx, id), n);
}
