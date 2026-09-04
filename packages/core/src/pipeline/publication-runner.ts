/**
 * One runner for every publication type.
 *
 * This is the magazine pipeline — subject, research, flatplan, pages, art,
 * PDF — with the magazine taken out of it. The stages, the approval gates, the
 * queue and resume semantics and the structure law are all still here; what
 * used to be hardcoded (six pillars, plates on rectos, three densities) now
 * comes from a PublicationDefinition, so a second type runs the same code with
 * different law.
 *
 * Deliberately not a second engine beside Quire: the model call arrives as an
 * `ask` function from the caller, so a run uses whatever provider the session
 * already uses, with the tools that session already has.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PublicationDefinition } from "../publications/types.js";
import { renderTemplate } from "../publications/types.js";
import * as styles from "../publications/styles.js";
import {
  allSearchSources,
  findingsFor,
  researchPublication,
  type ResearchReport,
} from "./publication-research.js";
import { resolveVoice } from "./publication-voice.js";
import {
  factCheck,
  isProblem,
  type FactCheckResult,
  type FactFinding,
} from "./fact-check.js";
import { auditPages, summarize, type PublicationAudit, type PublicationFinding } from "./publication-audit.js";
import {
  buildAuditPrompt,
  buildRevisePrompt,
  isSlopFinding,
  parseAuditFindings,
} from "./publication-review.js";
import {
  PublicationMemory,
  RECALL_THRESHOLD,
  isPageWritten,
  openingOf,
  type RecalledFinding,
  type RecalledPage,
} from "./publication-memory.js";
import { buildRuleStack } from "../utils/rule-stack.js";
import { requireDesigner, requireRenderer } from "../utils/renderer-preflight.js";
import { validateIssue } from "./publication-schema.js";
import {
  DEFAULT_DESIGN_PROMPT,
  checkSpec,
  contrast,
  designReferences,
  type DesignSpec,
} from "./publication-design.js";

/* ------------------------------------------------------------------- types */

export interface PageBrief {
  readonly prompt: string;
  readonly orientation: string;
  /** What the picture is for on the page — "hero", "inset", "diagram". */
  readonly role?: string;
}

export interface PublicationPage {
  n: number;
  title: string;
  type: string;
  density: string;
  section: number;
  pillar: string;
  premise: string;
  body: string | null;
  deck?: string;
  pullQuote?: string;
  furniture?: Array<{ kind: string; text: string; source?: string }>;
  /**
   * The images this page wants, as prompts. Zero is a legal answer.
   *
   * This was one prompt, always exactly one, and rendering fired in the same
   * step that wrote it. A design-led spread that wants four pictures could
   * only have one, a pure-type page that wants none threw rather than passing,
   * and nobody could look at the prompts before the GPU had already run.
   */
  briefs?: Array<PageBrief>;
  /** Rendered files, one per brief, by brief index. */
  images?: Array<string | null>;
  sources?: string[];
  uncertain?: string[];
  words?: number;
  image?: string | null;
}

/**
 * The page's image briefs, whichever shape the issue was written in.
 *
 * Issues already on disk predate the list and carry a single `brief`. Reading
 * them through here means an old magazine keeps working with no migration pass
 * over the workspace.
 */
export function briefsOf(page: PublicationPage): ReadonlyArray<PageBrief> {
  if (page.briefs) return page.briefs;
  const legacy = (page as { brief?: PageBrief | null }).brief;
  return legacy?.prompt ? [legacy] : [];
}

/**
 * Read whatever shape the model answered in.
 *
 * `image_prompts` is what the page prompt now asks for. `image_prompt` is the
 * single-string form, still accepted because a user's own publication
 * definition may ask for it, and because a model will sometimes answer in the
 * old shape regardless of what it was asked.
 */
export function readBriefs(
  out: Record<string, unknown>,
  page: PublicationPage,
): PageBrief[] {
  const fallback = briefsOf(page)[0]?.orientation ?? "landscape";
  const many = out.image_prompts;
  if (Array.isArray(many)) {
    return many.flatMap((raw) => {
      if (typeof raw === "string") {
        return raw.trim() ? [{ prompt: raw.trim(), orientation: fallback }] : [];
      }
      const r = raw as Record<string, unknown>;
      const prompt = String(r.prompt ?? r.image_prompt ?? "").trim();
      if (!prompt) return [];
      return [{
        prompt,
        orientation: String(r.orientation ?? r.image_orientation ?? fallback),
        ...(r.role ? { role: String(r.role) } : {}),
      }];
    });
  }
  const one = String(out.image_prompt ?? "").trim();
  // Zero prompts is a real answer, not a failure: a contents page or a pure
  // type spread wants no picture, and the single-string shape had no way to
  // say so — it threw at render time instead.
  if (!one) return [];
  return [{ prompt: one, orientation: String(out.image_orientation ?? fallback) }];
}

export interface PublicationSection {
  n: number;
  label: string;
  question: string;
  colour: string;
  from: number;
  to: number;
}

export interface DesignWorld {
  n: number;
  register: string;
  technique?: string;
  idiom: string;
  paper: string;
  ink: string;
  hue?: string;
  field?: string;
  devices?: string[];
}

export interface PublicationDesign {
  sections: DesignWorld[];
  fixed?: { folio?: string; trim?: string; grid?: string; divider?: string };
  /** What the design stage decided: the one source both renderers read. */
  spec?: DesignSpec | null;
}

export interface PublicationIssue {
  id: string;
  type: string;
  series: string;
  subject: string;
  angle: string;
  title: string;
  thesis: string;
  extent: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  /** Images the user attached at intake, for the design stage. */
  referenceImages?: string[];
  research: Record<string, unknown> | null;
  sections: PublicationSection[];
  pages: PublicationPage[];
  design?: PublicationDesign | null;
  designPrefs?: { register: string; technique: string; notes: string };
  warnings?: string[];
  approved?: { at: string; by: string } | null;
  /** Separate from `approved`: the copy and the design are two decisions. */
  designApproved?: { at: string; by: string } | null;
  build?: { pdf?: string | null; at?: string };
  /** What the audit stage found. Advisory: it never blocks the pipeline. */
  audit?: PublicationAudit | null;
  /** Last fact-check over the written pages, when the type asks for one. */
  factCheck?: FactCheckResult | null;
  /**
   * Why the last run stopped, when it stopped badly.
   *
   * A failed run used to announce itself over SSE and nowhere else, so an
   * issue that died at page two read as "writing, 1/16, not running" with no
   * reason attached — the explanation existed for as long as someone happened
   * to have the page open. Recorded here so the run can be understood after
   * the fact. Cleared when a run gets going again.
   */
  lastError?: { at: string; stage?: string; message: string } | null;
}

/** Parsed JSON from the model. The caller owns the provider and the transport. */
export type AskFn = (prompt: string, tag: string) => Promise<Record<string, unknown>>;

export interface PublicationEvent {
  readonly type: string;
  readonly at: number;
  readonly [key: string]: unknown;
}

export interface RunnerContext {
  readonly projectRoot: string;
  readonly definition: PublicationDefinition;
  readonly ask: AskFn;
  /** Whether the research agent's model browses on its own account. */
  readonly modelSearches?: () => boolean;
  readonly onEvent?: (event: PublicationEvent) => void;
  /**
   * Base URL of Quire's shim, which owns ComfyUI and Affinity. Absent means
   * the art and build stages report as unavailable rather than failing oddly.
   */
  readonly shimUrl?: string;
}

/* ----------------------------------------------------------------- storage */

const slug = (s: string) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const rootFor = (ctx: RunnerContext) => join(ctx.projectRoot, ctx.definition.outDir, "issues");

/**
 * Where a series keeps the rules its issues share.
 *
 * A book has book_rules.md and story_bible.md and carries them across every
 * chapter. A magazine series had nowhere to put the equivalent, so house
 * prohibitions and register were re-derived from scratch each issue and drifted.
 * series_rules.md and house_style.md live here and are read by buildRuleStack.
 */
const seriesDirOf = (ctx: RunnerContext, issue: PublicationIssue) =>
  join(ctx.projectRoot, ctx.definition.outDir, "series", slug(issue.series || "default"));
const dirOf = (ctx: RunnerContext, id: string) => join(rootFor(ctx), id);
const fileOf = (ctx: RunnerContext, id: string) => join(dirOf(ctx, id), "publication.json");

const emit = (ctx: RunnerContext, type: string, data: Record<string, unknown> = {}) => {
  // A listener that throws must not take the run with it.
  try { ctx.onEvent?.({ type, at: Date.now(), ...data }); } catch { /* ignored */ }
};

export async function readIssue(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const path = fileOf(ctx, id);
  if (!existsSync(path)) throw new Error(`no such publication: ${id}`);
  return validateIssue(JSON.parse(await readFile(path, "utf-8")), id);
}

