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
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PublicationDefinition } from "../publications/types.js";
import { renderTemplate } from "../publications/types.js";
import {
  advance, approve as approveGate, ensurePipeline, loadPipeline, markStage, pause, pipelineFor, pipelinePath,
  reportUnitDone, reportUnitFailed, resizeUnits, resume, rewindTo, runStage, tryTrack,
  withdraw as withdrawGate,
} from "./orchestrator.js";
import { stageSequence } from "./pipeline-state.js";
import type { StageExecutor } from "./executors.js";
import { track as trackJob } from "./jobs.js";
import * as styles from "../publications/styles.js";
import { artPolicyOf, type Surface } from "../productions/registry.js";
import { seedOf } from "./treatments.js";
import {
  allSearchSources,
  findingsFor,
  researchPublication,
  type ResearchReport,
} from "./publication-research.js";
import { resolveVoice } from "./publication-voice.js";
import { rulesFor } from "./taste-engine.js";
import {
  factCheck,
  isProblem,
  worthChecking,
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
  /** How it sits on the page (09 §1): rolled once, kept, read by the layout. */
  readonly treatment?: string;
  /** What kind of picture it is, which decides which engines may draw it. */
  readonly surface?: string;
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
  /** Which lens of the connection web this page looks through (13 rev. B). */
  ring?: string;
  /**
   * The bridges this page must build to other pages, from the flatplan.
   *
   * `cue` is the word both pages share — a person, a place, an object — which
   * is what lets the audit see whether the bridge was actually written.
   */
  links?: Array<{ to: number; why: string; cue: string }>;
  /** Names of the issue's threads this page carries. */
  threads?: string[];
}

/**
 * The issue's skeleton: one thing at the centre, followed outward (13 rev. B).
 *
 * Built from the research before the flatplan, so the plan walks connections
 * instead of ticking a list of pillars, and every page knows which other pages
 * it is tied to.
 */
export interface IssueWeb {
  /** The one thing, in a few words. */
  centre: string;
  /** What the issue asks first and answers last. */
  question: string;
  /** The lenses this research is rich in, chosen per issue. */
  rings: string[];
  nodes: Array<{ id: string; ring: string; fact: string; source?: string }>;
  links: Array<{ from: string; to: string; why: string; cue?: string }>;
  /** What recurs across the issue, with the words that mark it in text. */
  threads: Array<{ name: string; cue: string[] }>;
  /** The one image a reader keeps, echoed at least twice. */
  wonder?: { text: string; cue: string[] };
  /** The single strong colour of the issue. */
  accent?: { name: string; hex: string };
  /** A drawable motif taken from the centre itself. */
  motif?: string;
}

/**
 * The page's image briefs, whichever shape the issue was written in.
 *
 * Issues already on disk predate the list and carry a single `brief`. Reading
 * them through here means an old magazine keeps working with no migration pass
 * over the workspace.
 */
/**
 * An issue's name, as a cover would set it.
 *
 * Asked for in a few words, it came back as "The Latent Surface: Photochemical
 * Mechanics, Industrial Scale, and the Living Craft of Film", and that wrapped
 * over seven lines of the top bar. The part after a colon or dash is a
 * subtitle, and the thesis already says it.
 */
export function coverTitle(title: string): string {
  return (title.split(/\s*[:|–—]\s*|\s+-\s+/)[0] ?? "").trim();
}

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
  /** Prepended to every image brief in this section (08 §2). */
  imagePrompt?: string;
  negative?: string;
  props?: string[];
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
  /** The connection web, once research has found enough to draw it. */
  web?: IssueWeb | null;
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
  lastError?: { at: string; stage?: string; message: string; stopped?: boolean } | null;
  /** Who reads it, as the intake said it; picks the writing bar (13 §4b). */
  audience?: string;
  /**
   * Start the next issue on its own, this often (13 §Sources). Only the latest
   * issue of a series carries it; making the next one moves it along.
   */
  recurring?: "weekly" | "monthly" | null;
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
  /**
   * Stop the run between stages and between pages.
   *
   * Without it the Stop button reported success and the issue kept writing:
   * the task snapshot said "running" for as long as the app stayed up, because
   * nothing in here ever read the signal it was given.
   */
  readonly signal?: AbortSignal;
}

/** Thrown at the first boundary after a stop, so the task ends as stopped. */
export class PublicationStopped extends Error {
  constructor() {
    super("Stopped by user");
    this.name = "AbortError";
  }
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
/**
 * Where the magazine's brand book lives: above every series.
 *
 * An issue's series is its subject ("photography", "the kolam…"), so a house
 * style kept per series was a house style per subject — the brand reached one
 * issue and no other. `Magazine/house_style.md` is read first; a series file
 * read after it may still say something more particular.
 */
const brandDirOf = (ctx: RunnerContext) => join(ctx.projectRoot, ctx.definition.outDir);
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
  await retireRunFile(ctx, id);

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

/** When a recurring issue's successor is due, or null when it does not recur. */
export function nextIssueDue(issue: Pick<PublicationIssue, "recurring" | "createdAt">): Date | null {
  if (!issue.recurring) return null;
  const at = new Date(issue.createdAt);
  if (Number.isNaN(at.getTime())) return null;
  if (issue.recurring === "weekly") at.setDate(at.getDate() + 7);
  else at.setMonth(at.getMonth() + 1);
  return at;
}

/** Who the issue is for, and how often it recurs (13 §4b, §Sources). */
export async function setIssueSchedule(
  ctx: RunnerContext,
  id: string,
  patch: { readonly recurring?: "weekly" | "monthly" | null; readonly audience?: string },
): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  if (patch.recurring !== undefined) issue.recurring = patch.recurring;
  if (patch.audience !== undefined) issue.audience = patch.audience.trim() || undefined;
  return await save(ctx, issue);
}

/**
 * Make the next issue of a recurring series, if it is due: same subject,
 * extent, reader and series, dated in its angle so its id is new. The
 * recurring flag moves to it, so only the latest issue of a series ever
 * carries one and a series never forks.
 */
