/**
 * Audit packs: what an audit looks for, as data instead of constants.
 *
 * The dimensions an audit runs were already selectable — a genre pack picks
 * from the 37, `book_rules.md` can add to them — but only by editing files
 * nobody can see from the app, and the deterministic word lists were frozen in
 * TypeScript. A pack is the same choice written down: enable these, disable
 * those, add one of my own in a sentence, and move the thresholds. It is
 * versioned, it says which production types it applies to, and the taste engine
 * can append to it (19 §5).
 *
 * A pack never edits the builtin catalogue. It layers over it, so a bad pack
 * can be removed and the audit is exactly what it was.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** A dimension the catalogue ships: the ids a pack may enable or disable. */
export interface CatalogueDimension {
  readonly id: number;
  readonly en: string;
  readonly zh?: string;
  /** Story dimensions carry their question with them; book dimensions build it per genre. */
  readonly ask?: string;
}

export interface DimensionCatalogue {
  readonly id: string;
  readonly version: number;
  readonly kind: "book" | "story";
  readonly dimensions: ReadonlyArray<CatalogueDimension>;
}

/** A dimension a pack invents: one sentence, injected into the auditor prompt. */
export interface CustomDimension {
  readonly id: string;
  readonly label: string;
  readonly instruction: string;
  readonly severity?: "blocking" | "warning" | "note";
}

export interface WordDelta {
  readonly add?: ReadonlyArray<string>;
  readonly remove?: ReadonlyArray<string>;
}

export interface AuditPack {
  readonly id: string;
  readonly version: number;
  /** Production types this pack is for. Empty or absent means every type. */
  readonly appliesTo?: ReadonlyArray<string>;
  /** Which builtin catalogue it layers over. */
  readonly extends?: string;
  readonly dimensions?: {
    readonly enable?: ReadonlyArray<number | string>;
    readonly disable?: ReadonlyArray<number | string>;
    readonly custom?: ReadonlyArray<CustomDimension>;
  };
  readonly deterministic?: {
    readonly fatigueWords?: WordDelta;
    readonly hedgeWords?: WordDelta;
    readonly markers?: WordDelta;
    readonly paragraph?: { readonly maxChars?: number };
  };
  readonly scoring?: {
    readonly passThreshold?: number;
    readonly maxIterations?: number;
  };
  /**
   * Finding categories that stop an approval. Publication findings are
   * reported and nothing blocks; naming a category here is what lets a copy
   * gate actually gate (19 §3).
   */
  readonly blocking?: ReadonlyArray<string>;
  /** Accretions from the taste engine, newest last. */
  readonly rules?: ReadonlyArray<string>;
}

/** Every pack that applied, flattened into the answers the audit needs. */
export interface ResolvedAuditPack {
  /** Pack ids in resolution order — shown on a finding so an audit is explainable. */
  readonly packs: ReadonlyArray<string>;
  readonly enable: ReadonlySet<number>;
  readonly disable: ReadonlySet<number>;
  /**
   * Finding categories never to report again — what "never flag this again"
   * writes (19 §4.4). A name matches itself and anything under it, so
   * `ai-tell` silences the family and `ai-tell/Hedge density` one member.
   */
  readonly suppress: ReadonlySet<string>;
  readonly custom: ReadonlyArray<CustomDimension>;
  readonly fatigueWords: WordDelta;
  readonly hedgeWords: WordDelta;
  readonly markers: WordDelta;
  readonly paragraphMaxChars?: number;
  readonly passThreshold: number;
  readonly maxIterations: number;
  readonly blocking: ReadonlySet<string>;
  readonly rules: ReadonlyArray<string>;
}

/** What the audit does when nobody has chosen a pack — today's behaviour. */
export const DEFAULT_SCORING: { readonly passThreshold: number; readonly maxIterations: number } =
  { passThreshold: 85, maxIterations: 2 };

const packsRoot = (): string => fileURLToPath(new URL("../../audit-packs", import.meta.url));

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

function wordDelta(v: unknown): WordDelta {
  if (!isRecord(v)) return {};
  const add = strings(v.add);
  const remove = strings(v.remove);
  return { ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) };
}