/**
 * Write the issue, or leave the last good one alone.
 *
 * Two things stand between a bad run and a destroyed issue. The schema check
 * happens before anything is written, so a stage that mangled the object fails
 * loudly with the file still intact. The write goes to a sibling and is renamed
 * over the target, which is atomic on both NTFS and POSIX, so a crash or a full
 * disk cannot leave half a JSON file where the issue used to be.
 */
async function save(ctx: RunnerContext, issue: PublicationIssue): Promise<PublicationIssue> {
  issue.updatedAt = new Date().toISOString();
  validateIssue(issue, issue.id);

  await mkdir(dirOf(ctx, issue.id), { recursive: true });
  const target = fileOf(ctx, issue.id);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(issue, null, 2), "utf-8");
  await rename(temp, target);

  // Nothing indexes here: `recall` re-records before every query, so the index
  // is right even when the issue was changed by something that never called
  // save at all — a tool, or a hand edit.
  emit(ctx, "publication:issue", { id: issue.id, status: issue.status });
  return issue;
}

export interface PublicationSummary {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly subject: string;
  readonly status: string;
  readonly extent: number;
  readonly pages: number;
  readonly written: number;
  readonly art: number;
  readonly pdf: string | null;
}

export async function listIssues(ctx: RunnerContext): Promise<PublicationSummary[]> {
  const dir = rootFor(ctx);
  let ids: string[];
  try { ids = await readdir(dir); } catch { return []; }

  const out: PublicationSummary[] = [];
  for (const id of ids) {
    try {
      const raw = await readFile(join(dir, id, "publication.json"), "utf-8");
      const issue = JSON.parse(raw) as PublicationIssue;
      out.push({
        id: issue.id,
        type: issue.type,
        title: issue.title,
        subject: issue.subject,
        status: issue.status,
        extent: issue.extent,
        pages: issue.pages?.length ?? 0,
        written: issue.pages?.filter(isPageWritten).length ?? 0,
        art: issue.pages?.filter((p) => p.image).length ?? 0,
        pdf: issue.build?.pdf ?? null,
      });
    } catch {
      // A half-written or hand-edited issue is skipped, not fatal to the list.
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function createIssue(
  ctx: RunnerContext,
  args: { subject: string; angle?: string; extent?: number; series?: string },
): Promise<PublicationIssue> {
  if (!args.subject) throw new Error("subject required");
  const def = ctx.definition;
  const id = slug(`${args.subject}${args.angle ? "-" + args.angle : ""}`) || `issue-${Date.now()}`;
  if (existsSync(fileOf(ctx, id))) throw new Error(`publication already exists: ${id}`);

  let extent = Number(args.extent) || def.extent.default;
  // An even extent leaves the last spread complete. Only some types care: a
  // magazine does, because every section plate has to land on a recto.
  if (def.rules.evenExtent) extent = Math.round(extent / 2) * 2;
  extent = Math.min(def.extent.max, Math.max(def.extent.min, extent));

  return save(ctx, {
    id,
    type: def.id,
    series: args.series || slug(args.subject),
    subject: args.subject,
    angle: args.angle ?? "",
    title: "",
    thesis: "",
    extent,
    status: "new",
    createdAt: new Date().toISOString(),
    research: null,
    sections: [],
    pages: [],
  });
}

/** Reference images the user attached, kept for the design stage to look at. */
export async function setReferenceImages(
  ctx: RunnerContext,
  id: string,
  paths: ReadonlyArray<string>,
): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  issue.referenceImages = [...paths];
  return save(ctx, issue);
}

export async function setNotes(
  ctx: RunnerContext,
  id: string,
  notes: string,
): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  issue.notes = String(notes ?? "");
  return save(ctx, issue);
}

/**
 * Record why a run stopped, or clear the record when one starts.
 *
 * Kept separate from the run itself: the run has already failed by the time
 * this is called, so it must not be able to fail in a way that loses the
 * reason. A write that cannot happen is swallowed rather than replacing the
 * original error with a filesystem one.
 */
export async function setLastError(
  ctx: RunnerContext,
  id: string,
  error: { stage?: string; message: string } | null,
): Promise<void> {
  try {
    const issue = await readIssue(ctx, id);
    issue.lastError = error
      ? { at: new Date().toISOString(), ...(error.stage ? { stage: error.stage } : {}), message: error.message }
      : null;
    await save(ctx, issue);
  } catch { /* the run's own error is the one worth keeping */ }
}

export async function removeIssue(ctx: RunnerContext, id: string): Promise<boolean> {
  const dir = dirOf(ctx, id);
  if (!existsSync(dir)) return false;
  // Moved, never deleted: this is the user's own writing.
  const trash = join(ctx.projectRoot, ctx.definition.outDir, "_trash");
  await mkdir(trash, { recursive: true });
  await rename(dir, join(trash, `${id}-${Date.now()}`));
  return true;
}

/* --------------------------------------------------------------------- law */

/**
 * Check the plan against the definition's structure law.
 *
 * Reported, never corrected. The model follows the law well but not perfectly,
 * and a silently-broken plan otherwise surfaces as a bad PDF forty minutes of
 * writing later.
 */
export function checkPlan(def: PublicationDefinition, issue: PublicationIssue): string[] {
  const w: string[] = [];
  const pages = issue.pages ?? [];
  if (pages.length !== issue.extent) {
    w.push(`${pages.length} pages planned, ${issue.extent} asked for`);
  }

  const rules = def.rules;

  if (rules.rectoOnlyType) {
    const verso = pages.filter(
      (p) => p.type === rules.rectoOnlyType && p.section > 0 && p.n % 2 === 0,
    );
    if (verso.length) {
      w.push(`${rules.rectoOnlyType} on a left-hand page: p${verso.map((p) => p.n).join(", p")}`);
    }
  }

  if (rules.maxConsecutiveDensity) {
    const { density, max } = rules.maxConsecutiveDensity;
    let run = 0;
    let worst = 0;
    for (const p of pages) {
      run = p.density === density ? run + 1 : 0;
      worst = Math.max(worst, run);
    }
    if (worst > max) w.push(`${worst} ${density} pages in a row — the law is ${max}`);
  }

  if (rules.evenSections) {
    for (const s of issue.sections ?? []) {
      const n = s.to - s.from + 1;
      if (n % 2) w.push(`section "${s.label}" is ${n} pages — sections must be even`);
    }
  }

  if (rules.requireAllPillars) {
    const used = new Set(pages.map((p) => p.pillar));
    const missing = def.pillars.filter((p) => !used.has(p));
    if (missing.length) w.push(`no page covers: ${missing.join(", ")}`);
  }

  if (rules.reportDensityMix) {
    const share = (d: string) =>
      Math.round((100 * pages.filter((p) => p.density === d).length) / (pages.length || 1));
    const codes = Object.keys(def.densities);
    w.push(`density ${codes.join("/")} = ${codes.map(share).join("/")}%`);
  }
  return w;
}

function sharedFaces(worlds: readonly DesignWorld[]): string[] {
  const byFace = new Map<string, number[]>();
  for (const world of worlds) {
    const register = styles.byName(world.register);
    const face = (register?.type ?? world.register ?? "").toLowerCase().trim();
    if (!face) continue;
    byFace.set(face, [...(byFace.get(face) ?? []), world.n]);
  }
  return [...byFace.entries()]
    .filter(([, sections]) => sections.length > 1)
    .map(([face, sections]) => `sections ${sections.join(", ")} share the typeface "${face}"`);
}

/**
 * Check a design decision against the style law.
 *
 * Ported unchanged, including the 7:1 print floor: paper is less forgiving
 * than a backlit screen, so WCAG's 4.5:1 is not enough for body copy in ink.
 */
export function checkDesign(design: PublicationDesign | null | undefined): string[] {
  const bad: string[] = [];
  const worlds = design?.sections ?? [];
  if (!worlds.length) return ["no section worlds"];

  for (const w of worlds) {
    const reg = styles.byName(w.register);
    if (!reg) bad.push(`s${w.n}: "${w.register}" is not one of the 50`);
    else if (reg.tier !== 1) {
      bad.push(`s${w.n}: ${reg.name} is tier ${reg.tier} - only a tier 1 system may run a section`);
    } else if (reg.screenOnly) {
      bad.push(`s${w.n}: ${reg.name} is a screen register and leaves no legible ink on paper`);
    }

    if (w.technique) {
      const t = styles.byName(w.technique);
      if (!t) bad.push(`s${w.n}: "${w.technique}" is not one of the 50`);
      else if (t.tier !== 2) {
        bad.push(`s${w.n}: ${t.name} is tier ${t.tier} - the figure technique must be tier 2`);
      }
    }

    const cp = styles.contrast(w.paper, w.ink);
    if (cp === null) bad.push(`s${w.n}: paper or ink is not a hex colour`);
    else if (cp < 7) {
      bad.push(`s${w.n}: ink on paper is only ${cp.toFixed(1)}:1 - body copy needs 7:1`);
    }

    // A saturated field usually carries reversed type, so the test is whether
    // either of the section's two type colours reads on it, not just the ink.
    const cf = Math.max(styles.contrast(w.field, w.ink) ?? 0, styles.contrast(w.field, w.paper) ?? 0);
    if (w.field && cf && cf < 4.5) {
      bad.push(`s${w.n}: nothing reads on the field - best is ${cf.toFixed(1)}:1 against ink or paper`);
    }
    if (!w.idiom) bad.push(`s${w.n}: no named idiom - the image prompts have nothing to hold`);
  }

  bad.push(...sharedFaces(worlds));
  if (!design?.fixed?.folio) {
    bad.push("no folio spec - the folio is what makes N worlds one object");
  }
  return bad;
}

export function worldFor(issue: PublicationIssue, n: number): DesignWorld | null {
  const section = (issue.sections ?? []).find((s) => n >= s.from && n <= s.to);
  if (!section) return null;
  return (issue.design?.sections ?? []).find((w) => w.n === section.n) ?? null;
}

/* ------------------------------------------------------------------- gates */

/**
 * Approval is of specific copy, so any rewrite clears it: a sign-off that
 * outlives the text it approved is worse than no sign-off at all.
 */
export function requireApproval(issue: PublicationIssue, what: string): void {
  if (!issue.approved) {
    throw new Error(`${what} needs the copy approved first — every page written, then approved`);
  }
}

export async function approve(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  if (!issue.pages?.length) throw new Error("nothing to approve — plan the publication first");
  const unwritten = issue.pages.filter((p) => p.body === null || p.body === undefined);
  if (unwritten.length) {
    throw new Error(
      `${unwritten.length} pages are not written yet: p${unwritten.map((p) => p.n).join(", p")}`,
    );
  }
  issue.approved = { at: new Date().toISOString(), by: "editor" };
  return save(ctx, issue);
}

export async function unapprove(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  issue.approved = null;
  return save(ctx, issue);
}

/**
 * What one page is told about the world.
 *
 * The whole report used to be JSON.stringify'd into the prompt and cut at 6000
 * characters, which spent the budget on field names and cut a pillar in half.
 * A page gets its own pillar's claims, each with the source attached, as text
 * a writer can actually use.
 */
function pageResearch(
  report: ResearchReport | null,
  pillar: string,
  fallback: ReadonlyArray<RecalledFinding> = [],
): string {
  const own = findingsFor(report, pillar);
  if (own) return own;
  if (!report) return "";
  // A pillar that found nothing still gets the rest, rather than a blank page
  // context — thin is better than empty, and the writer can see it is thin.
  //
  // Which of the rest used to be "the first four of every pillar", which is an
  // arbitrary slice that ignores what the page is about. The index answers the
  // question that was actually being asked: of everything researched for this
  // issue, what bears on this page?
  const chosen: ReadonlyArray<RecalledFinding> = fallback.length
    ? fallback
    : Object.values(report.pillars).flatMap((p) => p.findings.slice(0, 4));
  return chosen
    .map((f) => `- (${f.kind}) ${f.claim}\n  source: ${f.sourceTitle} — ${f.sourceUrl}`)
    .join("\n");
}

/**
 * What the issue remembers that bears on one page.
 *
 * Opened and closed per call: the index is a few kilobytes, a page write is a
 * model round trip, and a connection held across an await is a lock held across
 * an await. Any failure here degrades to no recall, never to a failed page.
 */
function recall(
  ctx: RunnerContext,
  issue: PublicationIssue,
  query: string,
  exclude: number,
): { pages: RecalledPage[]; findings: RecalledFinding[] } {
  try {
    const memory = new PublicationMemory(dirOf(ctx, issue.id));
    try {
      memory.record(issue);
      return { pages: memory.pages(query, exclude), findings: memory.findings(query) };
    } finally {
      memory.close();
    }
  } catch {
    return { pages: [], findings: [] };
  }
}

/** Which blocks this archetype may carry. Undefined mapping means all of them. */
function allowedBlocks(def: PublicationDefinition, archetype: string): readonly string[] {
  const blocks = def.blocks;
  if (!blocks) return [];
  const named = blocks.byArchetype?.[archetype];
  // A definition may declare `blocks` and no kinds at all; that is "none",
  // not a crash three frames down in the prompt builder.
  return named ?? blocks.kinds ?? [];
}

function blocksLine(def: PublicationDefinition, archetype: string): string {
  const allowed = allowedBlocks(def, archetype);
  if (!def.blocks) return "";
  if (!allowed.length) {
    return "BLOCKS: this page carries none. Return an empty furniture list.";
  }
  return "BLOCKS this page may carry, beside the body — these are objects placed on the\n"
    + "page, not sentences inside the prose, so each one must stand alone and be worth\n"
    + `its own space: ${allowed.join(", ")}.`;
}

/**
 * Keep only the blocks this archetype is allowed.
 *
 * The allowance is law from the definition, and a model that offers a sidebar
 * on a full-bleed plate is offering something the page has no room for. Better
 * dropped here than discovered in Affinity.
 */
function keepAllowedBlocks(
  def: PublicationDefinition,
  archetype: string,
  raw: unknown,
): PublicationPage["furniture"] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(allowedBlocks(def, archetype));
  const out: NonNullable<PublicationPage["furniture"]> = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const kind = String(item?.kind ?? "").trim();
    const text = String(item?.text ?? "").trim();
    if (!text || !allowed.has(kind)) continue;
    const source = String(item?.source ?? "").trim();
    out.push(source ? { kind, text, source } : { kind, text });
  }
  return out;
}