export async function startNextIssue(ctx: RunnerContext, id: string, now = new Date()): Promise<PublicationIssue | null> {
  const issue = await readIssue(ctx, id);
  const due = nextIssueDue(issue);
  if (!due || due > now) return null;
  const stamp = now.toISOString().slice(0, 10);
  const next = await createIssue(ctx, {
    subject: issue.subject,
    angle: [issue.angle, stamp].filter(Boolean).join(" "),
    extent: issue.extent,
    series: issue.series,
  });
  next.recurring = issue.recurring ?? null;
  if (issue.audience) next.audience = issue.audience;
  await save(ctx, next);
  issue.recurring = null;
  await save(ctx, issue);
  return next;
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
  error: { stage?: string; message: string; stopped?: boolean } | null,
): Promise<void> {
  try {
    const issue = await readIssue(ctx, id);
    issue.lastError = error
      ? {
        at: new Date().toISOString(),
        ...(error.stage ? { stage: error.stage } : {}),
        message: error.message,
        ...(error.stopped ? { stopped: true } : {}),
      }
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
  const stamp = `${id}-${Date.now()}`;
  await rename(dir, join(trash, stamp));
  await retireRunFile(ctx, id, join(trash, stamp));
  return true;
}

/**
 * Take the run file for an id out of the way, keeping it beside `into`.
 *
 * The run file lives at `<outDir>/<id>/pipeline.json`, not inside the issue
 * folder, so removing an issue left it behind. A new issue with the same
 * subject then inherited it: the run screen showed the old run's fourteen
 * finished pages and its failure over a run that had written none, while the
 * issue page showed the new one. A new issue is a new run.
 */
async function retireRunFile(ctx: RunnerContext, id: string, into?: string): Promise<void> {
  let path: string;
  try {
    path = pipelinePath(ctx.projectRoot, { type: "publication", id });
  } catch {
    return; // No pipeline for this kind of work.
  }
  if (!existsSync(path)) return;
  const keep = into ?? join(ctx.projectRoot, ctx.definition.outDir, "_trash", `${id}-run-${Date.now()}`);
  await mkdir(keep, { recursive: true });
  await rename(path, join(keep, "pipeline.json"));
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

  // The signature pages are what make one issue look like the last one; an
  // issue that planned without them is a different magazine.
  for (const type of rules.requireTypes ?? []) {
    if (!pages.some((p) => p.type === type)) w.push(`no ${type} page — every issue carries one`);
  }
  if (rules.closingType) {
    // The page before the back cover, whichever section the planner put it in:
    // a closing page left outside every section is still the closing page.
    const content = [...pages].sort((a, b) => a.n - b.n).filter((p) => p.type !== "cover");
    const last = content[content.length - 1];
    if (last && last.type !== rules.closingType) {
      w.push(`the last page before the back cover is ${last.type}, not ${rules.closingType}`);
    }
  }

  if (rules.reportDensityMix) {
    const share = (d: string) =>
      Math.round((100 * pages.filter((p) => p.density === d).length) / (pages.length || 1));
    const codes = Object.keys(def.densities);
    w.push(`density ${codes.join("/")} = ${codes.map(share).join("/")}%`);
  }
  return w;
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

  // No rule against sections sharing a typeface any more: the type pair is the
  // brand's, fixed for every issue (13 rev. A). Sections differ in register,
  // technique and paper, inside that.
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
  const saved = await save(ctx, issue);
  await signGate(ctx, id, "content", true);
  return saved;
}

export async function unapprove(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  issue.approved = null;
  const saved = await save(ctx, issue);
  await signGate(ctx, id, "content", false);
  return saved;
}

/**
 * The same sign-off, said to the run file.
 *
 * The issue's flags are what the magazine's own stages check; the gate is what
 * Home, the Run page and every other production read. Saying it once in each
 * keeps "waiting on you" honest for an issue the way it is for a book. A run
 * file that does not exist yet (nothing planned) is nothing to tell.
 */
async function signGate(ctx: RunnerContext, id: string, gate: "content" | "design", yes: boolean): Promise<void> {
  const ref = { type: "publication", id } as const;
  await tryTrack(async () => {
    if (!await loadPipeline(ctx.projectRoot, ref)) return;
    if (yes) await approveGate({ projectRoot: ctx.projectRoot, ref, gate, by: "editor" });
    else await withdrawGate({ projectRoot: ctx.projectRoot, ref, gate });
  });
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

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const words = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : []).map(str).filter(Boolean);

/**
 * The model's web, kept only where it holds together.
 *
 * A node with no source is dropped — the web is what pages stand on, and a fact
 * no one can check is not ground. A link must join two nodes that exist. A web
 * with no centre is no web, and the plan falls back to the research alone.
 */
export function readWeb(raw: Record<string, unknown>): IssueWeb | null {
  const centre = str(raw.centre);
  if (!centre) return null;
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .map((n) => n as Record<string, unknown>)
    .map((n) => ({ id: str(n.id), ring: str(n.ring), fact: str(n.fact), source: str(n.source) }))
    .filter((n) => n.id && n.fact && n.source);
  const ids = new Set(nodes.map((n) => n.id));
  const links = (Array.isArray(raw.links) ? raw.links : [])
    .map((l) => l as Record<string, unknown>)
    .map((l) => ({ from: str(l.from), to: str(l.to), why: str(l.why), cue: str(l.cue) }))
    .filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to && l.why);
  const threads = (Array.isArray(raw.threads) ? raw.threads : [])
    .map((t) => t as Record<string, unknown>)
    .map((t) => ({ name: str(t.name), cue: words(t.cue) }))
    .filter((t) => t.name && t.cue.length);
  const wonderRaw = (raw.wonder ?? null) as Record<string, unknown> | null;
  const accentRaw = (raw.accent ?? null) as Record<string, unknown> | null;
  const hex = str(accentRaw?.hex);
  const rings = words(raw.rings);
  return {
    centre,
    question: str(raw.question),
    rings: rings.length ? rings : [...new Set(nodes.map((n) => n.ring).filter(Boolean))],
    nodes,
    links,
    threads,
    ...(wonderRaw && str(wonderRaw.text) ? { wonder: { text: str(wonderRaw.text), cue: words(wonderRaw.cue) } } : {}),
    ...(/^#[0-9a-f]{6}$/i.test(hex) ? { accent: { name: str(accentRaw?.name) || hex, hex } } : {}),
    ...(str(raw.motif) ? { motif: str(raw.motif) } : {}),
  };
}

/** The web as the planner reads it: rings, the facts' ids, the links and threads. */
function webBlock(web: IssueWeb | null | undefined): string {
  if (!web) return "";
  return [
    `CENTRE: ${web.centre}`,
    `THE QUESTION THE ISSUE OPENS ON AND ANSWERS LAST: ${web.question}`,
    `RINGS (the lenses this research is rich in): ${web.rings.join(", ")}`,
    "NODES:",
    ...web.nodes.map((n) => `- ${n.id} [${n.ring}] ${n.fact}`),
    "LINKS:",
    ...web.links.map((l) => `- ${l.from} -> ${l.to} (cue: ${l.cue || "none"}): ${l.why}`),
    "THREADS (each must surface on at least three pages, in different rings):",
    ...web.threads.map((t) => `- ${t.name} (cue: ${t.cue.join(", ")})`),
    web.wonder ? `WONDER MOMENT (echo it at least twice, told from different sides): ${web.wonder.text}` : "",
  ].filter(Boolean).join("\n");
}

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
  issue.title = coverTitle(report.title ?? "") || issue.title || issue.subject;
  issue.thesis = report.thesis || "";

  // The research is a pile of sourced facts; the web is how they connect. Drawn
  // here, once, so the flatplan walks connections rather than a pillar list.
  if (def.prompts.web) {
    emit(ctx, "publication:stage", { id, stage: "research", state: "progress", message: "drawing the connection web" });
    const out = await ctx.ask(renderTemplate(def.prompts.web, {
      voice: await voiceFor(ctx, issue),
      subject: issue.subject,
      angleSuffix: issue.angle ? ` / ${issue.angle}` : "",
      thesis: issue.thesis,
      notes: notesBlock(issue),
      research: JSON.stringify(report).slice(0, 16000),
    }), "web");
    issue.web = readWeb(out);
  }
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
    // With a web, the plan stands on it; the raw research is still there for
    // what the web left out, but no longer has to carry the whole issue.
    research: JSON.stringify(issue.research).slice(0, issue.web ? 6000 : 12000),
    web: webBlock(issue.web) || "(no web — plan from the research)",
    archetypes: def.archetypes.join(", "),
  }), "plan");

  issue.sections = (out.sections as PublicationSection[]) ?? [];
  const threadNames = new Set((issue.web?.threads ?? []).map((t) => t.name.toLowerCase()));
  issue.pages = (((out.pages as Array<Partial<PublicationPage> & Record<string, unknown>>) ?? [])
    .map((p) => {
      const n = Number(p.n);
      const links = (Array.isArray(p.links) ? p.links : [])
        .map((l) => l as Record<string, unknown>)
        .map((l) => ({ to: Number(l.to), why: str(l.why), cue: str(l.cue) }))
        .filter((l) => l.to && l.to !== n && l.why);
      // A thread the web never named is the planner inventing one; keep only
      // the threads the audit can count.
      const threads = words(p.threads).filter((t) => !threadNames.size || threadNames.has(t.toLowerCase()));
      return {
        n,
        title: p.title ?? "",
        type: p.type ?? def.archetypes[0],
        density: p.density ?? def.defaultDensity,
        section: Number(p.section) || 0,
        pillar: p.pillar ?? "none",
        premise: p.premise ?? "",
        ...(str(p.ring) ? { ring: str(p.ring) } : {}),
        ...(links.length ? { links } : {}),
        ...(threads.length ? { threads } : {}),
        body: null,
        briefs: [],
        image: null,
      };
    })
    .filter((p) => p.n)
    .sort((a, b) => a.n - b.n)) as PublicationPage[];
  issue.warnings = checkPlan(def, issue);
  issue.status = "planned";
  // The flatplan is the first moment the page count is real. The run started
  // sized to the extent asked for; it now takes the count that was planned.
  await tryTrack(async () => {
    const ref = { type: "publication", id } as const;
    await ensurePipeline({ projectRoot: ctx.projectRoot, ref, totalUnits: issue.pages.length });
    await resizeUnits({ projectRoot: ctx.projectRoot, ref, total: issue.pages.length });
  });
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

