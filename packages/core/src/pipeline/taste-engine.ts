/**
 * The taste engine (18): capture → distill → approve → apply, and the pack
 * that carries it somewhere else.
 *
 * Capture already happens — every verdict, gate, finding and final lands in
 * `_taste/feedback.jsonl`. This is the rest. Distillation counts first: a
 * "too busy" chip pressed on seven pictures of one work is a rule without any
 * model, and a person can read exactly why it was proposed. Notes and diffs,
 * which only a model can generalise, go to a model second. Nothing proposed is
 * applied until someone accepts it; what is accepted is injected into the next
 * unit's prompt, watched for three units, and flagged if all three come back
 * redone.
 *
 * ponytail: one `rules.jsonl` with a scope on every rule, instead of a rules
 * file beside each style, world and skill. The scope is the same information;
 * one file is one thing to read, export and prune.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, sep } from "node:path";
import JSZip from "jszip";
import { workDirOf, worldPathOf } from "./image-prompt.js";
import { KITS_DIR, kitIdOf } from "./kit.js";

export interface TasteRule {
  readonly id: string;
  readonly at: string;
  readonly text: string;
  readonly kind: "sentence" | "number";
  /** `{}` everywhere; `{work: "book/b"}` one work; `{surface: "image"}` one kind of verdict. */
  readonly scope: Readonly<Record<string, string>>;
  readonly evidence: ReadonlyArray<string>;
  readonly source: string;
  /** The first three verdicts after acceptance, watched (18 §5). */
  readonly trial?: { readonly seen: number; readonly redo: number };
  /** All three came back redone: the rule may be wrong. */
  readonly review?: boolean;
  readonly retired?: string;
}

/** A verdict as the stream holds it — the fields distillation reads. */
export interface TasteEvent {
  readonly id: string;
  readonly at: string;
  readonly ref: { readonly type: string; readonly id: string; readonly unit?: number };
  readonly surface: string;
  readonly verdict: string;
  readonly cause?: ReadonlyArray<string>;
  readonly note?: string;
  readonly source: string;
  /**
   * What the verdict was about beyond the work: `audit` carries the finding's
   * category, `world` the design world, `stylePack` the voice. The stream has
   * always written it; distillation reads it for the audit scope (19 §5.2).
   */
  readonly scope?: Readonly<Record<string, string>>;
  readonly diff?: unknown;
}

export interface RuleProposal {
  readonly scope: Readonly<Record<string, string>>;
  readonly text: string;
  readonly kind: "sentence" | "number";
  readonly evidence: ReadonlyArray<string>;
  readonly source: "distill" | "pack" | "final";
}

const rulesFile = (root: string) => join(root, "_taste", "rules.jsonl");

async function readLines<T>(file: string): Promise<T[]> {
  const text = await readFile(file, "utf-8").catch(() => "");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* a broken line costs that line */ }
  }
  return out;
}

export async function readRules(root: string): Promise<TasteRule[]> {
  return await readLines<TasteRule>(rulesFile(root));
}