/* ------------------------------------------------------------------ stages */

/**
 * The voice for this run, taken from the skill the definition names.
 *
 * Resolved per stage rather than once at the top: a stage may be run on its
 * own — a re-write of one page, a design decision days later — and each of
 * those should see the skill as it is now, not as it was when the issue was
 * created. Any complaint about the skill is surfaced as a warning on the
 * issue, so a run that quietly changed voice can be explained afterwards.
 */
async function voiceFor(ctx: RunnerContext, issue: PublicationIssue): Promise<string> {
  const { voice, diagnostic } = await resolveVoice({
    projectRoot: ctx.projectRoot,
    fallback: ctx.definition.prompts.voice,
    skillId: ctx.definition.prompts.voiceSkill,
  });
  if (diagnostic) {
    issue.warnings = [...new Set([...(issue.warnings ?? []), diagnostic])];
    emit(ctx, "publication:stage", { id: issue.id, stage: "voice", state: "warn", message: diagnostic });
  }
  return voice;
}

const notesBlock = (issue: PublicationIssue) =>
  issue.notes ? `THE EDITOR'S OWN NOTES (these outrank your research):\n${issue.notes}` : "";

export async function runResearch(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const def = ctx.definition;
  const issue = await readIssue(ctx, id);
  issue.status = "researching";
  await save(ctx, issue);
  emit(ctx, "publication:stage", { id, stage: "research", state: "start" });

  // This used to be one call asking the model what it remembered. It cited
  // nothing, because there was nothing to cite, and a page could print a
  // figure no one had ever checked. Now the model writes queries, the web
  // answers them, and only claims carrying a URL from those answers survive.
  const report = await researchPublication({
    projectRoot: ctx.projectRoot,
    cachePath: join(dirOf(ctx, id), "research-cache.json"),
    subject: issue.subject,
    angle: issue.angle ?? undefined,
    pillars: def.pillars,
    ask: (prompt, label) => ctx.ask(prompt, label),
    // Rung one of the search ladder: a model that browses does its own
    // searching, and our keys are the fallback for one that cannot.
    modelSearches: ctx.modelSearches?.() ?? false,
    onProgress: (message) => emit(ctx, "publication:stage", {
      id, stage: "research", state: "progress", message,
    }),
  });

  issue.research = report as unknown as Record<string, unknown>;
  issue.title = report.title || issue.title || issue.subject;
  issue.thesis = report.thesis || "";
  issue.status = "researched";
  emit(ctx, "publication:stage", {
    id, stage: "research", state: "done",
    sources: Object.values(report.pillars).reduce((n, p) => n + p.sources.length, 0),
    findings: Object.values(report.pillars).reduce((n, p) => n + p.findings.length, 0),
  });
  return save(ctx, issue);
}