/**
 * What one page is told about the web: the centre, its bridges, its threads.
 *
 * Every value is a whole line or empty, so a type without a web renders the
 * same template with the lines simply missing.
 */
export function connectionLines(issue: PublicationIssue, page: PublicationPage): Record<string, string> {
  const web = issue.web;
  const titleOf = (n: number) => issue.pages.find((p) => p.n === n)?.title ?? "";
  const links = (page.links ?? []).map((l) =>
    `- to p${l.to} "${titleOf(l.to)}" — ${l.why}${l.cue ? ` (use the word: ${l.cue})` : ""}`);
  const threads = (page.threads ?? []).map((name) => {
    const t = web?.threads.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return t ? `${t.name} (${t.cue.join(", ")})` : name;
  });
  const signature: Record<string, string> = {
    map: "THIS IS THE MAP: the issue's whole web drawn as one spread. Write only a deck and a body"
      + " under 80 words that invites the reader in. The drawing is made from the web itself, so"
      + " return an empty image_prompts list.",
    "where-else": `THIS IS WHERE ELSE: ${web?.centre ?? "the subject"} found where nobody expects it.`
      + " Short finds, each one surprising and each from a source; no find without one.",
    voices: "THIS IS VOICES: two to four real people who live with the subject. A quotation only if"
      + " the research holds those exact words with a source — otherwise describe their work and"
      + " use no quotation marks at all. Never invent a quote.",
    "in-your-hands": `THIS IS IN YOUR HANDS, the closing page: where the reader meets ${web?.centre ?? "the subject"}`
      + ` today, and the answer to the issue's opening question${web?.question ? ` ("${web.question}")` : ""}.`
      + " End in the reader's own life. No summary, no moral.",
  };
  return {
    centreLine: web
      ? `THE ISSUE'S CENTRE: ${web.centre}. THE QUESTION IT OPENS ON AND ANSWERS LAST: ${web.question}`
      : "",
    linksLine: links.length
      ? `BRIDGES THIS PAGE MUST BUILD — write each into the text naturally, with its word:\n${links.join("\n")}\n`
        + "The reader sees the bridge, never the planning: do not write \"web\", \"node\", \"ring\" or"
        + " \"thread\" about this issue's structure."
      : "",
    threadsLine: threads.length
      ? `THREADS THIS PAGE CARRIES — let them surface, never as a list: ${threads.join("; ")}`
      : "",
    wonderLine: web?.wonder
      ? `THE ISSUE'S WONDER MOMENT, if this page can touch it from its own side: ${web.wonder.text}`
      : "",
    signatureLine: signature[page.type] ?? "",
  };
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
    rulesDir: [brandDirOf(ctx), seriesDirOf(ctx, issue)],
    taste: { projectRoot: ctx.projectRoot, type: "publication", id: issue.id },
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
    ...connectionLines(issue, page),
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
    // The cover carries the issue's name, so it follows the same cover-line rule.
    title: (page.type === "cover" ? coverTitle(String(out.title ?? "")) : out.title as string) || page.title,
    deck: (out.deck as string) || "",
    body: (out.body as string) ?? "",
    pullQuote: (out.pull_quote as string) || "",
    furniture: keepAllowedBlocks(def, page.type, out.furniture),
    // The page prompt asks for `image_prompts`, a list. This read only the old
    // single `image_prompt`, so every brief of a 50-page issue was thrown away
    // and art read "no page asked for a picture" before it had started.
    briefs: readBriefs(out, page),
    sources: (out.sources as string[]) ?? [],
    uncertain: (out.uncertain as string[]) ?? [],
    words: String(out.body ?? "").split(/\s+/).filter(Boolean).length,
  });

  await writePageMarkdown(ctx, id, page);

  // Approval is of specific copy: rewriting a page means the sign-off no
  // longer describes what is set.
  const withdrawn = Boolean(issue.approved);
  if (issue.approved) {
    issue.approved = null;
    emit(ctx, "publication:issue", { id, approved: false });
  }
  issue.status = "writing";
  emit(ctx, "publication:stage", {
    id, stage: "write", state: "done", page: page.n, words: page.words,
  });
  await save(ctx, issue);
  if (withdrawn) await signGate(ctx, id, "content", false);
  // Written pages are the units of a magazine's content stage. Pages are
  // written one call at a time and in any order, and `completeUnit` is a set,
  // so rewriting p7 reports it done twice and the count stays honest.
  await tryTrack(() => reportUnitDone({
    projectRoot: ctx.projectRoot,
    ref: { type: "publication", id },
    unit: page.n,
    satisfies: "content.write",
  }));
  return page;
}