async function writeRules(root: string, rules: ReadonlyArray<TasteRule>): Promise<void> {
  await mkdir(dirname(rulesFile(root)), { recursive: true });
  await writeFile(rulesFile(root), rules.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf-8");
}

/** Accept a rule. It starts on trial: the next three verdicts in its scope are watched. */
export async function addRule(root: string, input: Omit<TasteRule, "id" | "at" | "trial" | "review" | "retired">): Promise<TasteRule> {
  const rule: TasteRule = {
    ...input,
    id: `tr_${Date.now().toString(36)}${randomUUID().slice(0, 4)}`,
    at: new Date().toISOString(),
    trial: { seen: 0, redo: 0 },
  };
  await writeRules(root, [...await readRules(root), rule]);
  return rule;
}

export async function retireRule(root: string, id: string): Promise<TasteRule | null> {
  const all = await readRules(root);
  const hit = all.find((r) => r.id === id);
  if (!hit) return null;
  const next = { ...hit, retired: new Date().toISOString() };
  await writeRules(root, all.map((r) => (r.id === id ? next : r)));
  return next;
}

export const scopeKey = (scope: Readonly<Record<string, string>>): string =>
  Object.entries(scope).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`).join("|") || "global";

/** Whether a rule speaks to this work and this kind of output. Every key it names must match. */
export function applies(
  rule: Pick<TasteRule, "scope" | "retired">,
  at: { readonly type: string; readonly id: string; readonly surface?: string; readonly style?: string },
): boolean {
  if (rule.retired) return false;
  for (const [key, value] of Object.entries(rule.scope)) {
    if (key === "work" && value !== `${at.type}/${at.id}`) return false;
    if (key === "type" && value !== at.type) return false;
    if (key === "surface" && at.surface && value !== at.surface) return false;
    if (key === "style" && value !== at.style) return false;
  }
  return true;
}

/** The sentence rules for a unit, newest first — what goes into its prompt. */
export async function rulesFor(
  root: string,
  at: { readonly type: string; readonly id: string; readonly surface?: string; readonly style?: string },
  limit = 8,
): Promise<string[]> {
  return (await readRules(root))
    .filter((r) => r.kind === "sentence" && applies(r, at))
    .reverse()
    .slice(0, limit)
    .map((r) => r.text);
}

/* ------------------------------------------------------------ counting */

/** A chip pressed often enough is a rule. These are the rules the chips mean. */
export const CAUSE_RULES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  content: {
    "too long": "Cut before adding: shorter paragraphs and fewer sentences per beat.",
    unclear: "Say the concrete thing first, one idea to a sentence.",
    dull: "Open every scene on an action or an object, never on a summary.",
    "wrong tone": "Hold the work's tone; no shift of register inside a scene.",
    factual: "Check every figure and name against the sources before it is written.",
    "off-setting": "Nothing may appear that does not belong to the work's place and time.",
  },
  image: {
    "doesn't match text": "Show the scene exactly as the text describes it.",
    "wrong style": "Stay strictly inside the world's technique and palette.",
    "too busy": "Keep pictures simple: fewer elements, more empty space.",
    realism: "Flat, plainly illustrated pictures; nothing photographic.",
    "bad crop": "Keep the whole subject in the frame.",
    "character off": "Draw each character exactly as their sheet describes them.",
  },
  design: {
    "too busy": "One dominant element per page; fewer blocks.",
    dull: "Give every spread one bold move.",
    "wrong colour": "Keep to the world's palette; accent only on numbers, rules and one panel.",
    "type too small": "Body type never below the reader's floor.",
    "image doesn't fit": "Crop pictures to their frame; never squash them.",
    generic: "Use the world's own props and technique; nothing that looks like stock.",
  },
  build: {
    "text overflow": "Cut copy to fit its frame before layout.",
    fonts: "Only faces the kit declares.",
    "bleed/safe": "Keep text at least 5 mm inside the trim.",
    "colour off": "Convert colour once, at export.",
  },
};

const NEGATIVE = new Set(["redo", "tweak", "reject", "re-world"]);
/** A person's hand-finished final says more than a chip (18 §1). */
const weightOf = (e: TasteEvent) => (e.source === "final" ? 3 : 1);
const MIN_WEIGHT = 5;

/**
 * Rules from counted causes, no model involved.
 *
 * A cause pressed with weight ≥ 5 on one work proposes a rule for that work;
 * the same cause across two or more works proposes it everywhere for that
 * kind of verdict. Anything already a rule, or already proposed — including
 * proposals someone ignored — is not proposed again.
 */
export function causeProposals(
  events: ReadonlyArray<TasteEvent>,
  known: ReadonlyArray<{ readonly text: string; readonly scope: Readonly<Record<string, string>>; readonly retired?: string }>,
): RuleProposal[] {
  const seen = new Set(known.filter((k) => !k.retired).map((k) => `${scopeKey(k.scope)}::${k.text}`));
  const perWork = new Map<string, { surface: string; cause: string; work: string; weight: number; ids: string[] }>();
  const perCause = new Map<string, { surface: string; cause: string; works: Set<string>; weight: number; ids: string[] }>();
  for (const e of events) {
    if (!NEGATIVE.has(e.verdict)) continue;
    for (const cause of e.cause ?? []) {
      if (!CAUSE_RULES[e.surface]?.[cause]) continue;
      const work = `${e.ref.type}/${e.ref.id}`;
      const a = perWork.get(`${e.surface}|${cause}|${work}`) ?? { surface: e.surface, cause, work, weight: 0, ids: [] };
      a.weight += weightOf(e);
      a.ids.push(e.id);
      perWork.set(`${e.surface}|${cause}|${work}`, a);
      const b = perCause.get(`${e.surface}|${cause}`) ?? { surface: e.surface, cause, works: new Set(), weight: 0, ids: [] };
      b.weight += weightOf(e);
      b.works.add(work);
      b.ids.push(e.id);
      perCause.set(`${e.surface}|${cause}`, b);
    }
  }
  const out: RuleProposal[] = [];
  const push = (scope: Record<string, string>, surface: string, cause: string, ids: string[]) => {
    const text = CAUSE_RULES[surface]![cause]!;
    const key = `${scopeKey(scope)}::${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ scope, text, kind: "sentence", evidence: ids.slice(-20), source: "distill" });
  };
  for (const g of perCause.values()) {
    if (g.works.size >= 2 && g.weight >= MIN_WEIGHT) push({ surface: g.surface }, g.surface, g.cause, g.ids);
  }
  for (const g of perWork.values()) {
    const global = perCause.get(`${g.surface}|${g.cause}`);
    if (global && global.works.size >= 2 && global.weight >= MIN_WEIGHT) continue;
    if (g.weight >= MIN_WEIGHT) push({ surface: g.surface, work: g.work }, g.surface, g.cause, g.ids);
  }
  // Highest weight first, so the Taste page leads with what was pressed most.
  return out.sort((a, b) => b.evidence.length - a.evidence.length);
}

