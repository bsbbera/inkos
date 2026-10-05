/**
 * Where a work's design is decided: its world, its kit, its cast (08 §6,
 * 07 §1b, 08 §9) — and the art plan that uses all three.
 *
 * Choosing a world, reading a cast or directing a unit's art all need a
 * model, which lives up here in the Studio, so the engine's art plan is
 * wrapped rather than rewritten: the first unit to plan art chooses the world
 * and reads the cast from the approved text, then the ArtDirector reads that
 * unit and decides what, if anything, is drawn. The routes are the desk's
 * cards: approve or re-world the world, propose or approve the kit, draw and
 * choose a reference for each character.
 */
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import {
  PRODUCTIONS, artPolicyOf, bibleSections, buildArtDirectorPrompt, buildCastPrompt, buildWorldPrompt, castDirOf,
  readBible, readLexicon, readSetting,
  composeImagePrompt, enqueueJob, kitDirOf, kitIdOf, latestKit, parseArtDirection, parseCast, parseWorld,
  postProcessFor, previousTreatments, proposeKit, readCast, readWorld, roleDirFor, safeChildPath, sheetPrompt,
  workDirOf, worldPathOf, writeBrief, writeKit, writeNone, rulesFor,
  type CastSheet, type Kit, type KitAsset, type StageContext, type StageExecutor, type StageResult,
  type StoryAskFn,
} from "@actalk/quire-core";
import { listAuditTargets } from "./audit.js";
import { bytesOfDataUrl, safeName } from "./final.js";
import { appendFeedback } from "./taste.js";

export interface DesignDeskDeps {
  readonly root: string;
  readonly broadcast: (event: string, data: unknown) => void;
  readonly shimUrl: () => string;
  /** A model to ask, bound to this request's cancel signal. */
  readonly ask: (signal?: AbortSignal) => Promise<StoryAskFn>;
  /** The engine's own art plan, which the desk wraps. */
  readonly coreArtplan: StageExecutor;
}

const IMAGE = /\.(png|jpe?g|webp)$/i;
const posix = (p: string) => p.replace(/\\/g, "/");
const text = (v: unknown) => (typeof v === "string" ? v : "");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const leading = (name: string) => Number(/^(\d+)/.exec(name)?.[1] ?? Number.NaN);
/** Types whose units the ArtDirector reads. Storybooks and storyboards plan from their own art notes. */
const DIRECTED = new Set(["book", "short", "interactive-film"]);

/**
 * The concrete nouns from a researched bible, for an image brief to draw.
 *
 * Only the objects section: "monsoon mould smell in files" is material for a
 * writer and useless to a renderer, while "punkah, anna coins, hurricane lamp"
 * is exactly what keeps a picture in its own century.
 */
function bibleObjects(bible: string): ReadonlyArray<string> {
  const section = bibleSections(bible)["Daily life & objects"] ?? "";
  return section.split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").split(/[—:;(]/)[0]?.trim() ?? "")
    .filter((line) => line.length > 2 && line.length < 40)
    .slice(0, 12);
}
/** Types whose one world is chosen from the text on the first art plan. */
export const WORLD_TYPES = ["book", "short", "storybook", "storyboard", "interactive-film"] as const;