/* --------------------------------------------------------------------- art */

/**
 * Render one page's image through Quire's shim, which owns ComfyUI.
 *
 * Gated on approval: rendering art for copy nobody signed off wastes GPU time
 * on pages that are about to be rewritten.
 */
/** The design's own slot for a page, said in the treatment table's words. */
function treatmentForSlot(slot: string | undefined): string | undefined {
  switch (slot) {
    case "full-bleed": return "full-bleed";
    case "top": return "half-bleed-top";
    case "bottom": return "half-bleed-top";
    case "left": case "right": return "half-bleed-side";
    case "inset": return "cutout";
    default: return undefined;
  }
}

/**
 * Which surface this picture is, from the type's target mix (08 §1).
 *
 * Seeded rather than random: the same page asks for the same kind of picture
 * on every re-render, and across an issue the shares come out near the target
 * the audit measures against.
 */
function surfaceForPage(id: string, page: number, k: number): Surface {
  const mix = artPolicyOf("publication")?.mix ?? { illustration: 1 };
  const entries = Object.entries(mix) as ReadonlyArray<[Surface, number]>;
  const total = entries.reduce((sum, [, share]) => sum + share, 0) || 1;
  // A fixed point in [0,1) per page, spread evenly by the golden ratio so
  // neighbouring pages land in different buckets instead of running in blocks.
  const at = ((seedOf(id, page, k) * 0.6180339887) % 1 + 1) % 1;
  let cursor = 0;
  for (const [surface, share] of entries) {
    cursor += share / total;
    if (at < cursor) return surface;
  }
  return entries[0]?.[0] ?? "illustration";
}

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
  /*
   * The section's world, or the issue's image direction when the design gave
   * no per-section worlds. Both were generated and neither ever reached a
   * render: every page went to Comfy as its own brief and nothing else.
   */
  const { composeImagePrompt } = await import("./image-prompt.js");
  const { pageCandidates, postProcessFor, rollTreatment } = await import("./treatments.js");
  const section = worldFor(issue, page.n);
  const world = {
    ...(section ?? {}),
    imagePrompt: section?.imagePrompt || issue.design?.spec?.imageDirection || "",
  };
  const before = issue.pages.find((p) => p.n === page.n - 1);
  let last = before ? briefsOf(before)[0]?.treatment : undefined;
  for (const [i, brief] of briefs.entries()) {
    // Resumable per image, not per page: a four-picture spread that failed on
    // the fourth should not pay for the first three again.
    if (done[i]) {
      last = brief.treatment ?? last;
      continue;
    }
    const portrait = brief.orientation === "portrait";
    const square = brief.orientation === "square";
    const suffix = briefs.length > 1 ? `-${i + 1}` : "";
    const outFile = join(dirOf(ctx, id), "art", `${String(page.n).padStart(2, "0")}${suffix}.png`);
    // Rolled once and kept on the brief, so a re-render keeps its place on the
    // page and the Affinity layout reads the same answer (09 §1).
    /*
     * The layout already said how this picture sits on its page.
     *
     * `spec.pages[n].imageSlot` is the design stage's own decision — full
     * bleed, top, inset — and the art stage ignored it, rolling a treatment
     * from the page type instead. So a page designed with the title in
     * negative space at the top got an edge-to-edge picture under it and the
     * words had nowhere to go. The roll stays as the fallback for a page the
     * design said nothing about.
     */
    const treatment = brief.treatment
      ?? treatmentForSlot(issue.design?.spec?.pages?.[String(page.n)]?.imageSlot)
      ?? rollTreatment({
        type: "publication", id, unit: page.n, k: i, slot: "page",
        candidates: pageCandidates(page.type), previous: [last],
      });
    last = treatment;
    /*
     * What kind of picture this is, from the issue's own target mix.
     *
     * `brief.surface` was written by nobody and read by the audit only, so
     * every picture composed as the policy's first surface — a photograph.
     * A magazine is mostly drawn: the mix in the registry decides, seeded per
     * page so a re-render draws the same kind of picture again.
     */
    const surface = (brief.surface as Surface | undefined) ?? surfaceForPage(id, page.n, i);
    page.briefs = briefsOf(page).map((b, j) => (j === i ? { ...b, treatment, surface } : b));
    /*
     * An element stands on its section's paper, not on white.
     *
     * The ground goes into the prompt and into the post-process from the same
     * value, so the colour that is drawn is the colour that is keyed away.
     */
    const ground = section?.paper ?? issue.design?.spec?.palette?.paper;
    const composed = composeImagePrompt({
      type: "publication", prompt: brief.prompt, world, treatment, surface,
      ...(ground ? { ground } : {}),
    });

    const res = await fetch(`${ctx.shimUrl}/image/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: composed.prompt,
        negative: composed.negative,
        width: square ? 1280 : portrait ? 1024 : 1536,
        height: square ? 1280 : portrait ? 1536 : 1024,
        outFile,
        // A magazine picture is a one-off on its own page: no recurring cast to
        // keep steady, so it is the one surface a hosted engine may draw
        // (23 §3.3). The router still decides — this only says nothing blocks it.
        surface,
        // The world's technique picks a style LoRA when one is installed
        // (09 §2B). It was never sent, so no LoRA could ever be chosen.
        ...(world.technique ? { technique: world.technique } : {}),
        needs: [],
        post: postProcessFor(treatment, {
          paper: section?.paper, ink: section?.ink, hue: section?.hue,
          ...(ground ? { ground } : {}),
        }),
        recipe: {
          type: "publication",
          id,
          unit: page.n,
          slot: `p${page.n}${suffix}`,
          treatment,
          ...(section ? { section: section.n } : {}),
          components: composed.components,
        },
      }),
    });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; notice?: string };
    if (!res.ok || body.ok === false) {
      const why = body.error ?? `HTTP ${res.status}`;
      page.images = done;
      await save(ctx, issue);
      emit(ctx, "publication:stage", { id, stage: "art", state: "error", page: page.n, error: why });
      throw new Error(`art p${page.n} image ${i + 1}: ${why}`);
    }
    if (body.notice) emit(ctx, "publication:stage", { id, stage: "art", state: "progress", page: page.n, notice: body.notice });
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
 * The sections, for the design prompt to give each its own world.
 *
 * `DesignWorld` and `design.sections` existed and nothing wrote them, so every
 * section of every issue was drawn in one look and `worldFor` answered null.
 */
/** Exported for the test that asserts the prompt offers the law's own catalogue. */
export function sectionBlockFor(issue: PublicationIssue): string {
  return sectionBlock(issue);
}

function sectionBlock(issue: PublicationIssue): string {
  const sections = issue.sections ?? [];
  if (!sections.length) return "";
  return [
    "",
    "SECTIONS. Each is its own world — a register, a figure technique, its own",
    "paper and ink — sharing the folio. Adjacent sections must not look alike.",
    ...sections.map((s) => `s${s.n} "${s.label}" (pages ${s.from}-${s.to}): ${s.question}`),
    /*
     * The catalogue, named.
     *
     * `checkDesign` has always required a register from this list and a tier-2
     * figure technique, and the prompt asked for "register" as free text while
     * listing only the techniques. So the stage answered with inventions —
     * "Historical alchemy and physical apparatus" — and every design it
     * produced failed its own law and could never be signed off. A rule the
     * asker is never told is not a rule, it is a trap.
     */
    `Registers to choose from, spelled exactly: ${styles.registers().map((r) => r.name).join(", ")}.`,
    `Figure techniques to choose from, spelled exactly: ${styles.techniques().map((t) => t.name).join(", ")}.`,
    "For each section give: register (from that list), technique (from that list),",
    "idiom (a named visual idiom of your own words), paper, ink, hue, imagePrompt",
    "(how every image in that section looks, no single subject) and negative (what",
    "those images must avoid). No two sections may share a register.",
    "",
    ...brandDesignLines(issue),
  ].join("\n");
}

/**
 * The brand's design constants, said to the art director (13 rev. A).
 *
 * The type pair and grid never change between issues; what changes is one
 * accent — the centre's own colour — and one motif taken from the subject.
 * Every other colour stays quiet so the accent is the one that speaks.
 */
function brandDesignLines(issue: PublicationIssue): string[] {
  const web = issue.web;
  return [
    "THE BRAND'S CONSTANTS (the same in every issue — do not vary them by section):",
    "- One display face and one text face for the whole issue: spec.type.display and spec.type.text.",
    "- One accent colour, spec.palette.accent, and it is the only strong colour in the issue."
      + " Section hues are quiet: tints or shades of paper and ink, never a second accent.",
    web?.accent
      ? `- The accent is the centre's own colour: ${web.accent.name} ${web.accent.hex}. Use that hex, or the`
        + " nearest one that holds contrast on the paper."
      : "",
    web?.motif
      ? `- The motif is ${web.motif}. Put it in fixed.divider, and let every section's imagePrompt`
        + " carry it in a small way, so the issue reads as one object."
      : "",
    "- Pictures stay quiet so the accent can speak: muted, duotone or sepia, never a rainbow.",
  ].filter(Boolean).concat("");
}