/** Below this many verdicts a ratio is noise, not a pattern (19 §5.2). */
const AUDIT_MIN_VERDICTS = 10;
/** Ignored this often, the check is wrong for this work rather than the work wrong. */
const AUDIT_IGNORED_SHARE = 0.8;

/**
 * Checks the person keeps waving away (19 §5.2).
 *
 * Every finding verdict is already captured with the category that raised it.
 * A category ignored four times out of five, over at least ten verdicts, is
 * not catching anything this person wants caught — so propose silencing it.
 * The proposal carries the category as a `number`-free rule the accept handler
 * writes into the work's own pack, never a shared one.
 *
 * Counted per work. One book hating a check says nothing about the next.
 */
export function auditProposals(
  events: ReadonlyArray<TasteEvent>,
  known: ReadonlyArray<{ readonly text: string; readonly scope: Readonly<Record<string, string>>; readonly retired?: string }>,
): RuleProposal[] {
  const seen = new Set(known.filter((k) => !k.retired).map((k) => `${scopeKey(k.scope)}::${k.text}`));
  const tally = new Map<string, {
    category: string; work: string; type: string; id: string;
    kept: number; ignored: number; ids: string[];
  }>();

  for (const e of events) {
    const category = e.scope?.audit;
    if (e.source !== "audit" || !category) continue;
    const work = `${e.ref.type}/${e.ref.id}`;
    const key = `${category}|${work}`;
    const row = tally.get(key)
      ?? { category, work, type: e.ref.type, id: e.ref.id, kept: 0, ignored: 0, ids: [] };
    // "keep" on a finding means the fix was taken; "reject" means it was left.
    if (e.verdict === "keep") row.kept += 1; else row.ignored += 1;
    row.ids.push(e.id);
    tally.set(key, row);
  }

  const out: RuleProposal[] = [];
  for (const row of tally.values()) {
    const total = row.kept + row.ignored;
    if (total < AUDIT_MIN_VERDICTS) continue;
    if (row.ignored / total < AUDIT_IGNORED_SHARE) continue;
    const scope = { surface: "content", work: row.work, audit: row.category };
    const text = `Stop flagging ${row.category}: ${row.ignored} of ${total} were left alone.`;
    const key = `${scopeKey(scope)}::${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ scope, text, kind: "sentence", evidence: row.ids.slice(-20), source: "distill" });
  }
  return out.sort((a, b) => b.evidence.length - a.evidence.length);
}

/* ------------------------------------------------------------ the model */

export interface DistillGroup {
  readonly scope: Readonly<Record<string, string>>;
  readonly events: ReadonlyArray<TasteEvent>;
}

/** Verdicts with words in them — notes and diffs — grouped by work and surface. */
export function distillGroups(events: ReadonlyArray<TasteEvent>): DistillGroup[] {
  const by = new Map<string, { scope: Record<string, string>; events: TasteEvent[]; weight: number }>();
  for (const e of events) {
    if (!NEGATIVE.has(e.verdict) || (!e.note && !e.diff)) continue;
    const scope = { surface: e.surface, work: `${e.ref.type}/${e.ref.id}` };
    const key = scopeKey(scope);
    const g = by.get(key) ?? { scope, events: [] as TasteEvent[], weight: 0 };
    g.events.push(e);
    g.weight += weightOf(e);
    by.set(key, g);
  }
  return [...by.values()].filter((g) => g.weight >= MIN_WEIGHT).map(({ scope, events }) => ({ scope, events }));
}

const compact = (e: TasteEvent) => {
  const diff = e.diff && typeof e.diff === "object" ? e.diff as { before?: string; after?: string } : null;
  return [
    `[${e.id}] ${e.verdict}${e.source === "final" ? " (from their hand-finished final)" : ""}`,
    e.cause?.length ? `causes: ${e.cause.join(", ")}` : "",
    e.note ? `note: ${e.note}` : "",
    diff?.before !== undefined || diff?.after !== undefined
      ? `changed: "${String(diff?.before ?? "").slice(0, 160)}" → "${String(diff?.after ?? "").slice(0, 160)}"`
      : "",
  ].filter(Boolean).join(" · ");
};

export function buildDistillPrompt(group: DistillGroup, existing: ReadonlyArray<string>): string {
  return [
    `Below are ${group.events.length} verdicts one person gave on ${group.scope.surface} for ${group.scope.work}.`,
    "Propose at most 5 durable rules that would have prevented them. Each rule must be:",
    "- one imperative sentence a writer or illustrator can obey or break on a single unit;",
    "- supported by at least three of the verdicts below (cite their ids);",
    "- not already covered by an existing rule.",
    "Verdicts marked as coming from their hand-finished final weigh three times the others.",
    existing.length ? `Existing rules:\n${existing.map((r) => `- ${r}`).join("\n")}` : "There are no existing rules.",
    "",
    "Verdicts:",
    ...group.events.slice(-40).map(compact),
    "",
    'Return JSON only: {"rules":[{"text":"...","kind":"sentence|number","evidence":["fb_..."]}]}',
  ].join("\n");
}

/** A model's rules, held to the shape: short, cited, never a duplicate. */
export function parseDistill(out: Record<string, unknown>, group: DistillGroup, existing: ReadonlyArray<string>): RuleProposal[] {
  const ids = new Set(group.events.map((e) => e.id));
  const have = new Set(existing.map((t) => t.toLowerCase().trim()));
  const raw = Array.isArray(out.rules) ? out.rules as Array<Record<string, unknown>> : [];
  const rules: RuleProposal[] = [];
  for (const r of raw.slice(0, 5)) {
    const text = String(r.text ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 220 || have.has(text.toLowerCase())) continue;
    const cited = (Array.isArray(r.evidence) ? r.evidence : []).map(String).filter((id) => ids.has(id));
    if (cited.length < 3) continue;
    have.add(text.toLowerCase());
    rules.push({ scope: group.scope, text, kind: r.kind === "number" ? "number" : "sentence", evidence: cited, source: "distill" });
  }
  return rules;
}

/* ------------------------------------------------------------ the trial */

/**
 * Count a new verdict against every rule still on trial in its scope.
 *
 * A rule accepted and then followed by three redos in a row is either wrong or
 * being applied wrongly; either way a person should look, so it is flagged —
 * never retired on its own (18 §5).
 */
export async function noteTrial(root: string, event: TasteEvent): Promise<ReadonlyArray<string>> {
  const all = await readRules(root);
  const flagged: string[] = [];
  let changed = false;
  const next = all.map((r) => {
    if (!r.trial || r.trial.seen >= 3 || r.retired || event.at <= r.at) return r;
    if (!applies(r, { type: event.ref.type, id: event.ref.id, surface: event.surface })) return r;
    changed = true;
    const trial = { seen: r.trial.seen + 1, redo: r.trial.redo + (event.verdict === "redo" || event.verdict === "reject" ? 1 : 0) };
    const review = trial.seen === 3 && trial.redo === 3;
    if (review) flagged.push(r.id);
    return { ...r, trial, ...(review ? { review: true } : {}) };
  });
  if (changed) await writeRules(root, next);
  return flagged;
}

/* ------------------------------------------------------------ taste packs */

export interface TastePackManifest {
  readonly id: string;
  readonly version: 1;
  readonly createdAt: string;
  readonly author?: string;
  readonly license?: string;
  readonly contains: {
    readonly styles: ReadonlyArray<string>;
    readonly worlds: ReadonlyArray<string>;
    readonly kits: ReadonlyArray<string>;
    readonly rules: number;
  };
  readonly requires: { readonly quire: string };
}

const PACK_ID = /^[a-z0-9][a-z0-9-]{1,60}$/;

async function addDir(zip: JSZip, dir: string, as: string): Promise<number> {
  let n = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) n += await addDir(zip, full, `${as}/${e.name}`);
    else if (e.isFile()) {
      zip.file(`${as}/${e.name}`, await readFile(full));
      n += 1;
    }
  }
  return n;
}

/**
 * Bundle a voice, a work's look and the accepted rules into one file (18 §7).
 *
 * Never the feedback stream, never a manuscript: a pack is taste, not work.
 * Rules scoped to one work lose that work in the pack — the work does not
 * exist where the pack is going — and keep what kind of verdict they are for.
 */
export async function exportTastePack(root: string, input: {
  readonly id: string;
  readonly styles?: ReadonlyArray<string>;
  readonly works?: ReadonlyArray<{ readonly type: string; readonly id: string }>;
  readonly rules?: boolean;
  readonly author?: string;
  readonly license?: string;
}): Promise<{ readonly file: string; readonly manifest: TastePackManifest }> {
  if (!PACK_ID.test(input.id)) throw new Error("a pack id is lowercase letters, digits and hyphens");
  const zip = new JSZip();
  const styles: string[] = [];
  for (const id of input.styles ?? []) {
    if (!PACK_ID.test(id)) continue;
    if (await addDir(zip, join(root, "styles", id), `styles/${id}`)) styles.push(id);
  }
  const worlds: string[] = [];
  const kits: string[] = [];
  for (const w of input.works ?? []) {
    const world = join(root, worldPathOf(w.type, w.id));
    if (existsSync(world)) {
      const name = `${w.type}-${w.id}`;
      zip.file(`worlds/${name}.json`, await readFile(world));
      worlds.push(name);
    }
    const kitId = kitIdOf(w.type, w.id);
    const versions = (await readdir(join(root, KITS_DIR)).catch(() => [] as string[])).filter((d) => d.startsWith(`${kitId}@`)).sort();
    const latest = versions[versions.length - 1];
    if (latest && await addDir(zip, join(root, KITS_DIR, latest), `kits/${latest}`)) kits.push(latest);
  }
  let rules = 0;
  if (input.rules) {
    const chosen = new Set((input.works ?? []).map((w) => `${w.type}/${w.id}`));
    const kept = (await readRules(root))
      .filter((r) => !r.retired && (!r.scope.work || chosen.has(r.scope.work)))
      .map(({ text, kind, scope }) => {
        const { work: _work, ...rest } = scope;
        return { text, kind, scope: rest };
      });
    zip.file("rules.jsonl", kept.map((r) => `${JSON.stringify(r)}\n`).join(""));
    rules = kept.length;
  }
  const manifest: TastePackManifest = {
    id: input.id, version: 1, createdAt: new Date().toISOString(),
    ...(input.author ? { author: input.author } : {}),
    ...(input.license ? { license: input.license } : {}),
    contains: { styles, worlds, kits, rules },
    requires: { quire: ">=0.1" },
  };
  zip.file("taste-pack.json", JSON.stringify(manifest, null, 2));
  const file = join(root, "_taste", "packs", `${input.id}.zip`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { file, manifest };
}

/** A path inside the pack that stays inside the folder it is unpacked into. */
function inside(base: string, path: string): string | null {
  if (path.includes("\0") || /^[\\/]|^[a-zA-Z]:/.test(path)) return null;
  const full = normalize(join(base, path));
  return full === base || full.startsWith(base + sep) ? full : null;
}

/**
 * Install a pack under names that say where it came from.
 *
 * Voices land as `pack-<id>-<voice>` in the style library, worlds beside the
 * pack for a person to apply, kits as `pack-<id>-…` in the kit library. Rules
 * are handed back, not installed: someone else's taste enters the proposals
 * queue and waits to be accepted like any other.
 */
export async function importTastePack(root: string, data: Buffer): Promise<{
  readonly manifest: TastePackManifest;
  readonly styles: ReadonlyArray<string>;
  readonly worlds: ReadonlyArray<string>;
  readonly kits: ReadonlyArray<string>;
  readonly rules: ReadonlyArray<Omit<RuleProposal, "evidence" | "source">>;
}> {
  const zip = await JSZip.loadAsync(data);
  const head = zip.file("taste-pack.json");
  if (!head) throw new Error("not a Taste Pack: taste-pack.json is missing");
  const manifest = JSON.parse(await head.async("string")) as TastePackManifest;
  if (manifest.version !== 1 || !PACK_ID.test(String(manifest.id)) || !manifest.contains) {
    throw new Error("not a Taste Pack this version can read");
  }
  const prefix = `pack-${manifest.id}`;
  const styles = new Set<string>();
  const worlds: string[] = [];
  const kits = new Set<string>();
  const rules: Array<Omit<RuleProposal, "evidence" | "source">> = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const [top, name, ...rest] = entry.name.split("/");
    let target: string | null = null;
    if (top === "styles" && name && rest.length) {
      target = inside(join(root, "styles"), join(`${prefix}-${name}`, ...rest));
      styles.add(`${prefix}-${name}`);
    } else if (top === "worlds" && name?.endsWith(".json") && !rest.length) {
      target = inside(join(root, "_taste", "packs", manifest.id, "worlds"), name);
      worlds.push(name.replace(/\.json$/, ""));
    } else if (top === "kits" && name && rest.length) {
      target = inside(join(root, KITS_DIR), join(`${prefix}-${name}`, ...rest));
      kits.add(`${prefix}-${name}`);
    } else if (entry.name === "rules.jsonl") {
      for (const line of (await entry.async("string")).split("\n")) {
        try {
          const r = JSON.parse(line) as { text?: unknown; kind?: unknown; scope?: unknown };
          if (typeof r.text === "string" && r.text.trim()) {
            rules.push({
              text: r.text.trim(), kind: r.kind === "number" ? "number" : "sentence",
              scope: r.scope && typeof r.scope === "object" ? r.scope as Record<string, string> : {},
            });
          }
        } catch { /* skip */ }
      }
      continue;
    }
    if (!target) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await entry.async("nodebuffer"));
  }
  return { manifest, styles: [...styles], worlds, kits: [...kits], rules };
}

/**
 * "Make the new one look and sound like the last one" (18 §7), locally: the
 * voice mark, the world and the work's own rules go from one work to another.
 * Copies, never links — changing the new work's world must not change the old.
 */
export async function cloneTaste(
  root: string,
  from: { readonly type: string; readonly id: string },
  to: { readonly type: string; readonly id: string },
): Promise<{ readonly copied: ReadonlyArray<string>; readonly rules: number }> {
  const copied: string[] = [];
  const src = join(root, workDirOf(from.type, from.id));
  const dst = join(root, workDirOf(to.type, to.id));
  if (!existsSync(src)) throw new Error(`${from.type}/${from.id} does not exist`);
  if (!existsSync(dst)) throw new Error(`${to.type}/${to.id} does not exist`);
  // The guide and profile are the voice itself; style.json alone only names it.
  for (const rel of ["style.json", "style_guide.md", "style_profile.json", join("design", "world.json"), join("design", "cast.json")]) {
    const file = join(src, rel);
    if (!existsSync(file) || !(await stat(file)).isFile()) continue;
    await mkdir(dirname(join(dst, rel)), { recursive: true });
    await writeFile(join(dst, rel), await readFile(file));
    copied.push(relative(root, join(dst, rel)).split(sep).join("/"));
  }
  const own = (await readRules(root)).filter((r) => !r.retired && r.scope.work === `${from.type}/${from.id}`);
  for (const r of own) {
    await addRule(root, { text: r.text, kind: r.kind, scope: { ...r.scope, work: `${to.type}/${to.id}` }, evidence: r.evidence, source: `clone:${from.type}/${from.id}` });
  }
  return { copied, rules: own.length };
}
