/**
 * The pictures a creation has, and what a person does to one (04 §2).
 *
 * Images were written into each work's folder with a recipe beside them, and
 * then nothing could see them: no screen listed them, the file route refused
 * most of them, and the only way to be rid of a bad one was the file explorer.
 * This is the gallery's back end. Files stay the truth — the list is a walk of
 * the work's folder, a verdict lives in the recipe beside its picture, and
 * delete is a move into `art/.trash/`. Only `purge` destroys anything, and only
 * what is already in the trash.
 *
 * The actions are exported as well as routed, because the Verdict control
 * (taste.ts) does the same things: "keep" chooses, "reject" trashes, "redo"
 * redraws.
 */
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import {
  KIT_SLOTS, KITS_DIR, PRODUCTIONS, TREATMENTS_BY_SLOT, captureIntoKit, composeImagePrompt, enqueueJob,
  kitIdOf, postProcessFor, readWorld, safeChildPath, workDirOf, worldPathOf,
  type ImageWorld, type Job, type KitAsset,
} from "@actalk/quire-core";

/**
 * The person's own folder in every work (04 §6). Not `final/`: a short's
 * pipeline already writes its finished text there, and a folder the pipeline
 * writes to cannot also be the one it promises never to touch.
 */
export const MY_FINAL = "my-final";

/**
 * Which images the file route may serve, and so which the gallery lists.
 *
 * The three folders that always could, covers, the kit library, and inside a
 * production: generated art, the person's own final, and cast references.
 * Everything else under a book stays private, as it always was: a picture the
 * gallery lists but cannot show is worse than one it does not list.
 */
export function isServableImage(relPath: string): boolean {
  if (["shorts/", "covers/", "interactive-films/", `${KITS_DIR}/`].some((p) => relPath.startsWith(p))) return true;
  const parts = relPath.split("/");
  return PRODUCTIONS.some((p) => relPath.startsWith(`${p.outDir}/`))
    && (parts.includes("art") || parts.includes(MY_FINAL) || (parts.includes("design") && parts.includes("cast")));
}

export interface AssetRouteDeps {
  readonly root: string;
  readonly broadcast: (event: string, data: unknown) => void;
  readonly shimUrl: () => string;
}

type Recipe = Record<string, unknown>;

export interface Asset {
  /** Workspace-relative, forward slashes. */
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly modified: string;
  /** What made it, or null for a picture from before recipes were kept. */
  readonly recipe: Recipe | null;
  /** When it was chosen as its unit's picture. */
  readonly approved: string | null;
  /** Drawn before the work's current world was chosen — a re-world makes pictures stale (08 §2b). */
  readonly stale: boolean;
  /** Rendered here, copied back from the kit, or put in by the person with their final. */
  readonly source: "generated" | "kit" | "user";
}

const IMAGE = /\.(png|jpe?g|webp)$/i;
const TRASH = "art/.trash";
const posix = (p: string) => p.replace(/\\/g, "/");
const text = (v: unknown) => (typeof v === "string" ? v : "");
/* Read when asked, not at import: nothing from the engine is touched while this module loads. */
const allTreatments = () => new Set(Object.values(TREATMENTS_BY_SLOT).flat());

export const recipePathOf = (image: string): string => `${image.replace(IMAGE, "")}.recipe.json`;

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > 6) return;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    // `.trash` and `.raw` are dot-named, so a normal listing never shows what
    // was deleted or the untreated original. `design/` holds cast references,
    // which the design desk shows, not the gallery.
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "design") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, depth + 1, out);
    else if (IMAGE.test(entry.name)) out.push(full);
  }
}

async function readRecipe(root: string, image: string): Promise<Recipe | null> {
  try {
    return JSON.parse(await readFile(join(root, recipePathOf(image)), "utf-8")) as Recipe;
  } catch {
    return null;
  }
}

async function writeRecipe(root: string, image: string, recipe: Recipe): Promise<void> {
  await writeFile(join(root, recipePathOf(image)), `${JSON.stringify(recipe, null, 2)}\n`, "utf-8");
}

