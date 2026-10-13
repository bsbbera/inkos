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
import { replaceFile } from "../utils/replace-file.js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
import { cleanBlocks, placedBlocks, type PageBlock } from "./page-blocks.js";
import type { PageLayout } from "./publication-design.js";
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
  pageBlockers,
  type DesignSpec,
} from "./publication-design.js";
import { goldenRules, readMath, repairGoldenRules } from "./design-rules.js";
import { GRID_SYSTEMS, applyHouse, houseBlock, houseInForce } from "./house.js";
import { brandBlock, brandHouse, brandLanguage, holdBrandSpec, loadBrand, offBrandColours, pairOf, placeOf, selectedBrand, type Brand } from "./brand.js";
import { LANGUAGE_GUIDE, holdLanguage, type Language } from "./visual-language.js";
import { holdShapes, pageArtPrompt } from "./page-art.js";
import { imageStyleOf, issueLook, lookOf, type IssueLook } from "./looks.js";
import { checkComposition, composePrompt, compositionSummary, layoutOf, slotManifest, type ComposedPage, type PageSetting } from "./composition.js";
import { layoutOfPlan, planPage, rerank, type Arrangement } from "./page-plan.js";


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
  /** Legacy: the art style a world was picked from before sections wrote their own language. */
  style?: string;
  /** The section's own colours, panels and motif, written from its copy (visual-language.ts). */
  language?: Language;
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
  /** Held to a brand (brand.ts): its colours are the brand's, its register is the brand's own. */
  brand?: string;
  /** The brand's two section colours this section is made of, by name. */
  pair?: [string, string];
  /** The brand signature that leads the section. */
  lead?: string;
  /** The section's name in Bengali, set beside its English eyebrow. */
  bn?: string;
}

export interface PublicationDesign {
  sections: DesignWorld[];
  fixed?: {
    folio?: string; trim?: string; grid?: string; divider?: string;
    /** The masthead the wordmark and running head set: the house's name. */
    masthead?: string;
    /** Legacy house panel style; panels now come from each section's language. */
    panel?: string;
    /** The house's rule style (house.ts). */
    rule?: string;
    /** Brand furniture placed on every page built from blocks (runhead, rule, folio). */
    blocks?: PageBlock[];
  };
  /** What the design stage decided: the one source both renderers read. */
  spec?: DesignSpec | null;
  /** The issue's design direction, written by the model from the copy (plan 27). */
  direction?: string;
  /** What the composer and illustrator reported during the last design run. */
  notes?: string[];
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
  /** The extent asked for, when the type's rules changed it (a magazine is 16 to 64). */
  extentAsked?: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  /** Images the user attached at intake, for the design stage. */
  referenceImages?: string[];
  /** The look the editor chose for this issue (looks.ts); none chosen imposes none. */
  look?: IssueLook | null;
  /** The brand this work is held to (brand.ts, core/brands/<id>); none: it invents its own. */
  brand?: string | null;
  research: Record<string, unknown> | null;
  /** The connection web, once research has found enough to draw it. */
  web?: IssueWeb | null;
  sections: PublicationSection[];
  pages: PublicationPage[];
  design?: PublicationDesign | null;
  /**
   * How many designs the design stage makes for the editor to choose among at
   * the design gate (1 when unset). One creation, several looks: a second look
   * is an option of this issue, never a copy of it.
   */
  designCount?: number;
  /** The designs the stage made, when it made more than one; `design` is the chosen one. */
  designOptions?: PublicationDesign[];
  /** Which of `designOptions` is `design`. */
  designChoice?: number;
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
  /**
   * The section board (13 §2, §4b): a section the editor kept, or locked so
   * no re-world and no design run changes its world. Keyed by section number.
   */
  sectionBoard?: Record<string, { state: "approved" | "locked"; at: string }>;
}

/** Parsed JSON from the model. The caller owns the provider and the transport. */
/** `images`: files the model is shown with the prompt (a rendered page it judges). */
export type AskFn = (prompt: string, tag: string, opts?: { readonly images?: ReadonlyArray<string> }) => Promise<Record<string, unknown>>;

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
export const issueDir = dirOf;
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
let saves = 0;