export async function runPlan(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const def = ctx.definition;
  const issue = await readIssue(ctx, id);
  if (!issue.research) throw new Error("run research first");
  issue.status = "planning";
  await save(ctx, issue);
  emit(ctx, "publication:stage", { id, stage: "plan", state: "start" });

  const out = await ctx.ask(renderTemplate(def.prompts.plan, {
    voice: await voiceFor(ctx, issue),
    title: issue.title,
    subject: issue.subject,
    angleSuffix: issue.angle ? ` / ${issue.angle}` : "",
    thesis: issue.thesis,
    extent: issue.extent,
    notes: notesBlock(issue),
    research: JSON.stringify(issue.research).slice(0, 12000),
    archetypes: def.archetypes.join(", "),
  }), "plan");

  issue.sections = (out.sections as PublicationSection[]) ?? [];
  issue.pages = (((out.pages as Array<Partial<PublicationPage>>) ?? [])
    .map((p) => ({
      n: Number(p.n),
      title: p.title ?? "",
      type: p.type ?? def.archetypes[0],
      density: p.density ?? def.defaultDensity,
      section: Number(p.section) || 0,
      pillar: p.pillar ?? "none",
      premise: p.premise ?? "",
      body: null,
      briefs: [],
      image: null,
    }))
    .filter((p) => p.n)
    .sort((a, b) => a.n - b.n)) as PublicationPage[];
  issue.warnings = checkPlan(def, issue);
  issue.status = "planned";
  emit(ctx, "publication:stage", { id, stage: "plan", state: "done", pages: issue.pages.length });
  return save(ctx, issue);
}

/**
 * The page as markdown beside the JSON.
 *
 * A JSON blob is not something anyone can edit by hand, and the user's
 * existing issues are markdown. Shared by the writer and the revise pass so a
 * revised page does not leave the pre-revision markdown on disk.
 */
/**
 * Where a page's markdown lives, relative to the project root.
 *
 * The path is derived, not stored, so it stays right for pages written before
 * anything asked for it. Returned as posix so the Studio's artifact drawer —
 * which addresses files by URL segment — can open it on Windows too.
 */
export function pagePath(ctx: RunnerContext, id: string, page: PublicationPage): string {
  return [
    ctx.definition.outDir,
    "issues",
    id,
    "pages",
    `${String(page.n).padStart(2, "0")}-${slug(page.title || "page")}.md`,
  ].join("/");
}

/** Every written page of an issue, in reading order, as project-relative paths. */
export function pagePaths(ctx: RunnerContext, issue: PublicationIssue): string[] {
  return issue.pages
    .filter((p) => p.body !== null && p.body !== undefined)
    .map((p) => pagePath(ctx, issue.id, p));
}

async function writePageMarkdown(
  ctx: RunnerContext,
  id: string,
  page: PublicationPage,
): Promise<void> {
  const pagesDir = join(dirOf(ctx, id), "pages");
  await mkdir(pagesDir, { recursive: true });
  await writeFile(
    join(pagesDir, `${String(page.n).padStart(2, "0")}-${slug(page.title || "page")}.md`),
    `# ${page.title}\n\n> ${page.deck ?? ""}\n\n${page.body ?? ""}\n\n`
    + (page.pullQuote ? `**"${page.pullQuote}"**\n\n` : "")
    + (page.furniture ?? []).map((f) => `- *${f.kind}* - ${f.text}`).join("\n")
    + briefsOf(page)
      .map((b, i) => `\n\n---\n*visual brief ${i + 1}${b.role ? ` (${b.role})` : ""}:* ${b.prompt}`)
      .join("")
    + "\n",
    "utf-8",
  );
}

export async function writePage(
  ctx: RunnerContext,
  id: string,
  n: number,
): Promise<PublicationPage> {
  const def = ctx.definition;
  const issue = await readIssue(ctx, id);
  const page = issue.pages.find((p) => p.n === Number(n));
  if (!page) throw new Error(`no page ${n} in ${id}`);
  emit(ctx, "publication:stage", {
    id, stage: "write", state: "start", page: page.n, title: page.title,
  });

  const [lo, hi] = def.densities[page.density] ?? def.densities[def.defaultDensity];
  const section = issue.sections.find((s) => s.n === page.section);
  const neighbours = issue.pages
    .filter((p) => Math.abs(p.n - page.n) <= 2 && p.n !== page.n)
    .map((p) => `p${p.n} ${p.type}: ${p.title}`)
    .join(" | ");

  // Pages are written independently, so without this every one of them opens
  // on the single best anecdote in the research and the issue reads as a loop.
  //
  // Small issues list every page: eleven openings are readable, and recall
  // cannot beat the complete set. Past that the list stops being context and
  // starts being a wall, so the index picks the pages this one could actually
  // collide with — which are exactly the pages that score against its premise.
  const query = `${page.title} ${page.premise} ${page.pillar} ${section?.question ?? ""}`;
  const recalled = recall(ctx, issue, query, page.n);
  const written = issue.pages.filter((p) => p.n !== page.n && isPageWritten(p) && p.body);
  const near: RecalledPage[] = written.length > RECALL_THRESHOLD
    ? recalled.pages
    : written.map((p) => ({ n: p.n, title: p.title, opening: openingOf(p) }));
  const taken = near.map((p) => `p${p.n}: "${p.opening}…"`);

  const world = worldFor(issue, page.n);
  // The visual brief has to be writable in the register the section is already
  // committed to; told afterwards, the brief and the design fight each other.
  const registerLine = world
    ? `THIS SECTION IS PRINTED IN: ${world.register}`
      + `${world.technique ? " x " + world.technique : ""} - ${world.idiom}. `
      + `Paper ${world.paper}, ink ${world.ink}, accent ${world.hue ?? ""}.`
      + (world.devices?.length ? ` Devices in play: ${world.devices.join(", ")}.` : "")
      + " Write the visual brief so it belongs in that register."
    : "";

  const research = issue.research as unknown as ResearchReport | null;
  const takenBlock = taken.length
    ? "\nALREADY USED ON OTHER PAGES - do not open the same way, do not retell these:\n"
      + `${taken.join("\n")}\n\n`
      + "The reader is holding one object. If two pages open on the same anecdote the issue\n"
      + "reads as a loop. Find a different door into this page: a different person, a different\n"
      + "year, an object, a number, a consequence, a dissenting voice.\n"
    : "";

  // The same rules the book and short pipelines write against. A magazine used
  // to get none of them: the voice skill supplied tone and nothing supplied
  // craft, so a de-AI rule added for stories changed nothing here. Prepended
  // rather than added to every type's page template, so a new publication type
  // inherits the rules without having to remember to ask for them.
  const rules = await buildRuleStack({
    kind: "publication",
    language: "en",
    rulesDir: seriesDirOf(ctx, issue),
  });

  const out = await ctx.ask(`${rules}

` + renderTemplate(def.prompts.page, {
    voice: await voiceFor(ctx, issue),
    title: issue.title,
    thesis: issue.thesis,
    notes: notesBlock(issue),
    sectionLine: section
      ? `THIS SECTION: ${section.question} - colour world: ${section.colour}`
      : "",
    registerLine,
    pageNumber: page.n,
    pageTitle: page.title,
    pageType: page.type,
    pageDensity: page.density,
    pagePillar: page.pillar,
    pagePremise: page.premise,
    neighbours: neighbours || "none",
    pageResearch: pageResearch(research, page.pillar, recalled.findings),
    takenBlock,
    blocksLine: blocksLine(def, page.type),
    wordsLow: lo,
    wordsHigh: hi,
    plateNote: def.rules.rectoOnlyType && page.type === def.rules.rectoOnlyType
      ? ` A ${def.rules.rectoOnlyType.toUpperCase()} has NO body at all: body must be empty,`
        + " and the deck is the single question line."
      : "",
  }), `page-${page.n}`);

  Object.assign(page, {
    title: (out.title as string) || page.title,
    deck: (out.deck as string) || "",
    body: (out.body as string) ?? "",
    pullQuote: (out.pull_quote as string) || "",
    furniture: keepAllowedBlocks(def, page.type, out.furniture),
    brief: {
      prompt: (out.image_prompt as string) || "",
      orientation: (out.image_orientation as string) || "landscape",
    },
    sources: (out.sources as string[]) ?? [],
    uncertain: (out.uncertain as string[]) ?? [],
    words: String(out.body ?? "").split(/\s+/).filter(Boolean).length,
  });

  await writePageMarkdown(ctx, id, page);

  // Approval is of specific copy: rewriting a page means the sign-off no
  // longer describes what is set.
  if (issue.approved) {
    issue.approved = null;
    emit(ctx, "publication:issue", { id, approved: false });
  }
  issue.status = "writing";
  emit(ctx, "publication:stage", {
    id, stage: "write", state: "done", page: page.n, words: page.words,
  });
  await save(ctx, issue);
  return page;
}

/* --------------------------------------------------------------------- art */

/**
 * Render one page's image through Quire's shim, which owns ComfyUI.
 *
 * Gated on approval: rendering art for copy nobody signed off wastes GPU time
 * on pages that are about to be rewritten.
 */
