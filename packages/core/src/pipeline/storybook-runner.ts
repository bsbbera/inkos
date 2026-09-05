/**
 * The storybook, which exists to prove the rails carry a type they were not
 * written for.
 *
 * Every other production here arrived with its own runner: a script runner, a
 * short-fiction runner, a publication runner, each one owning its own
 * sequencing, its own idea of what "done" means, and its own bugs about it.
 * This one owns none of that. It is three functions the orchestrator calls per
 * unit, and the ordering, the gates, the hand-off, the resume and the cancel
 * all come from the graph in the registry.
 *
 * The functions live here rather than in `executors.ts` because two of them
 * need a model, and a model means the Studio's routing table. The Studio
 * registers thin executors that build a context and call these.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeChildPath } from "../utils/path-safety.js";
import { StorybookAgent, type SpreadPlan } from "../agents/storybook.js";
import type { AgentContext } from "../agents/base.js";

export const STORYBOOK_DIR = "storybooks";

/** What a storybook is, before anyone has written a word of it. */
export interface StorybookMeta {
  readonly title: string;
  readonly audience: string;
  readonly brief: string;
  /** Spreads, which is a physical fact about the printed object. */
  readonly spreads: number;
  readonly createdAt: string;
}

function bookDir(id: string): string {
  return join(STORYBOOK_DIR, id);
}

export function spreadPath(id: string, unit: number): string {
  return join(bookDir(id), "spreads", `${String(unit).padStart(4, "0")}.md`);
}

async function readJson<T>(root: string, relative: string): Promise<T> {
  return JSON.parse(await readFile(safeChildPath(root, relative), "utf-8")) as T;
}