const exists = async (file: string) => access(file).then(() => true, () => false);

export async function listAssets(root: string, type: string, id: string, trash = false): Promise<Asset[]> {
  const base = posix(workDirOf(type, id));
  const files: string[] = [];
  await walk(join(root, trash ? `${base}/${TRASH}` : base), 0, files);
  const worldAt = trash ? null : await readFile(join(root, worldPathOf(type, id)), "utf-8")
    .then((t) => text((JSON.parse(t) as Recipe).at) || null)
    .catch(() => null);
  const out: Asset[] = [];
  for (const file of files) {
    const path = posix(file.slice(root.length).replace(/^[\\/]+/, ""));
    if (!isServableImage(path)) continue;
    try {
      const info = await stat(file);
      const recipe = await readRecipe(root, path);
      const at = text(recipe?.at);
      out.push({
        path,
        name: path.split("/").pop() ?? path,
        bytes: info.size,
        modified: info.mtime.toISOString(),
        recipe,
        approved: typeof recipe?.approved === "string" ? recipe.approved : null,
        stale: Boolean(worldAt && at && at < worldAt),
        source: path.split("/").includes(MY_FINAL) ? "user" : recipe?.engine === "kit" ? "kit" : "generated",
      });
    } catch { /* gone between the walk and the stat */ }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** A path the caller sent, proven to be a picture inside this work. */
function pictureIn(root: string, type: string, id: string, raw: unknown, where: "work" | "trash"): string {
  const base = `${posix(workDirOf(type, id))}/`;
  const path = posix(String(raw ?? "").trim());
  const inTrash = path.startsWith(`${base}${TRASH}/`);
  if (!path.startsWith(base) || !IMAGE.test(path) || path.split("/").includes("..")
    || (where === "trash") !== inTrash) {
    throw new Error(where === "trash" ? "that is not a picture in this work's trash" : "that is not a picture in this work");
  }
  safeChildPath(root, path);
  return path;
}

async function move(root: string, from: string, to: string): Promise<void> {
  await mkdir(dirname(join(root, to)), { recursive: true });
  await rename(join(root, from), join(root, to));
  if (await exists(join(root, recipePathOf(from)))) {
    await rename(join(root, recipePathOf(from)), join(root, recipePathOf(to)));
  }
}

/** A magazine page, edited in its issue file. The Affinity build reads the page, not the gallery. */
async function editIssuePage(
  root: string,
  id: string,
  unit: number,
  edit: (page: Record<string, unknown>) => void,
): Promise<void> {
  const file = join(root, workDirOf("publication", id), "publication.json");
  try {
    const issue = JSON.parse(await readFile(file, "utf-8")) as { pages?: Array<Record<string, unknown>> };
    const page = issue.pages?.find((p) => p.n === unit);
    if (!page) return;
    edit(page);
    await writeFile(file, `${JSON.stringify(issue, null, 2)}\n`, "utf-8");
  } catch { /* an issue file that will not parse is the issue screen's to report */ }
}

/** The world's paper, ink and hue for a picture: the work's world, or its magazine section's. */
async function coloursFor(root: string, type: string, id: string, recipe: Recipe): Promise<{ paper?: string; ink?: string; hue?: string }> {
  let world: Recipe | null = null;
  if (type === "publication") {
    const issue = await readFile(join(root, workDirOf(type, id), "publication.json"), "utf-8")
      .then((t) => JSON.parse(t) as { design?: { sections?: Recipe[] } }).catch(() => null);
    world = issue?.design?.sections?.find((s) => s.n === recipe.section) ?? null;
  } else {
    world = (await readWorld(root, type, id)) as Recipe | null;
  }
  const pick = (k: string) => (/^#[0-9a-f]{6}$/i.test(text(world?.[k])) ? { [k]: text(world?.[k]) } : {});
  return { ...pick("paper"), ...pick("ink"), ...pick("hue") };
}

/**
 * Choose a picture as its unit's picture. Others for the same unit and slot
 * stay as candidates, no longer chosen. Choosing furniture — an ornament, a
 * tailpiece, a texture — also keeps it in the work's kit, so it is never drawn
 * again (07 §1b, capture on first use). Choosing a magazine picture points its
 * page at it, which is what the layout builds from.
 */
export async function approveAsset(
  root: string, type: string, id: string, raw: unknown, approve = true,
): Promise<{ readonly approved: string | null; readonly captured: KitAsset | null }> {
  const path = pictureIn(root, type, id, raw, "work");
  const all = await listAssets(root, type, id);
  const me = all.find((a) => a.path === path);
  if (!me) throw new Error("that picture is not there any more");
  const at = approve ? new Date().toISOString() : null;
  const { unit, slot } = me.recipe ?? {};
  for (const a of all) {
    if (a.path === path) {
      await writeRecipe(root, a.path, { ...(a.recipe ?? {}), approved: at });
    } else if (at && a.approved && unit !== undefined && slot !== undefined
      && a.recipe?.unit === unit && a.recipe?.slot === slot) {
      await writeRecipe(root, a.path, { ...a.recipe, approved: null });
    }
  }
  let captured: KitAsset | null = null;
  if (at) {
    const kind = text(slot);
    if (KIT_SLOTS.includes(kind)) {
      captured = await captureIntoKit(root, kitIdOf(type, id), {
        file: path,
        kind: kind === "texture" ? "texture" : "ornament",
        origin: "captured",
        state: "approved",
        subjectKey: text(me.recipe?.subjectKey) || me.name.replace(IMAGE, ""),
      }).catch(() => null);
    }
    if (type === "publication" && typeof unit === "number") {
      await editIssuePage(root, id, unit, (page) => { page.image = join(root, path); });
    }
  }
  return { approved: at, captured };
}

/** Into the trash, recipe and all. Recoverable. */
export async function trashAsset(root: string, type: string, id: string, raw: unknown): Promise<string> {
  const path = pictureIn(root, type, id, raw, "work");
  const base = `${posix(workDirOf(type, id))}/`;
  const to = `${base}${TRASH}/${path.slice(base.length)}`;
  if (await exists(join(root, to))) await rm(join(root, to), { force: true });
  await move(root, path, to);
  return to;
}

/** A verdict's stream id, kept in the recipe beside its picture (18 §5). */
export async function rememberOnRecipe(root: string, raw: string, entry: Record<string, unknown>): Promise<void> {
  const path = posix(raw);
  safeChildPath(root, path);
  if (!IMAGE.test(path)) return;
  const recipe = (await readRecipe(root, path)) ?? {};
  const feedback = Array.isArray(recipe.feedback) ? recipe.feedback : [];
  await writeRecipe(root, path, { ...recipe, feedback: [...feedback, entry] });
}

/**
 * Draw it again with a note, as a new picture beside the old one.
 *
 * Re-composed from the recipe's parts rather than its final prompt, so the
 * note changes the subject and the world stays the world it was drawn in.
 * The new recipe names its parent — the lineage a redesign is traced by.
 * Runs on the job queue: a render is minutes, and it holds the GPU.
 *
 * `subject` replaces what the picture shows outright — the description edited
 * in the gallery (13 rev. C). The style still comes from the world at render
 * time, so a picture's content changes without touching the text it sits
 * beside; on a magazine page the page's brief takes the new description too,
 * so the next art run draws what was asked for, not the old words.
 */
export async function redesignAsset(
  deps: AssetRouteDeps, type: string, id: string, raw: unknown, note: string, subjectEdit = "",
): Promise<{ readonly job: Job; readonly path: string }> {
  const { root, broadcast } = deps;
  const path = pictureIn(root, type, id, raw, "work");
  const recipe = await readRecipe(root, path);
  if (!recipe) throw new Error("there is no recipe beside this picture, so it cannot be redrawn in the same style");
  const parts = (recipe.components ?? {}) as Record<string, unknown>;
  const world: ImageWorld = {
    imagePrompt: text(parts.world),
    technique: text(parts.technique),
    negative: text(parts.worldNegative),
    props: Array.isArray(parts.props) ? parts.props.map(String) : [],
  };
  const subject = subjectEdit || text(parts.subject) || text(recipe.prompt);
  const treatment = text(recipe.treatment);
  const composed = composeImagePrompt({
    type,
    prompt: note ? `${subject.replace(/[\s.]+$/, "")}. ${note}` : subject,
    negative: text(parts.briefNegative),
    world,
    ...(treatment ? { treatment } : {}),
    ...(Array.isArray(parts.cast) && parts.cast.length ? { cast: parts.cast.map(String) } : {}),
  });
  const post = postProcessFor(treatment || undefined, await coloursFor(root, type, id, recipe));

  const stem = path.replace(IMAGE, "").replace(/-r\d+$/, "");
  let n = 1;
  while (await exists(join(root, `${stem}-r${n}.png`))) n += 1;
  const out = `${stem}-r${n}.png`;
  const shim = deps.shimUrl();

  const job = enqueueJob({
    ref: { type, id },
    // One stage per picture: the queue folds identical stages of one run.
    stage: `design.redesign ${out.split("/").pop()}`,
    work: async ({ signal, onProgress }) => {
      onProgress(`Redrawing ${path.split("/").pop()}${note ? ` — ${note}` : ""}`);
      await fetch(`${shim}/comfy/start`, { method: "POST", body: "{}", signal });
      const res = await fetch(`${shim}/comfy/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          prompt: composed.prompt,
          negative: composed.negative,
          ...(typeof recipe.width === "number" ? { width: recipe.width } : {}),
          ...(typeof recipe.height === "number" ? { height: recipe.height } : {}),
          outFile: join(root, out),
          post,
          recipe: {
            ...Object.fromEntries(["unit", "slot", "treatment", "brief", "section", "subjectKey",
              "characters", "castSheets", "identity", "kit"]
              .filter((k) => recipe[k] !== undefined).map((k) => [k, recipe[k]])),
            type,
            id,
            parent: path,
            ...(note ? { changeNote: note } : subjectEdit ? { changeNote: "description edited" } : {}),
            components: composed.components,
          },
        }),
      });
      const answer = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || answer.ok === false) throw new Error(answer.error ?? `render failed: HTTP ${res.status}`);
      broadcast("assets:changed", { type, id });
    },
  });
  return { job, path: out };
}

export function registerAssetRoutes(app: Hono, deps: AssetRouteDeps): void {
  const { root, broadcast } = deps;

  /** Parse `{type, id, …}` and hand back the rest, or a 400 the caller can read. */
  const read = async (
    c: { req: { json: () => Promise<unknown> } },
  ): Promise<Record<string, unknown> & { type: string; id: string }> => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const type = text(body.type);
    const id = text(body.id);
    if (!type || !id) throw new Error("type and id are required");
    return { ...body, type, id };
  };
  const fail = (c: { json: (b: unknown, s: 400) => Response }, error: unknown) =>
    c.json({ error: error instanceof Error ? error.message : String(error) }, 400);

  app.get("/api/v1/assets", async (c) => {
    const type = c.req.query("type") ?? "";
    const id = c.req.query("id") ?? "";
    if (!type || !id) return c.json({ error: "type and id are required" }, 400);
    try {
      return c.json({ assets: await listAssets(root, type, id, c.req.query("trash") === "1") });
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/v1/assets/approve", async (c) => {
    try {
      const body = await read(c);
      const out = await approveAsset(root, body.type, body.id, body.path, body.approve !== false);
      broadcast("assets:changed", { type: body.type, id: body.id });
      return c.json({ ok: true, ...out });
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/v1/assets/delete", async (c) => {
    try {
      const body = await read(c);
      const trashed = await trashAsset(root, body.type, body.id, body.path);
      broadcast("assets:changed", { type: body.type, id: body.id });
      return c.json({ ok: true, trashed });
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/v1/assets/restore", async (c) => {
    try {
      const body = await read(c);
      const path = pictureIn(root, body.type, body.id, body.path, "trash");
      const base = `${posix(workDirOf(body.type, body.id))}/`;
      const to = `${base}${path.slice(`${base}${TRASH}/`.length)}`;
      if (await exists(join(root, to))) {
        return c.json({ error: "a picture with that name is already back in its place" }, 409);
      }
      await move(root, path, to);
      broadcast("assets:changed", { type: body.type, id: body.id });
      return c.json({ ok: true, restored: to });
    } catch (error) {
      return fail(c, error);
    }
  });

  /** The one destructive move: only for what is already in the trash. */
  app.post("/api/v1/assets/purge", async (c) => {
    try {
      const body = await read(c);
      const path = pictureIn(root, body.type, body.id, body.path, "trash");
      await rm(join(root, path), { force: true });
      await rm(join(root, recipePathOf(path)), { force: true });
      broadcast("assets:changed", { type: body.type, id: body.id });
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/v1/assets/redesign", async (c) => {
    try {
      const body = await read(c);
      const subject = text(body.subject).trim();
      const out = await redesignAsset(deps, body.type, body.id, body.path, text(body.note).trim(), subject);
      if (subject && body.type === "publication") {
        // The page's own brief follows, so the next art run draws what was asked.
        const recipe = (await readRecipe(root, pictureIn(root, body.type, body.id, body.path, "work"))) ?? {};
        const slot = /^p(\d+)(?:-(\d+))?$/.exec(text(recipe.slot));
        if (slot && typeof recipe.unit === "number") {
          const index = slot[2] ? Number(slot[2]) - 1 : 0;
          await editIssuePage(root, body.id, recipe.unit, (page) => {
            const briefs = Array.isArray(page.briefs) ? page.briefs as Array<Record<string, unknown>> : [];
            if (briefs[index]) briefs[index] = { ...briefs[index], prompt: subject };
          });
        }
      }
      return c.json({ ok: true, ...out });
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * Change how a picture sits without drawing it again (09 §1): the shim
   * re-runs the new treatment's post-process from the kept original. An empty
   * treatment puts the original back. A magazine page's brief follows, so the
   * layout places it the new way.
   */
  app.post("/api/v1/assets/treat", async (c) => {
    try {
      const body = await read(c);
      const path = pictureIn(root, body.type, body.id, body.path, "work");
      const treatment = text(body.treatment).trim();
      const known = allTreatments();
      if (treatment && !known.has(treatment)) {
        return c.json({ error: `not a treatment: ${treatment} — one of ${[...known].join(", ")}` }, 400);
      }
      const recipe = (await readRecipe(root, path)) ?? {};
      const res = await fetch(`${deps.shimUrl()}/image/post`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          file: join(root, path),
          ops: postProcessFor(treatment || undefined, await coloursFor(root, body.type, body.id, recipe)),
        }),
      });
      const answer = await res.json().catch(() => ({})) as {
        ok?: boolean; error?: string; applied?: unknown[]; raw?: string | null;
      };
      if (!res.ok || answer.ok === false) throw new Error(answer.error ?? `the shim answered HTTP ${res.status}`);
      await writeRecipe(root, path, {
        ...recipe,
        treatment: treatment || null,
        postProcess: answer.applied ?? [],
        raw: answer.raw ?? null,
        treatedAt: new Date().toISOString(),
      });
      if (body.type === "publication" && typeof recipe.unit === "number" && /^p\d+$/.test(text(recipe.slot))) {
        await editIssuePage(root, body.id, recipe.unit, (page) => {
          const briefs = Array.isArray(page.briefs) ? page.briefs as Array<Record<string, unknown>> : [];
          if (briefs[0]) briefs[0] = { ...briefs[0], treatment: treatment || undefined };
        });
      }
      broadcast("assets:changed", { type: body.type, id: body.id });
      return c.json({ ok: true, treatment: treatment || null, applied: answer.applied ?? [] });
    } catch (error) {
      return fail(c, error);
    }
  });
}