/** The model's section worlds, kept only where they name a real section. */
function worldsFrom(raw: unknown, issue: PublicationIssue, spec: DesignSpec): DesignWorld[] {
  const known = new Set((issue.sections ?? []).map((s) => s.n));
  const hex = (v: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(String(v ?? "")) ? String(v) : fallback);
  return (Array.isArray(raw) ? raw : [])
    .filter((w): w is Record<string, unknown> => !!w && typeof w === "object" && known.has(Number(w.n)))
    .map((w) => ({
      n: Number(w.n),
      register: String(w.register ?? w.technique ?? ""),
      ...(w.technique ? { technique: String(w.technique) } : {}),
      idiom: String(w.idiom ?? ""),
      paper: hex(w.paper, spec?.palette?.paper ?? "#ffffff"),
      ink: hex(w.ink, spec?.palette?.ink ?? "#111111"),
      ...(w.hue ? { hue: hex(w.hue, spec?.palette?.accent ?? "") } : {}),
      ...(w.imagePrompt ? { imagePrompt: String(w.imagePrompt) } : {}),
      ...(w.negative ? { negative: String(w.negative) } : {}),
    }));
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
      // The editor's accepted design rules (18 §4) - counted from their own
      // verdicts on layouts, so they outrank anything generic above.
      await rulesFor(ctx.projectRoot, { type: "publication", id, surface: "design" })
        .then((rules) => rules.length
          ? `THE EDITOR'S OWN DESIGN RULES (follow every one):\n${rules.map((r) => `- ${r}`).join("\n")}`
          : "")
        .catch(() => ""),
    ].filter(Boolean).join("\n\n"),
    pageDigest: pageDigest(issue),
    sectionBlock: sectionBlock(issue),
  }), "design");

  // The section worlds come back beside the spec, not inside it: the spec is
  // the whole issue's law, and a world is one section's look (08 §2).
  const { sections: rawWorlds, fixed: rawFixed, ...specOnly } = out as Record<string, unknown>;
  const spec = specOnly as unknown as DesignSpec;
  /*
   * The furniture is kept beside the spec, where the law looks for it.
   *
   * `checkDesign` refuses a design with no folio — "the folio is what makes N
   * worlds one object" — and nothing ever wrote one, because the prompt never
   * asked and this function threw the field away with the rest of the reply.
   * Every design the stage made was unsignable for want of four sentences.
   */
  const fixed = rawFixed && typeof rawFixed === "object"
    ? Object.fromEntries(
      Object.entries(rawFixed as Record<string, unknown>)
        .filter(([key]) => ["folio", "trim", "grid", "divider"].includes(key))
        .map(([key, value]) => [key, String(value ?? "").trim()])
        .filter(([, value]) => value),
    ) as PublicationDesign["fixed"]
    : undefined;
  const worlds = worldsFrom(rawWorlds, issue, spec);
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

  issue.design = {
    ...(issue.design ?? { sections: [] }),
    spec,
    ...(fixed && Object.keys(fixed).length ? { fixed } : {}),
    ...(worlds.length ? { sections: worlds } : {}),
  };
  // A new spec is a new decision, so any previous sign-off on the old one goes.
  issue.designApproved = null;
  issue.status = "designed";
  emit(ctx, "publication:stage", { id, stage: "design", state: "done" });
  return save(ctx, issue);
}

