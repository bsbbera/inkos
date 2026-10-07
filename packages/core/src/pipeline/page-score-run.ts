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
import { blockRules, placedBlocks } from "./page-blocks.js";
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

async function setVariant(ctx: RunnerContext, id: string, n: number, variant: PageVariant): Promise<boolean> {
  return writeSpecPage(ctx, id, n, (spec) => {
    const key = String(n);
    const page = spec?.pages?.[key] ?? { layout: "editorial", imageSlot: "none" as const };
    return { ...spec!, pages: { ...(spec?.pages ?? {}), [key]: { ...page, variant } } };
  });
}
