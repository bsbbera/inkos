/**
 * The personal magazine (13 §Sources, sellable feature 11 #6): research that
 * reads what the person has already read.
 *
 * An Obsidian vault, a folder of notes, a Zotero library — each becomes items
 * of `{title, date, text, tags, highlights}`, and the items become a search
 * source beside the web ones. That is the whole integration: research asks
 * every source the same questions, so an issue built from "everything I read
 * in August tagged #science" needs no second research path, and the claim
 * check that drops unsourced facts applies to the person's notes too.
 *
 * Nothing leaves the machine except as prompt text to the person's own model.
 */
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { SearchSource } from "../utils/search-sources.js";

export interface PersonalItem {
  readonly id: string;
  readonly title: string;
  readonly date?: string;
  readonly text: string;
  readonly tags: ReadonlyArray<string>;
  readonly highlights: ReadonlyArray<string>;
  readonly url?: string;
  readonly source: "markdown" | "zotero";
}

export interface PersonalSourcesConfig {
  readonly markdown?: ReadonlyArray<{ readonly dir: string; readonly tag?: string; readonly since?: string }>;
  readonly zotero?: { readonly path?: string; readonly tag?: string; readonly since?: string } | null;
}

export const personalConfigPath = (root: string) => join(root, ".quire", "personal-sources.json");

export async function readPersonalConfig(root: string): Promise<PersonalSourcesConfig> {
  return await readFile(personalConfigPath(root), "utf-8")
    .then((t) => JSON.parse(t) as PersonalSourcesConfig)
    .catch(() => ({}));
}

