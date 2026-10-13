/*
 * The page looked at (Phase 9): a model is shown the printed proof and judges
 * it the way an art director judges one (quire-editorial-design §14).
 *
 * The page score reads pixels with arithmetic: shares of colour, whitespace,
 * frame boxes. It cannot see a deck sitting on the body's first line, a story
 * that stops mid-sentence, or a page with no idea, and Rain p2 passed every
 * check with all three. This is the eye: one model call with the render
 * attached, answered as faults with where they are and how to fix them, so a
 * redesign is told what was seen and not only what was counted.
 */
import { lookOf } from "./looks.js";
import { loadBrand } from "./brand.js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { rulesFor } from "./taste-engine.js";
import { issueDir, readIssue, worldFor, type RunnerContext } from "./publication-runner.js";

/** Under this a page is redesigned (§14 "Scoring a proof"). */
export const LOOK_PASS = 85;

export interface LookDefect {
  readonly severity: "fatal" | "major" | "minor";
  readonly what: string;
  readonly where: string;
  readonly fix: string;
}

export interface PageLook {
  readonly at: string;
  readonly score: number;
  /** What the eye lands on first. */
  readonly first: string;
  readonly dims: Readonly<Record<string, number>>;
  readonly defects: ReadonlyArray<LookDefect>;
  /** One rule the worst fault teaches every page, for the taste engine; null when there is none. */
  readonly lesson: string | null;
  readonly pass: boolean;
  /** Which composition was judged: a look of another one says nothing about this. */
  readonly layout: string;
}

export interface LookInput {
  readonly title: string;
  readonly page: { readonly n: number; readonly type: string; readonly title?: string | null; readonly deck?: string | null; readonly body?: string | null };
  readonly world?: string;
  readonly direction?: string;
  readonly rules: ReadonlyArray<string>;
  readonly measured: ReadonlyArray<string>;
  /** The look the editor chose for the issue, and its standard in their words. */
  readonly look?: { readonly name: string; readonly standard: string };
}

const lastSentence = (body: string) => {
  const flat = body.replace(/\s+/g, " ").trim();
  const parts = flat.split(/(?<=[.!?])\s+/);
  return parts[parts.length - 1]?.slice(-160) ?? "";
};

export function lookPrompt(i: LookInput): string {
  const body = i.page.body ?? "";
  return [
    `You are the art director of "${i.title}". The picture attached is the printed proof of page ${i.page.n} (A4 portrait, as it will print).`,
    "Judge it as §14 of your skill says (Seeing the proof), in that order, against the design language of its world (§15)"
      + (i.look ? `, and against the look the editor chose for this issue, "${i.look.name}" (§16)` : ", and against the issue's own direction - the editor chose no look, so no look's standard applies (§16)")
      + ": a body line over 75 characters, an empty band across the middle, blocks off shared edges, a clipped panel or more than two families are each a major defect, named with where it is.",
    i.look?.standard ? `THE CHOSEN LOOK'S STANDARD (what its best pages share; a page that breaks it has a fault):
${i.look.standard.slice(0, 2500)}` : "",
    "",
    `The page: a ${i.page.type} page. Title "${i.page.title ?? ""}". Deck "${i.page.deck ?? ""}".`,
    body ? `Its story is ${body.split(/\s+/).filter(Boolean).length} words and ends with: "${lastSentence(body)}" - if that sentence is not on the proof, the text is cut.` : "It carries no body text.",
    i.world ? `Its world: ${i.world}.` : "",
    i.direction ? `The issue's direction: ${i.direction.slice(0, 600)}` : "",
    i.measured.length ? `Measured in Affinity: ${i.measured.join("; ")}.` : "",
    i.rules.length ? `The editor's rules for this work (a page that breaks one has a fault):\n${i.rules.map((r) => `- ${r}`).join("\n")}` : "",
    "",
    "Be strict: a page a good magazine would not send to print scores under 85. A collision or cut text is fatal.",
    "Name every fault by the frame it is in (title, deck, body, kicker, panel, pull, figure, image, drawn art, runhead, folio)",
    "and give the fix in the page's own terms: which frame, which way, how far, or what to take out.",
    "",
    "Return ONLY JSON:",
    `{"first": "what the eye lands on first", "score": 0, "dims": {"hierarchy": 0, "space": 0, "type": 0, "colour": 0, "picture": 0, "language": 0, "craft": 0},`
      + ` "defects": [{"severity": "fatal|major|minor", "what": "...", "where": "...", "fix": "..."}],`
      + ` "lesson": "one sentence, a rule that would have kept the worst fault off any page of any work, or null"}`,
  ].filter((l) => l !== "").join("\n");
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The model's answer as a look. A fatal fault fails the page whatever score was given. */
export function parseLook(raw: unknown, layout: string, at = new Date().toISOString()): PageLook {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const defects: LookDefect[] = (Array.isArray(o.defects) ? o.defects : []).flatMap((d) => {
    const x = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    const what = str(x.what);
    if (!what) return [];
    const severity = x.severity === "fatal" || x.severity === "minor" ? x.severity : "major";
    return [{ severity, what, where: str(x.where), fix: str(x.fix) }];
  });
  const dims = Object.fromEntries(Object.entries((o.dims && typeof o.dims === "object" ? o.dims : {}) as Record<string, unknown>)
    .flatMap(([k, v]) => (num(v) === null ? [] : [[k, num(v)!]])));
  const score = num(o.score) ?? 0;
  const lesson = str(o.lesson);
  return {
    at, score, first: str(o.first), dims, defects,
    lesson: lesson && !/^null$/i.test(lesson) ? lesson : null,
    pass: score >= LOOK_PASS && !defects.some((d) => d.severity === "fatal"),
    layout,
  };
}

/** A page's composition as a short fingerprint: what a look was a look at. */
export const layoutHash = (layout: unknown) =>
  createHash("sha1").update(JSON.stringify(layout ?? null)).digest("hex").slice(0, 12);

const lookPath = (dir: string, n: number) => join(dir, "pages", String(n).padStart(2, "0"), "look.json");

export async function readLook(dir: string, n: number): Promise<{ latest: PageLook; history: PageLook[] } | null> {
  try { return JSON.parse(await readFile(lookPath(dir, n), "utf-8")); } catch { return null; }
}

async function saveLook(dir: string, n: number, look: PageLook): Promise<void> {
  const before = await readLook(dir, n);
  const path = lookPath(dir, n);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ latest: look, history: [...(before?.history ?? []), look].slice(-40) }, null, 2), "utf-8");
}