async function save(ctx: RunnerContext, issue: PublicationIssue): Promise<PublicationIssue> {
  issue.updatedAt = new Date().toISOString();
  validateIssue(issue, issue.id);

  await mkdir(dirOf(ctx, issue.id), { recursive: true });
  const target = fileOf(ctx, issue.id);
  // One temp per write: two saves in flight shared `<pid>.tmp` and raced.
  const temp = `${target}.${process.pid}.${++saves}.tmp`;
  await writeFile(temp, JSON.stringify(issue, null, 2), "utf-8");
  await replaceFile(temp, target);

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
  // Said, not silent: 8 asked for and 16 made read as a miscount.
  const asked = Number(args.extent) || 0;

  return save(ctx, {
    id,
    type: def.id,
    series: args.series || slug(args.subject),
    subject: args.subject,
    angle: args.angle ?? "",
    title: "",
    thesis: "",
    extent,
    ...(asked && asked !== extent ? { extentAsked: asked } : {}),
    status: "new",
    createdAt: new Date().toISOString(),
    // The workspace's selected brand (the Brand page); the issue can still be moved off it.
    brand: selectedBrand(ctx.projectRoot),
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
  if (issue.brand) next.brand = issue.brand;
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

/**
 * The same approved copy, to be designed again in another design language.
 *
 * The copy, its research and its approval come along; the design, its art,
 * the build and the editor's visual notes do not, because they are the language. The fork's design stage
 * reads the workspace's other designs (`recentBlock`) and so does not repeat
 * this one. The original is not touched.
 */
export async function forkIssue(ctx: RunnerContext, id: string): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  let k = 2;
  while (existsSync(dirOf(ctx, `${id}--l${k}`))) k++;
  const forkId = `${id}--l${k}`;
  const from = dirOf(ctx, id), to = dirOf(ctx, forkId);
  await mkdir(join(to, "pages"), { recursive: true });
  for (const f of ["research-cache.json", "memory.db"]) {
    if (existsSync(join(from, f))) await writeFile(join(to, f), await readFile(join(from, f)));
  }
  for (const f of await readdir(join(from, "pages")).catch(() => [] as string[])) {
    if (f.endsWith(".md")) await writeFile(join(to, "pages", f), await readFile(join(from, "pages", f)));
  }
  // The editor's notes and reference pictures pin the original's look (Rain's said "kraft, #D9693A"):
  // a fork made for another language that kept them came back in the same colours.
  const { design: _d, designOptions: _o, designChoice: _c, designApproved: _a, build: _b, sectionBoard: _s, lastError: _e, notes: _n, referenceImages: _r, ...kept } = issue;
  const fork: PublicationIssue = {
    ...kept,
    id: forkId,
    status: "approved",
    createdAt: new Date().toISOString(),
    // The pictures are drawn in the language; the briefs (what they show) are content and stay.
    pages: issue.pages.map(({ image: _i, images: _is, ...p }) => p as PublicationPage),
  };
  return save(ctx, fork);
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
    if (w.brand) { /* the brand's own register: held by brand.ts, not the 50 */ }
    else if (!reg) bad.push(`s${w.n}: "${w.register}" is not one of the 50`);
    else if (reg.tier !== 1) {
      bad.push(`s${w.n}: ${reg.name} is tier ${reg.tier} - only a tier 1 system may run a section`);
    } else if (reg.screenOnly) {
      bad.push(`s${w.n}: ${reg.name} is a screen register and leaves no legible ink on paper`);
    }

    if (w.technique && !w.brand) {
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
  const worlds = [...(issue.design?.sections ?? [])].sort((a, b) => a.n - b.n);
  const section = (issue.sections ?? []).find((s) => n >= s.from && n <= s.to);
  if (section) return worlds.find((w) => w.n === section.n) ?? null;
  // Front matter wears the first section's world and back matter the last's:
  // a cover with no world fell back to the toolkit's tint and came out grey.
  if (!worlds.length) return null;
  const first = Math.min(...(issue.sections ?? []).map((s) => s.from));
  return n < first ? worlds[0]! : worlds[worlds.length - 1]!;
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

/** The brand's bilingual blocks (bilingualLine), kept whatever the archetype allows: at most one of each. */
function bilingualBlocks(issue: PublicationIssue, raw: unknown): NonNullable<PublicationPage["furniture"]> {
  if (!issue.brand || !Array.isArray(raw)) return [];
  const out: NonNullable<PublicationPage["furniture"]> = [];
  for (const kind of ["wordbox", "bengali-line"]) {
    const f = raw.find((x) => x && typeof x === "object" && (x as { kind?: unknown }).kind === kind) as { text?: unknown } | undefined;
    const text = String(f?.text ?? "").trim();
    if (text && /[ঀ-৿]/.test(text) && text.includes("|")) out.push({ kind, text: text.slice(0, 300) } as NonNullable<PublicationPage["furniture"]>[number]);
  }
  return out;
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
    signatureLine: [signature[page.type] ?? "", bilingualLine(issue, page)].filter(Boolean).join("\n"),
  };
}

/** Under a brand with a bilingual rule (brand.ts): the Bengali this page carries, beside its English. */
function bilingualLine(issue: PublicationIssue, page: PublicationPage): string {
  const brand = loadBrand(issue.brand);
  if (!brand) return "";
  const lastOfSection = (issue.sections ?? []).some((s) => s.to === page.n);
  return [
    `THIS PAGE IS ${brand.name.toUpperCase()} (${brand.mark}): ${String(brand.bilingual.split ?? "")}`,
    "Write the body, deck and title in English. Then add, as furniture (they are always allowed):",
    `- {"kind":"wordbox","text":"<one Bengali word> | <how it sounds, in Latin letters> | <what it means, under 18 words>"} when this page's idea has a Bengali word that names it better than English (at most one; features only).`,
    lastOfSection || page.type === "cover" || page.type === "opener"
      ? `- {"kind":"bengali-line","text":"<one line of Bengali, from a real Bengali source when quoted> | <its English>"}: this page ${lastOfSection ? "closes its story" : "opens"}, so it carries the story's one Bengali line.`
      : "",
    "Bengali is never a translation of the English beside it, and never more than one line.",
  ].filter(Boolean).join("\n");
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
    furniture: [...(keepAllowedBlocks(def, page.type, out.furniture) ?? []), ...bilingualBlocks(issue, out.furniture)],
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
  // The last page in says so; otherwise a finished issue reads "writing" for as long as it sits.
  issue.status = issue.pages.every((p) => p.body !== null && p.body !== undefined) ? "written" : "writing";
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
/** Pixels for a picture of this aspect at about the area the renderer draws best (1.5 MP), in steps of 64. */
export function sizeForFrame(aspect: number): { width: number; height: number } {
  // Within 1:2 and 2.4:1: past that the renderer repeats its subject down a strip (Birds p12
  // drew the same two feathers twice at 0.32). A narrower frame crops the middle of it.
  const a = Math.min(2.4, Math.max(0.5, aspect || 1));
  const step = (v: number) => Math.max(512, Math.round(v / 64) * 64);
  return { width: step(Math.sqrt(1536 * 1024 * a)), height: step(Math.sqrt(1536 * 1024 / a)) };
}

/** How a picture's frame sits on the page, in words the renderer acts on. */
export function placementOf(f: { x: number; y: number; w: number; h: number }): string {
  const a = f.w / f.h;
  const shape = a < 0.8 ? "A tall upright composition" : a > 1.4 ? "A wide composition" : "A square composition";
  const face = f.x < 1 && f.x + f.w < 200 ? ", the subject facing right, into the page"
    : f.x + f.w > 209 && f.x > 10 ? ", the subject facing left, into the page" : ", the subject centred";
  return `${shape}${face}, whole and uncropped.`;
}

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
  { redo = false, from }: {
    readonly redo?: boolean;
    /**
     * A picture already made (another page's, the gallery's, an earlier render) to use
     * for this page's first picture instead of drawing a new one. Only its treatment is
     * run on it: the editor kept the Birds gouaches and asked for no new generation.
     */
    readonly from?: string;
  } = {},
): Promise<PublicationPage> {
  const def = ctx.definition;
  if (!def.needsImages) throw new Error(`${def.label} does not use generated images`);
  if (from && !existsSync(from)) throw new Error(`no picture at ${from}`);

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

  // A redo asked for one page draws its pictures again; the stage resumes what it has.
  const done = redo || from ? [] : [...(page.images ?? [])];
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
    const frame = (issue.design?.spec?.pages?.[String(page.n)]?.blocks ?? [])
      .filter((b) => b.kind === "image" && b.box)[i]?.box;
    const frameSize = frame ? sizeForFrame(frame.w / frame.h) : null;
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
    // A picture in a frame short of the whole page shares the paper with the type.
    // It keeps its painted ground, as a plate: a cutout of a gouache bird on cream was never
    // clean (Birds), so the page is drawn round the plate in its ground's colour and grain
    // (shim postprocess `ground`, affinity `held`) and the plate's edge disappears into it.
    const sharesPaper = !!frame && (frame.w < 205 || frame.h < 290);
    const treatment = (sharesPaper ? "plate" : brief.treatment)
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
    // Where the picture stands, so the subject faces into the page and fills its frame's
    // shape: told nothing, the Birds hornbill on the left edge faced off the page.
    const placement = frame ? placementOf(frame) : "";
    const composed = composeImagePrompt({
      type: "publication", prompt: placement ? `${brief.prompt} ${placement}` : brief.prompt, world, treatment, surface,
      ...(ground ? { ground } : {}),
    });
    const post = postProcessFor(treatment, {
      paper: section?.paper, ink: section?.ink, hue: section?.hue,
      ...(ground ? { ground } : {}),
    });
    if (from && i === 0) {
      // The kept original is the picture given; the treatment is run on it by the shim,
      // which writes only inside the workspace.
      const { copyFile } = await import("node:fs/promises");
      await mkdir(join(dirname(outFile), ".raw"), { recursive: true });
      await copyFile(from, join(dirname(outFile), ".raw", basename(outFile)));
      await copyFile(from, outFile);
      const treated = await fetch(`${ctx.shimUrl}/image/post`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: outFile, ops: post }),
      }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) })) as { ok?: boolean; error?: string; applied?: unknown[] };
      if (treated.ok === false) throw new Error(`art p${page.n}: the picture from ${from} could not be treated (${treated.error})`);
      await writeFile(outFile.replace(/\.png$/i, ".recipe.json"), JSON.stringify({
        type: "publication", id, unit: page.n, slot: `p${page.n}${suffix}`, treatment,
        ...(section ? { section: section.n } : {}), reused: from, postProcess: treated.applied ?? [], at: new Date().toISOString(),
      }, null, 2) + "\n", "utf-8");
      done[i] = outFile;
      continue;
    }

    const res = await fetch(`${ctx.shimUrl}/image/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: composed.prompt,
        negative: composed.negative,
        // At the shape of the frame it fills, when the plan gave it one: a landscape picture
        // cropped into a tall side frame loses its subject, contained it leaves bands.
        ...(frameSize ?? {
          width: square ? 1280 : portrait ? 1024 : 1536,
          height: square ? 1280 : portrait ? 1536 : 1024,
        }),
        outFile,
        // A magazine picture is a one-off on its own page: no recurring cast to
        // keep steady, so it is the one surface a hosted engine may draw
        // (23 §3.3). The router still decides — this only says nothing blocks it.
        surface,
        // The world's technique picks a style LoRA when one is installed
        // (09 §2B). It was never sent, so no LoRA could ever be chosen.
        ...(world.technique ? { technique: world.technique } : {}),
        needs: [],
        post,
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
        : ", no image")
      + (p.body ? `\n   opens: ${p.body.replace(/[#*_>]/g, "").replace(/\s+/g, " ").slice(0, 420)}` : "");
  }).join("\n");
}

/**
 * The sections, for the design prompt to give each its own world.
 *
 * `DesignWorld` and `design.sections` existed and nothing wrote them, so every
 * section of every issue was drawn in one look and `worldFor` answered null.
 */
/** Exported for the test that asserts the prompt offers the law's own catalogue. */
export function sectionBlockFor(issue: PublicationIssue, house?: string, brand?: Brand | null): string {
  return sectionBlock(issue, house, brand);
}

function sectionBlock(issue: PublicationIssue, house?: string, brand?: Brand | null): string {
  const sections = issue.sections ?? [];
  // A brand fixes colour, faces and pictures; a section chooses its pair and its lead signature.
  if (brand) {
    return [
      "",
      house ?? "",
      "",
      sections.length ? `SECTIONS. Each chooses inside the ${brand.name} brand:` : "",
      ...sections.map((s) => `s${s.n} "${s.label}" (pages ${s.from}-${s.to}): ${s.question}`),
      sections.length ? `For each section give: n, bn (its name in Bengali, two or three words, for the eyebrow), pair (two of ${brand.sectionColours.join(", ")}, the main one first), lead (one of ${Object.keys(brand.shapes).join(", ")}), idiom (in the brand's vocabulary: which of its shapes, how its panels are edged, what its devices are), and language.motif (one or two sentences: what this section's drawn art is built from, using the brand's shapes). Colours, faces, panel style and pictures are the brand's and are filled in for you.` : "",
      "",
      ...brandDesignLines(issue).filter((l) => !/colour|Colour/.test(l)),
    ].join("\n");
  }
  // With a house in force the house speaks: fixed type and colours, and worlds
  // picked from its art styles rather than invented (house.ts, Phase 7).
  if (house) {
    return [
      "",
      house,
      "",
      sections.length ? "SECTIONS. Each gets its own world and its own language, sharing the house's type and folio:" : "",
      ...sections.map((s) => `s${s.n} "${s.label}" (pages ${s.from}-${s.to}): ${s.question}`),
      sections.length ? `Registers to choose from, spelled exactly: ${styles.registers().map((r) => r.name).join(", ")}.` : "",
      sections.length ? `Figure techniques to choose from, spelled exactly: ${styles.techniques().map((t) => t.name).join(", ")}.` : "",
      sections.length ? "For each section give: register, technique, idiom (a named visual idiom in your own words), language, imagePrompt (how its pictures look, no single subject) and negative." : "",
      sections.length ? LANGUAGE_GUIDE : "",
      "",
      ...brandDesignLines(issue),
    ].join("\n");
  }
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
    "idiom (a named visual idiom of your own words), language, imagePrompt",
    "(how every image in that section looks, no single subject) and negative (what",
    "those images must avoid). No two sections may share a register.",
    LANGUAGE_GUIDE,
    "",
    ...brandDesignLines(issue),
  ].join("\n");
}

/**
 * The faces the art director may choose from: the ones Affinity has (font
 * preflight, Phase 5). Without the list a design names fonts this machine
 * does not have, and the build quietly sets everything in the house face.
 */
/** The faces Affinity has, or null when the shim cannot say. */
async function installedFonts(ctx: RunnerContext): Promise<string[] | null> {
  if (!ctx.shimUrl) return null;
  try {
    const res = await fetch(`${ctx.shimUrl}/affinity/fonts`, { signal: AbortSignal.timeout(60_000) });
    const out = await res.json() as { fonts?: string[] };
    return res.ok && out.fonts?.length ? out.fonts : null;
  } catch {
    return null;
  }
}

async function fontBlock(ctx: RunnerContext): Promise<string> {
  if (!ctx.shimUrl) return "";
  try {
    const listed = await installedFonts(ctx);
    if (!listed) return "";
    const fonts = [...listed];
    for (let i = fonts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [fonts[i], fonts[j]] = [fonts[j]!, fonts[i]!]; }
    return `
INSTALLED FONTS (in no order). type.display and type.text must each be one of these, spelled exactly:
${fonts.join(", ")}
`;
  } catch {
    return "";
  }
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
    "- The folio, the running head and the grid. Colour is NOT a constant: each section's language owns it.",
    web?.accent
      ? `- The centre's own colour is ${web.accent.name} ${web.accent.hex}: let it appear in every section's`
        + " language, as accent or second."
      : "",
    web?.motif
      ? `- The motif is ${web.motif}. Put it in fixed.divider, and let every section's imagePrompt`
        + " carry it in a small way, so the issue reads as one object."
      : "",
  ].filter(Boolean).concat("");
}