async function writeInto(root: string, relative: string, content: string): Promise<void> {
  const file = safeChildPath(root, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf-8");
}

export async function loadStorybook(root: string, id: string): Promise<StorybookMeta> {
  return await readJson<StorybookMeta>(root, join(bookDir(id), "storybook.json"));
}

/**
 * Start one. Writes the description of the book and nothing else — the plan is
 * a stage the pipeline runs, not something creation does behind its back.
 */
export async function createStorybook(input: {
  readonly projectRoot: string;
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly audience?: string;
  readonly spreads?: number;
}): Promise<StorybookMeta> {
  const meta: StorybookMeta = {
    title: input.title,
    audience: input.audience?.trim() || "children of 3 to 6, read to at bedtime",
    brief: input.brief,
    // Twelve spreads is the common short picture book; the number is the
    // caller's to set because it is decided by the printer, not by us.
    spreads: Math.max(1, Math.min(40, Math.trunc(input.spreads ?? 12))),
    createdAt: new Date().toISOString(),
  };
  await writeInto(
    input.projectRoot,
    join(bookDir(input.id), "storybook.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  return meta;
}

/**
 * The whole spread map, written once.
 *
 * The orchestrator calls every stage once per unit, and a plan is not a
 * per-unit thing: a book planned spread by spread has no shape. So the first
 * unit writes the map and the rest find it already there — the same
 * check-then-skip the export stage uses, and what makes the stage resumable.
 */
export async function planStorybook(input: {
  readonly projectRoot: string;
  readonly id: string;
  readonly unit: number;
  readonly agent: AgentContext;
  readonly onProgress?: (message: string) => void;
}): Promise<ReadonlyArray<string>> {
  const relative = join(bookDir(input.id), "plan.json");
  try {
    await readJson<ReadonlyArray<SpreadPlan>>(input.projectRoot, relative);
    return [];
  } catch {
    /* Not planned yet. */
  }

  const meta = await loadStorybook(input.projectRoot, input.id);
  input.onProgress?.(`Planning ${meta.spreads} spreads of "${meta.title}"…`);
  const plan = await new StorybookAgent(input.agent).planSpreads({
    title: meta.title,
    brief: meta.brief,
    audience: meta.audience,
    spreads: meta.spreads,
  });
  await writeInto(input.projectRoot, relative, `${JSON.stringify(plan, null, 2)}\n`);
  input.onProgress?.(`Planned ${plan.length} spreads`);
  return [relative.replace(/\\/g, "/")];
}

/**
 * Write one spread, unless it is already written.
 *
 * The previous spread is read off disk rather than held in memory because the
 * stage may be resumed by a different process than started it — which is the
 * whole reason the pipeline keeps its state on disk.
 */
export async function writeStorybookSpread(input: {
  readonly projectRoot: string;
  readonly id: string;
  readonly unit: number;
  readonly agent: AgentContext;
  readonly onProgress?: (message: string) => void;
}): Promise<ReadonlyArray<string>> {
  const relative = spreadPath(input.id, input.unit);
  try {
    const already = await readFile(safeChildPath(input.projectRoot, relative), "utf-8");
    if (already.trim()) return [];
  } catch {
    /* Not written yet. */
  }

  const meta = await loadStorybook(input.projectRoot, input.id);
  const plan = await readJson<ReadonlyArray<SpreadPlan>>(
    input.projectRoot,
    join(bookDir(input.id), "plan.json"),
  );
  const beat = plan.find((p) => p.spread === input.unit);
  if (!beat) throw new Error(`spread ${input.unit} is not in the plan`);

  const before = input.unit > 1
    ? await readFile(safeChildPath(input.projectRoot, spreadPath(input.id, input.unit - 1)), "utf-8")
      .then((text) => spreadWords(text))
      .catch(() => undefined)
    : undefined;

  input.onProgress?.(`Writing spread ${input.unit} of ${meta.spreads}…`);
  const written = await new StorybookAgent(input.agent).writeSpread({
    title: meta.title,
    audience: meta.audience,
    plan: beat,
    total: meta.spreads,
    ...(before ? { before } : {}),
  });

  await writeInto(input.projectRoot, relative, renderSpread(input.unit, written.text, written.art));
  input.onProgress?.(`Spread ${input.unit}: ${written.text.split(/\s+/).length} words`);
  return [relative.replace(/\\/g, "/")];
}

const ART_MARKER = "**Art:**";

/**
 * One spread, as a file a person can read and edit.
 *
 * Markdown rather than JSON because the audit screen opens these, and asking
 * someone to fix a line of a bedtime story inside a quoted JSON string is how
 * you get nobody fixing it. The art note lives in the same file, below a rule:
 * it is written about these exact words, and separating them means one of them
 * gets edited alone.
 */
export function renderSpread(unit: number, text: string, art: string): string {
  return `# Spread ${unit}\n\n${text.trim()}\n\n---\n\n${ART_MARKER} ${art.trim()}\n`;
}

/** The words on the spread, without the art note or the heading. */
export function spreadWords(markdown: string): string {
  const body = markdown.split(/^---$/m)[0] ?? markdown;
  return body.replace(/^#.*$/m, "").trim();
}

/** The art note, for the stage that turns it into an image brief. */
export function spreadArtNote(markdown: string): string {
  const at = markdown.indexOf(ART_MARKER);
  return at < 0 ? "" : markdown.slice(at + ART_MARKER.length).trim();
}

/**
 * The book as one page you can read, and print from.
 *
 * Not the print PDF the registry would rather have: that wants an Affinity
 * document with a storybook master, and there is not one. This is the proof
 * copy — every spread's picture beside its words, in order, in a single file
 * that opens anywhere and prints one spread to a sheet. It is what an author
 * checks before paying anybody to typeset it, and building it is what lets a
 * storybook run reach the end of its own graph today.
 */
export async function buildStorybookProof(input: {
  readonly projectRoot: string;
  readonly id: string;
  readonly onProgress?: (message: string) => void;
}): Promise<ReadonlyArray<string>> {
  const relative = join(bookDir(input.id), "build", `${input.id}.html`);
  const file = safeChildPath(input.projectRoot, relative);
  const meta = await loadStorybook(input.projectRoot, input.id);

  const art = await readdir(
    safeChildPath(input.projectRoot, join(bookDir(input.id), "art", "generated")),
  ).catch(() => [] as string[]);

  const sections: string[] = [];
  for (let unit = 1; unit <= meta.spreads; unit += 1) {
    const words = await readFile(safeChildPath(input.projectRoot, spreadPath(input.id, unit)), "utf-8")
      .then((text) => spreadWords(text))
      .catch(() => "");
    // `../art/generated/…`: the file sits in build/, and a proof that only
    // opens from the project root is a proof nobody can send anywhere.
    const picture = art.find((n) => n.startsWith(`${unit}-`) && !n.endsWith(".recipe.json"));
    sections.push([
      `<section class="spread">`,
      picture
        ? `  <img src="../art/generated/${encodeURIComponent(picture)}" alt="Spread ${unit}">`
        : `  <div class="missing">No picture for spread ${unit} yet</div>`,
      `  <div class="words">${escapeHtml(words)}</div>`,
      `  <p class="folio">${unit}</p>`,
      `</section>`,
    ].join("\n"));
  }

  const html = [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8">`,
    `<title>${escapeHtml(meta.title)}</title>`,
    `<style>`,
    `  :root { color-scheme: light; }`,
    `  body { margin: 0; background: #f6f4ef; color: #201d18;`,
    `    font: 20px/1.6 Georgia, "Iowan Old Style", serif; }`,
    `  .spread { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;`,
    `    align-items: center; min-height: 90vh; padding: 3rem; page-break-after: always; }`,
    `  .spread img { width: 100%; height: auto; border-radius: 2px; }`,
    `  .missing { display: grid; place-items: center; aspect-ratio: 4/3;`,
    `    border: 1px dashed #b3aa99; color: #7d7566; font-size: 15px; }`,
    `  .words { font-size: 1.4rem; max-width: 22em; }`,
    `  .folio { font-size: 12px; color: #8a8272; }`,
    `  @media print { body { background: #fff } .spread { min-height: 100vh } }`,
    `</style></head><body>`,
    ...sections,
    `</body></html>`,
    ``,
  ].join("\n");

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html, "utf-8");
  input.onProgress?.(`Proof built: ${relative}`);
  return [relative.replace(/\\/g, "/")];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