/** Show the model page n's render and keep its judgement. Null when the page has no render. */
/**
 * Pages the editor holds up as the standard for the issue's chosen look
 * (`_taste/references/<look>/*.jpg|png`, shared Output). The eye is shown `count`
 * of them beside the proof, rotated by page so an issue is measured against the
 * whole set; the design stage is shown a different few per option. No look
 * chosen, no references: the newest set used to be shown to every issue, which
 * held a colourful magazine to the minimal set the editor gave for Rain.
 */
export async function referencePages(root: string, n: number, count = 3, look?: string | null): Promise<string[]> {
  const all = (await lookOf(root, look))?.images ?? [];
  if (!all.length) return [];
  return Array.from({ length: Math.min(count, all.length) }, (_, i) => all[(n * count + i) % all.length]!);
}

export async function lookAtPage(ctx: RunnerContext, id: string, n: number, measured: ReadonlyArray<string> = []): Promise<PageLook | null> {
  const issue = await readIssue(ctx, id);
  const page = issue.pages.find((p) => p.n === n);
  const dir = issueDir(ctx, id);
  const render = join(dir, "pages", String(n).padStart(2, "0"), "render.png");
  if (!page || !existsSync(render)) return null;
  const w = worldFor(issue, n);
  const brand = loadBrand(issue.brand);
  // Under a brand, lessons are the brand's: they gather across all its issues, not one section's pair.
  const rules = await rulesFor(ctx.projectRoot, {
    type: "publication", id, surface: "design", ...(brand ? { world: brand.name } : w?.register ? { world: w.register } : {}),
  }).catch(() => [] as string[]);
  const chosen = await lookOf(ctx.projectRoot, issue.look?.name)
    ?? (brand ? { name: brand.name, standard: brand.standard } : null);
  const refs = brand && !issue.look?.name && brand.references.length
    ? Array.from({ length: Math.min(3, brand.references.length) }, (_, i) => brand.references[(n * 3 + i) % brand.references.length]!)
    : await referencePages(ctx.projectRoot, n, 3, issue.look?.name);
  const raw = await ctx.ask(lookPrompt({
    title: issue.title || issue.subject,
    page,
    ...(w ? { world: `${w.register} / ${w.idiom}` } : {}),
    ...(issue.design?.direction ? { direction: issue.design.direction } : {}),
    rules, measured,
    ...(chosen ? { look: { name: chosen.name, standard: chosen.standard } } : {}),
  }) + (refs.length && brand && !issue.look?.name
    ? `\n\nThe first image is the page. The ${refs.length} after it are spreads of ${brand.name}, the brand this page belongs to: `
      + "judge whether the page is unmistakably the same brand (its palette, faces, shapes and their meanings, finish, bilingual touches) and at their level. "
      + "A colour, face or ornament the brand does not have is a fault however good it looks."
    : refs.length ? `\n\nThe first image is the page. The ${refs.length} after it are pages the editor holds up as the standard: `
    + "judge the page's layout, type and use of space against their level, never copy their subject or palette." : ""),
  "design-look", { images: [render, ...refs] });
  const look = parseLook(raw, layoutHash(issue.design?.spec?.pages?.[String(n)]));
  await saveLook(dir, n, look);
  return look;
}

/**
 * A lesson the eye drew, offered to the taste engine as a pending proposal
 * (studio `api/taste.ts` reads the same file). Nothing applies until it is
 * accepted; one already proposed or already a rule is not offered twice.
 */
export async function proposeLesson(root: string, text: string, evidence: string, scope: Readonly<Record<string, string>> = { surface: "design" }): Promise<boolean> {
  const dir = join(root, "_taste");
  const read = async (f: string) => (await readFile(join(dir, f), "utf-8").catch(() => "")).split("\n")
    .flatMap((l) => { try { return l.trim() ? [JSON.parse(l) as { text?: string }] : []; } catch { return []; } });
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set([...await read("proposals.jsonl"), ...await read("rules.jsonl")].map((p) => key(p.text ?? "")));
  if (!text.trim() || seen.has(key(text))) return false;
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "proposals.jsonl"), `${JSON.stringify({
    id: `tp_${Date.now().toString(36)}l`, at: new Date().toISOString(), scope, text: text.trim(),
    kind: "sentence", evidence: [evidence], source: "distill", state: "pending",
  })}\n`, "utf-8");
  return true;
}