export async function writePersonalConfig(root: string, config: PersonalSourcesConfig): Promise<void> {
  await mkdir(join(root, ".quire"), { recursive: true });
  await writeFile(personalConfigPath(root), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

const norm = (tag: string) => tag.replace(/^#/, "").trim().toLowerCase();

/** Frontmatter as flat key → value(s); enough for title, date and tags. */
export function frontmatter(markdown: string): { readonly data: Record<string, string | string[]>; readonly body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!m) return { data: {}, body: markdown };
  const data: Record<string, string | string[]> = {};
  let listKey = "";
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item && listKey) {
      const prev = data[listKey];
      data[listKey] = [...(Array.isArray(prev) ? prev : prev ? [prev] : []), item[1]!.replace(/^["']|["']$/g, "")];
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    listKey = kv[1]!.toLowerCase();
    const value = kv[2]!.trim();
    if (/^\[.*\]$/.test(value)) {
      data[listKey] = value.slice(1, -1).split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else if (value) {
      data[listKey] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { data, body: markdown.slice(m[0].length) };
}

/** One note as an item: frontmatter and inline #tags, ==highlights== and quotes. */
export function noteItem(markdown: string, file: string, mtime: Date): PersonalItem {
  const { data, body } = frontmatter(markdown);
  const fmTags = data.tags ?? data.tag ?? [];
  const inline = [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]!);
  const tags = [...new Set([...(Array.isArray(fmTags) ? fmTags : [fmTags]), ...inline].map(norm).filter(Boolean))];
  const highlights = [
    ...[...body.matchAll(/==([^=\n]{3,300})==/g)].map((m) => m[1]!.trim()),
    ...body.split(/\r?\n/).filter((l) => /^>\s?\S/.test(l)).map((l) => l.replace(/^>\s?/, "").trim()),
  ].slice(0, 20);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1];
  const title = String(data.title ?? heading ?? basename(file).replace(/\.md$/i, ""));
  const date = typeof data.date === "string" && !Number.isNaN(Date.parse(data.date))
    ? new Date(data.date).toISOString().slice(0, 10)
    : mtime.toISOString().slice(0, 10);
  const url = typeof data.url === "string" ? data.url : typeof data.source === "string" && /^https?:/.test(data.source) ? data.source : undefined;
  return { id: `md:${file}`, title, date, text: body.trim(), tags, highlights, ...(url ? { url } : {}), source: "markdown" };
}

const wanted = (item: PersonalItem, filter: { tag?: string; since?: string }) =>
  (!filter.tag || item.tags.includes(norm(filter.tag)))
  && (!filter.since || !item.date || item.date >= filter.since);

/** Every note in a folder, recursively, filtered by tag and date. */
export async function readMarkdownFolder(input: {
  readonly dir: string; readonly tag?: string; readonly since?: string; readonly limit?: number;
}): Promise<PersonalItem[]> {
  const out: PersonalItem[] = [];
  const limit = input.limit ?? 2000;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6 || out.length >= limit) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (/\.md$/i.test(e.name)) {
        const [text, info] = await Promise.all([readFile(full, "utf-8").catch(() => ""), stat(full).catch(() => null)]);
        if (!text.trim() || !info) continue;
        const item = noteItem(text, full, info.mtime);
        if (wanted(item, input)) out.push(item);
      }
    }
  };
  await walk(input.dir, 0);
  return out;
}

/**
 * A Zotero library: titles, abstracts, notes, PDF annotations and tags.
 *
 * Zotero holds a lock on its database while it runs, so a copy is read. The
 * schema has moved between versions, so every part is asked for separately and
 * a part that fails is simply absent.
 */
export async function readZotero(input: {
  readonly path?: string; readonly tag?: string; readonly since?: string;
}): Promise<PersonalItem[]> {
  const db = input.path ?? join(homedir(), "Zotero", "zotero.sqlite");
  if (!existsSync(db)) return [];
  let sqlite: typeof import("node:sqlite");
  try {
    sqlite = await import("node:sqlite");
  } catch {
    throw new Error("Reading Zotero needs Node 22.13 or later (node:sqlite)");
  }
  const copy = join(tmpdir(), `quire-zotero-${process.pid}.sqlite`);
  await copyFile(db, copy);
  const conn = new sqlite.DatabaseSync(copy, { readOnly: true });
  const all = <T>(sql: string): T[] => {
    try { return conn.prepare(sql).all() as T[]; } catch { return []; }
  };
  try {
    const field = (name: string) => `(SELECT v.value FROM itemData d JOIN fields f ON f.fieldID = d.fieldID
      JOIN itemDataValues v ON v.valueID = d.valueID WHERE d.itemID = i.itemID AND f.fieldName = '${name}')`;
    const items = all<{ itemID: number; key: string; title: string | null; date: string | null; url: string | null; abstract: string | null }>(
      `SELECT i.itemID, i.key, ${field("title")} AS title, ${field("date")} AS date, ${field("url")} AS url, ${field("abstractNote")} AS abstract
       FROM items i WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)`,
    ).filter((r) => r.title);
    const notes = all<{ parentItemID: number; note: string }>("SELECT parentItemID, note FROM itemNotes WHERE parentItemID IS NOT NULL");
    const marks = all<{ parent: number; text: string | null; comment: string | null }>(
      `SELECT att.parentItemID AS parent, a.text, a.comment FROM itemAnnotations a
       JOIN itemAttachments att ON att.itemID = a.parentItemID WHERE att.parentItemID IS NOT NULL`,
    );
    const tags = all<{ itemID: number; name: string }>("SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON t.tagID = it.tagID");
    const by = <T extends { [k: string]: unknown }>(rows: T[], key: keyof T) => {
      const m = new Map<number, T[]>();
      for (const r of rows) m.set(r[key] as number, [...(m.get(r[key] as number) ?? []), r]);
      return m;
    };
    const notesBy = by(notes, "parentItemID");
    const marksBy = by(marks, "parent");
    const tagsBy = by(tags, "itemID");
    const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const out: PersonalItem[] = [];
    for (const r of items) {
      const highlights = (marksBy.get(r.itemID) ?? []).flatMap((m) => [m.text, m.comment]).filter((t): t is string => Boolean(t?.trim()));
      const text = [r.abstract ?? "", ...(notesBy.get(r.itemID) ?? []).map((n) => strip(n.note))].filter(Boolean).join("\n\n");
      const year = /\d{4}(-\d{2}(-\d{2})?)?/.exec(r.date ?? "")?.[0];
      const item: PersonalItem = {
        id: `zotero:${r.key}`,
        title: r.title!,
        ...(year ? { date: year } : {}),
        text,
        tags: (tagsBy.get(r.itemID) ?? []).map((t) => norm(t.name)),
        highlights: highlights.slice(0, 30),
        url: r.url || `zotero://select/items/0_${r.key}`,
        source: "zotero",
      };
      if (wanted(item, input)) out.push(item);
    }
    return out;
  } finally {
    conn.close();
  }
}

let cache: { key: string; at: number; items: PersonalItem[] } | null = null;

/** Every item every configured source yields. Cached a minute: research asks many times. */
export async function loadPersonalItems(root: string): Promise<PersonalItem[]> {
  const config = await readPersonalConfig(root);
  const key = JSON.stringify(config);
  if (cache && cache.key === key && Date.now() - cache.at < 60_000) return cache.items;
  const items: PersonalItem[] = [];
  for (const folder of config.markdown ?? []) {
    items.push(...await readMarkdownFolder({ ...folder }).catch(() => []));
  }
  if (config.zotero) items.push(...await readZotero({ ...config.zotero }).catch(() => []));
  cache = { key, at: Date.now(), items };
  return items;
}

// Without these, "the" alone matched every note to every query.
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "about", "what", "when", "where", "which", "their", "there", "were", "was", "are", "how", "why", "who", "its", "not", "but"]);
const split = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u);
const terms = (q: string) => [...new Set(split(q).filter((t) => t.length > 2 && !STOP.has(t)))];
const HAN = /\p{Script=Han}/u;

/** Title hits count triple, tags double, highlights and text once. Whole words; Chinese by substring. */
export function scoreItem(item: PersonalItem, query: string): number {
  const qs = terms(query);
  if (!qs.length) return 0;
  const fields = [item.title, item.highlights.join(" "), item.text].map((s) => ({ raw: s.toLowerCase(), words: new Set(split(s)) }));
  const hit = (f: { raw: string; words: Set<string> }, t: string) => HAN.test(t) ? f.raw.includes(t) : f.words.has(t);
  const [title, marks, text] = fields as [typeof fields[0], typeof fields[0], typeof fields[0]];
  let score = 0;
  for (const t of qs) {
    if (hit(title, t)) score += 3;
    if (item.tags.some((g) => g === t)) score += 2;
    if (hit(marks, t)) score += 1.5;
    if (hit(text, t)) score += 1;
  }
  return score;
}

/** The person's notes as a search source, or null when none are configured. */
export async function personalSource(root: string): Promise<SearchSource | null> {
  const config = await readPersonalConfig(root);
  if (!config.markdown?.length && !config.zotero) return null;
  return {
    id: "personal",
    kind: "local",
    async run(query, limit) {
      const items = await loadPersonalItems(root);
      return items
        .map((item) => ({ item, score: scoreItem(item, query) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ item }) => ({
          title: item.title,
          url: item.url ?? `personal:${item.id}`,
          snippet: (item.highlights[0] ?? item.text).replace(/\s+/g, " ").slice(0, 300),
        }));
    },
  };
}