/**
 * One section's world, chosen again — the editor's pick, not the stage's.
 *
 * The whole-issue design stage decides every section in one pass, and until
 * now that was the only way a magazine got a world: `POST /design/world`
 * answered "a magazine's worlds are chosen per section at its design stage"
 * and left no way to disagree with what that stage chose. The issue's law —
 * palette, type, grid — is untouched; this re-decides the look of one section
 * inside it, which is exactly the decision a section is (08 §2).
 *
 * The other sections are named in the prompt so the new one cannot land on a
 * register a neighbour already holds: adjacent sections that look alike are
 * the failure this whole per-section idea exists to avoid.
 */
export async function designSection(
  ctx: RunnerContext,
  id: string,
  n: number,
  note?: string,
): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  const spec = issue.design?.spec;
  if (!spec) {
    throw new Error("there is no design yet — run the design stage before choosing a section's world");
  }
  const section = (issue.sections ?? []).find((s) => s.n === n);
  if (!section) throw new Error(`this issue has no section ${n}`);

  const worlds = issue.design?.sections ?? [];
  const mine = worlds.find((w) => w.n === n);
  const others = worlds.filter((w) => w.n !== n);
  const pages = issue.pages.filter((p) => p.n >= section.from && p.n <= section.to);

  const out = await ctx.ask([
    `You are choosing the look of ONE section of "${issue.title || issue.subject}".`,
    `Section ${n}: "${section.label}" — ${section.question}`,
    `Its pages: ${pages.map((p) => `p${p.n} ${p.title}`).join("; ") || "none yet"}`,
    "",
    `The issue's law is already decided and does not change: paper ${spec.palette?.paper}, `
      + `ink ${spec.palette?.ink}, accent ${spec.palette?.accent}, `
      + `display ${spec.type?.display}, text ${spec.type?.text}.`,
    mine ? `This section currently reads: ${mine.register} / ${mine.idiom}.` : "This section has no world yet.",
    others.length
      ? `The other sections hold: ${others.map((w) => `s${w.n} ${w.register} / ${w.idiom}`).join("; ")}. `
        + "Do not repeat any of them, and do not sit next to one that looks like it."
      : "",
    note ? `THE EDITOR ASKS FOR: ${note}` : "Choose a different world from the one above.",
    // The same catalogue the law checks against, named here too: a section
    // chosen by hand must pass the check a section chosen by the stage does.
    `Registers to choose from, spelled exactly: ${styles.registers().map((r) => r.name).join(", ")}.`,
    `Figure techniques to choose from, spelled exactly: ${styles.techniques().map((t) => t.name).join(", ")}.`,
    "",
    "Return ONLY JSON:",
    `{"n": ${n}, "register": "...", "technique": "...", "idiom": "...", `
      + `"paper": "#rrggbb", "ink": "#rrggbb", "hue": "#rrggbb", `
      + `"imagePrompt": "under 60 words, no single subject", "negative": "..."}`,
  ].filter(Boolean).join("\n"), "design-section");

  const [world] = worldsFrom([{ ...(out as Record<string, unknown>), n }], issue, spec);
  if (!world) throw new Error(`the answer did not describe section ${n}`);

  issue.design = {
    ...(issue.design ?? { sections: [] }),
    spec,
    sections: [...others, world].sort((a, b) => a.n - b.n),
  };
  // A section's look is part of the design that was signed off, so the
  // sign-off goes with it rather than standing over something it never saw.
  issue.designApproved = null;
  emit(ctx, "publication:stage", { id, stage: "design", state: "done", section: n });
  return save(ctx, issue);
}

export async function approveDesign(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  if (!issue.design?.spec) throw new Error("there is no design to approve — run the design stage first");
  issue.designApproved = { at: new Date().toISOString(), by: "editor" };
  emit(ctx, "publication:issue", { id, designApproved: true });
  const saved = await save(ctx, issue);
  await signGate(ctx, id, "design", true);
  return saved;
}

export async function unapproveDesign(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  issue.designApproved = null;
  emit(ctx, "publication:issue", { id, designApproved: false });
  const saved = await save(ctx, issue);
  await signGate(ctx, id, "design", false);
  return saved;
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
): Promise<{ readonly image: string | null; readonly error?: string; readonly prescreen?: ReadonlyArray<PublicationFinding> }> {
  await requireDesigner(ctx.shimUrl, "rendering a spread");
  const issue = await readIssue(ctx, id);
  const page = issue.pages.find((p) => p.n === Number(n));
  if (!page) throw new Error(`no page ${n} in ${id}`);

  const res = await fetch(`${ctx.shimUrl}/affinity/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ issue, issueDir: dirOf(ctx, id), page: Number(n) }),
  });
  const body = await res.json().catch(() => ({})) as {
    ok?: boolean; image?: string; error?: string;
  };
  if (!res.ok || body.ok === false) return { image: null, error: body.error ?? `HTTP ${res.status}` };
  if (!body.image) return { image: null };
  // The machine beauty pre-screen (13 §9): measured on the page as rendered,
  // so a crowded or shouting page is named before a person has to see it.
  const { prescreen } = await import("./magazine-bar.js");
  const metrics = await fetch(`${ctx.shimUrl}/image/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: body.image }),
  }).then(async (r) => (r.ok ? await r.json() as { whitespace: number; accent: number; busy: number; contrast: number } : null))
    .catch(() => null);
  return {
    image: body.image,
    ...(metrics ? { prescreen: prescreen(metrics, { n: page.n, type: page.type }) } : {}),
  };
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

