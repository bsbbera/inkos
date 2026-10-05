/**
 * Where a work's time and place are decided, researched and handed out.
 *
 * The stage that runs first on every type now is `content.research`, and this
 * is what stands behind it. Almost always it does nothing: a work with no
 * setting pinned passes straight through, which is how a conditional stage is
 * expressed in a graph that has no conditionals (22 §3).
 *
 * When there is something to research it is the same shape for every type —
 * one folder, one bible, one word list — so a storyboard and a novel get the
 * same material, and the checker downstream can be exact rather than asking a
 * model whether 1943 had plastic bags.
 */
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import {
  PRODUCTIONS, allSearchSources, askPathOf, biblePathOf, buildDetectPrompt, buildSettingCard,
  copySetting, createSeries, enqueueJob, intakeTextOf, joinSeries, lexiconPathOf, libraryDirOf,
  listLibrarySettings, listSeries, makeSetting, parseGuess, readBible, readLexicon, readSeries,
  readSetting, researchSetting, seriesDirOf, settingDirOf, settingPathOf, settingSlug,
  sourcesPathOf, workDirOf, writeSetting, writeSettingCard,
  type Setting, type StageContext, type StageResult, type StoryAskFn,
} from "@actalk/quire-core";
import { appendFeedback } from "./taste.js";

export interface SettingDeskDeps {
  readonly root: string;
  readonly broadcast: (event: string, data: unknown) => void;
  readonly ask: (signal?: AbortSignal) => Promise<StoryAskFn>;
}

const posix = (p: string) => p.replace(/\\/g, "/");
const text = (v: unknown) => (typeof v === "string" ? v : "");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Above this the detector is confident enough to be worth interrupting for. */
const ASK_THRESHOLD = 0.6;

