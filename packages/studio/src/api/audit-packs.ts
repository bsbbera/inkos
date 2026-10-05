/**
 * Audit packs over HTTP: see what an audit looks for, change it, try it (19 §4).
 *
 * The dimensions were always selectable and nobody could see the switch. These
 * routes are that switch — the builtin catalogue to check rows against, the
 * packs that exist, the pack a work has chosen, and a preview that runs one
 * pack against one file so editing a criterion and watching the findings move
 * is a loop rather than a guess.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import {
  auditPackIn, benchFromSettled, benchSummary, parseAuditPack, readAuditPacks, readBench,
  readCatalogues, resolveAuditPack, runBench, workDirOf, writeBenchCase,
  type AuditPack, type ResolvedAuditPack,
} from "@actalk/quire-core";

export interface AuditPackRouteDeps {
  /** The workspace root — user packs live at `<root>/audit/packs/<id>/pack.json`. */
  readonly root: string;
  /**
   * Findings the person already settled, newest first, with the paragraph each
   * was about — what the bench is seeded from. Absent means seeding answers 501.
   */
  readonly settledFindings?: (limit: number) => Promise<ReadonlyArray<{
    readonly id: string;
    readonly path: string;
    readonly category: string;
    readonly state: string;
    readonly quote: string;
    readonly paragraph: string;
  }>>;
  /**
   * Run one audit over one file with a pack applied, reporting only.
   * Absent means the preview route answers 501 rather than pretending.
   */
  readonly preview?: (input: {
    readonly type: string;
    readonly id: string;
    readonly path: string;
    readonly pack: ResolvedAuditPack;
  }) => Promise<{ readonly findings: ReadonlyArray<unknown> }>;
}

const packDir = (root: string, id: string): string => join(root, "audit", "packs", id);

/** A production folder, or null when the type is not one the registry knows. */
function workFolder(root: string, type: string, id: string): string | null {
  try {
    return join(root, workDirOf(type, id));
  } catch {
    return null;
  }
}

/** A pack id has to be one safe path segment: it names a folder. */
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * Stop reporting one finding category for one work (19 §4.4, §5.3).
 *
 * Written into the work's own override rather than a shared pack: one book's
 * noise is another book's point. Returns the categories now silenced, and
 * `undo` puts one back.
 */
export async function silenceCategory(
  root: string,
  type: string,
  id: string,
  category: string,
  undo = false,
): Promise<string[]> {
  const dir = workFolder(root, type, id);
  if (!dir) throw new Error(`no such work: ${type}/${id}`);
  const file = join(dir, "audit", "pack.json");
  const existing = parseAuditPack(await readJsonFile(file))
    ?? { id: `${id}-own`, version: 1, dimensions: { enable: [], disable: [], custom: [] } };
  const off = new Set([...(existing.dimensions?.disable ?? [])]);
  if (undo) off.delete(category); else off.add(category);
  const next: AuditPack = {
    ...existing,
    version: existing.version + 1,
    dimensions: { ...existing.dimensions, disable: [...off] },
  };
  await mkdir(join(dir, "audit"), { recursive: true });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  return [...off].filter((x): x is string => typeof x === "string");
}