/** The model's section worlds, kept only where they name a real section. */
function worldsFrom(raw: unknown, issue: PublicationIssue, spec: DesignSpec, notes: string[] = []): DesignWorld[] {
  const known = new Set((issue.sections ?? []).map((s) => s.n));
  const hex = (v: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(String(v ?? "")) ? String(v) : fallback);
  // The language is held to print here; a colour it had to move is said.
  const speak = (w: DesignWorld, raw: unknown): DesignWorld => {
    if (!raw || typeof raw !== "object") return w;
    const { language, notes: said } = holdLanguage(raw, { paper: w.paper, ink: w.ink, accent: w.hue ?? spec?.palette?.accent ?? "#b03a2e" });
    notes.push(...said.map((x) => `s${w.n}: ${x}`));
    return { ...w, paper: language.paper, ink: language.ink, hue: language.accent, field: language.field, language };
  };
  return (Array.isArray(raw) ? raw : [])
    .filter((w): w is Record<string, unknown> => !!w && typeof w === "object" && known.has(Number(w.n)))
    .map((w) => speak({
      n: Number(w.n),
      ...(w.style ? { style: String(w.style) } : {}),
      register: String(w.register ?? w.technique ?? ""),
      ...(w.technique ? { technique: String(w.technique) } : {}),
      idiom: String(w.idiom ?? ""),
      paper: hex(w.paper, spec?.palette?.paper ?? "#ffffff"),
      ink: hex(w.ink, spec?.palette?.ink ?? "#111111"),
      ...(w.hue ? { hue: hex(w.hue, spec?.palette?.accent ?? "") } : {}),
      ...(w.imagePrompt ? { imagePrompt: String(w.imagePrompt) } : {}),
      ...(w.negative ? { negative: String(w.negative) } : {}),
    }, w.language));
}

/** A section world held to the brand: its pair and lead from the model, every colour the brand's. */
function brandWorld(brand: Brand, w: DesignWorld, raw: unknown): DesignWorld {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lang = (r.language && typeof r.language === "object" ? r.language : {}) as Record<string, unknown>;
  const pair = pairOf(brand, r.pair, [w.hue, w.language?.accent, w.language?.second, String(lang.accent ?? ""), String(lang.second ?? "")].filter((v): v is string => !!v));
  const language = brandLanguage(brand, pair, w.language ?? null);
  const lead = Object.keys(brand.shapes).includes(String(r.lead ?? "")) ? String(r.lead) : "panel";
  const { technique: _t, ...rest } = w;
  return {
    ...rest, brand: brand.id, pair, lead, language,
    ...(/[ঀ-৿]/.test(String(r.bn ?? "")) ? { bn: String(r.bn).slice(0, 40) } : {}),
    register: `${brand.name} · ${pair.join(" + ")}`,
    idiom: w.idiom || `${brand.name} ${lead}`,
    paper: language.paper, ink: language.ink, hue: language.accent, field: language.field,
    imagePrompt: brand.imageStyle.style, negative: brand.imageStyle.negative,
  };
}

/**
 * Draw every laid page's art: one model call per page, given its copy, its
 * section's language and where its type sits (page-art.ts). A page whose call
 * fails keeps no shapes and the shim draws its fallback generator, said.
 */
async function drawArt(
  ctx: RunnerContext, issue: PublicationIssue, spec: DesignSpec, worlds: DesignWorld[], only?: readonly number[],
  direction?: string,
  note?: string,
): Promise<{ spec: DesignSpec; notes: string[] }> {
  type Box = { x: number; y: number; w: number; h: number };
  const withWorlds = { ...issue, design: { ...(issue.design ?? {}), sections: worlds } } as PublicationIssue;
  // A planned page's art is its picture, in an image slot. Rain's pages were composed
  // with drawn areas only, so the pictures the art stage made never printed.
  const pages = issue.pages.filter((p) => (!only || only.includes(p.n)) && spec.pages?.[String(p.n)]?.blocks?.length && !spec.pages?.[String(p.n)]?.plan);
  const next: Record<string, PageLayout> = { ...spec.pages };
  const notes: string[] = [];
  const sectionOf = (n: number) => (issue.sections ?? []).find((s) => n >= s.from && n <= s.to)?.label;
  const brand = loadBrand(issue.brand);
  const placeFor = (p: PublicationIssue["pages"][number]) =>
    placeOf(p.type ?? "", (issue.sections ?? []).some((s) => s.to === p.n));
  const one = async (p: PublicationIssue["pages"][number]) => {
    const l = next[String(p.n)]!;
    const language = worldFor(withWorlds, p.n)?.language;
    if (!language) { notes.push(`p${p.n}: its section has no language, so the fallback art is drawn`); return; }
    const boxed = (l.blocks ?? []).filter((b): b is PageBlock & { box: Box } => !!(b as { box?: Box }).box);
    const art = boxed.filter((b) => b.kind === "drawn" || b.kind === "image").map((b) => b.box);
    const type = boxed.filter((b) => !["drawn", "image", "rule"].includes(b.kind)).map((b) => ({ kind: b.kind, box: b.box }));
    try {
      const out = await ctx.ask(pageArtPrompt({
        title: p.title ?? "", deck: p.deck, body: p.body ?? "", type: p.type, language,
        ...(sectionOf(p.n) ? { section: sectionOf(p.n)! } : {}), art, blocks: type,
        ...(direction ? { direction } : {}),
        ...(l.reading ? { reading: l.reading } : {}),
        ...(l.composed?.idea ? { idea: l.composed.idea } : {}),
        ...(note ? { note } : {}),
        ...(brand ? { brand: { brand, place: placeFor(p) } } : {}),
      }), "design-art") as Record<string, unknown>;
      const held: string[] = [];
      const shapes = holdShapes(out, type, brand ? { brand, place: placeFor(p), notes: held } : undefined);
      if (held.length) notes.push(`p${p.n}: ${held.join("; ")}`);
      if (!shapes.length) { notes.push(`p${p.n}: the art came back with no shapes it could draw`); return; }
      next[String(p.n)] = { ...l, shapes, ...(typeof out.idea === "string" ? { artIdea: out.idea.slice(0, 200) } : {}) };
    } catch (e) {
      notes.push(`p${p.n}: the art call failed (${e instanceof Error ? e.message : String(e)})`);
    }
  };
  // Three at a time: each is a full model call, and one issue is a few dozen pages.
  for (let i = 0; i < pages.length; i += 3) {
    if (ctx.signal?.aborted) throw new PublicationStopped();
    await Promise.all(pages.slice(i, i + 3).map(one));
  }
  return { spec: { ...spec, pages: next }, notes };
}

/** The model's direction object, as the one text every later call is given. */
function directionOf(raw: unknown): string {
  if (typeof raw === "string") return raw.trim().slice(0, 3000);
  if (!raw || typeof raw !== "object") return "";
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => `- ${k}: ${String(v).trim()}`).join("\n").slice(0, 3000);
}

const fingerprintsFile = (ctx: RunnerContext) => join(ctx.projectRoot, "_taste", "design-fingerprints.jsonl");

/**
 * What other creations already look like, so this one is not drawn the same
 * way (plan 27, Phase 13): the type pair, colours, grid and direction of the
 * last few designs in the workspace, this issue's own earlier ones left out.
 */
async function recentBlock(ctx: RunnerContext, id: string): Promise<string> {
  const lines = await readFile(fingerprintsFile(ctx), "utf-8").then((t) => t.split("\n").filter(Boolean)).catch(() => [] as string[]);
  const seen = new Map<string, Record<string, any>>();
  for (const l of lines) { try { const f = JSON.parse(l); if (f.id !== id) { seen.delete(f.id); seen.set(f.id, f); } } catch { /* a torn line */ } }
  const recent = [...seen.values()].slice(-6);
  if (!recent.length) return "";
  // A design kept before worlds were fingerprinted is read for them, from the issue itself.
  for (const f of recent) {
    if (!f.worlds) f.worlds = await readIssue(ctx, f.id).then((i) => (i.design?.sections ?? []).map((w) => `${w.register} / ${w.technique}`).join(" | ")).catch(() => "");
  }
  return [
    "",
    "OTHER CREATIONS IN THIS WORKSPACE ALREADY LOOK LIKE THIS. This one must not repeat their type pair,",
    "their colours, their direction, or any of their worlds' registers - every section takes a register none of them used:",
    ...recent.map((f) => `- "${f.title}": ${f.fonts}; colours ${f.colours}; grid ${f.system};${f.worlds ? ` worlds ${f.worlds};` : ""} ${String(f.composition ?? "").slice(0, 220)}`),
    "",
  ].join("\n");
}

async function keepFingerprint(ctx: RunnerContext, issue: PublicationIssue, spec: DesignSpec, worlds: DesignWorld[], direction: string): Promise<void> {
  const { appendFile } = await import("node:fs/promises");
  await mkdir(dirname(fingerprintsFile(ctx)), { recursive: true });
  const line = {
    id: issue.id, at: new Date().toISOString(), title: issue.title || issue.subject,
    fonts: `${spec.type?.display} / ${spec.type?.text}`, system: spec.grid?.system ?? "columns",
    worlds: worlds.map((w) => `${w.register} / ${w.technique}`).join(" | "),
    colours: (worlds.length ? worlds.map((w) => [w.paper, w.hue, w.language?.second].filter(Boolean).join(" ")) : [spec.palette?.paper, spec.palette?.accent]).join(" | "),
    composition: /composition: ([^\n]*)/.exec(direction)?.[1] ?? direction.slice(0, 220),
  };
  await appendFile(fingerprintsFile(ctx), JSON.stringify(line) + "\n", "utf-8").catch(() => undefined);
}

/** Every picture slot of the issue, for ComfyUI later: `<issue>/slots.json` (plan 27, Phase 15). */
async function writeSlots(ctx: RunnerContext, issue: PublicationIssue): Promise<void> {
  const spec = issue.design?.spec;
  if (!spec) return;
  const slots = slotManifest(spec, (n) => worldFor(issue, n));
  await writeFile(join(dirOf(ctx, issue.id), "slots.json"), JSON.stringify({ issue: issue.id, slots }, null, 2) + "\n", "utf-8");
}

/** The colours and furniture words the builder will set on page n, so the checks read what prints. */
export function pageSetting(issue: PublicationIssue, spec: DesignSpec, n: number): PageSetting | undefined {
  const w = worldFor(issue, n);
  const paper = w?.paper ?? spec.palette?.paper, ink = w?.ink ?? spec.palette?.ink;
  if (!paper || !ink) return undefined;
  const runhead = [issue.design?.fixed?.masthead || issue.series || "", issue.title || ""].filter(Boolean).join(" — ");
  const section = (issue.sections ?? []).find((s) => n >= s.from && n <= s.to)?.label;
  return {
    paper, ink, field: w?.field ?? paper, accent: spec.palette?.accent ?? w?.hue ?? ink, runhead, ...(section ? { section } : {}),
    // The chosen look's numbers; with no look chosen nothing is limited.
    ...(issue.look?.extras != null ? { extras: issue.look.extras } : {}),
    ...(issue.look?.layers ? { layers: true } : {}),
  };
}

/**
 * What the planner needs of a page's picture: its width:height and the edges that cut its
 * subject. A plate measured by the art stage (postprocess `ground`) gives its subject's box,
 * with a margin, and its cut edges: the Birds kingfisher is a 0.32 picture of a nearly square
 * bird cut at the right. Else the picture's pixels (a PNG's header), else its brief's
 * orientation, else nothing.
 */
