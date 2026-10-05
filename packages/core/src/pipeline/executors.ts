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

import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeChildPath } from "../utils/path-safety.js";
import { PRODUCTIONS, type Surface } from "../productions/registry.js";
import { requireRenderer } from "../utils/renderer-preflight.js";
import { castIn, readCast, traitLine } from "./cast.js";
import { composeImagePrompt, readWorld } from "./image-prompt.js";
import { rulesFor } from "./taste-engine.js";
import { kitAssetFor, kitIdOf, latestKit } from "./kit.js";
import { postProcessFor, rollTreatment } from "./treatments.js";

export interface StageContext {
  readonly projectRoot: string;
  readonly type: string;
  readonly id: string;
  readonly unit: number;
  /** Where the shim is. Stages that render need it; the rest ignore it. */
  readonly shimUrl?: string;
  readonly onProgress?: (message: string) => void;
  /**
   * Someone changed their mind.
   *
   * Passed down to whatever the stage waits on rather than polled here: a
   * render is a fetch that can be aborted at the socket, and checking a flag
   * between units would leave a cancelled job holding a GPU for the twenty
   * minutes the current image still takes.
   */
  readonly signal?: AbortSignal;
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
  /** What kind of picture (08 §1). Absent: the type's first allowed surface. */
  readonly surface?: Surface;
  /** How it sits on the page (09 §1). */
  readonly treatment?: string;
  /** For kit furniture: the object, so it is drawn once and reused (07 §1b). */
  readonly subjectKey?: string;
  /** Cast Sheet ids of who is in the picture (08 §9). */
  readonly characters?: ReadonlyArray<string>;
  /** Why the ArtDirector put it here. */
  readonly reason?: string;
  /** A finished answer of "no picture for this unit", with its reason. */
  readonly none?: boolean;
}