export async function artPage(
  ctx: RunnerContext,
  id: string,
  n: number,
): Promise<PublicationPage> {
  const def = ctx.definition;
  if (!def.needsImages) throw new Error(`${def.label} does not use generated images`);

  const issue = await readIssue(ctx, id);
  requireApproval(issue, "art");
  await requireRenderer(ctx.shimUrl);
  const page = issue.pages.find((p) => p.n === Number(n));
  if (!page) throw new Error(`no page ${n} in ${id}`);
  const briefs = briefsOf(page);
  // No brief is a finished answer for a contents page or a pure type spread.
  // This threw, which meant a page that wanted no picture stopped the stage.
  if (briefs.length === 0) {
    emit(ctx, "publication:stage", { id, stage: "art", state: "done", page: page.n, images: 0 });
    return page;
  }

  emit(ctx, "publication:stage", { id, stage: "art", state: "start", page: page.n });
  await mkdir(join(dirOf(ctx, id), "art"), { recursive: true });

  const done = [...(page.images ?? [])];
  for (const [i, brief] of briefs.entries()) {
    // Resumable per image, not per page: a four-picture spread that failed on
    // the fourth should not pay for the first three again.
    if (done[i]) continue;
    const portrait = brief.orientation === "portrait";
    const square = brief.orientation === "square";
    const suffix = briefs.length > 1 ? `-${i + 1}` : "";
    const outFile = join(dirOf(ctx, id), "art", `${String(page.n).padStart(2, "0")}${suffix}.png`);

    const res = await fetch(`${ctx.shimUrl}/comfy/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: brief.prompt,
        width: square ? 1280 : portrait ? 1024 : 1536,
        height: square ? 1280 : portrait ? 1536 : 1024,
        outFile,
      }),
    });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) {
      const why = body.error ?? `HTTP ${res.status}`;
      page.images = done;
      await save(ctx, issue);
      emit(ctx, "publication:stage", { id, stage: "art", state: "error", page: page.n, error: why });
      throw new Error(`art p${page.n} image ${i + 1}: ${why}`);
    }
    done[i] = outFile;
  }

  page.images = done;
  // The first image is still what a single-picture page means by "its" image.
  page.image = done[0] ?? null;
  emit(ctx, "publication:stage", { id, stage: "art", state: "done", page: page.n });
  await save(ctx, issue);
  return page;
}

/* ------------------------------------------------------------------ design */

/** A page as the art director sees it: what is actually on it, not what was planned. */
function pageDigest(issue: PublicationIssue): string {
  return issue.pages.map((p) => {
    const blocks = (p.furniture ?? []).map((f) => f.kind);
    return `p${p.n} [${p.type}] "${p.title}" — ${p.words ?? 0} words`
      + (p.deck ? `, deck: "${String(p.deck).slice(0, 80)}"` : "")
      + (blocks.length ? `, blocks: ${blocks.join(", ")}` : ", no blocks")
      + (briefsOf(p).length
        ? `, images: ${briefsOf(p).map((b) => b.orientation).join(" + ")}`
        : ", no image");
  }).join("\n");
}

/**
 * Decide the design, from the finished copy.
 *
 * Deliberately gated on the copy being approved rather than merely written:
 * directing a design at a draft the editor is still cutting produces a spec
 * for a publication that will not exist.
 */
export async function runDesign(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const def = ctx.definition;
  if (!def.needsImages && !def.needsPdf) {
    throw new Error(`${def.label} renders nothing, so it has no design to decide`);
  }

  const issue = await readIssue(ctx, id);
  requireApproval(issue, "design");
  const unwritten = issue.pages.filter((p) => p.body === null || p.body === undefined);
  if (unwritten.length) {
    throw new Error(`design has nothing to read: ${unwritten.length} pages are unwritten`);
  }

  issue.status = "designing";
  await save(ctx, issue);
  emit(ctx, "publication:stage", { id, stage: "design", state: "start" });

  const template = def.prompts.design || DEFAULT_DESIGN_PROMPT;
  const out = await ctx.ask(renderTemplate(template, {
    voice: await voiceFor(ctx, issue),
    title: issue.title || issue.subject,
    subject: issue.subject,
    thesis: issue.thesis,
    extent: String(issue.extent),
    notes: notesBlock(issue),
    referenceNote: [
      await designReferences(ctx.projectRoot),
      issue.referenceImages?.length
        ? `The editor also attached ${issue.referenceImages.length} reference image(s): `
          + `${issue.referenceImages.join(", ")}.`
        : "",
    ].filter(Boolean).join("\n\n"),
    pageDigest: pageDigest(issue),
  }), "design");

  const spec = out as unknown as DesignSpec;
  const problems = checkSpec(spec, issue.pages.map((p) => p.n));
  // Print is less forgiving than a backlit screen, which is why the style law
  // already sets 7:1 for ink on paper. A palette that fails it fails here,
  // before an Affinity document is built out of it.
  if (spec?.palette?.ink && spec.palette.paper) {
    const ratio = contrast(spec.palette.ink, spec.palette.paper);
    if (ratio && ratio < 7) {
      problems.push(`ink on paper is only ${ratio.toFixed(1)}:1 — body copy needs 7:1 in print`);
    }
  }
  if (problems.length) {
    emit(ctx, "publication:stage", { id, stage: "design", state: "error" });
    throw new Error(`the design spec does not hold up:\n- ${problems.join("\n- ")}`);
  }

  issue.design = { ...(issue.design ?? { sections: [] }), spec };
  // A new spec is a new decision, so any previous sign-off on the old one goes.
  issue.designApproved = null;
  issue.status = "designed";
  emit(ctx, "publication:stage", { id, stage: "design", state: "done" });
  return save(ctx, issue);
}

export async function approveDesign(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  if (!issue.design?.spec) throw new Error("there is no design to approve — run the design stage first");
  issue.designApproved = { at: new Date().toISOString(), by: "editor" };
  emit(ctx, "publication:issue", { id, designApproved: true });
  return save(ctx, issue);
}

export async function unapproveDesign(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  issue.designApproved = null;
  emit(ctx, "publication:issue", { id, designApproved: false });
  return save(ctx, issue);
}

function requireDesignApproval(issue: PublicationIssue, what: string): void {
  if (!issue.design?.spec) {
    throw new Error(`${what} needs a design — run the design stage after approving the copy`);
  }
  if (!issue.designApproved) {
    throw new Error(`${what} needs the design approved first: it is a separate decision from the copy`);
  }
}

/* ------------------------------------------------------------------- build */

/**
 * Hand the finished issue to Affinity through the shim.
 *
 * Affinity is a pure executor here: everything it needs — copy, design
 * decision, images — is already decided and on disk.
 */
export async function build(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const def = ctx.definition;
  if (!def.needsPdf) throw new Error(`${def.label} does not produce a PDF`);

  const issue = await readIssue(ctx, id);
  requireApproval(issue, "build");
  await requireDesigner(ctx.shimUrl, "building the document");
  requireDesignApproval(issue, "build");
  const designProblems = checkSpec(issue.design?.spec, issue.pages.map((p) => p.n));
  if (designProblems.length) {
    throw new Error(`the design does not pass its own law:\n- ${designProblems.join("\n- ")}`);
  }

  emit(ctx, "publication:stage", { id, stage: "build", state: "start" });
  const res = await fetch(`${ctx.shimUrl}/affinity/build`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ issue, issueDir: dirOf(ctx, id) }),
  });
  const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; pdf?: string };
  if (!res.ok || body.ok === false) {
    const why = body.error ?? `HTTP ${res.status}`;
    emit(ctx, "publication:stage", { id, stage: "build", state: "error", error: why });
    throw new Error(`build: ${why}`);
  }

  issue.build = { pdf: body.pdf ?? null, at: new Date().toISOString() };
  issue.status = "built";
  emit(ctx, "publication:stage", { id, stage: "build", state: "done", pdf: issue.build.pdf });
  return save(ctx, issue);
}

/* --------------------------------------------------------- scoped rebuilds */

/**
 * Lay out one page in Affinity, without rebuilding the issue around it.
 *
 * "Change the design on page 16" used to mean re-running build(), which
 * recreates the document from nothing: forty pages of layout, every image
 * re-staged, and a fresh PDF, to move one heading. Affinity has had a
 * per-page path all along — the shim simply never exposed it.
 *
 * Gated exactly as build() is, and for the same reason: this writes into the
 * document the user is going to publish.
 */
export async function placePage(
  ctx: RunnerContext,
  id: string,
  n: number,
): Promise<{ readonly page: number; readonly findings: ReadonlyArray<string> }> {
  const def = ctx.definition;
  if (!def.needsPdf) throw new Error(`${def.label} does not produce a PDF`);

  const issue = await readIssue(ctx, id);
  requireApproval(issue, "layout");
  await requireDesigner(ctx.shimUrl, "laying out a page");
  requireDesignApproval(issue, "layout");
  if (!issue.pages.some((p) => p.n === Number(n))) throw new Error(`no page ${n} in ${id}`);

  emit(ctx, "publication:stage", { id, stage: "design", state: "start", page: Number(n) });
  const res = await fetch(`${ctx.shimUrl}/affinity/page`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ issue, issueDir: dirOf(ctx, id), page: Number(n) }),
  });
  const body = await res.json().catch(() => ({})) as {
    ok?: boolean; error?: string; findings?: string[];
  };
  if (!res.ok || body.ok === false) {
    const why = body.error ?? `HTTP ${res.status}`;
    emit(ctx, "publication:stage", { id, stage: "design", state: "error", page: Number(n), error: why });
    throw new Error(`layout p${n}: ${why}`);
  }
  emit(ctx, "publication:stage", { id, stage: "design", state: "done", page: Number(n) });
  return { page: Number(n), findings: body.findings ?? [] };
}

/**
 * A picture of one spread as Affinity has it.
 *
 * Every other signal from the layout is text — an inspector reporting whether
 * the instructions were followed. A page can satisfy every rule it checks and
 * still be unreadable, and nothing in the pipeline could see that. This is the
 * only call that hands back something a model can actually look at.
 *
 * Not gated: rendering reads the document, it does not change it, and a model
 * that cannot see what it made will keep making the same page.
 */
export async function renderPage(
  ctx: RunnerContext,
  id: string,
  n: number,
): Promise<{ readonly image: string | null; readonly error?: string }> {
  await requireDesigner(ctx.shimUrl, "rendering a spread");
  const issue = await readIssue(ctx, id);
  if (!issue.pages.some((p) => p.n === Number(n))) throw new Error(`no page ${n} in ${id}`);

  const res = await fetch(`${ctx.shimUrl}/affinity/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ issue, issueDir: dirOf(ctx, id), page: Number(n) }),
  });
  const body = await res.json().catch(() => ({})) as {
    ok?: boolean; image?: string; error?: string;
  };
  if (!res.ok || body.ok === false) return { image: null, error: body.error ?? `HTTP ${res.status}` };
  return { image: body.image ?? null };
}