export async function pictureFacts(page: PublicationPage): Promise<{ aspect?: number; cut?: string[] }> {
  const file = page.images?.[0] ?? page.image;
  if (file && existsSync(file)) {
    const recipe = await readFile(file.replace(/\.png$/i, ".recipe.json"), "utf-8").then((t) => JSON.parse(t) as { postProcess?: Array<Record<string, unknown>> }).catch(() => null);
    const m = recipe?.postProcess?.find((x) => x.op === "ground");
    const head = await readFile(file).then((b) => b.subarray(0, 24)).catch(() => null);
    if (head && head.length >= 24 && head.toString("ascii", 12, 16) === "IHDR") {
      const w = head.readUInt32BE(16), h = head.readUInt32BE(20);
      const box = Array.isArray(m?.subject) ? m!.subject as number[] : null;
      const cut = Array.isArray(m?.cut) ? (m!.cut as string[]) : [];
      if (box && box.length === 4 && w > 0 && h > 0) {
        // The subject with a margin on every side the picture does not cut.
        const mx = (box[2]! - box[0]!) * 0.08, my = (box[3]! - box[1]!) * 0.08;
        const bw = (box[2]! - box[0]! + (cut.includes("left") ? 0 : mx) + (cut.includes("right") ? 0 : mx)) * w;
        const bh = (box[3]! - box[1]! + (cut.includes("top") ? 0 : my) + (cut.includes("bottom") ? 0 : my)) * h;
        return { aspect: bw / bh, cut };
      }
      if (w > 0 && h > 0) return { aspect: w / h };
    }
  }
  const o = briefsOf(page)[0]?.orientation;
  return { aspect: o === "portrait" ? 2 / 3 : o === "square" ? 1 : o === "landscape" ? 3 / 2 : undefined };
}


/** "head 0.618 / pull" -> "head". */
const arrangementOf = (plan?: string): Arrangement | undefined => {
  const a = plan?.split(" ")[0];
  return a === "head" || a === "foot" || a === "side" || a === "type" ? a : undefined;
};

/**
 * The visual loop's next move (page-score-run.ts): the best arrangement of the
 * page not tried yet, ranked again for what its proof was found to lack. No
 * model call, so a round costs a layout and a look, not a recomposition. False
 * when every arrangement has been tried.
 */
export async function replanPage(
  ctx: RunnerContext, id: string, n: number, tried: ReadonlySet<string>, faults: readonly string[],
): Promise<string | null> {
  const issue = await readIssue(ctx, id);
  const spec = issue.design?.spec;
  const page = issue.pages.find((p) => p.n === n);
  if (!spec || !page) return null;
  const previous = arrangementOf(spec.pages?.[String(n - 1)]?.plan);
  const setting = pageSetting(issue, spec, n);
  const facts = await pictureFacts(page);
  const ranked = rerank(planPage(page, spec, { ...(previous ? { previous } : {}), shows: briefsOf(page)[0]?.prompt ?? page.title ?? "", ...(setting ? { setting } : {}), ...facts }), faults);
  const pick = ranked.find((c) => !tried.has(c.id) && !c.composed.problems.length);
  if (!pick) return null;
  const before = spec.pages?.[String(n)];
  issue.design = { ...(issue.design ?? { sections: [] }), spec: { ...spec, pages: { ...spec.pages, [String(n)]: layoutOfPlan(pick, spec, n, before, setting) } } };
  await save(ctx, issue);
  return pick.id;
}

/**
 * Compose pages on the grid, one model call each (composition.ts): the model
 * places the frames, code checks them, and what is wrong goes back for at most
 * two repairs. Pages go in order so each one sees how its neighbours were built.
 * ponytail: sequential, one page at a time; parallel by section if long issues get slow.
 */
async function composePages(
  ctx: RunnerContext, issue: PublicationIssue, spec: DesignSpec, direction: string,
  opts: { only?: readonly number[]; note?: string; rules?: readonly string[]; reviewed?: boolean } = {},
): Promise<{ spec: DesignSpec; notes: string[] }> {
  const next: Record<string, PageLayout> = { ...spec.pages };
  const notes: string[] = [];
  const settingOf = (n: number) => pageSetting(issue, spec, n);
  /*
   * The page planned by arithmetic (page-plan.ts) unless the spec asks for the
   * model's composition, or an editor's note asks for something only words can
   * say. The model composer took about eighteen calls a design and left holes;
   * the plan takes none and sizes every frame to its copy.
   */
  if (spec.composer !== "model" && !opts.note) {
    let previous: Arrangement | undefined;
    for (const p of [...issue.pages].sort((a, b) => a.n - b.n)) {
      const before = next[String(p.n)];
      if (opts.only && !opts.only.includes(p.n)) { previous = arrangementOf(before?.plan); continue; }
      const setting = settingOf(p.n);
      const facts = await pictureFacts(p);
      const [best] = planPage(p, spec, { ...(previous ? { previous } : {}), shows: briefsOf(p)[0]?.prompt ?? p.title ?? "", ...(setting ? { setting } : {}), ...facts });
      if (!best) throw new Error(`page ${p.n} could not be planned: no arrangement on this grid holds its copy`);
      if (best.composed.problems.length) notes.push(`p${p.n} planned as ${best.id} still has: ${best.composed.problems.join("; ")}`);
      next[String(p.n)] = layoutOfPlan(best, spec, p.n, before, setting);
      previous = best.arrangement;
    }
    return { spec: { ...spec, pages: next }, notes };
  }
  const rules = opts.rules ?? await rulesFor(ctx.projectRoot, { type: "publication", id: issue.id, surface: "design" }).catch(() => [] as string[]);
  const sectionOf = (n: number) => (issue.sections ?? []).find((s) => n >= s.from && n <= s.to)?.label;
  const done: string[] = [];
  for (const p of [...issue.pages].sort((a, b) => a.n - b.n)) {
    const before = next[String(p.n)];
    if (opts.only && !opts.only.includes(p.n)) {
      if (before?.composed?.idea) done.push(`p${p.n}: ${before.composed.idea}`);
      continue;
    }
    let c: ComposedPage | null = null;
    let raw: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      // A stopped run stops here, between model calls, not after the whole stage.
      if (ctx.signal?.aborted) throw new PublicationStopped();
      try {
        raw = await ctx.ask(composePrompt({
          issueTitle: issue.title || issue.subject, page: p, spec, direction,
          ...(before?.reading ? { reading: before.reading } : {}),
          ...(sectionOf(p.n) ? { section: sectionOf(p.n)! } : {}),
          ...(done.length ? { neighbours: done.slice(-3).join("\n") } : {}),
          rules, ...(opts.note ? { note: opts.note } : {}),
          ...(issue.look?.extras != null ? { extras: issue.look.extras } : {}),
          ...(c?.problems.length ? { previous: { blocks: (raw as { blocks?: unknown } | null)?.blocks ?? [], problems: c.problems } } : {}),
        }), "design-page");
      } catch (e) {
        // A failed call is asked again: Night Markets lost its first two pages to one.
        notes.push(`p${p.n}: the composition call failed (${e instanceof Error ? e.message : String(e)})`);
        continue;
      }
      c = checkComposition(raw, p, spec, settingOf(p.n));
      if (!c.problems.length) break;
      emit(ctx, "publication:stage", { id: issue.id, stage: "design", state: "progress", message: `p${p.n} sent back: ${c.problems.join("; ")}` });
    }
    // A page with no composition is said, never built from some other arrangement.
    if (!c) throw new Error(`page ${p.n} could not be composed: ${notes.filter((x) => x.startsWith(`p${p.n}:`)).join("; ")}`);
    notes.push(...c.notes.map((x) => `p${p.n}: ${x}`));
    if (c.problems.length) notes.push(`p${p.n} still has after two repairs: ${c.problems.join("; ")}`);
    next[String(p.n)] = layoutOf(c, spec, p.n, before);
    done.push(compositionSummary(p.n, c));
  }
  // The issue read against its own direction, by the model that wrote both: pages
  // that break the rhythm it promised are composed again with its own note. No
  // rule of Quire's decides what counts as repetition (the Octopuses test promised
  // "treatment changes on every page turn" and built four pages the same way).
  if (!opts.only && !opts.reviewed && done.length > 2 && direction) {
    try {
      const out = await ctx.ask(rhythmPrompt(issue.title || issue.subject, direction, done), "design-page") as { recompose?: unknown };
      const redo = (Array.isArray(out.recompose) ? out.recompose : [])
        .map((r) => r as { n?: unknown; why?: unknown })
        .filter((r) => issue.pages.some((p) => p.n === Number(r.n)) && typeof r.why === "string")
        .slice(0, 2);
      for (const r of redo) {
        notes.push(`p${r.n} composed again for the rhythm: ${r.why}`);
        const again = await composePages(ctx, issue, { ...spec, pages: next }, direction, { only: [Number(r.n)], note: String(r.why), rules, reviewed: true });
        next[String(r.n)] = again.spec.pages[String(r.n)]!;
        notes.push(...again.notes);
      }
    } catch (e) {
      notes.push(`the rhythm review failed (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { spec: { ...spec, pages: next }, notes };
}

function rhythmPrompt(title: string, direction: string, pages: readonly string[]): string {
  return `You art-directed "${title}" and composed its pages. Read them against your own direction.

YOUR DIRECTION:
${direction}

YOUR PAGES, in order (frames as kind, cells c<first>+<span>, rows r<first>+<count>):
${pages.join("\n")}

Name the pages, at most two, whose composition breaks what your direction says about rhythm and
composition across the issue, and say for each what it should do instead. Name none if the issue
already does what the direction says.

Return ONLY JSON: {"recompose": [{"n": 2, "why": "one or two sentences"}]}`;
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

  // A brand is the house: the series cannot redraft what the brand fixes.
  const brand = loadBrand(issue.brand);
  if (issue.brand && !brand) throw new Error(`this issue is held to brand "${issue.brand}", which is not installed`);
  const house = brand ? brandHouse(brand) : await houseInForce(brandDirOf(ctx));
  if (brand) emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Held to the ${brand.name} brand: its colours, faces, shapes and pictures` });
  else if (!house) {
    emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: "No house approved yet: this issue chooses its own type and colours" });
  }
  // Several looks for one creation are options at its design gate (Rain was forked
  // into three issues to get three looks; one creation is the unit, the look a choice).
  const count = Math.max(1, Math.min(4, Math.round(issue.designCount ?? 1)));
  const options: PublicationDesign[] = [];
  const failed: string[] = [];
  for (let k = 0; k < count; k++) {
    if (count > 1) emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Design option ${k + 1} of ${count}` });
    try {
      options.push(await designOne(ctx, issue, house, optionsBlock(options, count, !!brand), k));
    } catch (e) {
      if (e instanceof PublicationStopped) throw e;
      const message = e instanceof Error ? e.message : String(e);
      if (count === 1) { emit(ctx, "publication:stage", { id, stage: "design", state: "error" }); throw e; }
      failed.push(`option ${k + 1}: ${message}`);
      emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Option ${k + 1} did not hold up: ${message.slice(0, 300)}` });
    }
  }
  if (!options.length) {
    emit(ctx, "publication:stage", { id, stage: "design", state: "error" });
    throw new Error(`no design option held up:\n- ${failed.join("\n- ")}`);
  }
  issue.design = options[0]!;
  if (count > 1) { issue.designOptions = options; issue.designChoice = 0; } else { delete issue.designOptions; delete issue.designChoice; }
  await writeSlots(ctx, issue);
  for (const o of options) await keepFingerprint(ctx, issue, o.spec!, o.sections, o.direction ?? "");
  // A new spec is a new decision, so any previous sign-off on the old one goes.
  issue.designApproved = null;
  issue.status = "designed";
  emit(ctx, "publication:stage", { id, stage: "design", state: "done" });
  return save(ctx, issue);
}