async function exists(file: string): Promise<boolean> {
  return await access(file).then(() => true, () => false);
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

/** What the image router answers with; the shim decides which engine drew. */
interface RenderAnswer {
  ok?: boolean;
  error?: string;
  seed?: number;
  width?: number;
  height?: number;
  engine?: string;
  notice?: string;
  fallbackFrom?: string;
}

/**
 * What this brief needs from an engine, which decides where it may be drawn.
 *
 * Hosted engines are cheaper and slower to trust: Canva takes no reference
 * image, cannot repaint part of a picture and has no seed. Rather than let the
 * router guess from the brief, each caller states its requirements and the
 * router matches them against what each engine claims (23 §3.2).
 *
 * A recurring character is the important one. A book's cast has to look the
 * same in chapter 14 as in chapter 1, and the only lever this build has for
 * that is a fixed seed plus an identical prompt — so a brief with cast in it
 * stays on the engine that has seeds.
 */
export function engineNeeds(
  type: string,
  brief: { slot?: string; treatment?: string },
  hasCast: boolean,
): ReadonlyArray<string> {
  const needs: string[] = [];
  if (hasCast) needs.push("refs", "seed");
  // A picture book is one continuous world across every spread; a magazine
  // spot is not, and that is the whole difference in where they may be drawn.
  if (type === "storybook" || type === "storyboard") needs.push("seed");
  if (brief.slot === "cover") needs.push("seed");
  return needs;
}

/** The first line that reads like a sentence, as the brief's one-line subject. */
export function subjectOf(prompt: string): string {
  const sentence = prompt.split(/(?<=\.)\s/)[0] ?? prompt;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
}

/**
 * A picture book plans art per spread, not per book.
 *
 * The generic art plan materialises one cover from the prompt the packaging
 * agent wrote at the end of the content stage. A storybook has no such prompt
 * and would not be served by one: the illustration is the unit, and the note
 * describing it was written beside the words it belongs to, on the spread
 * itself. So this reads that note rather than inventing a second one — the
 * same rule as the cover, applied to a book where every page has a picture.
 *
 * Landscape, because a spread is two pages wide and a portrait brief would
 * produce art that has to be cropped to fit the shape it was made for.
 */
const storybookArtplan = async (ctx: StageContext, dir: string): Promise<StageResult> => {
  const source = join(dir, "spreads", `${String(ctx.unit).padStart(4, "0")}.md`);
  let markdown: string;
  try {
    markdown = await readFile(safeChildPath(ctx.projectRoot, source), "utf-8");
  } catch {
    return { ok: false, artifacts: [], error: `spread ${ctx.unit} is not written yet (${source})` };
  }
  const { spreadArtNote } = await import("./storybook-runner.js");
  const note = spreadArtNote(markdown);
  if (!note) {
    return { ok: false, artifacts: [], error: `spread ${ctx.unit} has no art note to plan from` };
  }

  const { prompt, negative } = splitNegative(note);
  // Variety in a picture book is rhythm (09 §5b): the roll alternates a
  // full-bleed spread with one that breathes on white, from the spreads before.
  const treatment = rollTreatment({
    type: ctx.type, id: ctx.id, unit: ctx.unit, slot: "spread",
    previous: await previousTreatments(ctx.projectRoot, dir, ctx.unit),
  });
  const cast = castIn(markdown, await readCast(ctx.projectRoot, ctx.type, ctx.id));
  const brief: ArtBrief = {
    slot: "spread",
    unit: ctx.unit,
    subject: subjectOf(prompt),
    prompt: await withTaste(ctx, prompt),
    negative,
    width: 1344,
    height: 768,
    workflow: "default",
    source,
    surface: "illustration",
    treatment,
    ...(cast.length ? { characters: cast.map((c) => c.id) } : {}),
  };
  const relative = join(dir, "art", "briefs", `${ctx.unit}-spread.json`);
  const file = safeChildPath(ctx.projectRoot, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(brief, null, 2)}\n`, "utf-8");
  ctx.onProgress?.(`Art brief written: ${relative}`);
  return { ok: true, artifacts: [relative.replace(/\\/g, "/")] };
};

/**
 * The treatments of the two units before this one, most recent first — what
 * the seeded roll needs so neighbours never match.
 */
export async function previousTreatments(
  projectRoot: string,
  dir: string,
  unit: number,
): Promise<Array<string | undefined>> {
  const briefsDir = join(dir, "art", "briefs");
  const names = (await readdir(safeChildPath(projectRoot, briefsDir)).catch(() => [] as string[])).sort();
  const out: Array<string | undefined> = [];
  for (const u of [unit - 1, unit - 2]) {
    let found: string | undefined;
    for (const name of names.filter((n) => n.startsWith(`${u}-`) && n.endsWith(".json"))) {
      const brief = await readFile(safeChildPath(projectRoot, join(briefsDir, name)), "utf-8")
        .then((t) => JSON.parse(t) as Partial<ArtBrief>)
        .catch(() => ({} as Partial<ArtBrief>));
      if (brief.treatment && brief.slot !== "cover") {
        found = brief.treatment;
        break;
      }
    }
    out.push(found);
  }
  return out;
}

/**
 * The person's accepted picture rules (18 §4), added to the end of a prompt.
 * The art director on the design desk read these; the pipeline's own art plan
 * did not, so a rule accepted from ten redone pictures changed nothing here.
 */
const withTaste = async (ctx: StageContext, prompt: string): Promise<string> => {
  const rules = await rulesFor(ctx.projectRoot, { type: ctx.type, id: ctx.id, surface: "image" })
    .catch(() => [] as string[]);
  return rules.length ? `${prompt} ${rules.join(" ")}` : prompt;
};

export async function writeBrief(ctx: StageContext, dir: string, name: string, brief: ArtBrief): Promise<string> {
  const relative = join(dir, "art", "briefs", name);
  const file = safeChildPath(ctx.projectRoot, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(brief, null, 2)}\n`, "utf-8");
  return relative.replace(/\\/g, "/");
}

/**
 * "No picture for this unit" as a finished answer, with its reason — most of a
 * book's chapters, by design. Written as a brief so the generate and review
 * stages see a decision rather than a missing plan.
 */