/* ------------------------------------------------------------------- queue */

export interface QueueState {
  readonly id: string;
  readonly kind: "write" | "art";
  readonly total: number;
  readonly done: number;
  readonly current: number | null;
  readonly stopping: boolean;
  readonly errors: ReadonlyArray<{ page: number; error: string }>;
}

interface Queue extends QueueState {
  pages: number[];
  kind: "write" | "art";
  done: number;
  current: number | null;
  stopping: boolean;
  errors: Array<{ page: number; error: string }>;
}

// One queue at a time, process-wide: two runs writing the same issue would
// interleave saves and lose pages. The runner is per-window, so this is the
// right scope.
let queue: Queue | null = null;

export const queueState = (): QueueState | null =>
  queue ? { ...queue, pages: undefined } as unknown as QueueState : null;

export const busy = (): boolean => Boolean(queue && !queue.stopping);

export function stopQueue(): boolean {
  if (!queue) return false;
  queue.stopping = true;
  return true;
}

/**
 * The pages still outstanding for a stage. `redo` ignores what is already
 * there; otherwise a stopped run resumes exactly where it left off.
 */
export function outstanding(
  issue: PublicationIssue,
  kind: "write" | "art",
  redo: boolean,
): number[] {
  return (issue.pages ?? [])
    .filter((p) => {
      if (redo) return true;
      if (kind === "write") return p.body === null || p.body === undefined;
      // Outstanding while any of the page's briefs is still unrendered.
      const briefs = briefsOf(p);
      return briefs.length > 0 && (p.images ?? []).filter(Boolean).length < briefs.length;
    })
    .map((p) => p.n);
}

export async function startQueue(
  ctx: RunnerContext,
  id: string,
  { kind = "write", redo = false, only = null }: {
    kind?: "write" | "art";
    redo?: boolean;
    only?: number[] | null;
  } = {},
): Promise<QueueState> {
  if (busy()) throw new Error("a run is already in progress");
  const issue = await readIssue(ctx, id);
  if (kind === "art") requireApproval(issue, "art");

  const pages = only ?? outstanding(issue, kind, redo);
  if (!pages.length) throw new Error(`nothing outstanding to ${kind}`);

  queue = {
    id, kind, pages, total: pages.length, done: 0,
    current: null, stopping: false, errors: [],
  };
  emit(ctx, "publication:queue", { id, kind, total: pages.length });

  // Deliberately not awaited: the caller gets the queue state at once and
  // follows progress through events, exactly as the magazine engine did.
  void (async () => {
    for (const n of pages) {
      if (!queue || queue.stopping) break;
      queue.current = n;
      try {
        if (kind === "write") await writePage(ctx, id, n);
        else await artPage(ctx, id, n);
        queue.done += 1;
      } catch (error) {
        // One bad page must not end the run: it is recorded and the queue
        // moves on, so a 40-page issue is not lost to a single timeout.
        const message = error instanceof Error ? error.message : String(error);
        queue.errors.push({ page: n, error: message });
        emit(ctx, "publication:queue", { id, kind, page: n, error: message });
      }
      emit(ctx, "publication:queue", {
        id, kind, done: queue.done, total: queue.total, current: n,
      });
    }
    const finished = queue;
    queue = null;
    emit(ctx, "publication:queue", {
      id, kind, state: "end",
      done: finished?.done ?? 0,
      errors: finished?.errors.length ?? 0,
      stopped: finished?.stopping ?? false,
    });
  })();

  return queueState() as QueueState;
}

/* --------------------------------------------------------------------- run */

export type Stage = "research" | "plan" | "write" | "fact-check" | "audit" | "art" | "build";

/**
 * Read every written page and record what is wrong with the prose.
 *
 * Runs after write and before art, which is the only place it is worth
 * anything: the copy is finished, and nothing has been drawn or laid out yet,
 * so a page that has to change has not yet cost an image or a spread.
 *
 * Never fails the run. The findings go on the issue and into the stage event,
 * and the editor decides — same contract the length governor has upstream.
 */
export interface AuditOptions {
  /**
   * Whether the model reads the pages, or only the rules do. Off is for tests
   * and for a fast re-check after a revise; a real audit is on.
   */
  readonly deep?: boolean;
  /** Rewrite pages the audit faulted, then audit again. */
  readonly revise?: boolean;
  /** How many revise-then-re-audit rounds at most. */
  readonly rounds?: number;
  /**
   * Restrict the revise pass to findings matching this. De-AI-ification is
   * this with a slop filter; a full audit passes nothing and fixes everything.
   */
  readonly only?: (finding: PublicationFinding) => boolean;
}

/** The model's read of one page, on top of what the rules already found. */
async function reviewPage(
  ctx: RunnerContext,
  issue: PublicationIssue,
  page: PublicationPage,
): Promise<PublicationFinding[]> {
  const section = issue.sections.find((s) => s.n === page.section);
  // Above the threshold the whole issue stops fitting usefully in one prompt,
  // so the auditor gets the pages this one could contradict rather than all of
  // them at two hundred characters each.
  const others = issue.pages.filter((p) => p.n !== page.n && p.body).length;
  const recalled = others > RECALL_THRESHOLD
    ? recall(ctx, issue, `${page.title} ${page.premise} ${page.pillar}`, page.n).pages
    : undefined;
  try {
    const out = await ctx.ask(
      buildAuditPrompt(issue, page, ctx.definition, section, recalled),
      `audit-${page.n}`,
    );
    return parseAuditFindings(out, page.n);
  } catch (error) {
    // One page the model could not read must not throw away the audit of the
    // other thirty-nine. The gap is reported as a finding so it is visible
    // rather than looking like a clean page.
    return [{
      page: page.n,
      severity: "info",
      category: "audit/unavailable",
      description: `p${page.n}: the model could not audit this page — ${
        error instanceof Error ? error.message : String(error)}`,
      suggestion: "Re-run the audit for this page.",
    }];
  }
}

/**
 * Rewrite one page against its findings.
 *
 * Returns whether anything changed. A revise that produces no body is a failed
 * call, not an empty page, so the old copy stays.
 */