/** The options already made for this issue, so the next one is a different look. */
export function optionsBlock(made: readonly PublicationDesign[], count: number, branded = false): string {
  if (count < 2) return "";
  if (branded) return [
    "",
    `THIS IS DESIGN OPTION ${made.length + 1} OF ${count} FOR THIS SAME ISSUE, all inside the same brand. Options differ in`,
    "each section's colour pair and lead signature, the grid system, the devices chosen per spread and the composition; never in faces or palette.",
    ...made.map((o, i) => `- option ${i + 1}: grid ${o.spec?.grid?.system ?? "columns"}; sections ${o.sections.map((w) => `s${w.n} ${(w.pair ?? []).join("+")} led by ${w.lead ?? "?"}`).join(" | ")}`),
    "",
  ].join("\n");
  return [
    "",
    `THIS IS DESIGN OPTION ${made.length + 1} OF ${count} FOR THIS SAME ISSUE. The editor will choose one at the design gate,`,
    "so each option is a clearly different design language: its own type pair, colours, grid system, world registers and composition.",
    ...(made.length ? ["The options already made (do not repeat any of their decisions):",
      ...made.map((o, i) => `- option ${i + 1}: ${o.spec?.type?.display} / ${o.spec?.type?.text}; colours ${[o.spec?.palette?.paper, o.spec?.palette?.ink, o.spec?.palette?.accent].filter(Boolean).join(" ")}; grid ${o.spec?.grid?.system ?? "columns"}; worlds ${o.sections.map((w) => `${w.register} / ${w.technique}`).join(" | ")}; ${(/composition: ([^\n]*)/.exec(o.direction ?? "")?.[1] ?? (o.direction ?? "").slice(0, 200)).slice(0, 220)}`)] : []),
    "",
  ].join("\n");
}