export async function writeNone(ctx: StageContext, dir: string, reason: string): Promise<StageResult> {
  const relative = await writeBrief(ctx, dir, `${ctx.unit}-none.json`, {
    slot: "none", unit: ctx.unit, subject: "", prompt: "", negative: "", width: 0, height: 0,
    workflow: "default", source: "", none: true, reason,
  });
  ctx.onProgress?.(`Unit ${ctx.unit}: no picture — ${reason}`);
  return { ok: true, artifacts: [relative] };
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
  if (ctx.type === "storybook") return await storybookArtplan(ctx, dir);
  // One cover per book, not one per chapter: every chapter used to get the same
  // cover brief. A chapter's own picture is the ArtDirector's call, which needs
  // a model and is wired by the host; without one, a chapter gets none.
  if (ctx.type === "book" && ctx.unit > 1) {
    return await writeNone(ctx, dir, "a chapter's picture is the art director's call, and none is wired");
  }
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
    prompt: await withTaste(ctx, prompt),
    negative,
    // 3:4 upright, which is what the cover prompt asks for and what a reader
    // sees first on a phone.
    width: 896,
    height: 1152,
    workflow: "default",
    source,
    surface: "illustration",
    treatment: "full-bleed",
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
  const briefs: Array<{ readonly name: string; readonly brief: ArtBrief }> = [];
  for (const name of names) {
    briefs.push({
      name,
      brief: JSON.parse(await readFile(safeChildPath(ctx.projectRoot, join(briefsDir, name)), "utf-8")) as ArtBrief,
    });
  }
  const toDraw = briefs.filter((b) => !b.brief.none);
  if (toDraw.length === 0) {
    ctx.onProgress?.(`Unit ${ctx.unit}: no picture, by design`);
    return { ok: true, artifacts: [] };
  }

  // One world per work (08 §2), its cast (08 §9) and its kit (07 §1b), read once per unit.
  const world = await readWorld(ctx.projectRoot, ctx.type, ctx.id);
  const colours = (world ?? {}) as { paper?: string; ink?: string; hue?: string };
  const cast = await readCast(ctx.projectRoot, ctx.type, ctx.id);
  const kit = await latestKit(ctx.projectRoot, kitIdOf(ctx.type, ctx.id));
  const made: string[] = [];

  // Furniture the kit already holds is copied back, never drawn a second time.
  const fresh: typeof toDraw = [];
  for (const entry of toDraw) {
    const { name, brief } = entry;
    const reuse = brief.subjectKey && kit ? kitAssetFor(kit.manifest, brief.subjectKey) : undefined;
    if (!reuse || !kit) {
      fresh.push(entry);
      continue;
    }
    const stem = name.replace(/\.json$/, "");
    const imageRelative = join(dir, "art", "generated", `${stem}.png`);
    const recipeRelative = join(dir, "art", "generated", `${stem}.recipe.json`);
    await mkdir(dirname(safeChildPath(ctx.projectRoot, imageRelative)), { recursive: true });
    await copyFile(safeChildPath(ctx.projectRoot, reuse.file), safeChildPath(ctx.projectRoot, imageRelative));
    await writeFile(safeChildPath(ctx.projectRoot, recipeRelative), `${JSON.stringify({
      type: ctx.type,
      id: ctx.id,
      unit: brief.unit,
      slot: brief.slot,
      ...(brief.treatment ? { treatment: brief.treatment } : {}),
      subjectKey: brief.subjectKey,
      brief: join(briefsDir, name).replace(/\\/g, "/"),
      engine: "kit",
      reusedFrom: reuse.file,
      kit: kit.manifest.id,
      at: new Date().toISOString(),
    }, null, 2)}\n`, "utf-8");
    ctx.onProgress?.(`Reused ${reuse.file} from the kit for the ${brief.slot} — it was drawn once already`);
    made.push(imageRelative.replace(/\\/g, "/"), recipeRelative.replace(/\\/g, "/"));
  }
  if (fresh.length === 0) return { ok: true, artifacts: made };

  let shim: string;
  try {
    shim = await requireRenderer(ctx.shimUrl, "art generation");
  } catch (error) {
    return { ok: false, artifacts: made, error: error instanceof Error ? error.message : String(error) };
  }

  for (const { name, brief } of fresh) {
    const stem = name.replace(/\.json$/, "");
    const imageRelative = join(dir, "art", "generated", `${stem}.png`);
    const outFile = safeChildPath(ctx.projectRoot, imageRelative);
    await mkdir(dirname(outFile), { recursive: true });
    // Who is in the picture, described the same way every time. No installed
    // workflow can take a reference image for this base model, so identity
    // rides on the prompt alone — and the recipe says so, so a coherence check
    // knows to look harder (09 §3b).
    const members = cast.filter((c) => brief.characters?.includes(c.id));
    const composed = composeImagePrompt({
      type: ctx.type,
      prompt: brief.prompt,
      negative: brief.negative,
      world,
      ...(brief.surface ? { surface: brief.surface } : {}),
      ...(brief.treatment ? { treatment: brief.treatment } : {}),
      ...(members.length ? { cast: members.map(traitLine) } : {}),
    });

    ctx.onProgress?.(`Rendering ${brief.slot} for unit ${ctx.unit}${brief.treatment ? ` (${brief.treatment})` : ""}…`);
    // The shim writes the recipe beside the picture and runs the treatment's
    // post-process on it; this says what it is for.
    const body = await fetch(`${shim}/image/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      body: JSON.stringify({
        prompt: composed.prompt,
        negative: composed.negative,
        width: brief.width,
        height: brief.height,
        outFile,
        ...(brief.surface ? { surface: brief.surface } : {}),
        needs: engineNeeds(ctx.type, brief, members.length > 0),
        post: postProcessFor(brief.treatment, colours),
        // Picks a technique LoRA when the workflow in force can take one (09 §2B).
        ...((world as { technique?: unknown } | null)?.technique
          ? { technique: String((world as { technique?: unknown }).technique) } : {}),
        recipe: {
          type: ctx.type,
          id: ctx.id,
          unit: brief.unit,
          slot: brief.slot,
          ...(brief.treatment ? { treatment: brief.treatment } : {}),
          ...(brief.subjectKey ? { subjectKey: brief.subjectKey } : {}),
          brief: join(briefsDir, name).replace(/\\/g, "/"),
          components: composed.components,
          ...(members.length ? {
            characters: members.map((m) => m.id),
            castSheets: members.map((m) => ({ id: m.id, version: m.version, chosen: m.chosen ?? null })),
            identity: "prompt-only",
          } : {}),
          ...(kit ? { kit: kit.manifest.id } : {}),
        },
      }),
    })
      .then(async (r) => await r.json().catch(() => ({})) as RenderAnswer)
      .catch((e: unknown) => ({ ok: false as const, error: String(e) } as RenderAnswer));

    if (body.ok === false) {
      return { ok: false, artifacts: made, error: `${brief.slot}: ${body.error ?? "render failed"}` };
    }
    // A hosted engine that ran out mid-run is not an error, but it is news:
    // say it once, where the person is already watching (23 §3.2).
    if (body.notice) ctx.onProgress?.(body.notice);

    // Written by the shim beside the image, from the facts sent above.
    const recipeRelative = join(dir, "art", "generated", `${stem}.recipe.json`);
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
  const files = (await readdir(safeChildPath(ctx.projectRoot, madeDir)).catch(() => [] as string[]))
    .filter((n) => n.startsWith(`${ctx.unit}-`) && !n.endsWith(".recipe.json"))
    .sort();
  if (files.length === 0) {
    // A unit the art plan decided to leave bare is finished, not missing.
    if (await exists(safeChildPath(ctx.projectRoot, join(dir, "art", "briefs", `${ctx.unit}-none.json`)))) {
      ctx.onProgress?.(`Unit ${ctx.unit} has no picture, by design`);
      return { ok: true, artifacts: [] };
    }
    return { ok: false, artifacts: [], error: `unit ${ctx.unit} has no rendered art to review (${madeDir})` };
  }
  ctx.onProgress?.(`${files.length} image${files.length === 1 ? "" : "s"} ready for the design gate`);
  return { ok: true, artifacts: files.map((n) => join(madeDir, n).replace(/\\/g, "/")) };
};

function shapeOf(type: string): string {
  const spec = PRODUCTIONS.find((p) => p.id === type);
  if (!spec?.pipeline) throw new Error(`${type} does not run a pipeline`);
  return spec.pipeline.buildShape;
}

/**
 * Put one unit into the document.
 *
 * Only page-shaped work has a layout step worth running per unit: a magazine
 * page is placed on a spread that already exists, so `placePage` does exactly
 * one page and leaves the other thirty-nine alone.
 *
 * Reflow-shaped work — a book, a short, a translation — has no per-unit layout
 * at all: text pours across master pages and a chapter has no fixed place. That
 * needs the reflow script that does not exist yet, and saying so is the honest
 * answer. Passing silently would walk the run to a build gate with nothing
 * behind it, which is the failure this whole stage exists to prevent.
 */
export const layout: StageExecutor = async (ctx) => {
  const shape = shapeOf(ctx.type);
  // A screenplay's layout is its industry format and a storyboard's is a panel
  // grid; both are set whole by the export, so there is nothing to place here.
  if (shape === "screenplay" || ctx.type === "storyboard") {
    ctx.onProgress?.(`${ctx.type}: laid out whole at export`);
    return { ok: true, artifacts: [] };
  }
  if (shape !== "page-shaped") {
    return {
      ok: false,
      artifacts: [],
      error: `${ctx.type} is ${shape}, and nothing lays that out yet`
        + " — its pages are not placed one at a time",
    };
  }
  if (ctx.type !== "publication") {
    return { ok: false, artifacts: [], error: `no layout for ${ctx.type} yet` };
  }

  // Imported here rather than at the top because the publication runner
  // reports into the orchestrator, which owns this table: importing it up
  // there would close a cycle.
  const [{ openIssueContext }, runner] = await Promise.all([
    import("./publication-context.js"),
    import("./publication-runner.js"),
  ]);
  try {
    const { ctx: issueCtx } = await openIssueContext(ctx.projectRoot, ctx.id, {
      ...(ctx.shimUrl ? { shimUrl: ctx.shimUrl } : {}),
    });
    const out = await runner.placePage(issueCtx, ctx.id, ctx.unit);
    // Findings are what the layout inspector noticed, not a failure: a page
    // can break a rule and still be the page. They belong on the progress
    // line so the person at the design gate sees them before signing.
    for (const finding of out.findings) ctx.onProgress?.(`p${ctx.unit}: ${finding}`);
    ctx.onProgress?.(`Page ${ctx.unit} laid out`);
    return { ok: true, artifacts: [] };
  } catch (error) {
    return { ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * Make the file the reader actually gets.
 *
 * An export is a property of the whole work, not of a unit — one epub, one
 * PDF — but the orchestrator calls a stage once per unit, so this checks for
 * the finished file first and does nothing when it is already there. That is
 * also what makes it resumable: a run interrupted after the export but before
 * the last unit was recorded does not build the book twice.
 */
export const exportWork: StageExecutor = async (ctx) => {
  const shape = shapeOf(ctx.type);
  const dir = join(outDirOf(ctx.type), ctx.id);
  const printed = join(dir, "build", "print", "interior.pdf");
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  /*
   * The print edition, when this work has one. `optional` is for work that
   * already shipped something readable (a book's epub, a storybook's proof):
   * a machine without Typst still finishes the run, and says what is missing.
   */
  const print = async (optional: boolean): Promise<StageResult> => {
    if (await exists(safeChildPath(ctx.projectRoot, printed))) return { ok: true, artifacts: [] };
    const { buildPrintEdition, TypstMissing } = await import("./typeset.js");
    try {
      const out = await buildPrintEdition({
        projectRoot: ctx.projectRoot, type: ctx.type, id: ctx.id, workRel: dir,
        ...(ctx.onProgress ? { onProgress: ctx.onProgress } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      return { ok: true, artifacts: [out.interior, ...(out.cover ? [out.cover] : []), out.packageDir] };
    } catch (error) {
      // When something readable already shipped, a print edition that could
      // not be made is news, not a failed run — whatever the reason.
      if (optional) {
        ctx.onProgress?.(error instanceof TypstMissing ? error.message : `Print edition not made: ${message(error)}`);
        return { ok: true, artifacts: [] };
      }
      return { ok: false, artifacts: [], error: message(error) };
    }
  };

  if (shape === "reflow-shaped" && ctx.type === "book") {
    const relative = join(dir, "build", `${ctx.id}.epub`);
    const file = safeChildPath(ctx.projectRoot, relative);
    const made: string[] = [];
    if (!(await exists(file))) {
      const { StateManager } = await import("../state/manager.js");
      const { writeExportArtifact } = await import("../interaction/export-artifact.js");
      try {
        await mkdir(dirname(file), { recursive: true });
        const out = await writeExportArtifact(
          new StateManager(ctx.projectRoot),
          ctx.id,
          { format: "epub", outputPath: file },
        );
        ctx.onProgress?.(`Built ${out.chaptersExported} chapters into ${relative}`);
        made.push(relative.replace(/\\/g, "/"));
      } catch (error) {
        return { ok: false, artifacts: [], error: message(error) };
      }
    }
    const p = await print(true);
    return { ...p, artifacts: [...made, ...p.artifacts] };
  }

  // A short and a translation ship on paper or not at all.
  if (shape === "reflow-shaped" || shape === "screenplay" || ctx.type === "storyboard") {
    return await print(false);
  }

  if (ctx.type === "storybook") {
    const { buildStorybookProof } = await import("./storybook-runner.js");
    const relative = join(dir, "build", `${ctx.id}.html`);
    let made: ReadonlyArray<string> = [];
    if (!(await exists(safeChildPath(ctx.projectRoot, relative)))) {
      try {
        made = await buildStorybookProof({
          projectRoot: ctx.projectRoot,
          id: ctx.id,
          ...(ctx.onProgress ? { onProgress: ctx.onProgress } : {}),
        });
      } catch (error) {
        return { ok: false, artifacts: [], error: message(error) };
      }
    }
    const p = await print(true);
    return { ...p, artifacts: [...made, ...p.artifacts] };
  }

  // Played in the app's own player; there is no file to make and nothing to print.
  if (shape === "not-paper") {
    ctx.onProgress?.(`${ctx.type} plays in the app — nothing to print`);
    return { ok: true, artifacts: [] };
  }

  if (shape === "page-shaped" && ctx.type === "publication") {
    const [{ openIssueContext }, runner] = await Promise.all([
      import("./publication-context.js"),
      import("./publication-runner.js"),
    ]);
    try {
      const { ctx: issueCtx, issue } = await openIssueContext(ctx.projectRoot, ctx.id, {
        ...(ctx.shimUrl ? { shimUrl: ctx.shimUrl } : {}),
      });
      const pdf = issue.build?.pdf ?? (await runner.build(issueCtx, ctx.id)).build?.pdf ?? null;
      if (!pdf) return { ok: false, artifacts: [], error: "Affinity finished without writing a PDF" };
      ctx.onProgress?.(`Built ${pdf}`);
      // The issue's own pages are the interior; preflight them for the press.
      const { buildPrintEdition } = await import("./typeset.js");
      const issueRel = join(outDirOf(ctx.type), "issues", ctx.id);
      const edition = await buildPrintEdition({
        projectRoot: ctx.projectRoot, type: ctx.type, id: ctx.id, workRel: issueRel,
        interiorPdf: pdf,
        ...(ctx.onProgress ? { onProgress: ctx.onProgress } : {}),
      }).catch((error: unknown) => {
        ctx.onProgress?.(`Print folder not written: ${message(error)}`);
        return null;
      });
      return { ok: true, artifacts: [pdf, ...(edition ? [edition.packageDir] : [])] };
    } catch (error) {
      return { ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    ok: false,
    artifacts: [],
    error: `nothing builds ${ctx.type} yet (${shape})`
      + " — the run is finished as far as this app can take it",
  };
};

/**
 * Research the world, when something upstairs knows how to.
 *
 * `content.research` is declared by every production type (22 §3), and the
 * thing that can actually do it needs a model, so it is registered by the
 * Studio. This is what runs when nobody registered anything: a pass-through,
 * so a work with no setting — which is most of them — walks straight on.
 *
 * It has to exist rather than being left absent. An unregistered stage is
 * treated as owned by some other runner and the run simply stops there, which
 * for the *first* stage of every graph means nothing ever starts.
 */
const research: StageExecutor = async () => ({ ok: true, artifacts: [] });

/** Stage id → what does it. Everything absent is owned by a runner, for now. */
export const EXECUTORS: Readonly<Record<string, StageExecutor>> = {
  "content.research": research,
  "design.artplan": artplan,
  "design.generate": generate,
  "design.review": review,
  "build.layout": layout,
  "build.export": exportWork,
};

/**
 * Stages the host wires in at boot.
 *
 * Some stages cannot live in this file honestly. A de-slop pass needs a model,
 * and a model here means the project's router, its per-agent overrides and its
 * key handling — all of which live in the Studio, above this layer. Importing
 * that down into the engine would invert the dependency and drag the whole
 * server into every test that touches a stage.
 *
 * So the Studio hands the stage in instead. Registration is the only mutable
 * thing here and it happens once, at start-up, before any run moves.
 */
const registered = new Map<string, StageExecutor>();

/**
 * Register a stage, for one production type or for all of them.
 *
 * The type matters more than it looks. Registration wins over the table, and a
 * stage id is shared: `content.plan` is a stage of a book, a script, a
 * storyboard and a storybook. Registering the storybook's planner under the
 * bare stage id would hand every book's plan stage to it — and because a
 * registered executor that refuses is a *failed unit*, where no executor at all
 * is a stage that waits for its own runner, that mistake does not degrade
 * quietly. It fails every book at its first stage.
 */
export function registerExecutor(stage: string, executor: StageExecutor, type?: string): void {
  registered.set(type ? `${type}:${stage}` : stage, executor);
}

export function executorFor(stage: string, type?: string): StageExecutor | null {
  const forType = type ? registered.get(`${type}:${stage}`) : undefined;
  return forType ?? registered.get(stage) ?? EXECUTORS[stage] ?? null;
}
