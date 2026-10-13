/*
 * The house book over HTTP (Phase 7, analysis/26-design-engine.md).
 *
 *   GET  /api/v1/house            the house and what is wrong with it
 *   PUT  /api/v1/house            edit it (any edit makes it a draft again)
 *   POST /api/v1/house/propose    the model drafts one from the brand book (a job)
 *   POST /api/v1/house/approve    approve it, once nothing is wrong with it
 *
 * One house per brand directory: every publication type whose output lives in
 * the magazine's folder shares it, which is what makes them one brand.
 */
import type { Hono } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  GRID_SYSTEMS, RULE_STYLES, checkHouse, enqueueJob,
  findPublicationDefinition, proposeHousePrompt, readHouse, scaleOf, writeHouse,
  type House,
} from "@actalk/quire-core";

export interface HouseDeps {
  readonly root: string;
  readonly shimUrl: () => string;
  readonly ask: (signal?: AbortSignal) => Promise<(prompt: string, tag: string) => Promise<Record<string, unknown>>>;
  readonly broadcast: (event: string, data: unknown) => void;
}

/** What the brand has published or is writing, for a house drafted with no brand book. */
async function issuesIn(dir: string): Promise<string[]> {
  const ids = await readdir(join(dir, "issues")).catch(() => [] as string[]);
  const out: string[] = [];
  for (const id of ids.slice(0, 20)) {
    try {
      const p = JSON.parse(await readFile(join(dir, "issues", id, "publication.json"), "utf-8")) as { title?: string; subject?: string; thesis?: string };
      out.push([p.title || p.subject, p.thesis].filter(Boolean).join(" - "));
    } catch { /* not an issue */ }
  }
  return out.filter(Boolean);
}

/** The approved houses of the workspace's other brand folders. */
async function otherHouses(root: string, own: string): Promise<{ name: string; display: string; text: string }[]> {
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const out: { name: string; display: string; text: string }[] = [];
  for (const d of dirs) {
    if (!d.isDirectory() || join(root, d.name) === own) continue;
    const h = await readHouse(join(root, d.name));
    if (h?.status === "approved") out.push({ name: h.name, display: h.type.display, text: h.type.text });
  }
  return out;
}

export function registerHouseRoutes(app: Hono, deps: HouseDeps): void {
  const { root } = deps;
  const brandDir = async (type?: string) => {
    const def = await findPublicationDefinition(root, type || "magazine");
    return join(root, def?.outDir ?? "Magazine");
  };
  const fonts = async (): Promise<string[]> => {
    try {
      const res = await fetch(`${deps.shimUrl()}/affinity/fonts`, { signal: AbortSignal.timeout(60_000) });
      return ((await res.json()) as { fonts?: string[] }).fonts ?? [];
    } catch { return []; }
  };

  app.get("/api/v1/house", async (c) => {
    const dir = await brandDir(c.req.query("type"));
    const house = await readHouse(dir);
    return c.json({
      house,
      problems: house ? checkHouse(house) : [],
      scale: house ? scaleOf(house) : [],
      // What a new house starts from; the person or the model fills the rest.
      blank: {
        name: "", status: "draft", type: { display: "", text: "" }, scale: { body: 9.5, ratio: 1.333 },
        marginMm: 16, gutterMm: 5, baselineMm: 4.5,
        grids: ["columns", "golden", "thirds"], devices: { rule: "hairline", folio: "", kicker: "" },
      },
      choices: { grids: GRID_SYSTEMS, rules: RULE_STYLES },
    });
  });

  app.put("/api/v1/house", async (c) => {
    const body = await c.req.json().catch(() => null) as Partial<House> | null;
    if (!body || typeof body !== "object") return c.json({ error: "a house is required" }, 400);
    const dir = await brandDir(c.req.query("type"));
    // An approval is of a specific house; changing it withdraws the approval.
    const house = { ...body, status: "draft" } as House;
    delete (house as { approvedAt?: string }).approvedAt;
    await writeHouse(dir, house);
    deps.broadcast("house:changed", { status: "draft" });
    return c.json({ house, problems: checkHouse(house) });
  });

  app.post("/api/v1/house/approve", async (c) => {
    const dir = await brandDir(c.req.query("type"));
    const house = await readHouse(dir);
    if (!house) return c.json({ error: "there is no house to approve - draft one first" }, 404);
    // The faces are checked against Affinity's own list; with Affinity closed
    // there is no list, and an approval that skipped the check would hold an
    // uninstalled face in every issue until a build set it in the fallback.
    const installed = await fonts();
    if (!installed.length) return c.json({ error: "open Affinity first - the house's faces are checked against what it has installed" }, 409);
    const problems = checkHouse(house, installed);
    if (problems.length) return c.json({ error: problems.join("; "), problems }, 409);
    const approved: House = { ...house, status: "approved", approvedAt: new Date().toISOString() };
    await writeHouse(dir, approved);
    deps.broadcast("house:changed", { status: "approved" });
    return c.json({ house: approved, problems: [] });
  });

  app.post("/api/v1/house/propose", async (c) => {
    const dir = await brandDir(c.req.query("type"));
    const job = enqueueJob({
      ref: { type: "house", id: "house" },
      stage: "design.house",
      work: async ({ signal, onProgress }) => {
        onProgress("Drafting the house book…");
        const [installed, brandBook, issues] = await Promise.all([
          fonts(), readFile(join(dir, "house_style.md"), "utf-8").catch(() => ""), issuesIn(dir),
        ]);
        const ask = await deps.ask(signal);
        // Every other house in the workspace: a new magazine is not given their type.
        const taken = await otherHouses(root, dir);
        const shuffled = [...installed];
        for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]; }
        let refused: string | undefined;
        let house = {} as House;
        for (let attempt = 0; attempt < 2; attempt++) {
          const out = await ask(proposeHousePrompt({ brandBook, issues, fonts: shuffled, taken, ...(refused ? { refused } : {}) }), "design");
          house = { ...(out as Partial<House>), status: "draft" } as House;
          const clash = taken.find((t) => [t.display, t.text].includes(house.type?.display ?? "") || [t.display, t.text].includes(house.type?.text ?? "") || t.name === house.name);
          if (!clash) break;
          refused = `it shares type or the masthead with ${clash.name} (${clash.display} / ${clash.text})`;
          onProgress(`The draft repeated ${clash.name}'s type; asking again`);
        }
        await writeHouse(dir, house);
        deps.broadcast("house:changed", { status: "draft" });
        return { house, problems: checkHouse(house, installed) };
      },
    });
    return c.json({ ok: true, job });
  });
}