function customDimensions(v: unknown): CustomDimension[] {
  if (!Array.isArray(v)) return [];
  const out: CustomDimension[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const instruction = typeof raw.instruction === "string" ? raw.instruction.trim() : "";
    // An instruction is the whole value of a custom dimension: without one the
    // auditor is being asked to judge a name.
    if (!id || !label || !instruction) continue;
    const severity = raw.severity === "blocking" || raw.severity === "note" ? raw.severity
      : raw.severity === "warning" ? "warning" : undefined;
    out.push({ id, label, instruction, ...(severity ? { severity } : {}) });
  }
  return out;
}

/** Read one pack from parsed JSON. Returns null when it is not a pack at all. */
export function parseAuditPack(raw: unknown): AuditPack | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  // A catalogue is not a pack; it is what packs layer over.
  if (raw.kind === "book" || raw.kind === "story") return null;

  const dims = isRecord(raw.dimensions) ? raw.dimensions : {};
  const det = isRecord(raw.deterministic) ? raw.deterministic : {};
  const scoring = isRecord(raw.scoring) ? raw.scoring : {};
  const paragraph = isRecord(det.paragraph) ? det.paragraph : {};

  const ids = (v: unknown): Array<number | string> =>
    Array.isArray(v)
      ? v.filter((x): x is number | string =>
          (typeof x === "number" && Number.isFinite(x)) || (typeof x === "string" && x.trim().length > 0))
      : [];

  return {
    id,
    version: typeof raw.version === "number" ? raw.version : 1,
    ...(Array.isArray(raw.appliesTo) ? { appliesTo: strings(raw.appliesTo) } : {}),
    ...(typeof raw.extends === "string" ? { extends: raw.extends } : {}),
    dimensions: {
      enable: ids(dims.enable),
      disable: ids(dims.disable),
      custom: customDimensions(dims.custom),
    },
    deterministic: {
      fatigueWords: wordDelta(det.fatigueWords),
      hedgeWords: wordDelta(det.hedgeWords),
      markers: wordDelta(det.markers),
      ...(typeof paragraph.maxChars === "number" ? { paragraph: { maxChars: paragraph.maxChars } } : {}),
    },
    scoring: {
      ...(typeof scoring.passThreshold === "number" ? { passThreshold: scoring.passThreshold } : {}),
      ...(typeof scoring.maxIterations === "number" ? { maxIterations: scoring.maxIterations } : {}),
    },
    blocking: strings(raw.blocking),
    rules: strings(raw.rules),
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as unknown;
  } catch {
    // A pack that will not parse is skipped, never fatal: an audit with the
    // default dimensions is worth more than no audit at all.
    return null;
  }
}

/** The dimension catalogues that ship with the engine, by id. */
export async function readCatalogues(root = packsRoot()): Promise<Map<string, DimensionCatalogue>> {
  const out = new Map<string, DimensionCatalogue>();
  let names: string[] = [];
  try {
    names = (await readdir(root)).filter((n) => n.endsWith(".json"));
  } catch {
    return out;
  }
  for (const name of names) {
    const raw = await readJson(join(root, name));
    if (!isRecord(raw) || (raw.kind !== "book" && raw.kind !== "story")) continue;
    const dimensions = Array.isArray(raw.dimensions)
      ? raw.dimensions.filter(isRecord).flatMap((d): CatalogueDimension[] => {
          const id = typeof d.id === "number" ? d.id : NaN;
          const en = typeof d.en === "string" ? d.en : "";
          if (!Number.isFinite(id) || !en) return [];
          return [{
            id, en,
            ...(typeof d.zh === "string" ? { zh: d.zh } : {}),
            ...(typeof d.ask === "string" ? { ask: d.ask } : {}),
          }];
        })
      : [];
    const id = typeof raw.id === "string" ? raw.id : name.replace(/\.json$/, "");
    out.set(id, {
      id, kind: raw.kind,
      version: typeof raw.version === "number" ? raw.version : 1,
      dimensions,
    });
  }
  return out;
}

/**
 * Every pack available: the ones that ship, then the user's own. A user pack
 * with the same id replaces the builtin, the way a user skill does.
 */
