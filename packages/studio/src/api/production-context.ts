/**
 * What a conversation is about, when the thing it is about is not a book.
 *
 * The chat column knows how to describe a book — chapters, people, truth — and
 * asks `/books/:id` for all three. A short, an issue or a storyboard has the
 * same three things and no route that says them, so every session that made
 * one showed an empty column: the mock's left rail with nothing in it.
 *
 * Not a metadata framework. Three lists read off the files a run already
 * writes, and empty where a production genuinely has none.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { PRODUCTIONS, productionByDir } from "@actalk/quire-core";

export interface ProductionChapter {
  readonly number: number;
  readonly title: string;
  readonly words: number;
}

export interface ProductionPerson {
  readonly name: string;
  readonly note: string;
}

export interface ProductionTruth {
  readonly path: string;
  readonly name: string;
  readonly label: string;
}

export interface ProductionContext {
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  readonly chapters: ReadonlyArray<ProductionChapter>;
  readonly people: ReadonlyArray<ProductionPerson>;
  readonly truth: ReadonlyArray<ProductionTruth>;
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf-8")) as T; } catch { return null; }
}

async function listDir(path: string): Promise<ReadonlyArray<string>> {
  try { return await readdir(path); } catch { return []; }
}

/**
 * The chapters of a finished work, from whichever `final/` json carries them.
 *
 * Named by shape rather than by filename: a short writes `short-story.json`, a
 * script writes its own, and the one thing they agree on is a `chapters` array
 * with a number and a title in it. Looking for the shape means a production
 * that adopts the convention is described here without a second edit.
 */
async function chaptersOf(dir: string): Promise<ReadonlyArray<ProductionChapter>> {
  const finalDir = join(dir, "final");
  for (const name of await listDir(finalDir)) {
    if (!name.endsWith(".json")) continue;
    const doc = await readJson<{
      chapters?: ReadonlyArray<{ number?: number; title?: string; charCount?: number }>;
    }>(join(finalDir, name));
    const chapters = doc?.chapters;
    if (!Array.isArray(chapters) || chapters.length === 0) continue;
    return chapters
      .filter((ch) => typeof ch.title === "string")
      .map((ch, i) => ({
        number: typeof ch.number === "number" ? ch.number : i + 1,
        title: ch.title as string,
        words: typeof ch.charCount === "number" ? ch.charCount : 0,
      }));
  }
  return [];
}

/** The newest outline, which is the only one that still describes the work. */
async function latestOutline(dir: string): Promise<{ name: string; path: string } | null> {
  const outlineDir = join(dir, "outline");
  const versions = (await listDir(outlineDir)).filter((n) => /^v\d+\.md$/i.test(n)).sort();
  const newest = versions.at(-1);
  return newest ? { name: newest, path: join(outlineDir, newest) } : null;
}

/**
 * `- **Mira Solberg** — thermodynamicist, mid-career, precise, …`
 *
 * A short's people live in a prose heading of its plan, not in a `people.json`,
 * because nothing ever asked for them as data. Taking the bolded name and the
 * clause after the dash gets the two things the column shows and stops: the
 * rest of that bullet is a paragraph of intent, and the rail is a reminder of
 * who is in play, not the character bible.
 */
const PERSON = /^[-*]\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/gm;

function peopleIn(outline: string): ReadonlyArray<ProductionPerson> {
  const section = /##\s*Characters[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(outline);
  if (!section) return [];
  const out: ProductionPerson[] = [];
  for (const m of section[1]!.matchAll(PERSON)) {
    // The first clause is the description; what follows is the plan's argument
    // with itself about the character, which belongs in the outline.
    const note = m[2]!.split(/[.;]/)[0]!.trim();
    out.push({ name: m[1]!.trim(), note });
  }
  return out;
}

function titleIn(outline: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(outline);
  return heading ? heading[1]!.trim() : fallback;
}

/** The id as it would be written: `the-second-law` → `The Second Law`. */
function titleOf(id: string): string {
  return id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Accepts either the production's id or the directory it writes to.
 *
 * The client derives this from a path a run wrote — `shorts/the-second-law/…` —
 * so it holds the directory and not the kind, and making it keep its own copy
 * of the mapping is how the audit screen's list drifted in the first place.
 */
export async function readProductionContext(
  root: string,
  kind: string,
  id: string,
): Promise<ProductionContext | null> {
  const spec = PRODUCTIONS.find((p) => p.id === kind) ?? productionByDir(kind);
  if (!spec) return null;
  const rel = `${spec.outDir}/${id}`;
  const dir = join(root, spec.outDir, id);
  if ((await listDir(dir)).length === 0) return null;

  const outlinePath = await latestOutline(dir);
  const outline = outlinePath ? await readFile(outlinePath.path, "utf-8").catch(() => "") : "";

  const truth: ProductionTruth[] = [];
  if (outlinePath) {
    truth.push({
      path: `${rel}/outline/${outlinePath.name}`,
      name: outlinePath.name,
      label: "direction",
    });
  }
  if ((await listDir(dir)).includes("status.json")) {
    truth.push({ path: `${rel}/status.json`, name: "status.json", label: "rules" });
  }

  return {
    kind: spec.id,
    id,
    title: outline ? titleIn(outline, titleOf(id)) : titleOf(id),
    chapters: await chaptersOf(dir),
    people: peopleIn(outline),
    truth,
  };
}

export function registerProductionContextRoutes(app: Hono, root: string): void {
  app.get("/api/v1/production/:kind/:id/context", async (c) => {
    const context = await readProductionContext(root, c.req.param("kind"), c.req.param("id"));
    return context ? c.json(context) : c.json({ error: "no such production" }, 404);
  });
}