export async function revisePage(
  ctx: RunnerContext,
  id: string,
  n: number,
  findings: ReadonlyArray<PublicationFinding>,
): Promise<boolean> {
  if (findings.length === 0) return false;
  const issue = await readIssue(ctx, id);
  const page = issue.pages.find((p) => p.n === Number(n));
  if (!page) throw new Error(`no page ${n} in ${id}`);

  emit(ctx, "publication:stage", {
    id, stage: "revise", state: "start", page: page.n, findings: findings.length,
  });

  const out = await ctx.ask(
    buildRevisePrompt(issue, page, ctx.definition, findings),
    `revise-${page.n}`,
  );

  const body = typeof out.body === "string" ? out.body : "";
  if (!body.trim()) {
    emit(ctx, "publication:stage", {
      id, stage: "revise", state: "warn", page: page.n,
      message: "the revise pass returned no body; the page is unchanged",
    });
    return false;
  }

  const before = page.body;
  const revised = (out.furniture
    ? keepAllowedBlocks(ctx.definition, page.type, out.furniture)
    : undefined) ?? [];
  if (out.furniture && !revised.length && (page.furniture ?? []).length) {
    emit(ctx, "publication:stage", {
      id, stage: "revise", state: "warn", page: page.n,
      message: "the revise returned no usable furniture; the page keeps the blocks it had",
    });
  }
  Object.assign(page, {
    title: (out.title as string) || page.title,
    deck: (out.deck as string) ?? page.deck,
    body,
    pullQuote: (out.pull_quote as string) ?? page.pullQuote,
    // An empty array is not an instruction to delete. A revise that omits the
    // furniture, or returns it in a shape keepAllowedBlocks rejects, wiped
    // every box on the page — which happened on the first live run and took
    // three good blocks off p2. Losing content is the one outcome a revise
    // must not have, so the old blocks stand unless real ones replace them.
    furniture: revised.length ? revised : page.furniture,
    // Same rule as furniture above: an omitted brief is not a deletion.
    briefs: (out.image_prompt || out.image_prompts) ? readBriefs(out, page) : page.briefs,
    words: body.split(/\s+/).filter(Boolean).length,
  });

  await writePageMarkdown(ctx, id, page);

  // Same rule the writer follows: approval is of specific copy, and this is no
  // longer that copy.
  if (issue.approved) {
    issue.approved = null;
    emit(ctx, "publication:issue", { id, approved: false });
  }
  await save(ctx, issue);

  emit(ctx, "publication:stage", {
    id, stage: "revise", state: "done", page: page.n, words: page.words,
    rejected: Array.isArray(out.rejected) ? out.rejected.length : 0,
  });
  return body !== before;
}

/**
 * Read every written page and record what is wrong with the prose.
 *
 * Runs after write and before art, which is the only place it is worth
 * anything: the copy is finished, and nothing has been drawn or laid out yet,
 * so a page that has to change has not yet cost an image or a spread.
 *
 * Two halves. The rules count words, paragraph variance, hedge density and
 * cross-page repetition; the model reads the page against thirty-one editorial
 * dimensions. Then, unless told otherwise, the findings are rewritten out and
 * the pages audited again — because an audit that finds eighteen problems and
 * fixes none of them is a report, and nobody was reading the reports.
 *
 * Never fails the run. What survives the rounds goes on the issue and the
 * editor decides — same contract the length governor has upstream.
 */
/* ------------------------------------------------------- scoped mutation */

/**
 * The parts of a page a change can be aimed at.
 *
 * A page was the smallest thing anything could touch. `placePage` re-lays one
 * page instead of the whole issue, which is right, but a note about one
 * sidebar still put the entire page through a rewrite and came back with a
 * different body as well. These are the addressable elements, so "cut the
 * sidebar on sixteen" cuts the sidebar on sixteen.
 */
export type ElementKind = "title" | "deck" | "body" | "pull_quote" | "furniture" | "brief" | "image";

export interface ElementAddress {
  readonly page: number;
  readonly kind: ElementKind;
  /** 1-based, for the kinds that hold a list. Absent means the whole list. */
  readonly index?: number;
}

const ELEMENT_KINDS: ReadonlySet<string> = new Set<ElementKind>([
  "title", "deck", "body", "pull_quote", "furniture", "brief", "image",
]);

/**
 * Parse `page:16/furniture:2`, or `page:16/deck`, or bare `page:16`.
 *
 * Stable across rewrites on purpose: a page number and an element name do not
 * move when the prose around them changes, which a character offset would.
 */
export function parseElementAddress(address: string): ElementAddress {
  const m = /^page:(\d+)(?:\/([a-z_]+)(?::(\d+))?)?$/.exec(String(address).trim());
  if (!m) {
    throw new Error(
      `not an element address: "${address}". Expected page:N, page:N/<element>, `
      + `or page:N/<element>:M — elements are ${[...ELEMENT_KINDS].join(", ")}.`,
    );
  }
  const kind = m[2] ?? "body";
  if (!ELEMENT_KINDS.has(kind)) {
    throw new Error(`unknown element "${kind}". Elements are ${[...ELEMENT_KINDS].join(", ")}.`);
  }
  return {
    page: Number(m[1]),
    kind: kind as ElementKind,
    index: m[3] ? Number(m[3]) : undefined,
  };
}

/** What an address currently holds, so a rewrite can be asked for against it. */
function elementValue(page: PublicationPage, at: ElementAddress): string {
  switch (at.kind) {
    case "title": return page.title;
    case "deck": return page.deck ?? "";
    case "body": return page.body ?? "";
    case "pull_quote": return page.pullQuote ?? "";
    case "brief": return briefsOf(page).map((b) => b.prompt).join("\n\n");
    case "image": return page.image ?? "";
    case "furniture": {
      const blocks = page.furniture ?? [];
      if (at.index === undefined) return blocks.map((f) => `${f.kind}: ${f.text}`).join("\n");
      const one = blocks[at.index - 1];
      if (!one) throw new Error(`page ${page.n} has no furniture block ${at.index}`);
      return `${one.kind}: ${one.text}`;
    }
  }
}

/**
 * Remove one element, and nothing else.
 *
 * Deleting the body would leave a page every later stage treats as unwritten,
 * which is a state to reach by rewriting rather than by deleting, so it is
 * refused. The title is what the page is filed under and has the same problem.
 */
export async function deleteElement(
  ctx: RunnerContext,
  id: string,
  address: string,
): Promise<PublicationPage> {
  const at = parseElementAddress(address);
  if (at.kind === "body" || at.kind === "title") {
    throw new Error(
      `${at.kind} cannot be deleted — a page without one is not a page. `
      + "Rewrite it instead, or redo the page.",
    );
  }

  const issue = await readIssue(ctx, id);
  const page = issue.pages.find((p) => p.n === at.page);
  if (!page) throw new Error(`no page ${at.page} in ${id}`);

  if (at.kind === "furniture") {
    const blocks = page.furniture ?? [];
    if (at.index === undefined) {
      page.furniture = [];
    } else {
      const index = at.index;
      if (!blocks[index - 1]) throw new Error(`page ${at.page} has no furniture block ${index}`);
      page.furniture = blocks.filter((_, i) => i !== index - 1);
    }
  } else if (at.kind === "deck") {
    page.deck = "";
  } else if (at.kind === "pull_quote") {
    page.pullQuote = "";
  } else if (at.kind === "brief") {
    page.briefs = [];
  } else if (at.kind === "image") {
    page.image = null;
  }

  await writePageMarkdown(ctx, id, page);
  emit(ctx, "publication:element", { id, address, verb: "delete", page: at.page });
  await save(ctx, issue);
  return page;
}

/**
 * Rewrite one element to an instruction, and nothing else.
 *
 * The model is given the page for context and asked for one field back, so a
 * note about the deck cannot come back having also rewritten the body — which
 * is what happened when the only tool for this was the whole-page revise.
 */
export async function updateElement(
  ctx: RunnerContext,
  id: string,
  address: string,
  instruction: string,
): Promise<PublicationPage> {
  const at = parseElementAddress(address);
  if (at.kind === "image") {
    throw new Error(
      "an image is not rewritten from an instruction — change its brief, "
      + "then run the art stage for that page",
    );
  }

  const issue = await readIssue(ctx, id);
  const page = issue.pages.find((p) => p.n === at.page);
  if (!page) throw new Error(`no page ${at.page} in ${id}`);

  emit(ctx, "publication:element", { id, address, verb: "update", state: "start", page: at.page });

  const shape = at.kind === "furniture" && at.index === undefined
    ? '{"furniture":[{"kind":"sidebar","text":"..."}]}'
    : at.kind === "furniture"
      ? '{"kind":"sidebar","text":"the rewritten block"}'
      : '{"value":"the rewritten element, as plain text"}';

  const out = await ctx.ask([
    `Rewrite ONE element of page ${at.page} of "${issue.title || issue.subject}".`,
    `The element is: ${address}`,
    "",
    "WHAT THE EDITOR ASKED:",
    instruction,
    "",
    "Change only that element. Everything else on the page stays exactly as it",
    "is, and your reply must not contain it.",
    "",
    `PAGE TITLE: ${page.title}`,
    page.deck ? `DECK: ${page.deck}` : "",
    page.pullQuote ? `PULL QUOTE: ${page.pullQuote}` : "",
    (page.furniture ?? []).length
      ? `FURNITURE:\n${(page.furniture ?? []).map((f, i) => `${i + 1}. ${f.kind}: ${f.text}`).join("\n")}`
      : "",
    ...briefsOf(page).map((b, i) => `IMAGE BRIEF ${i + 1}: ${b.prompt}`),
    "",
    "BODY:",
    page.body ?? "",
    "",
    "CURRENT VALUE OF THE ELEMENT:",
    elementValue(page, at),
    "",
    "Respond with JSON only:",
    shape,
  ].filter(Boolean).join("\n"), `element-${at.page}-${at.kind}`);

  applyElement(ctx, page, at, out);
  await writePageMarkdown(ctx, id, page);

  // Approval is of specific copy. Changing a sidebar is a smaller change than
  // rewriting the page, but it is still not the copy that was signed off.
  if (issue.approved) {
    issue.approved = null;
    emit(ctx, "publication:issue", { id, approved: false });
  }
  emit(ctx, "publication:element", { id, address, verb: "update", state: "done", page: at.page });
  await save(ctx, issue);
  return page;
}