export async function readAuditPacks(
  workspace?: string | null,
  root = packsRoot(),
): Promise<AuditPack[]> {
  const by = new Map<string, AuditPack>();

  const fromDir = async (dir: string, nested: boolean): Promise<void> => {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = nested ? join(dir, name, "pack.json") : join(dir, name);
      if (!nested && !name.endsWith(".json")) continue;
      const pack = parseAuditPack(await readJson(path));
      if (pack) by.set(pack.id, pack);
    }
  };

  await fromDir(root, false);
  if (workspace) await fromDir(join(workspace, "audit", "packs"), true);
  return [...by.values()];
}

export interface ResolveAuditPackInput {
  /** Production type — a pack that names `appliesTo` only applies to its types. */
  readonly type?: string | null;
  readonly available: ReadonlyArray<AuditPack>;
  /** Pack ids chosen on the book or issue, in the order the user listed them. */
  readonly selected?: ReadonlyArray<string>;
  /** Dimensions `book_rules.md` adds, already resolved to catalogue ids. */
  readonly bookRuleDimensions?: ReadonlyArray<number>;
  /** A one-off override for a single unit, layered last. */
  readonly override?: AuditPack | null;
}

/**
 * Resolution order, per 19 §1: builtin base → type defaults → the packs chosen
 * on the work → `book_rules.md` additions → a per-unit override. Later layers
 * win, and `disable` beats `enable` within one layer so a pack can subtract
 * from the catalogue it extends.
 */
export function resolveAuditPack(input: ResolveAuditPackInput): ResolvedAuditPack {
  const applies = (p: AuditPack): boolean =>
    !p.appliesTo?.length || !input.type || p.appliesTo.includes(input.type);

  // Type defaults come first so a pack the user chose can still turn one off.
  const defaults = input.available.filter((p) => p.appliesTo?.length && applies(p));
  const chosen = (input.selected ?? [])
    .map((id) => input.available.find((p) => p.id === id))
    .filter((p): p is AuditPack => Boolean(p) && applies(p as AuditPack));

  const layers = [...defaults, ...chosen, ...(input.override ? [input.override] : [])];

  const enable = new Set<number>();
  const disable = new Set<number>();
  const suppress = new Set<string>();
  const custom = new Map<string, CustomDimension>();
  const blocking = new Set<string>();
  const rules: string[] = [];
  const fatigue = { add: new Set<string>(), remove: new Set<string>() };
  const hedge = { add: new Set<string>(), remove: new Set<string>() };
  const markers = { add: new Set<string>(), remove: new Set<string>() };
  let paragraphMaxChars: number | undefined;
  let passThreshold = DEFAULT_SCORING.passThreshold;
  let maxIterations = DEFAULT_SCORING.maxIterations;

  const merge = (into: { add: Set<string>; remove: Set<string> }, delta?: WordDelta): void => {
    for (const w of delta?.add ?? []) { into.add.add(w); into.remove.delete(w); }
    for (const w of delta?.remove ?? []) { into.remove.add(w); into.add.delete(w); }
  };

  for (const pack of layers) {
    for (const id of pack.dimensions?.enable ?? []) {
      if (typeof id === "number") { enable.add(id); disable.delete(id); }
      else suppress.delete(id);
    }
    for (const id of pack.dimensions?.disable ?? []) {
      if (typeof id === "number") { disable.add(id); enable.delete(id); }
      // A name rather than a number is a finding category, not a catalogue
      // entry: it is silenced rather than switched off.
      else suppress.add(id);
    }
    for (const d of pack.dimensions?.custom ?? []) custom.set(d.id, d);
    merge(fatigue, pack.deterministic?.fatigueWords);
    merge(hedge, pack.deterministic?.hedgeWords);
    merge(markers, pack.deterministic?.markers);
    if (pack.deterministic?.paragraph?.maxChars) paragraphMaxChars = pack.deterministic.paragraph.maxChars;
    if (pack.scoring?.passThreshold !== undefined) passThreshold = pack.scoring.passThreshold;
    if (pack.scoring?.maxIterations !== undefined) maxIterations = pack.scoring.maxIterations;
    for (const c of pack.blocking ?? []) blocking.add(c);
    rules.push(...(pack.rules ?? []));
  }

  // book_rules.md is the user's own file and layers after the packs, so a
  // dimension they wrote in by hand is never taken away by a pack default.
  for (const id of input.bookRuleDimensions ?? []) { enable.add(id); disable.delete(id); }

  const list = (s: Set<string>): string[] => [...s];
  return {
    packs: layers.map((p) => p.id),
    enable, disable, suppress,
    custom: [...custom.values()],
    fatigueWords: { add: list(fatigue.add), remove: list(fatigue.remove) },
    hedgeWords: { add: list(hedge.add), remove: list(hedge.remove) },
    markers: { add: list(markers.add), remove: list(markers.remove) },
    ...(paragraphMaxChars ? { paragraphMaxChars } : {}),
    passThreshold, maxIterations, blocking,
    rules,
  };
}

