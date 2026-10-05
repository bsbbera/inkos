/**
 * A series: one world, one cast, many works.
 *
 * A setting library entry is already "research this world once". A series is
 * that plus the people in it and what they are owed — the promises a first
 * book opened and a second is expected to pay. Without somewhere to keep that,
 * book two starts from an empty page and quietly contradicts book one, which
 * is the failure mode a long project actually has (22 §8).
 *
 * Everything here is a file. A work joins a series by copying the shared
 * material down into itself and recording where it came from, so a work that
 * has been written never changes underneath because the series moved on.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SERIES_DIR, copySetting, settingDirOf, settingSlug } from "./setting.js";
import { workDirOf, worldPathOf } from "./image-prompt.js";

export interface SeriesWork {
  readonly type: string;
  readonly id: string;
  readonly order: number;
  /** When this one is set, so a character's age can be read off the shelf. */
  readonly from?: string;
  readonly to?: string;
}

export interface SeriesPromise {
  readonly id: string;
  /** The hook itself, in the words the book opened it with. */
  readonly text: string;
  readonly openedIn: string;
  readonly paidIn?: string | null;
  readonly at: string;
}

export interface Series {
  readonly id: string;
  readonly title: string;
  readonly works: ReadonlyArray<SeriesWork>;
  readonly promises: ReadonlyArray<SeriesPromise>;
  readonly at: string;
}

export const seriesDirOf = (id: string): string => join(SERIES_DIR, id);
export const seriesPathOf = (id: string): string => join(seriesDirOf(id), "series.json");

export async function readSeries(root: string, id: string): Promise<Series | null> {
  try { return JSON.parse(await readFile(join(root, seriesPathOf(id)), "utf-8")) as Series; }
  catch { return null; }
}

export async function writeSeries(root: string, series: Series): Promise<void> {
  await mkdir(join(root, seriesDirOf(series.id)), { recursive: true });
  await writeFile(join(root, seriesPathOf(series.id)),
    `${JSON.stringify(series, null, 2)}\n`, "utf-8");
}

export async function listSeries(root: string): Promise<ReadonlyArray<Series>> {
  const dir = join(root, SERIES_DIR);
  if (!existsSync(dir)) return [];
  const out: Series[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const series = await readSeries(root, entry.name);
    if (series) out.push(series);
  }
  return out;
}

export async function createSeries(root: string, title: string): Promise<Series> {
  const id = settingSlug(title);
  const existing = await readSeries(root, id);
  if (existing) return existing;
  const series: Series = { id, title: String(title).trim() || id, works: [], promises: [], at: new Date().toISOString() };
  await writeSeries(root, series);
  return series;
}

/**
 * Add a work and give it everything the series already knows.
 *
 * The copy direction depends on which side has the material: the first work in
 * a series is usually where the world was researched, so it seeds the series;
 * every work after that receives it. Doing both in one function is what makes
 * "start a series from this book" and "new in series" the same operation.
 */
export async function joinSeries(input: {
  readonly root: string;
  readonly seriesId: string;
  readonly type: string;
  readonly id: string;
  readonly order?: number;
}): Promise<Series | null> {
  const { root, seriesId, type, id } = input;
  const series = await readSeries(root, seriesId);
  if (!series) return null;

  const seriesSetting = join(root, seriesDirOf(seriesId), "setting");
  const workSetting = join(root, settingDirOf(type, id));
  if (existsSync(join(seriesSetting, "setting.json"))) {
    await copySetting({ fromDir: seriesSetting, toDir: workSetting, reuseOf: `series:${seriesId}` });
  } else if (existsSync(join(workSetting, "setting.json"))) {
    await copySetting({ fromDir: workSetting, toDir: seriesSetting, reuseOf: null });
  }

  // The look travels too: a series that changes palette between books is not
  // one series on a shelf.
  const seriesWorld = join(root, seriesDirOf(seriesId), "design", "world.json");
  const workWorld = join(root, worldPathOf(type, id));
  if (existsSync(seriesWorld) && !existsSync(workWorld)) {
    await mkdir(join(root, workDirOf(type, id), "design"), { recursive: true });
    await writeFile(workWorld, await readFile(seriesWorld, "utf-8"), "utf-8");
  } else if (existsSync(workWorld) && !existsSync(seriesWorld)) {
    await mkdir(join(root, seriesDirOf(seriesId), "design"), { recursive: true });
    await writeFile(seriesWorld, await readFile(workWorld, "utf-8"), "utf-8");
  }

  const works = series.works.some((w) => w.type === type && w.id === id)
    ? series.works
    : [...series.works, { type, id, order: input.order ?? series.works.length + 1 }];
  const next: Series = { ...series, works: [...works].sort((a, b) => a.order - b.order) };
  await writeSeries(root, next);
  return next;
}

/** What book N still owes, in the words book N-1 used to promise it. */
export function openPromises(series: Series | null): ReadonlyArray<SeriesPromise> {
  return (series?.promises ?? []).filter((p) => !p.paidIn);
}

/**
 * The block a later work's planner is given.
 *
 * Deliberately short and deliberately quoted: a paraphrased promise is a new
 * promise, and the point of the ledger is that the second book pays the first
 * book's actual debt.
 */
export function seriesBrief(series: Series | null, forWorkId: string): string {
  if (!series) return "";
  const earlier = series.works.filter((w) => w.id !== forWorkId);
  if (!earlier.length) return "";
  const open = openPromises(series).filter((p) => p.openedIn !== forWorkId);
  const rows = [
    `SERIES — ${series.title}`,
    `Earlier: ${earlier.map((w) => w.id).join(", ")}`,
  ];
  if (open.length) {
    rows.push("Still open, and this work must acknowledge or pay them:");
    rows.push(...open.slice(0, 12).map((p) => `- "${p.text}" (opened in ${p.openedIn})`));
  }
  return rows.join("\n");
}

export async function addPromise(
  root: string, seriesId: string, text: string, openedIn: string,
): Promise<Series | null> {
  const series = await readSeries(root, seriesId);
  if (!series) return null;
  const promise: SeriesPromise = {
    id: `p${series.promises.length + 1}`,
    text: String(text).trim(),
    openedIn,
    paidIn: null,
    at: new Date().toISOString(),
  };
  const next = { ...series, promises: [...series.promises, promise] };
  await writeSeries(root, next);
  return next;
}

export async function settlePromise(
  root: string, seriesId: string, promiseId: string, paidIn: string,
): Promise<Series | null> {
  const series = await readSeries(root, seriesId);
  if (!series) return null;
  const next = {
    ...series,
    promises: series.promises.map((p) => (p.id === promiseId ? { ...p, paidIn } : p)),
  };
  await writeSeries(root, next);
  return next;
}