async function readWorkChoice(dir: string): Promise<string[]> {
  try {
    const raw = JSON.parse(await readFile(join(dir, "audit", "packs.json"), "utf-8")) as unknown;
    const packs = (raw as { packs?: unknown })?.packs;
    return Array.isArray(packs) ? packs.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function registerAuditPackRoutes(app: Hono, deps: AuditPackRouteDeps): void {
  const { root } = deps;

  /** Everything a pack editor needs to draw itself: the catalogue and the packs. */
  app.get("/api/v1/audit/catalogue", async (c) => {
    const cats = await readCatalogues();
    return c.json({
      catalogues: [...cats.values()].map((cat) => ({
        id: cat.id, kind: cat.kind, version: cat.version,
        dimensions: cat.dimensions,
      })),
    });
  });

  app.get("/api/v1/audit/packs", async (c) => {
    const builtin = new Set((await readAuditPacks(null)).map((p) => p.id));
    const packs = await readAuditPacks(root);
    return c.json({
      packs: packs.map((p) => ({ ...p, source: builtin.has(p.id) ? "builtin" : "user" })),
    });
  });

  app.get("/api/v1/audit/packs/:id", async (c) => {
    const id = c.req.param("id");
    const found = (await readAuditPacks(root)).find((p) => p.id === id);
    return found ? c.json({ pack: found }) : c.json({ error: "no such pack" }, 404);
  });

  /**
   * Write a pack. A builtin id is allowed: the user copy shadows the shipped
   * one, the way a user skill shadows a builtin skill, and deleting the copy
   * brings the original back.
   */
  app.put("/api/v1/audit/packs/:id", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "a pack id is letters, digits and dashes" }, 400);
    const body = await c.req.json().catch(() => null) as unknown;
    const pack = parseAuditPack({ ...(body as object), id });
    if (!pack) return c.json({ error: "that is not a pack" }, 400);
    // Accepting a change bumps the version, so a bench run and a finding can
    // both say which version of the criteria produced them (19 §5.3).
    const previous = (await readAuditPacks(root)).find((p) => p.id === id);
    const next: AuditPack = { ...pack, version: Math.max(pack.version, (previous?.version ?? 0) + 1) };
    await mkdir(packDir(root, id), { recursive: true });
    await writeFile(join(packDir(root, id), "pack.json"), `${JSON.stringify(next, null, 2)}\n`, "utf-8");

    /*
     * Warn, do not block (19 §5.4).
     *
     * The bench says what this version stopped catching and what it started
     * flagging, and the person is told before they rely on it. Blocking the
     * save would be wrong: they may be editing the pack precisely because the
     * bench case is the thing that is out of date.
     */
    const cases = await readBench(root, next.appliesTo?.[0]);
    const bench = cases.length
      ? await runBench(cases, resolveAuditPack({
          type: next.appliesTo?.[0] ?? null,
          available: await readAuditPacks(root),
          selected: [id],
        }))
      : null;
    return c.json({
      pack: next,
      ...(bench ? { bench: { ...bench, summary: benchSummary(bench) } } : {}),
    });
  });

  /** Run the bench on demand, for one pack or for what a work resolves to. */
  app.post("/api/v1/audit/bench/run", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const type = typeof body.type === "string" ? body.type : null;
    const packId = typeof body.pack === "string" ? body.pack : "";
    const cases = await readBench(root, type ?? undefined);
    if (!cases.length) return c.json({ error: "the bench is empty — seed it from settled findings first" }, 404);
    const pack = resolveAuditPack({
      type, available: await readAuditPacks(root),
      ...(packId ? { selected: [packId] } : {}),
    });
    const run = await runBench(cases, pack);
    return c.json({ ...run, summary: benchSummary(run) });
  });

  /**
   * Seed the bench from what the person already decided (19 §5.4).
   *
   * A finding they accepted becomes a passage that must keep being caught; one
   * they ignored becomes a passage that must stay quiet. This is what makes
   * the bench theirs rather than a vendor's idea of good writing.
   */
  app.post("/api/v1/audit/bench/seed", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const type = typeof body.type === "string" ? body.type : "book";
    const limit = Math.min(Number(body.limit ?? 10) || 10, 50);
    const settled = await deps.settledFindings?.(limit);
    if (!settled) return c.json({ error: "nothing to seed from" }, 501);
    const cases = benchFromSettled(settled, type);
    for (const one of cases) await writeBenchCase(root, one);
    return c.json({ added: cases.length, cases: cases.map((x) => ({ id: x.id, catches: x.catches, allows: x.allows })) });
  });

  app.delete("/api/v1/audit/packs/:id", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "a pack id is letters, digits and dashes" }, 400);
    await rm(packDir(root, id), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  /** What a given work's audit actually resolves to, and which packs it picked. */
  app.get("/api/v1/audit/packs/for/:type/:id", async (c) => {
    const type = c.req.param("type");
    const dir = workFolder(root, type, c.req.param("id"));
    if (!dir) return c.json({ error: "no such work" }, 404);
    const [resolved, selected, available] = await Promise.all([
      auditPackIn(dir, type),
      readWorkChoice(dir),
      readAuditPacks(root),
    ]);
    return c.json({
      selected,
      // `Set` does not survive JSON, so the wire carries lists.
      resolved: {
        packs: resolved.packs,
        enable: [...resolved.enable], disable: [...resolved.disable],
        custom: resolved.custom,
        fatigueWords: resolved.fatigueWords, hedgeWords: resolved.hedgeWords,
        markers: resolved.markers,
        ...(resolved.paragraphMaxChars ? { paragraphMaxChars: resolved.paragraphMaxChars } : {}),
        passThreshold: resolved.passThreshold, maxIterations: resolved.maxIterations,
        blocking: [...resolved.blocking], rules: resolved.rules,
      },
      available: available
        .filter((p) => !p.appliesTo?.length || p.appliesTo.includes(type))
        .map((p) => ({ id: p.id, version: p.version, appliesTo: p.appliesTo ?? [] })),
    });
  });

  /** Choose packs for one work — the same place the genre is chosen (19 §4.3). */
  app.put("/api/v1/audit/packs/for/:type/:id", async (c) => {
    const type = c.req.param("type");
    const dir = workFolder(root, type, c.req.param("id"));
    if (!dir) return c.json({ error: "no such work" }, 404);
    const body = await c.req.json().catch(() => ({})) as { packs?: unknown };
    const packs = Array.isArray(body.packs)
      ? body.packs.filter((p): p is string => typeof p === "string" && SAFE_ID.test(p))
      : [];
    await mkdir(join(dir, "audit"), { recursive: true });
    await writeFile(join(dir, "audit", "packs.json"), `${JSON.stringify({ packs }, null, 2)}\n`, "utf-8");
    return c.json({ packs });
  });

  /**
   * Try a pack against one file without saving it.
   *
   * This is the whole point of an editable pack: change a sentence, see the
   * findings change. The draft pack is layered last, so it wins over whatever
   * the work already chose.
   */
  app.post("/api/v1/audit/packs/preview", async (c) => {
    if (!deps.preview) return c.json({ error: "preview needs a model, and none is configured" }, 501);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const type = typeof body.type === "string" ? body.type : "";
    const id = typeof body.id === "string" ? body.id : "";
    const path = typeof body.path === "string" ? body.path : "";
    if (!type || !id || !path) return c.json({ error: "type, id and path are required" }, 400);
    const dir = workFolder(root, type, id);
    if (!dir) return c.json({ error: "no such work" }, 404);

    const draft = parseAuditPack(body.pack);
    const available = await readAuditPacks(root);
    const pack = resolveAuditPack({
      type, available, selected: await readWorkChoice(dir),
      ...(draft ? { override: draft } : {}),
    });
    const out = await deps.preview({ type, id, path, pack });
    return c.json({ packs: pack.packs, findings: out.findings });
  });

  /**
   * "Never flag this again" (19 §4.4).
   *
   * Ignoring a finding settles one complaint; this silences the kind. It is
   * written into the work's own override rather than a shared pack, because
   * one book's noise is another book's point, and it is one line to undo.
   */
  app.post("/api/v1/audit/suppress", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const type = typeof body.type === "string" ? body.type : "";
    const id = typeof body.id === "string" ? body.id : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    if (!type || !id || !category) return c.json({ error: "type, id and category are required" }, 400);
    try {
      return c.json({ silenced: await silenceCategory(root, type, id, category, body.undo === true) });
    } catch {
      return c.json({ error: "no such work" }, 404);
    }
  });

  /** The bench: frozen passages a pack version must still get right (19 §5.4). */
  app.get("/api/v1/audit/bench", async (c) => {
    const dir = join(root, "audit", "bench");
    let names: string[] = [];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
    } catch {
      return c.json({ cases: [] });
    }
    const cases = [];
    for (const name of names) {
      try {
        cases.push(JSON.parse(await readFile(join(dir, name), "utf-8")) as unknown);
      } catch { /* a broken case is skipped, never fatal */ }
    }
    return c.json({ cases });
  });
}