/** One whole design of the issue: spec, worlds, composed pages and their art. Throws when it does not hold up. */
async function designOne(ctx: RunnerContext, issue: PublicationIssue, house: Awaited<ReturnType<typeof houseInForce>>, others: string, k = 0): Promise<PublicationDesign> {
  const def = ctx.definition;
  const id = issue.id;
  const template = def.prompts.design || DEFAULT_DESIGN_PROMPT;
  // The editor's reference pages, seen, not described: each option is shown a different few.
  const { referencePages } = await import("./page-look.js");
  const brand = loadBrand(issue.brand);
  // A brand's own spreads are its standard, unless the editor also chose a look; each option sees a different few.
  const refs = brand && !issue.look?.name && brand.references.length
    ? Array.from({ length: Math.min(4, brand.references.length) }, (_, i) => brand.references[(k * 4 + i) % brand.references.length]!)
    : await referencePages(ctx.projectRoot, k, 4, issue.look?.name);
  const look = await lookOf(ctx.projectRoot, issue.look?.name);
  // The brand's picture style is the brand's; the editor's pinned style holds everywhere else.
  const imageStyle = brand ? brand.imageStyle : await imageStyleOf(ctx.projectRoot);
  const out = await ctx.ask(renderTemplate(template, {
    voice: await voiceFor(ctx, issue),
    title: issue.title || issue.subject,
    subject: issue.subject,
    thesis: issue.thesis,
    extent: String(issue.extent),
    notes: notesBlock(issue),
    referenceNote: [
      brand ? brandBlock(brand) : "",
      await designReferences(ctx.projectRoot),
      look
        ? `THE LOOK THE EDITOR CHOSE FOR THIS ISSUE: "${look.name}". Design every page to it.${look.standard ? `
What its best pages share:
${look.standard.slice(0, 2500)}` : ""}`
        : brand ? "" : "THE EDITOR CHOSE NO LOOK FOR THIS ISSUE: take it from the content and say it in the direction. No standard of another issue applies.",
      look?.layers
        ? "THE DRAWN LAYER OF THIS LOOK IS FLAT SOLID SHAPES - arches, discs, bands, blocks and rows of dots in the section's colours - "
          + "computed from where the frames fall. Choose each section's register, technique and motif so they speak through flat colour shapes "
          + "and the pictures' own style; a language that needs gradients, translucency, facets or hairline ornament cannot be drawn on these pages."
        : "",
      issue.design?.spec?.composer === "model" ? "" :
        "THE PAGES ARE LAID BY QUIRE'S PLANNER FROM THE COPY: columns, measures, sizes and positions are computed on the grid. "
        + "Your direction says how the pages look - colour, shapes, the character of the type, the pictures - and never fixes a count of "
        + "columns, characters, points or millimetres, which the planner decides page by page.",
      imageStyle
        ? `THE PICTURES ARE MADE IN THE STYLE THE EDITOR CHOSE, and it is not yours to change: "${imageStyle.style}". `
          + "Every section's imagePrompt is this style; design the pages, colours and shapes around pictures made in it."
        : "",
      refs.length && brand && !issue.look?.name
        ? `The ${refs.length} images attached are spreads of ${brand.name} itself: its palette, faces, shapes, finish and the way its pictures and drawn colour sit together ARE the brand - hold to them exactly. Take nothing of their subject or words.`
        : refs.length
        ? `The ${refs.length} images attached are pages the editor holds up as the standard. Take their level and their thinking`
          + " - how art and type are composed together, how colour carries a page - never their subject, words or exact palette."
        : "",
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
    sectionBlock: sectionBlock(issue, house ? houseBlock(house) : undefined, brand),
    // A house fixes the faces, so the list of installed ones is only noise then.
    fontBlock: house ? "" : await fontBlock(ctx),
    gridSystems: (house?.grids ?? GRID_SYSTEMS).join(", "),
    // A brand repeats its colours and faces on purpose: other works' designs are not something to avoid.
    recentBlock: (brand ? "" : await recentBlock(ctx, id)) + others,
    // A session of its own per run: under the plain "design" tag a re-run read the
    // last run's answer back and leaned on its look.
  }), `design-${Date.now().toString(36)}`, refs.length ? { images: refs } : {});

  // The section worlds come back beside the spec, not inside it: the spec is
  // the whole issue's law, and a world is one section's look (08 §2).
  const { sections: rawWorlds, fixed: rawFixed, direction: rawDirection, ...specOnly } = out as Record<string, unknown>;
  let spec = specOnly as unknown as DesignSpec;
  const direction = directionOf(rawDirection);
  // What the composer and the illustrator said, kept on the issue: progress lines are not stored.
  const designNotes: string[] = [];
  /*
   * Faces Affinity does not have print in its fallback serif: Rain l2 named
   * Archivo / IBM Plex Sans for an instrument-sheet language and proofed in an
   * elegant italic. The prompt listed the installed faces; nothing held it to them.
   */
  if (!house && spec?.type) {
    const fonts = await installedFonts(ctx);
    const has = (f?: string) => !!f && !!fonts?.some((x) => x.toLowerCase() === f.toLowerCase());
    if (fonts && (!has(spec.type.display) || !has(spec.type.text))) {
      const want = `${spec.type.display} / ${spec.type.text}`;
      const out = await ctx.ask([
        `A design chose the type pair ${want}, but Affinity does not have ${[spec.type.display, spec.type.text].filter((f) => !has(f)).join(" or ")}.`,
        `Choose the installed pair closest to it that keeps the design's language${direction ? ` (${direction.slice(0, 400)})` : ""}.`,
        `Installed fonts, spelled exactly: ${fonts.join(", ")}.`,
        `Return ONLY JSON: {"display": "...", "text": "..."}`,
      ].join("\n"), "design-type").catch(() => ({}) as Record<string, unknown>);
      const display = String(out.display ?? ""), text = String(out.text ?? "");
      if (has(display) && has(text)) {
        spec = { ...spec, type: { ...spec.type, display, text } };
        emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Type ${want} is not installed; set in ${display} / ${text}` });
      } else {
        throw new Error(`the design's type ${want} is not installed in Affinity, and no installed pair was chosen in its place`);
      }
    }
  }
  if (!direction) emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: "The design came back with no direction; pages are composed from their readings alone" });
  /*
   * The furniture is kept beside the spec, where the law looks for it.
   *
   * `checkDesign` refuses a design with no folio — "the folio is what makes N
   * worlds one object" — and nothing ever wrote one, because the prompt never
   * asked and this function threw the field away with the rest of the reply.
   * Every design the stage made was unsignable for want of four sentences.
   */
  const fixedRaw = rawFixed && typeof rawFixed === "object" ? rawFixed as Record<string, unknown> : null;
  let fixed = fixedRaw
    ? Object.fromEntries(
      Object.entries(fixedRaw)
        .filter(([key]) => ["folio", "trim", "grid", "divider"].includes(key))
        .map(([key, value]) => [key, String(value ?? "").trim()])
        .filter(([, value]) => value),
    ) as PublicationDesign["fixed"]
    : undefined;
  // A locked section keeps the world it had; the rest are the stage's to decide.
  const locked = new Set(Object.entries(issue.sectionBoard ?? {}).filter(([, m]) => m.state === "locked").map(([k]) => Number(k)));
  const before = issue.design?.sections ?? [];
  const languageNotes: string[] = [];
  let worlds = worldsFrom(rawWorlds, issue, spec, languageNotes)
    .map((w) => (locked.has(w.n) ? before.find((b) => b.n === w.n) ?? w : w));
  if (languageNotes.length) {
    emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Held to print: ${languageNotes.join("; ")}` });
  }
  for (const w of before) if (locked.has(w.n) && !worlds.some((x) => x.n === w.n)) worlds.push(w);
  worlds.sort((a, b) => a.n - b.n);
  if (brand) worlds = worlds.map((w) => (locked.has(w.n) ? w : brandWorld(brand, w, (Array.isArray(rawWorlds) ? rawWorlds : []).find((r) => Number((r as { n?: unknown })?.n) === w.n))));
  // The editor's image style holds whatever the model wrote: a world keeps its colours and
  // language, its pictures are made in the chosen style.
  if (imageStyle) {
    worlds = worlds.map((w) => ({ ...w, imagePrompt: imageStyle.style, ...(imageStyle.negative ? { negative: imageStyle.negative } : {}) }));
    if (spec) spec = { ...spec, imageDirection: imageStyle.style };
  }
  // The house holds what it fixes, whatever the model returned.
  const houseProblems: string[] = [];
  if (house && spec) {
    spec = applyHouse(spec, house);
    fixed = { ...(fixed ?? {}), masthead: house.name, rule: house.devices.rule };
  }
  if (brand && spec) {
    spec = holdBrandSpec(spec, brand);
    fixed = { ...(fixed ?? {}), masthead: brand.name, folio: fixed?.folio || brand.house.folio };
    const off = offBrandColours(brand, { palette: spec.palette, worlds: worlds.map((w) => w.language) });
    if (off.length) houseProblems.push(`colours outside the ${brand.name} brand: ${off.join(", ")}`);
  }
  // A section with no language is a section that would be drawn in nobody's colours.
  for (const s of issue.sections ?? []) {
    if (!worlds.find((w) => w.n === s.n)?.language) houseProblems.push(`s${s.n} "${s.label}" came back with no language`);
  }
  // Every page is composed by the model from its reading and the direction
  // (composition.ts); code only checks the frames. The readings came back in
  // spec.pages, so the composer is given them.
  if (spec) {
    spec = { ...spec, pages: Object.fromEntries(Object.entries(spec.pages ?? {}).map(([k, v]) => {
      const r = (v as { reading?: unknown } | null)?.reading;
      return [k, { layout: "", imageSlot: "none", ...(typeof r === "string" && r.trim() ? { reading: r.trim().slice(0, 1200) } : {}) } as PageLayout];
    })) };
    // Furniture is part of each page's composition now, placed on that page's own grid.
    if (fixed?.blocks) { const { blocks: _b, ...rest } = fixed; fixed = rest; }
    if (fixedRaw) delete (fixedRaw as { blocks?: unknown }).blocks;
    emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: "Composing each page" });
    const composed = await composePages(ctx, issue, spec, direction);
    spec = composed.spec;
    designNotes.push(...composed.notes);
    if (composed.notes.length) {
      emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Composed: ${composed.notes.join("; ")}` });
    }
    emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: "Drawing each page's art" });
    const drawn = await drawArt(ctx, issue, spec, worlds, undefined, direction);
    spec = drawn.spec;
    designNotes.push(...drawn.notes);
    if (drawn.notes.length) {
      emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Art: ${drawn.notes.join("; ")}` });
    }
  }
  // The golden rules, with whatever numbers the taste engine has taught this scope.
  const math = await readMath(ctx.projectRoot, { type: "publication", id, worlds: worlds.map((w) => w.register) });
  // What can be mended without a model is mended first, and said: a run of
  // full-bleeds is a fault to fix, not a reason to throw away the design.
  const mended = spec ? repairGoldenRules(spec, issue.sections, math) : null;
  if (mended?.repairs.length) {
    spec = mended.spec;
    emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Repaired the spec: ${mended.repairs.join("; ")}` });
  }
  // Blocks the builder cannot place are dropped and said, never thrown (page-blocks.ts).
  if (spec?.pages) {
    const cleaned = cleanBlocks(spec);
    spec = cleaned.spec;
    const furniture = Array.isArray(fixedRaw?.blocks)
      ? cleanBlocks({ ...spec, pages: { fixed: { layout: "fixed", imageSlot: "none", blocks: fixedRaw!.blocks as PageBlock[] } } })
      : null;
    const kept = placedBlocks(furniture?.spec.pages.fixed);
    if (kept.length) fixed = { ...(fixed ?? {}), blocks: kept };
    const dropped = [...cleaned.dropped, ...(furniture?.dropped ?? []).map((d) => d.replace(/^page fixed/, "brand furniture"))];
    if (dropped.length) {
      emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Left out: ${dropped.join("; ")}` });
    }
  }
  const problems = [
    ...houseProblems,
    ...checkSpec(spec, issue.pages.map((p) => p.n)),
    ...goldenRules(spec, issue.sections, math),
  ];
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
    throw new Error(`the design spec does not hold up:\n- ${problems.join("\n- ")}`);
  }

  const { direction: _dir, notes: _n, ...kept } = issue.design ?? { sections: [] };
  return {
    ...kept,
    sections: worlds.length ? worlds : kept.sections ?? [],
    spec,
    ...(direction ? { direction } : {}),
    notes: designNotes,
    ...(fixed && Object.keys(fixed).length ? { fixed } : {}),
  };
}

/** The editor's pick among the design options: it becomes the issue's design, and any sign-off goes. */
export async function chooseDesign(ctx: RunnerContext, id: string, k: number): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  const option = issue.designOptions?.[k];
  if (!option) throw new Error(`there is no design option ${k + 1}`);
  issue.design = option;
  issue.designChoice = k;
  issue.designApproved = null;
  issue.status = "designed";
  await writeSlots(ctx, issue);
  return save(ctx, issue);
}

/**
 * The look the issue is designed to, as the editor chose it (looks.ts), or none.
 * It applies from the next design: a design already made keeps the look it was made to.
 */
export async function setIssueLook(ctx: RunnerContext, id: string, name: string | null): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  if (name) {
    const look = await lookOf(ctx.projectRoot, name);
    if (!look) throw new Error(`no look named "${name}" under _taste/references`);
    issue.look = issueLook(look);
  } else issue.look = null;
  return save(ctx, issue);
}

/**
 * The brand the issue is held to (brand.ts), or none. Like the look, it applies from the
 * next design; the series' next issues inherit it.
 */
export async function setIssueBrand(ctx: RunnerContext, id: string, brandId: string | null): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  if (brandId && !loadBrand(brandId)) throw new Error(`no brand named "${brandId}" in core/brands`);
  issue.brand = brandId || null;
  return save(ctx, issue);
}

/**
 * A design made outside Quire (an editor's own plan, a reference built by hand),
 * taken as one more option at the design gate. Each page's frames go through
 * the same checks a composed page does and get their boxes from the grid, so
 * the builder lays exactly what was planned; what the checks find is kept on
 * the page, not refused, because the point of an outside plan is to see what
 * Affinity makes of it. The issue's own design stays an option beside it.
 */
export async function installDesign(ctx: RunnerContext, id: string, given: { spec?: unknown; sections?: unknown; direction?: unknown; fixed?: unknown; label?: unknown }): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  requireApproval(issue, "design");
  const raw = given.spec as DesignSpec | undefined;
  if (!raw?.grid || !raw.type || !raw.palette) throw new Error("a design needs a spec with grid, type and palette");
  const pages: Record<string, PageLayout> = {};
  const planned: number[] = [];
  for (const p of [...issue.pages].sort((a, b) => a.n - b.n)) {
    const l = raw.pages?.[String(p.n)] as (PageLayout & { idea?: string }) | undefined;
    if (!l?.blocks?.length) {
      // A page the plan leaves out is planned by Quire, so the issue stays whole.
      const setting = pageSetting(issue, raw, p.n);
      const facts = await pictureFacts(p);
      const [best] = planPage(p, raw, { shows: briefsOf(p)[0]?.prompt ?? p.title ?? "", ...(setting ? { setting } : {}), ...facts });
      if (best) { pages[String(p.n)] = layoutOfPlan(best, raw, p.n, undefined, setting); planned.push(p.n); }
      continue;
    }
    const c = checkComposition({ idea: l.idea ?? l.layout ?? "", blocks: l.blocks }, p, raw, pageSetting(issue, raw, p.n));
    const { plan: _p, ...kept } = l;
    const laid = layoutOf(c, raw, p.n, { ...kept, layout: l.layout ?? "" } as PageLayout);
    // The plan's own drawn layer is part of it, held to the page like the model's art is.
    const type = c.blocks.filter((b) => !["image", "drawn", "rule"].includes(b.kind)).map((b) => ({ kind: b.kind, box: b.box }));
    const planBrand = loadBrand(issue.brand);
    const shapes = kept.shapes?.length ? holdShapes(kept.shapes, type, planBrand ? { brand: planBrand, place: placeOf(p.type ?? "", (issue.sections ?? []).some((x) => x.to === p.n)) } : undefined) : [];
    pages[String(p.n)] = shapes.length ? { ...laid, shapes } : laid;
  }
  const spec = cleanBlocks({ ...raw, composer: raw.composer ?? "plan", pages }).spec;
  const problems = checkSpec(spec, issue.pages.map((p) => p.n));
  if (problems.length) throw new Error(`the design does not hold up:\n- ${problems.join("\n- ")}`);
  const sections = Array.isArray(given.sections) ? worldsFrom(given.sections, issue, spec) : issue.design?.sections ?? [];
  const design: PublicationDesign = {
    sections, spec,
    ...(typeof given.direction === "string" && given.direction ? { direction: given.direction } : {}),
    ...(given.fixed && typeof given.fixed === "object" ? { fixed: given.fixed as PublicationDesign["fixed"] } : {}),
    notes: [`installed from outside${typeof given.label === "string" ? `: ${given.label}` : ""}`,
      ...(planned.length ? [`pages ${planned.join(", ")} were not in it and were planned by Quire`] : [])],
  };
  const options = issue.designOptions?.length ? [...issue.designOptions] : issue.design?.spec ? [issue.design] : [];
  // The same plan installed again replaces its earlier copy: Birds held three of one plan.
  const same = options.findIndex((o) => o.notes?.[0] === design.notes?.[0]);
  if (same >= 0) options[same] = design; else options.push(design);
  issue.designOptions = options;
  issue.designChoice = same >= 0 ? same : options.length - 1;
  issue.design = design;
  issue.designApproved = null;
  issue.status = "designed";
  await writeSlots(ctx, issue);
  return save(ctx, issue);
}

/** How many designs the next design stage makes for the gate (1-4). */
export async function setDesignCount(ctx: RunnerContext, id: string, n: number): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  issue.designCount = Math.max(1, Math.min(4, Math.round(n)));
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
  opts: { readonly keepSignOff?: boolean } = {},
): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  const spec = issue.design?.spec;
  if (!spec) {
    throw new Error("there is no design yet — run the design stage before choosing a section's world");
  }
  const section = (issue.sections ?? []).find((s) => s.n === n);
  if (!section) throw new Error(`this issue has no section ${n}`);
  if (issue.sectionBoard?.[String(n)]?.state === "locked") {
    throw new Error(`section ${n} is locked - unlock it on the section board to choose another world`);
  }

  const worlds = issue.design?.sections ?? [];
  const mine = worlds.find((w) => w.n === n);
  const others = worlds.filter((w) => w.n !== n);
  const pages = issue.pages.filter((p) => p.n >= section.from && p.n <= section.to);

  const out = await ctx.ask([
    `You are choosing the look of ONE section of "${issue.title || issue.subject}".`,
    `Section ${n}: "${section.label}" — ${section.question}`,
    `Its pages: ${pages.map((p) => `p${p.n} ${p.title}`).join("; ") || "none yet"}`,
    "",
    `The issue's type is decided and does not change: display ${spec.type?.display}, text ${spec.type?.text}.`,
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
      + `"language": {...}, `
      + `"imagePrompt": "under 60 words, no single subject", "negative": "..."}`,
    LANGUAGE_GUIDE,
  ].filter(Boolean).join("\n"), "design-section");

  const [found] = worldsFrom([{ ...(out as Record<string, unknown>), n }], issue, spec);
  const sectionBrand = loadBrand(issue.brand);
  const world = found && sectionBrand ? brandWorld(sectionBrand, found, out) : found;
  if (!world) throw new Error(`the answer did not describe section ${n}`);

  issue.design = {
    ...(issue.design ?? { sections: [] }),
    spec,
    sections: [...others, world].sort((a, b) => a.n - b.n),
  };
  // A section's look is part of the design that was signed off, so the
  // sign-off goes with it rather than standing over something it never saw -
  // unless the editor asked for it at the beauty gate, where the sign-off is
  // being given page by page and the result comes straight back to be judged.
  if (!opts.keepSignOff) issue.designApproved = null;
  emit(ctx, "publication:stage", { id, stage: "design", state: "done", section: n });
  return save(ctx, issue);
}