export function createSettingDesk(deps: SettingDeskDeps) {
  const { root, broadcast } = deps;
  const exists = (rel: string) => access(join(root, rel)).then(() => true, () => false);

  /* --------------------------------------------------------- the stage */

  /**
   * Research the world, or notice that there is one worth asking about.
   *
   * Three outcomes, in order of how often they happen: nothing pinned and
   * nothing detected, so the stage passes; nothing pinned but the brief
   * clearly names a real place and time, so a card is left for the person and
   * the stage still passes (writing is not blocked on an answer nobody is
   * there to give); a setting pinned and not yet researched, so it researches.
   */
  const research = async (ctx: StageContext): Promise<StageResult> => {
    const { type, id } = ctx;
    // One work, one bible. Chapter 2 does not research Calcutta again.
    if (ctx.unit > 1) return { ok: true, artifacts: [] };

    const setting = await readSetting(root, type, id);
    if (!setting?.enabled) {
      await maybeAsk(type, id, ctx);
      return { ok: true, artifacts: [] };
    }
    if (setting.researchedAt && await exists(biblePathOf(type, id))) {
      ctx.onProgress?.("The world is already researched.");
      return { ok: true, artifacts: [] };
    }
    if (setting.kind === "secondary-world") {
      ctx.onProgress?.("Made-up world — nothing to look up.");
      return { ok: true, artifacts: [] };
    }

    try {
      const ask = await deps.ask(ctx.signal);
      const sources = await allSearchSources(root);
      if (!sources.length) {
        // Worth saying out loud rather than producing a bible of invention:
        // the whole point of the stage is that claims have somewhere to come
        // from.
        ctx.onProgress?.("No search source is configured — the world cannot be researched, writing anyway.");
        return { ok: true, artifacts: [] };
      }
      const done = await researchSetting({
        projectRoot: root, type, id, setting, ask, sources,
        ...(ctx.onProgress ? { onProgress: ctx.onProgress } : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      await writeSetting(root, type, id, { ...setting, researchedAt: new Date().toISOString() });
      broadcast("setting:changed", { type, id });
      ctx.onProgress?.(`Researched from ${done.sources} sources; ${done.lexicon.forbidden.length} words to avoid.`);
      return { ok: true, artifacts: [...done.artifacts, posix(settingPathOf(type, id))] };
    } catch (error) {
      // A world that could not be researched is a worse book, not a failed
      // run. Say so and let the writing happen.
      ctx.onProgress?.(`Could not research the setting: ${msg(error)} — writing anyway.`);
      return { ok: true, artifacts: [] };
    }
  };

  /**
   * Ask once, and only when the text itself suggests a real world (Door B).
   *
   * The answer — including "no, keep it loose" — is written down, because the
   * cost of asking twice is that the person stops reading the cards.
   */
  async function maybeAsk(type: string, id: string, ctx: StageContext): Promise<void> {
    if (await exists(askPathOf(type, id))) return;
    const intake = await intakeTextOf(root, type, id, workDirOf(type, id));
    if (intake.trim().length < 40) return;
    try {
      const ask = await deps.ask(ctx.signal);
      const guess = parseGuess(await ask(buildDetectPrompt(intake), "setting-detect"));
      const asked = { at: new Date().toISOString(), guess, answered: false };
      await mkdir(join(root, settingDirOf(type, id)), { recursive: true });
      await writeFile(join(root, askPathOf(type, id)), `${JSON.stringify(asked, null, 2)}\n`, "utf-8");
      if (guess.confidence >= ASK_THRESHOLD && guess.place) {
        ctx.onProgress?.(`This looks set in ${[guess.place, guess.time].filter(Boolean).join(", ")} — the Setting card can research it.`);
        broadcast("setting:ask", { type, id, guess });
      }
    } catch { /* the detector is a convenience; never fail a run over it */ }
  }

  /* --------------------------------------------------------- the cards */

  /** Everything the Setting card shows for one work. */
  async function deskOf(type: string, id: string) {
    const setting = await readSetting(root, type, id);
    const bible = await readBible(root, type, id);
    const lexicon = await readLexicon(root, type, id);
    let ask: unknown = null;
    try { ask = JSON.parse(await readFile(join(root, askPathOf(type, id)), "utf-8")); } catch { ask = null; }
    let sources = 0;
    try {
      const raw = await readFile(join(root, sourcesPathOf(type, id)), "utf-8");
      sources = raw.split("\n").filter((l) => l.trim()).length;
    } catch { sources = 0; }
    const series = (await listSeries(root)).find((s) => s.works.some((w) => w.type === type && w.id === id)) ?? null;
    return {
      setting, bible, lexicon, ask, sources, series,
      path: posix(settingPathOf(type, id)),
      library: await listLibrarySettings(root),
    };
  }

  /**
   * The card a unit's writer is actually given.
   *
   * Built on demand from the plan's own words rather than stored once, so a
   * replanned chapter gets the card its new plan needs (22 §4).
   */
  async function cardFor(type: string, id: string, unit: number, plan: string): Promise<string> {
    const setting = await readSetting(root, type, id);
    if (!setting?.enabled) return "";
    const bible = await readBible(root, type, id);
    if (!bible.trim()) return "";
    const card = buildSettingCard({
      setting, bible, lexicon: await readLexicon(root, type, id), plan,
    });
    if (card.trim()) await writeSettingCard(root, type, id, unit, card);
    return card;
  }

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

    app.get("/api/v1/setting", async (c) => {
      const type = c.req.query("type") ?? "";
      const id = c.req.query("id") ?? "";
      if (!type || !id) return c.json({ error: "type and id are required" }, 400);
      try { return c.json(await deskOf(type, id)); } catch (error) { return fail(c, error); }
    });

    /** Pin a world, from the form, the card, or a library entry. */
    app.post("/api/v1/setting", async (c) => {
      try {
        const body = await read(c);
        const { type, id } = body;
        if (body.action === "clear") {
          // "Keep it loose" is an answer, and remembering it is the whole
          // point of asking once.
          const had = await readSetting(root, type, id);
          await writeSetting(root, type, id, {
            ...(had ?? makeSetting({ place: "", time: "" })), enabled: false, at: new Date().toISOString(),
          });
          await writeFile(join(root, askPathOf(type, id)),
            `${JSON.stringify({ at: new Date().toISOString(), answered: true, kept: "loose" }, null, 2)}\n`, "utf-8");
          broadcast("setting:changed", { type, id });
          return c.json({ ok: true, setting: await readSetting(root, type, id) });
        }

        if (body.reuseOf) {
          const from = join(root, libraryDirOf(text(body.reuseOf)));
          const copied = await copySetting({
            fromDir: from, toDir: join(root, settingDirOf(type, id)), reuseOf: text(body.reuseOf),
          });
          if (!copied) return c.json({ error: "no such setting in the library" }, 404);
          broadcast("setting:changed", { type, id });
          return c.json({ ok: true, setting: await readSetting(root, type, id) });
        }

        const setting = makeSetting({
          place: text(body.place), then: text(body.then), country: text(body.country),
          time: text(body.time), from: text(body.from), to: text(body.to),
          kind: text(body.kind), fidelity: text(body.fidelity),
          ...(body.lens && typeof body.lens === "object" ? { lens: body.lens as Setting["lens"] } : {}),
          enabled: body.enabled !== false,
        });
        await writeSetting(root, type, id, setting);
        await writeFile(join(root, askPathOf(type, id)),
          `${JSON.stringify({ at: new Date().toISOString(), answered: true }, null, 2)}\n`, "utf-8");
        broadcast("setting:changed", { type, id });
        return c.json({ ok: true, setting });
      } catch (error) { return fail(c, error); }
    });

    /** Research now, rather than waiting for the stage to come round. */
    app.post("/api/v1/setting/research", async (c) => {
      try {
        const body = await read(c);
        const { type, id } = body;
        const setting = await readSetting(root, type, id);
        if (!setting?.enabled) return c.json({ error: "pin a place and time first" }, 409);
        const job = enqueueJob({
          ref: { type, id },
          stage: "content.research",
          work: async ({ signal, onProgress }) => {
            const ask = await deps.ask(signal);
            const sources = await allSearchSources(root);
            if (!sources.length) throw new Error("no search source is configured — add one in Connections");
            const done = await researchSetting({
              projectRoot: root, type, id, setting, ask, sources, onProgress, signal,
            });
            await writeSetting(root, type, id, { ...setting, researchedAt: new Date().toISOString() });
            broadcast("setting:changed", { type, id });
            return { sources: done.sources, forbidden: done.lexicon.forbidden.length };
          },
        });
        return c.json({ ok: true, job: job.id });
      } catch (error) { return fail(c, error); }
    });

    /** Hand-edit the word list — the cheapest way to teach the checker. */
    app.post("/api/v1/setting/lexicon", async (c) => {
      try {
        const body = await read(c);
        const { type, id } = body;
        const lexicon = body.lexicon;
        if (!lexicon || typeof lexicon !== "object") return c.json({ error: "lexicon is required" }, 400);
        await mkdir(join(root, settingDirOf(type, id)), { recursive: true });
        await writeFile(join(root, lexiconPathOf(type, id)), `${JSON.stringify(lexicon, null, 2)}\n`, "utf-8");
        await appendFeedback(root, {
          ref: { type, id }, surface: "content", verdict: "tweak", source: "gate",
          scope: { setting: id }, note: "edited the setting word list",
        });
        broadcast("setting:changed", { type, id });
        return c.json({ ok: true });
      } catch (error) { return fail(c, error); }
    });

    /** Keep this world for the next book set there (Door C). */
    app.post("/api/v1/setting/library", async (c) => {
      try {
        const body = await read(c);
        const { type, id } = body;
        const setting = await readSetting(root, type, id);
        if (!setting) return c.json({ error: "this work has no setting yet" }, 409);
        const name = text(body.name) || [setting.place.then || setting.place.name, setting.time.label].filter(Boolean).join(" ");
        const libraryId = settingSlug(name);
        const copied = await copySetting({
          fromDir: join(root, settingDirOf(type, id)),
          toDir: join(root, libraryDirOf(libraryId)),
          reuseOf: null,
        });
        if (!copied) return c.json({ error: "nothing to save" }, 409);
        await writeSetting(root, type, id, { ...setting, reuseOf: libraryId });
        broadcast("setting:changed", { type, id });
        return c.json({ ok: true, id: libraryId });
      } catch (error) { return fail(c, error); }
    });

    app.get("/api/v1/settings", async (c) => c.json({ settings: await listLibrarySettings(root) }));

    /* ------------------------------------------------------------ series */

    app.get("/api/v1/series", async (c) => c.json({ series: await listSeries(root) }));

    app.post("/api/v1/series", async (c) => {
      try {
        const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
        const action = text(body.action) || "create";
        if (action === "create") {
          const title = text(body.title);
          if (!title) return c.json({ error: "title is required" }, 400);
          return c.json({ ok: true, series: await createSeries(root, title) });
        }
        if (action === "join") {
          const type = text(body.type);
          const id = text(body.id);
          const seriesId = text(body.series);
          if (!type || !id || !seriesId) return c.json({ error: "series, type and id are required" }, 400);
          const series = await joinSeries({ root, seriesId, type, id });
          if (!series) return c.json({ error: "no such series" }, 404);
          broadcast("setting:changed", { type, id });
          return c.json({ ok: true, series });
        }
        return c.json({ error: "action must be create or join" }, 400);
      } catch (error) { return fail(c, error); }
    });
  }

  return { research, cardFor, deskOf, register };
}

/** Types that can hold a setting — everything with a working folder. */
export const SETTING_TYPES = PRODUCTIONS.filter((p) => p.pipeline).map((p) => p.id);

/** Listed here so the desk and the audit agree on where a bible lives. */
export async function settingFilesOf(root: string, type: string, id: string): Promise<ReadonlyArray<string>> {
  const dir = join(root, settingDirOf(type, id));
  try { return (await readdir(dir)).map((f) => posix(join(settingDirOf(type, id), f))); } catch { return []; }
}