export function createDesignDesk(deps: DesignDeskDeps) {
  const { root, broadcast } = deps;
  const exists = (rel: string) => access(join(root, rel)).then(() => true, () => false);
  const labelOf = (type: string) => PRODUCTIONS.find((p) => p.id === type)?.label ?? type;

  /** The work's written text in reading order — one unit's, when asked. */
  async function textOf(type: string, id: string, max: number, unit?: number): Promise<{ text: string; paths: string[] }> {
    const owned = (await listAuditTargets(root))
      .filter((t) => t.kind === type && t.project === id && (unit === undefined || leading(t.name) === unit))
      .sort((a, b) => a.path.localeCompare(b.path));
    let out = "";
    const paths: string[] = [];
    for (const t of owned) {
      if (out.length >= max) break;
      out += `${await readFile(join(root, t.path), "utf-8").catch(() => "")}\n\n`;
      paths.push(t.path);
    }
    return { text: out.slice(0, max), paths };
  }

  /* ------------------------------------------------------------ world */
  /**
   * The work's one world, chosen from its text (08 §2). A re-world asks again
   * with what the person said and what the last one was, and keeps the old
   * one in `design/.history/` — pictures drawn in it show as stale.
   */
  async function ensureWorld(
    type: string, id: string, signal?: AbortSignal, opts: { note?: string; force?: boolean } = {},
  ): Promise<string> {
    const relative = worldPathOf(type, id);
    const file = join(root, relative);
    const had = await exists(relative);
    if (had && !opts.force) return relative;
    const old = had ? JSON.parse(await readFile(file, "utf-8")) as { technique?: string; idiom?: string } : null;
    const previous = old ? [old.technique, old.idiom].filter(Boolean).join(", ") : "";
    const { text: excerpt } = await textOf(type, id, 8000);
    if (!excerpt.trim()) throw new Error("there is no written text yet to choose a design world from");
    const ask = await deps.ask(signal);
    const world = parseWorld(type, await ask(buildWorldPrompt({
      type, label: labelOf(type), excerpt,
      ...(opts.note ? { note: opts.note } : {}),
      ...(previous ? { previous } : {}),
    }), "design-system"));
    await mkdir(dirname(file), { recursive: true });
    if (had) {
      await mkdir(join(dirname(file), ".history"), { recursive: true });
      await rename(file, join(dirname(file), ".history", `world-${Date.now()}.json`));
    }
    await writeFile(file, `${JSON.stringify(world, null, 2)}\n`, "utf-8");
    broadcast("design:changed", { type, id });
    return relative;
  }

  /* ------------------------------------------------------------- cast */
  /**
   * Read the recurring characters off the text, once (08 §9). A re-read keeps
   * the reference someone already chose. An empty cast is an answer too, and
   * `asked.json` stops every later art plan asking again.
   */
  async function ensureCast(type: string, id: string, signal?: AbortSignal, force = false): Promise<number> {
    const dir = posix(castDirOf(type, id));
    const marker = `${dir}/asked.json`;
    if (!force && await exists(marker)) return (await readCast(root, type, id)).length;
    const { text: excerpt } = await textOf(type, id, 12_000);
    if (!excerpt.trim()) return 0;
    // Whichever folder this book keeps its majors in — English for anything
    // made after the rename, the old Chinese name for anything before it.
    // Reading only one of the two silently cast half the library as unknown.
    const roles = await readdir(
      await roleDirFor(join(root, workDirOf(type, id)), "major"),
    ).catch(() => [] as string[]);
    const ask = await deps.ask(signal);
    const sheets = parseCast(await ask(buildCastPrompt({
      label: labelOf(type), excerpt, known: roles.map((n) => n.replace(/\.md$/, "")),
    }), "design-cast"));
    const before = new Map((await readCast(root, type, id)).map((s) => [s.id, s]));
    for (const sheet of sheets) {
      const old = before.get(sheet.id);
      const next: CastSheet = old
        ? { ...sheet, chosen: old.chosen ?? null, approvedAt: old.approvedAt ?? null, version: old.version + 1 }
        : sheet;
      await mkdir(join(root, dir, sheet.id), { recursive: true });
      await writeFile(join(root, dir, sheet.id, "sheet.json"), `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    }
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, marker), `${JSON.stringify({
      at: new Date().toISOString(), characters: sheets.map((s) => s.id),
    }, null, 2)}\n`, "utf-8");
    broadcast("design:changed", { type, id });
    return sheets.length;
  }

  async function candidatesOf(type: string, id: string, character: string): Promise<string[]> {
    const dir = `${posix(castDirOf(type, id))}/${character}`;
    return (await readdir(join(root, dir)).catch(() => [] as string[]))
      .filter((n) => IMAGE.test(n)).sort().map((n) => `${dir}/${n}`);
  }

  async function writeSheet(type: string, id: string, sheet: CastSheet): Promise<void> {
    await writeFile(join(root, castDirOf(type, id), sheet.id, "sheet.json"), `${JSON.stringify(sheet, null, 2)}\n`, "utf-8");
  }

  async function sheetOf(type: string, id: string, character: string): Promise<CastSheet> {
    const sheet = (await readCast(root, type, id)).find((s) => s.id === character);
    if (!sheet) throw new Error(`no character "${character}" on this work's cast`);
    return sheet;
  }

  /* ----------------------------------------------------- art direction */
  async function directArt(ctx: StageContext): Promise<StageResult> {
    const dir = posix(workDirOf(ctx.type, ctx.id));
    const { text: unitText, paths } = await textOf(ctx.type, ctx.id, 14_000, ctx.type === "book" ? ctx.unit : undefined);
    if (!unitText.trim()) {
      return { ok: false, artifacts: [], error: `unit ${ctx.unit} has no written text for the art director to read` };
    }
    const cast = await readCast(root, ctx.type, ctx.id);
    const previous = await previousTreatments(root, dir, ctx.unit);
    const ask = await deps.ask(ctx.signal);
    // The researched world, so a cover for a 1943 story does not put a mobile
    // phone in someone's hand (22 §4).
    const setting = await readSetting(root, ctx.type, ctx.id);
    const lexicon = await readLexicon(root, ctx.type, ctx.id);
    const where = setting?.enabled
      ? {
          where: [setting.place.then || setting.place.name, setting.place.country].filter(Boolean).join(", "),
          when: setting.time.label || [setting.time.from, setting.time.to].filter(Boolean).join("–"),
          props: bibleObjects(await readBible(root, ctx.type, ctx.id)),
        }
      : null;
    // What this person has taught the picture side, verdict by verdict (18 §4).
    const rules = await rulesFor(root, { type: ctx.type, id: ctx.id, surface: "image" }).catch(() => [] as string[]);
    const out = await ask(buildArtDirectorPrompt({
      type: ctx.type, label: labelOf(ctx.type), unit: ctx.unit, text: unitText, previous, cast,
      setting: where, rules,
    }), "art-director");
    const { briefs, reason } = parseArtDirection({
      type: ctx.type, id: ctx.id, unit: ctx.unit, source: paths[0] ?? dir, out, cast, previous,
    });
    // What must not appear is as much a part of the brief as what must: the
    // word list the checker uses on prose is the same list a picture needs.
    const forbid = (lexicon?.forbidden ?? []).slice(0, 20).map((f) => f.term).join(", ");
    const artifacts: string[] = [];
    for (const [k, brief] of briefs.entries()) {
      const dated = forbid
        ? { ...brief, negative: [brief.negative, forbid].filter(Boolean).join(", ") }
        : brief;
      artifacts.push(await writeBrief(ctx, dir, `${ctx.unit}-${brief.slot}${k ? `-${k + 1}` : ""}.json`, dated));
      ctx.onProgress?.(`Art brief: ${brief.slot}, ${brief.treatment ?? "untreated"} — ${brief.reason ?? brief.subject}`);
    }
    const briefsDir = join(root, dir, "art", "briefs");
    if (briefs.length) {
      await rm(join(briefsDir, `${ctx.unit}-none.json`), { force: true });
      return { ok: true, artifacts };
    }
    const others = (await readdir(briefsDir).catch(() => [] as string[]))
      .filter((n) => n.startsWith(`${ctx.unit}-`) && n.endsWith(".json") && n !== `${ctx.unit}-none.json`);
    if (others.length) return { ok: true, artifacts };
    return await writeNone(ctx, dir, reason || "the art director drew nothing here");
  }

  /** The art plan: world, cast, then the engine's plan and the ArtDirector's. */
  const artplan: StageExecutor = async (ctx) => {
    try {
      ctx.onProgress?.(`Design world: ${posix(await ensureWorld(ctx.type, ctx.id, ctx.signal))}`);
    } catch (error) {
      return { ok: false, artifacts: [], error: `design world: ${msg(error)}` };
    }
    try {
      const n = await ensureCast(ctx.type, ctx.id, ctx.signal);
      if (n) ctx.onProgress?.(`Cast: ${n} recurring character${n === 1 ? "" : "s"} on sheets`);
    } catch (error) {
      // A cast helps the pictures agree; it does not gate them.
      ctx.onProgress?.(`cast not read: ${msg(error)}`);
    }
    const core = await deps.coreArtplan(ctx);
    if (!DIRECTED.has(ctx.type)) return core;
    let directed: StageResult;
    try {
      directed = await directArt(ctx);
    } catch (error) {
      directed = { ok: false, artifacts: [], error: `art director: ${msg(error)}` };
    }
    if (!directed.ok) {
      if (core.ok) {
        ctx.onProgress?.(directed.error ?? "art director did not answer");
        return core;
      }
      return { ok: false, artifacts: core.artifacts, error: `${core.error ?? "art plan failed"}; ${directed.error ?? ""}` };
    }
    return {
      ok: true,
      artifacts: [
        ...core.artifacts.filter((a) => !a.endsWith("-none.json") || directed.artifacts.length === 0),
        ...directed.artifacts,
      ],
    };
  };

  /* -------------------------------------------------------------- kit */
  async function sectionsOf(type: string, id: string): Promise<{
    worlds: Array<Record<string, unknown>>; faces: Record<string, unknown> | null;
  }> {
    if (type !== "publication") return { worlds: [], faces: null };
    const issue = await readFile(join(root, workDirOf(type, id), "publication.json"), "utf-8")
      .then((t) => JSON.parse(t) as { design?: { sections?: Array<Record<string, unknown>>; spec?: { type?: Record<string, unknown> } } })
      .catch(() => null);
    return { worlds: issue?.design?.sections ?? [], faces: issue?.design?.spec?.type ?? null };
  }

  async function kitsOf(type: string, id: string): Promise<Kit[]> {
    if (type !== "publication") {
      const kit = await latestKit(root, kitIdOf(type, id));
      return kit ? [kit] : [];
    }
    const out: Kit[] = [];
    for (const w of (await sectionsOf(type, id)).worlds) {
      const kit = await latestKit(root, kitIdOf(type, id, Number(w.n)));
      if (kit) out.push(kit);
    }
    return out;
  }

  /**
   * A new kit version from the world as it stands. Masks and a paper tile are
   * drawn by the shim; everything already captured and approved carries over,
   * so a new version never makes an approved ornament be drawn again.
   */
  async function proposeKits(type: string, id: string): Promise<Kit[]> {
    const targets: Array<{ kitId: string; ref: string; world: Record<string, unknown> }> = [];
    const { worlds, faces } = await sectionsOf(type, id);
    if (type === "publication") {
      for (const w of worlds) {
        targets.push({ kitId: kitIdOf(type, id, Number(w.n)), ref: `${posix(workDirOf(type, id))}/publication.json#section-${String(w.n)}`, world: w });
      }
      if (!targets.length) throw new Error("this issue has no section worlds yet — its design stage chooses them");
    } else {
      const world = (await readWorld(root, type, id)) as Record<string, unknown> | null;
      if (!world) throw new Error("this work has no design world yet — the first art plan chooses one from the text");
      targets.push({ kitId: kitIdOf(type, id), ref: posix(worldPathOf(type, id)), world });
    }
    const made: Kit[] = [];
    for (const { kitId, ref, world } of targets) {
      const prev = await latestKit(root, kitId);
      const version = (prev?.manifest.version ?? 0) + 1;
      const proposed = proposeKit({
        kitId, version, type, worldRef: ref,
        world: {
          technique: text(world.technique), idiom: text(world.idiom),
          paper: text(world.paper), ink: text(world.ink), hue: text(world.hue),
        },
        ...(faces ? { faces: { display: text(faces.display), text: text(faces.body) || text(faces.text) } } : {}),
      });
      const dir = kitDirOf(kitId, version);
      const drawn: KitAsset[] = [];
      try {
        const res = await fetch(`${deps.shimUrl()}/image/kit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dir: join(root, dir), paper: proposed.swatches.paper }),
        });
        const answer = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; files?: Array<{ kind: string; file: string }> };
        if (!res.ok || answer.ok === false) throw new Error(answer.error ?? `HTTP ${res.status}`);
        const at = new Date().toISOString();
        for (const f of answer.files ?? []) {
          drawn.push({
            id: `kit-${f.file.replace(/\.[^.]+$/, "").replace(/\W+/g, "-")}`,
            kind: f.kind === "pattern" ? "pattern" : "mask",
            file: `${dir}/${f.file}`,
            state: "approved",
            origin: "kit",
            at,
          });
        }
      } catch (error) {
        broadcast("design:changed", { type, id, warning: `kit masks not drawn: ${msg(error)}` });
      }
      const carried = (prev?.manifest.assets ?? []).filter((a) => a.origin !== "kit" && a.state === "approved");
      const kit: Kit = { dir, ...proposed, manifest: { ...proposed.manifest, assets: [...drawn, ...carried] } };
      await writeKit(root, kit);
      made.push(kit);
    }
    broadcast("design:changed", { type, id });
    return made;
  }

  /* ------------------------------------------------------------ routes */
  function register(app: Hono): void {
    const read = async (
      c: { req: { json: () => Promise<unknown> } },
    ): Promise<Record<string, unknown> & { type: string; id: string }> => {
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const type = text(body.type);
      const id = text(body.id);
      if (!type || !id) throw new Error("type and id are required");
      return { ...body, type, id };
    };
    const fail = (c: { json: (b: unknown, s: 400) => Response }, error: unknown) => c.json({ error: msg(error) }, 400);

    /** Everything the desk shows for one work. */
    app.get("/api/v1/design", async (c) => {
      const type = c.req.query("type") ?? "";
      const id = c.req.query("id") ?? "";
      if (!type || !id) return c.json({ error: "type and id are required" }, 400);
      try {
        const cast = await Promise.all((await readCast(root, type, id)).map(async (s) => ({
          ...s, candidates: await candidatesOf(type, id, s.id),
        })));
        return c.json({
          policy: artPolicyOf(type),
          world: type === "publication" ? null : await readWorld(root, type, id),
          worldPath: posix(worldPathOf(type, id)),
          sections: (await sectionsOf(type, id)).worlds,
          kits: await kitsOf(type, id),
          cast,
          castAsked: await exists(`${posix(castDirOf(type, id))}/asked.json`),
        });
      } catch (error) {
        return fail(c, error);
      }
    });

    /** Keep the world, or ask for another with a note. */
    app.post("/api/v1/design/world", async (c) => {
      try {
        const body = await read(c);
        if (body.type === "publication") {
          return c.json({ error: "a magazine's worlds are chosen per section at its design stage" }, 400);
        }
        const note = text(body.note).trim();
        if (body.action === "approve") {
          const file = join(root, worldPathOf(body.type, body.id));
          const world = JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
          await writeFile(file, `${JSON.stringify({ ...world, approvedAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
          await appendFeedback(root, {
            ref: { type: body.type, id: body.id }, surface: "design", verdict: "keep", source: "design",
            scope: { world: text(world.idiom) || text(world.technique) },
          });
          broadcast("design:changed", { type: body.type, id: body.id });
          return c.json({ ok: true });
        }
        if (body.action !== "reworld") return c.json({ error: "action must be approve or reworld" }, 400);
        await appendFeedback(root, {
          ref: { type: body.type, id: body.id }, surface: "design", verdict: "re-world", source: "design",
          ...(note ? { note } : {}),
        });
        const job = enqueueJob({
          ref: { type: body.type, id: body.id },
          stage: "design.reworld",
          work: async ({ signal, onProgress }) => {
            onProgress("Choosing another world from the text…");
            await ensureWorld(body.type, body.id, signal, { force: true, ...(note ? { note } : {}) });
            broadcast("assets:changed", { type: body.type, id: body.id });
          },
        });
        return c.json({ ok: true, job });
      } catch (error) {
        return fail(c, error);
      }
    });

    /** Propose a kit from the world as it stands, or approve the one proposed. */
    app.post("/api/v1/design/kit", async (c) => {
      try {
        const body = await read(c);
        if (body.action === "propose") return c.json({ ok: true, kits: await proposeKits(body.type, body.id) });
        if (body.action !== "approve") return c.json({ error: "action must be propose or approve" }, 400);
        const kits = await kitsOf(body.type, body.id);
        if (!kits.length) return c.json({ error: "there is no kit to approve yet — propose one first" }, 409);
        const at = new Date().toISOString();
        for (const kit of kits) await writeKit(root, { ...kit, manifest: { ...kit.manifest, approvedAt: at } });
        if (body.type !== "publication" && kits[0]) {
          const file = join(root, worldPathOf(body.type, body.id));
          const world = await readFile(file, "utf-8").then((t) => JSON.parse(t) as Record<string, unknown>).catch(() => null);
          if (world) {
            await writeFile(file, `${JSON.stringify({ ...world, kit: `${kits[0].manifest.id}@${kits[0].manifest.version}` }, null, 2)}\n`, "utf-8");
          }
        }
        await appendFeedback(root, {
          ref: { type: body.type, id: body.id }, surface: "design", verdict: "keep", source: "design",
          scope: { kit: kits.map((k) => `${k.manifest.id}@${k.manifest.version}`).join(",") },
        });
        broadcast("design:changed", { type: body.type, id: body.id });
        return c.json({ ok: true, approvedAt: at });
      } catch (error) {
        return fail(c, error);
      }
    });

    /** Read the cast off the text again. */
    app.post("/api/v1/design/cast", async (c) => {
      try {
        const body = await read(c);
        const job = enqueueJob({
          ref: { type: body.type, id: body.id },
          stage: "design.cast",
          work: async ({ signal, onProgress }) => {
            onProgress("Reading the cast off the text…");
            const n = await ensureCast(body.type, body.id, signal, true);
            onProgress(`${n} recurring character${n === 1 ? "" : "s"}`);
          },
        });
        return c.json({ ok: true, job });
      } catch (error) {
        return fail(c, error);
      }
    });

    /** Draw three reference candidates for one character, in the work's world, on white. */
    app.post("/api/v1/design/cast/draw", async (c) => {
      try {
        const body = await read(c);
        const sheet = await sheetOf(body.type, body.id, text(body.character));
        const note = text(body.note).trim();
        const world = await readWorld(root, body.type, body.id);
        const dir = `${posix(castDirOf(body.type, body.id))}/${sheet.id}`;
        const shim = deps.shimUrl();
        const job = enqueueJob({
          ref: { type: body.type, id: body.id },
          stage: `design.cast ${sheet.id}`,
          work: async ({ signal, onProgress }) => {
            await fetch(`${shim}/comfy/start`, { method: "POST", body: "{}", signal });
            const stamp = Date.now().toString(36);
            for (let n = 1; n <= 3; n += 1) {
              onProgress(`Drawing ${sheet.name}, candidate ${n} of 3`);
              const composed = composeImagePrompt({
                type: body.type,
                prompt: note ? `${sheetPrompt(sheet)}. ${note}` : sheetPrompt(sheet),
                world,
                treatment: "cutout",
              });
              const res = await fetch(`${shim}/comfy/generate`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                signal,
                body: JSON.stringify({
                  prompt: composed.prompt,
                  negative: composed.negative,
                  width: 896,
                  height: 1152,
                  outFile: join(root, dir, `cand-${stamp}-${n}.png`),
                  post: postProcessFor("cutout"),
                  recipe: {
                    type: body.type, id: body.id, slot: "cast", character: sheet.id, sheetVersion: sheet.version,
                    treatment: "cutout", components: composed.components, ...(note ? { changeNote: note } : {}),
                  },
                }),
              });
              const answer = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
              if (!res.ok || answer.ok === false) throw new Error(answer.error ?? `render failed: HTTP ${res.status}`);
              broadcast("design:changed", { type: body.type, id: body.id });
            }
          },
        });
        return c.json({ ok: true, job });
      } catch (error) {
        return fail(c, error);
      }
    });

    /** This one is the character: every later picture of them is described from this sheet. */
    app.post("/api/v1/design/cast/choose", async (c) => {
      try {
        const body = await read(c);
        const sheet = await sheetOf(body.type, body.id, text(body.character));
        const path = posix(text(body.path));
        const dir = `${posix(castDirOf(body.type, body.id))}/${sheet.id}/`;
        if (!path.startsWith(dir) || !IMAGE.test(path) || path.includes("..")) {
          return c.json({ error: "that is not a reference picture of this character" }, 400);
        }
        safeChildPath(root, path);
        const next: CastSheet = { ...sheet, chosen: path, approvedAt: new Date().toISOString(), version: sheet.version + 1 };
        await writeSheet(body.type, body.id, next);
        await appendFeedback(root, {
          ref: { type: body.type, id: body.id }, surface: "image", verdict: "keep", source: "design",
          target: path, scope: { character: sheet.id },
        });
        broadcast("design:changed", { type: body.type, id: body.id });
        return c.json({ ok: true, sheet: next });
      } catch (error) {
        return fail(c, error);
      }
    });

    /** Your own drawing of the character, chosen as its reference. */
    app.post("/api/v1/design/cast/upload", async (c) => {
      try {
        const body = await read(c);
        const sheet = await sheetOf(body.type, body.id, text(body.character));
        const name = safeName(text(body.filename) || "reference.png");
        if (!IMAGE.test(name)) return c.json({ error: "a reference must be a PNG, JPEG or WebP picture" }, 400);
        const path = `${posix(castDirOf(body.type, body.id))}/${sheet.id}/upload-${Date.now().toString(36)}-${name}`;
        await writeFile(safeChildPath(root, path), bytesOfDataUrl(text(body.dataUrl)));
        const next: CastSheet = { ...sheet, chosen: path, approvedAt: new Date().toISOString(), version: sheet.version + 1 };
        await writeSheet(body.type, body.id, next);
        broadcast("design:changed", { type: body.type, id: body.id });
        return c.json({ ok: true, sheet: next });
      } catch (error) {
        return fail(c, error);
      }
    });
  }

  return { artplan, ensureWorld, ensureCast, directArt, proposeKits, kitsOf, register };
}
