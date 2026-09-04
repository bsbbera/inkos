/**
 * What each stage actually does.
 *
 * The orchestrator decides where a run should be and refuses to do anything
 * itself; that separation is deliberate and it left one thing missing — the
 * table of things to do. Approving content moved a state file and started no
 * work, which is the complaint the whole pipeline exists to answer.
 *
 * An executor takes one unit and returns what it produced. It knows nothing
 * about what comes next: sequencing stays in the orchestrator, so a stage can
 * be re-run, run alone, or run from a test without any of them needing to
 * agree about order.
 *
 * Stages with no entry here are not errors. Most of them are already done by
 * the runners that own them — a chapter is written by the writer, a page laid
 * out by Affinity — and those will be moved behind this table as they are
 * wired. A stage with no executor simply waits for whoever does own it to
 * report the unit done.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeChildPath } from "../utils/path-safety.js";
import { PRODUCTIONS } from "../productions/registry.js";
import { requireRenderer } from "../utils/renderer-preflight.js";

export interface StageContext {
  readonly projectRoot: string;
  readonly type: string;
  readonly id: string;
  readonly unit: number;
  /** Where the shim is. Stages that render need it; the rest ignore it. */
  readonly shimUrl?: string;
  readonly onProgress?: (message: string) => void;
}

export interface StageResult {
  readonly ok: boolean;
  readonly artifacts: ReadonlyArray<string>;
  readonly error?: string;
}

export type StageExecutor = (ctx: StageContext) => Promise<StageResult>;

/**
 * One image to make, in the terms the generator needs rather than the terms
 * the story is written in.
 *
 * `negative` is split out of the prose prompt because every generator takes it
 * as a separate field, and a run that sends "Avoid: halos, light beams" as
 * part of the positive prompt asks for halos and light beams.
 */
export interface ArtBrief {
  readonly slot: string;
  readonly unit: number;
  readonly subject: string;
  readonly prompt: string;
  readonly negative: string;
  readonly width: number;
  readonly height: number;
  readonly workflow: string;
  readonly source: string;
}

function outDirOf(type: string): string {
  const spec = PRODUCTIONS.find((p) => p.id === type);
  if (!spec) throw new Error(`Unknown production type: ${type}`);
  return spec.outDir;
}

/**
 * Split a written cover prompt into what to draw and what not to.
 *
 * The packaging agent writes one paragraph ending in "Avoid: …", which is the
 * house style for these prompts and is not going to change to suit a parser.
 */
export function splitNegative(text: string): { prompt: string; negative: string } {
  const match = /(^|[\s.])avoid:\s*/i.exec(text);
  if (!match) return { prompt: text.trim(), negative: "" };
  const cut = match.index + match[0].length;
  const head = text.slice(0, match.index).trim();
  return { prompt: head, negative: text.slice(cut).trim() };
}

/** The first line that reads like a sentence, as the brief's one-line subject. */
export function subjectOf(prompt: string): string {
  const sentence = prompt.split(/(?<=\.)\s/)[0] ?? prompt;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
}

/**
 * Turn approved content into image briefs.
 *
 * For a short this materialises rather than invents: the packaging agent
 * already wrote a cover prompt at the end of the content stage, and asking a
 * model to write a second one would produce a different cover from the one the
 * person read and approved. The types that have no such prompt get their own
 * executor when they are wired; a missing source is reported, not guessed at.
 */