/** Keep or lock a section on the board, or clear its mark (null). */
export async function markSection(
  ctx: RunnerContext, id: string, n: number, state: "approved" | "locked" | null,
): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  if (!(issue.sections ?? []).some((s) => s.n === n)) throw new Error(`this issue has no section ${n}`);
  const board = { ...(issue.sectionBoard ?? {}) };
  if (state) board[String(n)] = { state, at: new Date().toISOString() };
  else delete board[String(n)];
  issue.sectionBoard = board;
  emit(ctx, "publication:stage", { id, stage: "plan", state: "done", section: n });
  return save(ctx, issue);
}

/**
 * Lay one page out again from new blocks, with the editor's reason (13 §9 🔁 / ✏️).
 *
 * Same content, new spec: one model call writes this page's blocks only, told
 * what the page holds, what it had, why that was refused, and the rules this
 * world has learned. Blocks it cannot place are dropped and said; with none
 * left the page keeps its type's arrangement. The caller lays it out; layout
 * needs the design signed off, so a redesign leaves the sign-off standing.
 */
export async function redesignPage(
  ctx: RunnerContext, id: string, n: number,
  why: { readonly note?: string; readonly cause?: ReadonlyArray<string> } = {},
): Promise<{ issue: PublicationIssue; dropped: string[] }> {
  const issue = await readIssue(ctx, id);
  const spec = issue.design?.spec;
  if (!spec) throw new Error("there is no design yet - run the design stage first");
  const page = issue.pages.find((p) => p.n === n);
  if (!page) throw new Error(`this issue has no page ${n}`);
  const section = (issue.sections ?? []).find((s) => n >= s.from && n <= s.to);
  const world = (issue.design?.sections ?? []).find((w) => w.n === section?.n);
  const rules = await rulesFor(ctx.projectRoot, {
    type: "publication", id, surface: "design", ...(world?.register ? { world: world.register } : {}),
  }).catch(() => [] as string[]);
  const current = spec.pages?.[String(n)];

  // The page is composed again by the same composer as the design stage, told what it
  // had, why that was refused, and this world's rules.
  const ask = [
    current?.composed?.idea ? `It was composed as: ${current.composed.idea}.` : "",
    // What Affinity measured on the laid page: the frame boxes passed, the set type did not.
    current?.measured?.length ? `Laid out in Affinity, it did not print right: ${current.measured.join("; ")}. Leave more room between those frames.` : "",
    why.cause?.length ? `What went wrong: ${why.cause.join(", ")}.` : "",
    why.note ?? "Give it a different composition from the one it had.",
  ].filter(Boolean).join(" ");
  const composed = await composePages(ctx, issue, spec, issue.design?.direction ?? "", { only: [n], note: ask, rules });
  if (!composed.spec.pages[String(n)]?.blocks?.length) throw new Error(`page ${n} could not be composed: ${composed.notes.join("; ")}`);
  if (composed.notes.length) emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Composed: ${composed.notes.join("; ")}` });
  // A new composition needs its own art: the old shapes were drawn round the old type.
  const drawn = await drawArt(ctx, issue, composed.spec, issue.design?.sections ?? [], [n], issue.design?.direction, why.note);
  const laidNext = drawn.spec.pages[String(n)]!;
  if (drawn.notes.length) emit(ctx, "publication:stage", { id, stage: "design", state: "progress", message: `Art: ${drawn.notes.join("; ")}` });
  const cleaned = cleanBlocks({ ...spec, pages: { [String(n)]: laidNext } });
  issue.design = { ...(issue.design ?? { sections: [] }), spec: { ...spec, pages: { ...spec.pages, [String(n)]: cleaned.spec.pages[String(n)]! } } };
  // Asked for at the beauty gate, which is where the design is signed off:
  // the sign-off stands, and the page comes back laid out to be judged again.
  emit(ctx, "publication:stage", { id, stage: "design", state: "done", page: n });
  return { issue: await save(ctx, issue), dropped: cleaned.dropped };
}

export interface PageReview {
  readonly at: string;
  readonly verdict: "keep" | "redesign" | "re-world" | "tweak";
  readonly cause?: ReadonlyArray<string>;
  readonly note?: string;
  readonly world?: string;
  /** The score the page had when it was judged. */
  readonly total?: number;
}

const reviewsFile = (ctx: RunnerContext, id: string, n: number) =>
  join(dirOf(ctx, id), "pages", String(n).padStart(2, "0"), "reviews.jsonl");

/** One verdict on one page, kept in its own folder (13 data model). */
export async function appendReview(ctx: RunnerContext, id: string, n: number, review: PageReview): Promise<void> {
  const file = reviewsFile(ctx, id, n);
  await mkdir(dirname(file), { recursive: true });
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, `${JSON.stringify(review)}\n`, "utf-8");
}

export async function readReviews(ctx: RunnerContext, id: string, n: number): Promise<PageReview[]> {
  const text = await readFile(reviewsFile(ctx, id, n), "utf-8").catch(() => "");
  return text.split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l) as PageReview]; } catch { return []; } });
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
  const designProblems = [
    ...checkSpec(issue.design?.spec, issue.pages.map((p) => p.n)),
    // Not the last measurement: the build measures again, and a fix in the builder
    // could otherwise only be proved by redesigning a page that was never wrong.
    ...pageBlockers(issue.design?.spec, { measured: false }),
    ...goldenRules(issue.design?.spec, issue.sections, await readMath(ctx.projectRoot, {
      type: "publication", id, worlds: (issue.design?.sections ?? []).map((w) => w.register),
    })),
  ];
  if (designProblems.length) {
    throw new Error(`the design does not pass its own law:\n- ${designProblems.join("\n- ")}`);
  }
  // A page goes to print only once its proof was looked at and passed, on the composition it has now.
  const unproven = await unprovenPages(ctx, issue);
  if (unproven.length) {
    throw new Error(`these pages have not been made right yet (the build stage does it):\n- ${unproven.join("\n- ")}`);
  }

  emit(ctx, "publication:stage", { id, stage: "build", state: "start" });
  const res = await fetch(`${ctx.shimUrl}/affinity/build`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ issue, issueDir: dirOf(ctx, id) }),
  });
  const body = await res.json().catch(() => ({})) as {
    ok?: boolean; error?: string; pdf?: string;
    pages?: ReadonlyArray<{ n: number; findings?: ReadonlyArray<{ level?: string; what?: string; roles?: ReadonlyArray<string> }> }>;
  };
  if (!res.ok || body.ok === false) {
    const why = body.error ?? `HTTP ${res.status}`;
    emit(ctx, "publication:stage", { id, stage: "build", state: "error", error: why });
    throw new Error(`build: ${why}`);
  }

  /*
   * What Affinity measured on each laid page. An error there (a frame that
   * oversets, two text frames on top of each other) is a page that does not
   * print right, so it goes back on the page as a design blocker and the build
   * is not done. Redesigning the page clears it.
   */
  const spec = issue.design?.spec;
  const measured = new Map<number, string[]>();
  for (const pg of body.pages ?? []) {
    // Which frames, by their block kind ("mag-p2-deck" -> deck), so a redesign knows what to move.
    const kinds = (roles?: ReadonlyArray<string>) => (roles ?? []).map((r) => String(r).replace(/^mag-p\d+[:-]/, "")).filter(Boolean);
    const errs = [...new Set((pg.findings ?? []).filter((f) => f.level === "error" && f.what)
      .map((f) => kinds(f.roles).length ? `${f.what}: the ${kinds(f.roles).join(" and the ")}` : f.what!))];
    if (errs.length) measured.set(pg.n, errs);
  }
  if (spec && body.pages) {
    const pages = { ...spec.pages };
    for (const [n, l] of Object.entries(pages)) {
      const errs = measured.get(Number(n));
      const { measured: _old, ...rest } = l;
      pages[n] = errs ? { ...rest, measured: errs } : rest;
    }
    issue.design = { ...issue.design!, spec: { ...spec, pages } };
  }
  if (measured.size) {
    const lines = [...measured].map(([n, e]) => `- p${n}: ${e.join("; ")}`);
    const why = ["the pages are laid out but do not print right:", ...lines].join("\n");
    await save(ctx, issue);
    emit(ctx, "publication:stage", { id, stage: "build", state: "error", error: why });
    throw new Error(`build: ${why}`);
  }

  issue.build = { pdf: body.pdf ?? null, at: new Date().toISOString() };
  issue.status = "built";
  emit(ctx, "publication:stage", { id, stage: "build", state: "done", pdf: issue.build.pdf });
  return save(ctx, issue);
}

/** Whether the issue's brand designs by authored spreads (spread-author.ts). */
function authorsBrand(issue: PublicationIssue): boolean {
  const brand = loadBrand(issue.brand ?? null);
  return !!brand && existsSync(join(brand.dir, "author", "lib.js"));
}

/**
 * A branded issue's build: every spread designed as its own script, checked, looked at and
 * revised (spread-author.ts), then the PDF. A spread that never passed the eye is kept at its
 * best and named in the issue's warnings: the editor sees it rather than losing the issue to it.
 */
export async function buildAuthored(ctx: RunnerContext, id: string, { rounds = 3, only = null as number[] | null } = {}): Promise<PublicationIssue> {
  const issue = await readIssue(ctx, id);
  requireApproval(issue, "build");
  await requireDesigner(ctx.shimUrl, "building the document");
  const pdf = join(dirOf(ctx, id), "build", `${id}.pdf`);
  emit(ctx, "publication:stage", { id, stage: "build", state: "start" });
  const { authorIssue } = await import("./spread-author.js");
  const res = await fetch(`${ctx.shimUrl}/affinity/open`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ issue, issueDir: dirOf(ctx, id), pdf }),
  });
  if (!res.ok) throw new Error(`build: could not open the document (${(await res.json().catch(() => ({})) as { error?: string }).error ?? res.status})`);
  const spreads = await authorIssue(ctx, id, { rounds, only });
  const closed = await fetch(`${ctx.shimUrl}/affinity/close`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pdf }),
  }).then((r) => r.json()).catch(() => ({})) as { exported?: boolean; exportError?: string };
  const after = await readIssue(ctx, id);
  const weak = spreads.filter((s) => !s.pass).map((s) => `p${s.pages.join("-")}: best eye ${s.best.eye?.total ?? "none"}${s.best.faults.length ? `, ${s.best.faults.length} fault(s): ${s.best.faults[0]}` : ""}`);
  after.warnings = [...(after.warnings ?? []).filter((w) => !String(w).startsWith("spread ")), ...weak.map((w) => `spread ${w}`)];
  if (!closed.exported) {
    await save(ctx, after);
    throw new Error(`build: the spreads are laid out but the PDF did not export: ${closed.exportError ?? "no answer"}`);
  }
  after.build = { pdf, at: new Date().toISOString() };
  after.status = "built";
  emit(ctx, "publication:stage", { id, stage: "build", state: "done", pdf });
  return save(ctx, after);
}

/** Pages whose proof was never looked at, failed, or was of another composition than the one they have now. */
async function unprovenPages(ctx: RunnerContext, issue: PublicationIssue): Promise<string[]> {
  const { readLook, layoutHash } = await import("./page-look.js");
  const out: string[] = [];
  for (const p of issue.pages) {
    const look = (await readLook(dirOf(ctx, issue.id), p.n))?.latest;
    if (!look) out.push(`p${p.n}: its proof was never looked at`);
    else if (look.layout !== layoutHash(issue.design?.spec?.pages?.[String(p.n)])) out.push(`p${p.n}: changed since its proof was looked at`);
    else if (!look.pass) out.push(`p${p.n}: eye ${look.score}${look.defects[0] ? ` - ${look.defects[0].what}` : ""}`);
  }
  return out;
}

/**
 * Lay out, look at and redesign every page until it is right (`perfectIssue`),
 * then say which could not be made right. Those stop the build: a page Quire
 * could not fix is a lesson for Quire, not a page to print.
 */
async function makePagesRight(ctx: RunnerContext, id: string): Promise<void> {
  const { perfectIssue } = await import("./page-score-run.js");
  const say = (message: string) => emit(ctx, "publication:stage", { id, stage: "build", state: "progress", message });
  say("Making every page right: lay out, look at the proof, redesign what fails");
  const pages = await perfectIssue(ctx, id, { onProgress: say });
  const wrong = pages.filter((p) => !p.pass);
  say(`Pages: ${pages.map((p) => `p${p.n} ${p.total}${p.pass ? "" : " (not right)"}`).join(", ")}`);
  if (wrong.length) {
    throw new Error(`Quire could not make ${wrong.length === 1 ? "this page" : "these pages"} right:\n`
      + wrong.map((p) => `- p${p.n} after ${p.rounds} rounds (pixels ${p.pixels}, eye ${p.eye ?? "none"}): ${p.faults.slice(0, 4).join("; ")}`).join("\n"));
  }
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
    ok?: boolean; error?: string; findings?: Array<{ level?: string; what?: string } | string>;
    frames?: unknown[]; grid?: unknown; cols?: unknown; leaks?: string[]; warnings?: string[]; measure?: unknown; built?: string;
  };
  if (!res.ok || body.ok === false) {
    const why = body.error ?? `HTTP ${res.status}`;
    emit(ctx, "publication:stage", { id, stage: "design", state: "error", page: Number(n), error: why });
    throw new Error(`layout p${n}: ${why}`);
  }
  // The geometry the page score reads for G, H and T, beside the render it will take.
  if (body.frames) {
    const file = join(dirOf(ctx, id), "pages", String(n).padStart(2, "0"), "layout.json");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({
      at: new Date().toISOString(), frames: body.frames, grid: body.grid, findings: body.findings ?? [],
      cols: body.cols ?? null, leaks: body.leaks ?? [], warnings: body.warnings ?? [],
      measure: body.measure ?? null, built: body.built ?? "type",
    }, null, 2), "utf-8");
  }
  emit(ctx, "publication:stage", { id, stage: "design", state: "done", page: Number(n) });
  const said = (body.findings ?? []).map((f) => (typeof f === "string" ? f : `${f.level ?? "info"}: ${f.what ?? ""}`));
  return { page: Number(n), findings: [...said, ...(body.warnings ?? []).map((w) => `warn: ${w}`), ...(body.leaks?.length ? [`error: markup printed: ${body.leaks.join(" ")}`] : [])] };
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
    // Both, or the art stage still counts the old picture as drawn and skips the page.
    page.image = null;
    page.images = [];
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

  const was = elementValue(page, at);
  applyElement(ctx, page, at, out);
  await writePageMarkdown(ctx, id, page);

  // A new brief means the old picture no longer answers it: drop it so the
  // art stage draws the page again instead of skipping it as done.
  if (at.kind === "brief" && elementValue(page, at) !== was) {
    page.image = null;
    page.images = [];
  }
  // Approval is of specific copy. Changing a sidebar is a smaller change than
  // rewriting the page, but it is still not the copy that was signed off.
  // A picture brief is not copy: it never prints, so it leaves the approval alone.
  if (issue.approved && at.kind !== "brief") {
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

  // Every page the model reads is saved as it is read, under a hash of what it
  // read. A run that stops on page 14 resumes at page 14, and a page a revise
  // has rewritten is the only one read again. Before this the whole audit was
  // held in memory: sixteen pages read, a failed revise, nothing kept.
  const reviewed: Record<string, { hash: string; findings: PublicationFinding[] }> = {
    ...((await readIssue(ctx, id)).audit?.reviewed ?? {}) as Record<string, { hash: string; findings: PublicationFinding[] }>,
  };
  const textOf = (p: PublicationPage) => [p.title, p.deck, p.body].filter(Boolean).join("\n\n");
  const hashOf = (p: PublicationPage) => createHash("sha1").update(textOf(p)).digest("hex").slice(0, 16);
  let roundsSoFar = 0;

  const checkpoint = async (found: PublicationFinding[]): Promise<void> => {
    const issue = await readIssue(ctx, id);
    issue.audit = { at: new Date().toISOString(), findings: found, rounds: roundsSoFar, complete: false, reviewed };
    await save(ctx, issue);
  };

  const look = async (): Promise<PublicationFinding[]> => {
    const issue = await readIssue(ctx, id);
    const found: PublicationFinding[] = [...auditPages(issue.pages, ctx.definition, issue)];
    if (deep) {
      for (const page of issue.pages.filter((p) => p.body && p.body.trim())) {
        if (ctx.signal?.aborted) throw new PublicationStopped();
        const key = String(page.n);
        const hash = hashOf(page);
        if (reviewed[key]?.hash !== hash) {
          const read = await reviewPage(ctx, issue, page);
          // A page the model could not read is retried next run, not remembered.
          if (read.some((f) => f.category === "audit/unavailable")) { found.push(...read); continue; }
          reviewed[key] = { hash, findings: read };
          await checkpoint([...found, ...read]);
        }
        found.push(...reviewed[key]!.findings);
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
    roundsSoFar = round;
    if (!changed) break;

    findings = await look();
  }

  const issue = await readIssue(ctx, id);
  issue.audit = { at: new Date().toISOString(), findings, rounds: round, complete: true, reviewed };
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
      // A brand that designs by authored spreads finds its own archive pictures per spread.
      if (authorsBrand(issue)) return { ok: true, artifacts: [] };
      if (outstanding(issue, "art", redo).includes(unit)) await artPage(ctx, id, unit, { redo });
      return { ok: true, artifacts: [] };
    },
    // Every page made right by Quire itself (page-score-run.ts `perfectPage`) before the PDF.
    "build.export": whole(async (id) => {
      if (!def.needsPdf) return;
      if (authorsBrand(await readIssue(ctx, id))) { await buildAuthored(ctx, id); return; }
      await makePagesRight(ctx, id); await build(ctx, id);
    }),
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
  const end = order.indexOf(stopAt);
  if (start < 0 || end < 0) throw new Error(`unknown stage: ${from} or ${stopAt}`);

  // The audit runs only when asked for: stopAt "audit", or its own button.

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
    let blocked: string | undefined;
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
      // Marked failed from outside while this run was alive - another copy
      // of the app booting on the same workspace calls every running stage
      // interrupted. This run is not; it picks itself back up. Done that way
      // it stalled at "4 of 4 done" and said nothing true about why.
      if (after?.status === "failed") await resume(where);
      // A gate, or a stage whose units are all in but which has not moved on
      // yet: walking it on is the same step a finished unit takes.
      if (++stalls > 2) {
        throw new Error(`${running} could not move on to the next stage: ${blocked ?? "the pipeline gave no reason"}`);
      }
      blocked = (await advance(where)).reason;
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