export type Stage = "research" | "plan" | "write" | "fact-check" | "audit" | "design" | "art" | "build";

/**
 * The names callers use for a magazine's steps, and the spine stage each is.
 *
 * Only names now. The run itself is the shared pipeline's (`run` drives
 * `runStage` over `publicationExecutor`), so there is one account of where an
 * issue is — `pipeline.json` — and nothing to keep in agreement by hand. The
 * short names stay because the routes, the chat tool and the issue page say
 * "from: art, stopAt: build", and those are the words a person uses.
 *
 * `design` is the odd one. `runDesign` decides the issue's palette, type and
 * per-section worlds, and until now *nothing called it*: the stage existed in
 * the registry and in this file's own design code, and no run ever performed
 * it — which is why a finished issue could not be built (`build` refuses
 * without a design that passes `checkSpec`).
 */
export const SPINE_STAGE: Readonly<Record<Stage, string>> = {
  research: "content.research",
  plan: "content.plan",
  write: "content.write",
  "fact-check": "content.factcheck",
  audit: "content.audit",
  design: "design.artplan",
  art: "design.generate",
  build: "build.export",
};

/**
 * The order the magazine walks, which is the spine's order under its own names.
 *
 * `design` sits between the audit and the art: it reads finished copy, and
 * everything drawn afterwards is drawn to it.
 */
export const STAGE_ORDER: ReadonlyArray<Stage> =
  ["research", "plan", "write", "fact-check", "audit", "design", "art", "build"];

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
    issue.factCheck = { at: new Date().toISOString(), findings: [], checked: 0, searchedWith: [], complete: true };
    emit(ctx, "publication:stage", {
      id, stage: "fact-check", state: "done", checked: 0,
      message: "no search source configured — nothing was checked",
    });
    return save(ctx, issue);
  }

  const skipTypes = new Set(ctx.definition.factCheckSkipTypes ?? []);
  const prior = issue.factCheck;
  let findings: FactFinding[] = [...(prior?.findings ?? [])];
  const searchedWith = new Set<string>(prior?.searchedWith ?? []);
  // Only a result that says which page it covered can be resumed; one written
  // before that existed is checked again from the start.
  const pages: Record<string, { hash: string; checked: number }> = prior?.pages ? { ...prior.pages } : {};
  if (!prior?.pages) findings = [];
  const record = (complete: boolean) => {
    issue.factCheck = {
      at: new Date().toISOString(),
      findings,
      checked: Object.values(pages).reduce((n, p) => n + p.checked, 0),
      searchedWith: [...searchedWith],
      pages,
      complete,
    };
  };

  const live = new Set(issue.pages.map((p) => String(p.n)));
  for (const key of Object.keys(pages)) if (!live.has(key)) delete pages[key];
  findings = findings.filter((f) => live.has(f.where.replace(/^p/, "")));

  let done = 0;
  for (const page of issue.pages) {
    if (ctx.signal?.aborted) throw new PublicationStopped();
    const key = String(page.n);
    const where = `p${page.n}`;
    // The boxes carry most of a numbers page's figures, so they are checked
    // with the body rather than left out of it.
    const text = [page.deck, page.body, ...(page.furniture ?? []).map((f) => f.text)]
      .filter((t): t is string => !!t?.trim())
      .join("\n\n");
    const hash = createHash("sha1").update(text).digest("hex").slice(0, 16);
    done += 1;
    if (pages[key]?.hash === hash) continue;

    findings = findings.filter((f) => f.where !== where);
    if (!page.body?.trim() || skipTypes.has(page.type) || !worthChecking(text)) {
      pages[key] = { hash, checked: 0 };
    } else {
      const result = await factCheck({
        text,
        where,
        ask: (prompt, label) => ctx.ask(prompt, label),
        sources,
        onProgress: (message) => emit(ctx, "publication:stage", {
          id, stage: "fact-check", state: "progress", message,
        }),
      });
      findings.push(...result.findings);
      for (const s of result.searchedWith) searchedWith.add(s);
      pages[key] = { hash, checked: result.checked };
    }
    // Saved per page: a run that dies on page 15 keeps the fourteen before it,
    // and the next one starts where this stopped.
    record(false);
    await save(ctx, issue);
    emit(ctx, "publication:stage", {
      id, stage: "fact-check", state: "progress",
      message: `${done}/${issue.pages.length} pages checked`,
    });
  }

  record(true);
  const problems = findings.filter(isProblem).length;
  emit(ctx, "publication:stage", {
    id, stage: "fact-check", state: "done", checked: issue.factCheck!.checked, problems,
  });
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
    const found: PublicationFinding[] = [...auditPages(issue.pages, ctx.definition, issue)];
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
 * One stage of an issue, as the shared pipeline runs it (13 rev. C).
 *
 * The magazine used to walk its own loop beside the spine and tell the run file
 * what it had done after the fact. Its stages are now executors the shared
 * `runStage` performs, unit by unit, with the one bookkeeping every other
 * production has. A page is a unit; a stage that works on the whole issue —
 * research, plan, fact-check, audit, design, build — does its work on unit 1
 * and passes the rest, which is what one pass over an issue is in a run of
 * pages.
 *
 * Returns null for a stage this type does not perform here, so the shared loop
 * falls back to whatever is registered — and a skipped stage never asks.
 */