/** Put the model's one field back on the page, or leave the page alone. */
function applyElement(
  ctx: RunnerContext,
  page: PublicationPage,
  at: ElementAddress,
  out: Record<string, unknown>,
): void {
  if (at.kind === "furniture") {
    if (at.index === undefined) {
      const blocks = keepAllowedBlocks(ctx.definition, page.type, out.furniture) ?? [];
      // An empty result is a failed call, not an instruction to clear the
      // page. Removing furniture is what deleteElement is for.
      if (blocks.length) page.furniture = blocks;
      return;
    }
    const text = String(out.text ?? "").trim();
    if (!text) return;
    const blocks = [...(page.furniture ?? [])];
    const existing = blocks[at.index - 1];
    if (!existing) throw new Error(`page ${at.page} has no furniture block ${at.index}`);
    blocks[at.index - 1] = { kind: String(out.kind ?? existing.kind), text, source: existing.source };
    page.furniture = keepAllowedBlocks(ctx.definition, page.type, blocks);
    return;
  }

  const value = String(out.value ?? "").trim();
  if (!value) return;
  if (at.kind === "title") {
    page.title = value;
  } else if (at.kind === "deck") {
    page.deck = value;
  } else if (at.kind === "pull_quote") {
    page.pullQuote = value;
  } else if (at.kind === "brief") {
    // Editing "the brief" replaces the set with the one the user just wrote.
    // Addressing an individual brief is a separate address this does not have.
    page.briefs = [{ prompt: value, orientation: briefsOf(page)[0]?.orientation ?? "landscape" }];
  } else if (at.kind === "body") {
    page.body = value;
    page.words = value.split(/\s+/).filter(Boolean).length;
  }
}

/**
 * Check the written pages against the web.
 *
 * Between writing and the audit, because the audit reads prose and this reads
 * facts, and a page whose figures are wrong should be known to be wrong before
 * anyone spends a revise round on how it sounds. The findings are recorded and
 * not acted on: deciding whether a contradicted figure means a rewrite or a
 * better source is the editor's call, not the runner's.
 *
 * Only runs when the type asks for it, so fiction never pays for it.
 */
export async function runFactCheck(
  ctx: RunnerContext,
  id: string,
): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  emit(ctx, "publication:stage", { id, stage: "fact-check", state: "start" });

  const sources = await allSearchSources(ctx.projectRoot);
  if (!sources.length) {
    // Not an error. A user with no search configured has already been told
    // during research; failing the run here would only repeat it louder.
    issue.factCheck = { at: new Date().toISOString(), findings: [], checked: 0, searchedWith: [] };
    emit(ctx, "publication:stage", {
      id, stage: "fact-check", state: "done", checked: 0,
      message: "no search source configured — nothing was checked",
    });
    return save(ctx, issue);
  }

  const findings: FactFinding[] = [];
  const searchedWith = new Set<string>();
  let checked = 0;

  for (const page of issue.pages) {
    if (!page.body?.trim()) continue;
    const result = await factCheck({
      text: page.body,
      where: `p${page.n}`,
      ask: (prompt, label) => ctx.ask(prompt, label),
      sources,
      onProgress: (message) => emit(ctx, "publication:stage", {
        id, stage: "fact-check", state: "progress", message,
      }),
    });
    findings.push(...result.findings);
    for (const s of result.searchedWith) searchedWith.add(s);
    checked += result.checked;
  }

  issue.factCheck = { at: new Date().toISOString(), findings, checked, searchedWith: [...searchedWith] };
  const problems = findings.filter(isProblem).length;
  emit(ctx, "publication:stage", { id, stage: "fact-check", state: "done", checked, problems });
  return save(ctx, issue);
}

export async function runAudit(
  ctx: RunnerContext,
  id: string,
  options: AuditOptions = {},
): Promise<PublicationIssue> {
  const { deep = true, revise = true, rounds = 2, only } = options;
  emit(ctx, "publication:stage", { id, stage: "audit", state: "start" });

  const look = async (): Promise<PublicationFinding[]> => {
    const issue = await readIssue(ctx, id);
    const found: PublicationFinding[] = [...auditPages(issue.pages, ctx.definition)];
    if (deep) {
      for (const page of issue.pages.filter((p) => p.body && p.body.trim())) {
        found.push(...await reviewPage(ctx, issue, page));
      }
    }
    return found;
  };

  let findings = await look();
  let round = 0;

  while (revise && round < rounds) {
    // Info-level findings are an editor's business. Rewriting a page over one
    // costs a model call and risks the copy for something nobody called wrong.
    const fixable = findings.filter((f) =>
      f.severity === "warning" && f.page > 0 && (!only || only(f)));
    if (fixable.length === 0) break;

    const byPage = new Map<number, PublicationFinding[]>();
    for (const f of fixable) byPage.set(f.page, [...(byPage.get(f.page) ?? []), f]);

    let changed = false;
    for (const [n, pageFindings] of byPage) {
      changed = await revisePage(ctx, id, n, pageFindings) || changed;
    }
    round += 1;
    if (!changed) break;

    findings = await look();
  }

  const issue = await readIssue(ctx, id);
  issue.audit = { at: new Date().toISOString(), findings, rounds: round };
  issue.status = "audited";
  await save(ctx, issue);

  emit(ctx, "publication:stage", {
    id, stage: "audit",
    state: findings.some((f) => f.severity === "warning") ? "warn" : "done",
    message: summarize(findings) + (round ? ` after ${round} revise round${round > 1 ? "s" : ""}` : ""),
    findings: findings.length,
    rounds: round,
  });
  return issue;
}

/**
 * De-AI-ification: the audit, revising only what makes prose sound machine-made.
 *
 * The same loop with a filter, not a second implementation — one place decides
 * what a finding is and how a page gets rewritten.
 */
export async function runDeslop(
  ctx: RunnerContext,
  id: string,
  rounds = 2,
): Promise<PublicationIssue> {
  return runAudit(ctx, id, { deep: true, revise: true, rounds, only: isSlopFinding });
}

/**
 * The whole pipeline, stopping where told.
 *
 * `stopAt` defaults to "write" because what comes next needs a human: art and
 * build both require the copy to be approved first.
 */
export async function run(
  ctx: RunnerContext,
  id: string,
  { from = "research", stopAt = "write", redo = false }: {
    from?: Stage;
    stopAt?: Stage;
    redo?: boolean;
  } = {},
): Promise<PublicationIssue> {
  const order: Stage[] = ["research", "plan", "write", "fact-check", "audit", "art", "build"];
  const start = order.indexOf(from);
  let end = order.indexOf(stopAt);
  if (start < 0 || end < 0) throw new Error(`unknown stage: ${from} or ${stopAt}`);

  // The audit is not a stage a caller gets to stop short of. `stopAt` defaulted
  // to "write", which meant the checks were reachable on paper and skipped in
  // practice by every run that took the default — which is every run. A run
  // that wrote pages audits them.
  if (order.indexOf("write") >= start && end === order.indexOf("write")) {
    end = order.indexOf("audit");
  }

  for (const stage of order.slice(start, end + 1)) {
    if (stage === "research") await runResearch(ctx, id);
    if (stage === "plan") await runPlan(ctx, id);
    if (stage === "write") {
      const issue = await readIssue(ctx, id);
      for (const n of outstanding(issue, "write", redo)) await writePage(ctx, id, n);
    }
    if (stage === "fact-check" && ctx.definition.needsFactCheck) await runFactCheck(ctx, id);
    if (stage === "audit") await runAudit(ctx, id);
    if (stage === "art" && ctx.definition.needsImages) {
      const issue = await readIssue(ctx, id);
      for (const n of outstanding(issue, "art", redo)) await artPage(ctx, id, n);
    }
    if (stage === "build" && ctx.definition.needsPdf) await build(ctx, id);
  }
  return readIssue(ctx, id);
}