export const artplan: StageExecutor = async (ctx) => {
  const dir = join(outDirOf(ctx.type), ctx.id);
  const source = join(dir, "final", "cover-prompt.md");
  let text: string;
  try {
    text = await readFile(safeChildPath(ctx.projectRoot, source), "utf-8");
  } catch {
    return {
      ok: false,
      artifacts: [],
      error: `no cover prompt at ${source} — nothing to plan art from`,
    };
  }

  const { prompt, negative } = splitNegative(text.trim());
  if (!prompt) return { ok: false, artifacts: [], error: `${source} is empty` };

  const brief: ArtBrief = {
    slot: "cover",
    unit: ctx.unit,
    subject: subjectOf(prompt),
    prompt,
    negative,
    // 3:4 upright, which is what the cover prompt asks for and what a reader
    // sees first on a phone.
    width: 896,
    height: 1152,
    workflow: "default",
    source,
  };

  const relative = join(dir, "art", "briefs", `${ctx.unit}-cover.json`);
  const file = safeChildPath(ctx.projectRoot, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(brief, null, 2)}\n`, "utf-8");
  ctx.onProgress?.(`Art brief written: ${relative}`);
  return { ok: true, artifacts: [relative.replace(/\\/g, "/")] };
};


/**
 * Render every brief this unit has, and keep the recipe beside the picture.
 *
 * The sidecar is the point of doing this here rather than by hand: an image
 * whose prompt and seed are not written down cannot be regenerated in the same
 * style, so the second cover never matches the first and nobody can say why.
 *
 * A machine with no renderer is a normal state, not a crash. `requireRenderer`
 * says so in words a person can act on, and the failure is recorded against
 * the unit so the screen can show it.
 */
export const generate: StageExecutor = async (ctx) => {
  const dir = join(outDirOf(ctx.type), ctx.id);
  const briefsDir = join(dir, "art", "briefs");
  let names: string[];
  try {
    names = (await readdir(safeChildPath(ctx.projectRoot, briefsDir)))
      .filter((n) => n.startsWith(`${ctx.unit}-`) && n.endsWith(".json"))
      .sort();
  } catch {
    return { ok: false, artifacts: [], error: `no briefs in ${briefsDir} — the art plan has not run` };
  }
  if (names.length === 0) {
    return { ok: false, artifacts: [], error: `no brief for unit ${ctx.unit} in ${briefsDir}` };
  }

  let shim: string;
  try {
    shim = await requireRenderer(ctx.shimUrl, "art generation");
  } catch (error) {
    return { ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error) };
  }

  const made: string[] = [];
  for (const name of names) {
    const brief = JSON.parse(
      await readFile(safeChildPath(ctx.projectRoot, join(briefsDir, name)), "utf-8"),
    ) as ArtBrief;
    const stem = name.replace(/\.json$/, "");
    const imageRelative = join(dir, "art", "generated", `${stem}.png`);
    const outFile = safeChildPath(ctx.projectRoot, imageRelative);
    await mkdir(dirname(outFile), { recursive: true });

    ctx.onProgress?.(`Rendering ${brief.slot} for unit ${ctx.unit}…`);
    const body = await fetch(`${shim}/comfy/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: brief.prompt,
        negative: brief.negative,
        width: brief.width,
        height: brief.height,
        outFile,
      }),
    })
      .then(async (r) => await r.json().catch(() => ({})) as {
        ok?: boolean; error?: string; seed?: number; width?: number; height?: number;
      })
      .catch((e: unknown) => ({ ok: false as const, error: String(e) } as {
        ok?: boolean; error?: string; seed?: number; width?: number; height?: number;
      }));

    if (body.ok === false) {
      return { ok: false, artifacts: made, error: `${brief.slot}: ${body.error ?? "render failed"}` };
    }

    const recipeRelative = join(dir, "art", "generated", `${stem}.recipe.json`);
    await writeFile(
      safeChildPath(ctx.projectRoot, recipeRelative),
      `${JSON.stringify({
        slot: brief.slot,
        unit: brief.unit,
        prompt: brief.prompt,
        negative: brief.negative,
        width: body.width ?? brief.width,
        height: body.height ?? brief.height,
        seed: body.seed ?? null,
        workflow: brief.workflow,
        brief: join(briefsDir, name).replace(/\\/g, "/"),
        at: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf-8",
    );
    made.push(imageRelative.replace(/\\/g, "/"), recipeRelative.replace(/\\/g, "/"));
  }
  return { ok: true, artifacts: made };
};


/**
 * Gather what was made, so the gate has something to be about.
 *
 * The plan calls this a no-op and it nearly is — it runs nothing and decides
 * nothing. What it does is refuse to let the run reach the design gate with
 * nothing behind it: a person asked to approve pictures that were never
 * rendered has been handed a decision the app already knows the answer to.
 */
export const review: StageExecutor = async (ctx) => {
  const dir = join(outDirOf(ctx.type), ctx.id);
  const madeDir = join(dir, "art", "generated");
  let files: string[];
  try {
    files = (await readdir(safeChildPath(ctx.projectRoot, madeDir)))
      .filter((n) => n.startsWith(`${ctx.unit}-`) && !n.endsWith(".recipe.json"))
      .sort();
  } catch {
    return { ok: false, artifacts: [], error: `nothing rendered in ${madeDir}` };
  }
  if (files.length === 0) {
    return { ok: false, artifacts: [], error: `unit ${ctx.unit} has no rendered art to review` };
  }
  ctx.onProgress?.(`${files.length} image${files.length === 1 ? "" : "s"} ready for the design gate`);
  return { ok: true, artifacts: files.map((n) => join(madeDir, n).replace(/\\/g, "/")) };
};

/** Stage id → what does it. Everything absent is owned by a runner, for now. */
export const EXECUTORS: Readonly<Record<string, StageExecutor>> = {
  "design.artplan": artplan,
  "design.generate": generate,
  "design.review": review,
};

export function executorFor(stage: string): StageExecutor | null {
  return EXECUTORS[stage] ?? null;
}