/** An empty resolution: what every caller gets when no pack is in play. */
export function noAuditPack(): ResolvedAuditPack {
  return resolveAuditPack({ available: [] });
}

/**
 * The workspace a production folder sits in, found by the `.quire` directory
 * every workspace has. Bounded, and returns null rather than guessing: a wrong
 * answer here would read some other folder's packs.
 */
async function workspaceOf(dir: string): Promise<string | null> {
  let at = dir;
  for (let up = 0; up < 4; up += 1) {
    try {
      await readdir(join(at, ".quire"));
      return at;
    } catch { /* keep walking */ }
    const parent = join(at, "..");
    if (parent === at) break;
    at = parent;
  }
  return null;
}

/**
 * The pack for one work, read from its own folder.
 *
 * `<work>/audit/packs.json` is the list the user picked in settings;
 * `<work>/audit/pack.json` is a one-off override for this work alone. Both are
 * optional, and with neither the audit is the type default and the builtin
 * catalogue — which is what every existing book gets, unchanged.
 */
export async function auditPackIn(
  dir: string,
  type?: string | null,
  bookRuleDimensions?: ReadonlyArray<number>,
): Promise<ResolvedAuditPack> {
  const workspace = await workspaceOf(dir);
  const available = await readAuditPacks(workspace);
  const chosen = await readJson(join(dir, "audit", "packs.json"));
  const selected = isRecord(chosen) ? strings(chosen.packs) : [];
  const override = parseAuditPack(await readJson(join(dir, "audit", "pack.json")));
  return resolveAuditPack({
    type: type ?? null, available, selected, override,
    ...(bookRuleDimensions ? { bookRuleDimensions } : {}),
  });
}

/** Whether a pack has silenced this finding category (19 §4.4). */
export function isSuppressed(pack: ResolvedAuditPack, category: string): boolean {
  for (const name of pack.suppress) {
    if (category === name || category.startsWith(`${name}/`)) return true;
  }
  return false;
}

/** Apply a pack's `{add, remove}` to a builtin word list, case-insensitively. */
export function applyWordDelta(base: ReadonlyArray<string>, delta?: WordDelta): string[] {
  const gone = new Set((delta?.remove ?? []).map((w) => w.toLowerCase()));
  const out = base.filter((w) => !gone.has(w.toLowerCase()));
  const have = new Set(out.map((w) => w.toLowerCase()));
  for (const w of delta?.add ?? []) {
    if (!have.has(w.toLowerCase())) { out.push(w); have.add(w.toLowerCase()); }
  }
  return out;
}

/**
 * The dimension ids an audit should run, given the catalogue it works from and
 * what the genre already chose. `enable` adds, `disable` removes, and a pack
 * that names neither leaves the audit exactly as it was.
 */
export function activeDimensions(
  fromGenre: Iterable<number>,
  pack: ResolvedAuditPack,
): Set<number> {
  const active = new Set<number>(fromGenre);
  for (const id of pack.enable) active.add(id);
  for (const id of pack.disable) active.delete(id);
  return active;
}

/** The prompt block a pack's custom dimensions add, or "" when it has none. */
export function customDimensionPrompt(pack: ResolvedAuditPack): string {
  if (!pack.custom.length) return "";
  return [
    "Also judge it on these, which this work has asked for specifically:",
    ...pack.custom.map((d) => `- ${d.label} (${d.id}) — ${d.instruction}`),
  ].join("\n");
}