export function publicationExecutor(
  ctx: RunnerContext,
  stage: string,
  { redo = false }: { redo?: boolean } = {},
): StageExecutor | null {
  const def = ctx.definition;
  const whole = (work: (id: string) => Promise<unknown>): StageExecutor => async ({ id, unit }) => {
    if (unit === 1) await work(id);
    return { ok: true, artifacts: [] };
  };

  const table: Record<string, StageExecutor> = {
    "content.research": whole((id) => runResearch(ctx, id)),
    "content.plan": whole((id) => runPlan(ctx, id)),
    "content.write": async ({ id, unit }) => {
      const issue = await readIssue(ctx, id);
      const page = issue.pages.find((p) => p.n === unit);
      // A unit with no page is a flatplan that came back shorter than the run.
      if (page && (redo || page.body === null || page.body === undefined)) await writePage(ctx, id, unit);
      return { ok: true, artifacts: page ? [pagePath(ctx, id, page)] : [] };
    },
    "content.factcheck": whole(async (id) => { if (def.needsFactCheck) await runFactCheck(ctx, id); }),
    "content.audit": whole((id) => runAudit(ctx, id)),
    "design.artplan": whole(async (id) => { if (def.needsImages || def.needsPdf) await runDesign(ctx, id); }),
    "design.generate": async ({ id, unit }) => {
      if (!def.needsImages) return { ok: true, artifacts: [] };
      const issue = await readIssue(ctx, id);
      if (outstanding(issue, "art", redo).includes(unit)) await artPage(ctx, id, unit);
      return { ok: true, artifacts: [] };
    },
    "build.export": whole(async (id) => { if (def.needsPdf) await build(ctx, id); }),
  };
  const executor = table[stage];
  if (!executor) return null;
  // A stage that throws is a failed unit with its reason, which is what the
  // shared loop records and the strip shows.
  return async (sctx) => {
    try {
      return await executor(sctx);
    } catch (error) {
      return { ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** The runner's step name for a spine stage, for messages a person reads. */
const aliasOf = (stage: string): Stage =>
  ((Object.entries(SPINE_STAGE) as Array<[Stage, string]>).find(([, spine]) => spine === stage)?.[0])
  ?? "research";

/**
 * The whole pipeline, stopping where told.
 *
 * `stopAt` defaults to "write" because what comes next needs a human: art and
 * build both require the copy to be approved first.
 *
 * Driven by the shared `runStage`, against `pipeline.json` — the one account of
 * where the run is. A `from` earlier than where the run stands means "do that
 * again", and the run is walked back to it; later means "start there".
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
  const order: ReadonlyArray<Stage> = STAGE_ORDER;
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

  /*
   * The run is listed with every other piece of work in flight, from here,
   * because every caller comes through here: chat, the issue page's resume,
   * and the recurring-issue clock. Cancelling the job stops the run at its
   * next boundary, the same as the caller's own stop.
   */
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  ctx.signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (ctx.signal?.aborted) controller.abort();
  const job = trackJob({ ref: { type: "publication", id }, stage: order[start]!, controller });
  // The issue's title once research has given it one; its id before that.
  let named = (await readIssue(ctx, id).catch(() => null))?.title || id;
  const rename = async () => { named = (await readIssue(ctx, id).catch(() => null))?.title || named; };
  // What each stage says about itself ("searching: kodak roll film") goes to
  // the job too, so the rail says more than the name of the issue.
  const live: RunnerContext = {
    ...ctx,
    signal: controller.signal,
    onEvent: (event) => {
      ctx.onEvent?.(event);
      const said = (event as { message?: unknown }).message;
      if (typeof said === "string" && said.trim()) job.progress(`${named} · ${said.trim()}`);
    },
  };

  // Checked at every boundary rather than mid-stage: a page stopped halfway
  // through writing is a half-written page that the next run reads as done.
  const stopHere = (): void => {
    if (controller.signal.aborted) throw new PublicationStopped();
  };

  await setLastError(ctx, id, null);
  const ref = { type: "publication", id } as const;
  const where = { projectRoot: ctx.projectRoot, ref };
  const pipeline = pipelineFor("publication");
  if (!pipeline) throw new Error("publication does not run a pipeline");
  const sequence = stageSequence(pipeline);
  const at = (stage: string) => sequence.indexOf(stage);
  const first = SPINE_STAGE[order[start]!];
  const target = SPINE_STAGE[order[end]!];

  let running: Stage = order[start]!;
  try {
    // The run file exists from the first stage, not from the flatplan: research
    // is a stage of this run like any other. Sized to the extent asked for
    // until the plan says how many pages there really are.
    const issueNow = await readIssue(ctx, id);
    await ensurePipeline({ ...where, totalUnits: issueNow.pages.length || issueNow.extent || 1 });
    // A new run clears how the last one ended before anything else, so a run
    // stopped at once reads as stopped, not as the failure before it.
    const before = await loadPipeline(ctx.projectRoot, ref);
    // Idle is also how a brand-new run file starts; only a stopped one resumes.
    const stopped = before?.status === "idle" && before.history.some((h) => h.event === "run:cancelled");
    if (before?.status === "failed" || stopped) await resume(where);
    stopHere();
    const standing = (await loadPipeline(ctx.projectRoot, ref))?.stage ?? first;
    if (standing === "done" || at(standing) > at(first)) await rewindTo({ ...where, stage: first });
    else if (at(standing) < at(first)) await markStage({ ...where, stage: first });

    const executor = (stage: string) => publicationExecutor(live, stage, { redo });
    let stalls = 0;
    for (;;) {
      stopHere();
      const state = await loadPipeline(ctx.projectRoot, ref);
      if (!state || state.stage === "done" || at(state.stage) > at(target)) break;
      running = aliasOf(state.stage);
      await rename();
      job.progress(named, running);
      const paged = state.stage === "content.write" || state.stage === "design.generate";
      const out = await runStage({
        ...where,
        ...(ctx.shimUrl ? { shimUrl: ctx.shimUrl } : {}),
        signal: controller.signal,
        executor,
        onProgress: (message) => job.progress(`${named} · ${message}`),
        onUnit: (unit) => {
          if (paged) job.progress(`${named} · page ${unit} of ${state.units.total}`, running);
        },
      });
      stopHere();
      if (out.advanced) { stalls = 0; continue; }
      const after = await loadPipeline(ctx.projectRoot, ref);
      const failed = after?.units.failed.find((f) => f.unit !== 0);
      if (failed) throw new Error(failed.error);
      // A gate, or a stage whose units are all in but which has not moved on
      // yet: walking it on is the same step a finished unit takes.
      if (++stalls > 2) {
        throw new Error(`${running} did not finish: ${after?.units.done.length ?? 0} of ${after?.units.total ?? 0} done`);
      }
      await advance(where);
    }
    job.finish();
  } catch (error) {
    job.finish(error);
    const message = error instanceof Error ? error.message : String(error);
    // A Stop is recorded as one, so the strip does not paint it as a failure.
    await setLastError(ctx, id, {
      stage: running, message, ...(error instanceof PublicationStopped ? { stopped: true } : {}),
    });
    await tryTrack(() => error instanceof PublicationStopped
      ? pause(where)
      : reportUnitFailed({ ...where, failure: { unit: 0, error: `${running}: ${message}`, resumable: true } }));
    throw error;
  } finally {
    ctx.signal?.removeEventListener("abort", onOuterAbort);
  }
  return readIssue(ctx, id);
}
