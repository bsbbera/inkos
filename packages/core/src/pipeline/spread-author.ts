/**
 * Authored spreads: how a branded issue is designed and built.
 *
 * Ochin 01 was not made by filling slots. Every spread was its own drawing, written as a
 * script against the brand's kit: the camera obscura's light crossing the fold, the film's
 * layers pulled apart, a log-scale ruler across a foot. A slot system cannot make those pages,
 * which is why a branded issue built through the page specs came out generic.
 *
 * So for a brand that ships an author kit (brands/<id>/author: lib.js, LIB.md, Ochin 01's own
 * spread scripts as examples), Quire designs the way that issue was designed:
 *   1. pictures: the designer names the archive photographs a spread needs; free-licence
 *      Commons files are found, looked at and fetched (shim commons.mjs);
 *   2. author: the designer writes the spread's text blocks and its script, shown the copy,
 *      the pictures, the kit's guide, three Ochin 01 scripts and their renders;
 *   3. run: the shim shapes the text and runs the script on the build document;
 *   4. check: in code (it ran, all the copy is placed, nothing overruns, collides, crosses the
 *      fold or the margins) and by eye (the critic compares the render with Ochin 01);
 *   5. revise with the render and the faults in hand, up to `rounds` times; the best version
 *      stands. Every spread is saved as it is made and a rebuild replays it without a model.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { loadBrand, type Brand } from "./brand.js";
import { issueDir, readIssue, worldFor, type PublicationIssue, type PublicationPage, type RunnerContext } from "./publication-runner.js";

export interface SpreadPicture { readonly file: string; readonly page: number; readonly shows: string; readonly w: number; readonly h: number; readonly license: string; readonly artist: string }
export interface SpreadVersion {
  readonly round: number;
  readonly plan: string;
  readonly texts: Record<string, unknown>;
  readonly script: string;
  readonly faults: string[];
  readonly eye: { readonly total: number; readonly pass: boolean; readonly fixes: string[] } | null;
  readonly render: string[];
}
export interface SpreadResult { readonly pages: number[]; readonly pass: boolean; readonly best: SpreadVersion; readonly rounds: number }

/** The issue's openings: the cover alone, then pairs, the last page alone when the count is even. */
export function spreadsOf(count: number): number[][] {
  const out: number[][] = [[1]];
  for (let p = 2; p <= count; p += 2) out.push(p + 1 <= count ? [p, p + 1] : [p]);
  return out;
}

/** Whether a brand designs by authored spreads. */
export const authors = (brand: Brand | null): boolean => !!brand && existsSync(join(brand.dir, "author", "lib.js"));

const say = (ctx: RunnerContext, id: string, message: string) => {
  try { ctx.onEvent?.({ type: "publication:stage", at: Date.now(), id, stage: "build", state: "progress", message }); } catch { /* ignored */ }
};

// Affinity runs and picture fetches can outlast fetch's default 5-minute wait for headers.
const patient = new Agent({ headersTimeout: 20 * 60_000, bodyTimeout: 20 * 60_000 });

async function shim<T>(ctx: RunnerContext, path: string, body: unknown): Promise<T> {
  const res = await undiciFetch(`${ctx.shimUrl}${path}`, { dispatcher: patient, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({})) as T & { error?: string; ok?: boolean };
  if (!res.ok) throw new Error(`${path}: ${out.error ?? `HTTP ${res.status}`}`);
  return out;
}

/** One model call, asked again once if the route times out or answers nothing usable. */
async function ask(ctx: RunnerContext, prompt: string, tag: string, images?: string[]): Promise<Record<string, unknown>> {
  const opts = images?.length ? { images } : undefined;
  try { return await ctx.ask(prompt, tag, opts); }
  catch (e) {
    ctx.signal?.throwIfAborted();
    return ctx.ask(`${prompt}\n\n(The last attempt failed: ${e instanceof Error ? e.message.slice(0, 200) : e}. Answer again.)`, tag, opts);
  }
}

/* ------------------------------------------------------------------ examples */

// Ochin 01's spreads, by what they show; references/NN-*.jpg is the render of sNN-1.
const EXAMPLES: Record<string, string> = {
  s00: "cover: a lens on a night field, the first photograph in it, alpana behind, bird on the rim",
  s01: "contents down a kantha thread with round windows; the editor's letter on a holud flood with the word box",
  s02: "a diagram across the fold: the camera obscura's light crossing the gutter, drawn in code",
  s03: "a photo feature: pictures bleeding off the head, a magnifier on a detail, a log-scale ruler",
  s04: "a colour field verso (cyanotype blue) facing a paper recto with a portrait and a colour diagram",
  s05: "one film strip across both pages carrying a sequence; paper verso, sindur cinema recto",
  s06: "an exploded diagram (film layers) on a padma field; a process down a kantha thread",
  s07: "two pages facing as an opposition: grain against pixel, warm paper against neel",
  s08: "a number stack down a thread with a scanned picture; a full-bleed photograph with type in its sky",
  s09: "an album page with photo corners and a lal paar head; a quiet page with one magnified detail",
  s10: "back cover: night field, a watercolour moon, the bird on its line, two lines of verse, lal paar",
};
function examplesFor(pages: PublicationPage[], index: number, count: number): string[] {
  const types = pages.map((p) => String(p.type || "").toLowerCase());
  const first = pages[0]?.n ?? 0;
  let lead: string[];
  if (first === 1) lead = ["s00", "s10"];
  else if (pages.some((p) => p.n === count)) lead = ["s10", "s09"];
  else if (types.some((t) => /contents|statement|imprint|letter|editor/.test(t))) lead = ["s01", "s09"];
  else if (types.some((t) => /diagram|map|explain|how|process|anatomy/.test(t))) lead = ["s02", "s06"];
  else if (types.some((t) => /timeline|history|chronolog/.test(t))) lead = ["s03", "s08"];
  else if (types.some((t) => /portrait|profile|people|interview/.test(t))) lead = ["s04", "s09"];
  else lead = ["s03", "s05"];
  const rest = ["s07", "s08", "s05", "s04", "s02", "s06", "s03", "s09"].filter((s) => !lead.includes(s));
  return [...lead, rest[index % rest.length]];
}

async function exampleBlock(brand: Brand, ids: string[]): Promise<{ text: string; images: string[] }> {
  const dir = join(brand.dir, "author", "exemplars");
  const refs = [...brand.references].sort();
  const parts: string[] = [], images: string[] = [];
  for (const s of ids) {
    const script = await readFile(join(dir, `${s}.js`), "utf-8").catch(() => "");
    const texts = await readFile(join(dir, `${s}.texts.mjs`), "utf-8").catch(() => "");
    const ref = refs[Number(s.slice(1))];
    if (ref) images.push(ref);
    parts.push(`### Example ${s} (${EXAMPLES[s]})${ref ? ` - its render is image ${images.length}` : ""}\nIts text blocks (Ochin 01 was set in Bengali; the helpers head/body/deck/... are the same roles you use):\n\`\`\`js\n${texts.trim()}\n\`\`\`\nIts script:\n\`\`\`js\n${script.trim()}\n\`\`\``);
  }
  return { text: parts.join("\n\n"), images };
}

/* ---------------------------------------------------------------------- copy */

const clean = (s: string | null | undefined) => String(s ?? "").replace(/^#{1,6}\s*/gm, "").replace(/[*_`>]/g, "").trim();

function copyBlock(issue: PublicationIssue, pages: PublicationPage[], pictures: SpreadPicture[], count: number): string {
  return pages.map((p) => {
    const side = p.n === 1 ? "the cover, alone on the right" : p.n === count ? "the back cover, alone on the left" : p.n % 2 === 0 ? "verso (left)" : "recto (right)";
    const sec = issue.sections.find((s) => p.n >= s.from && p.n <= s.to);
    const w = worldFor(issue, p.n);
    const opens = sec && sec.from === p.n;
    const furniture = (p.furniture ?? []).map((f) => `  - ${f.kind}: ${f.text}`).join("\n");
    const pics = pictures.filter((q) => q.page === p.n).map((q) => `  - ${q.file} (${q.w}x${q.h}px): ${q.shows}. ${q.license}${q.artist ? `, ${q.artist}` : ""}${/by/i.test(q.license) ? " - credit it in a label beside it" : ""}`).join("\n");
    return [
      `## Page ${p.n}: ${side} · ${p.type}${opens ? " · OPENS its section" : ""}`,
      sec ? `Section ${sec.n} "${sec.label}"${w?.bn ? ` · Bengali name ${w.bn}` : ""}${w?.pair ? ` · section colours ${w.pair.join(" + ")}` : ""}${w?.lead ? ` · lead signature ${w.lead}` : ""}` : "Front or back matter.",
      `Title: ${clean(p.title)}`,
      p.deck ? `Deck: ${clean(p.deck)}` : "",
      p.n === 1
        // Ochin 01's cover: masthead, one device, title, deck and three teasers (১৮২৬ · দানা · ১৮৯৮), no body.
        ? `The cover sets no body. Its copy below is what the issue is about: draw the deck from it, then 2-3 teasers along the foot, each a big number or word in the mark face beside a short chip that points inside. Stories to tease, with their pages:\n${issue.pages.filter((q) => q.n > 3 && q.n < count && q.title).map((q) => `  - p${q.n} ${q.type}: ${clean(q.title)}`).join("\n")}${p.body ? `\nCover copy (source, not set):\n<<<\n${clean(p.body)}\n>>>` : ""}`
        : p.body ? `Body (every word of it is placed; split it into as many blocks as the design needs, in reading order):\n<<<\n${clean(p.body)}\n>>>` : "",
      p.pullQuote ? `Pull quote (optional, from the body): ${clean(p.pullQuote)}` : "",
      furniture ? `Furniture (each is placed):\n${furniture}` : "",
      pics ? `Pictures for this page (only these exist):\n${pics}` : "No photographs for this page: draw what it needs in code, or let type carry it.",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

/* --------------------------------------------------------------- the checks */

interface Placed { readonly text: Array<{ id: string; P: number; x: number; y: number; w: number; h: number; over?: boolean }>; readonly photo: Array<{ file: string; P: number }>; readonly cleared: number[] }

const words = (s: string) => (s.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}']{4,}/gu) ?? []).map((w) => w.replace(/'/g, ""));

/** What is wrong with a run, in code. Empty is a spread that may go to the eye. */
export function faultsOf(pages: PublicationPage[], texts: Record<string, { text?: string }>, placed: Placed, count: number): string[] {
  const f: string[] = [];
  const ns = pages.map((p) => p.n);
  // K.clear empties the whole spread, so clearing either page clears both.
  if (!ns.some((n) => placed.cleared.includes(n))) f.push(`the spread was not cleared (K.clear(${ns[0]}) first)`);
  const drawn = new Set(placed.text.map((t) => t.id));
  for (const id of Object.keys(texts)) if (!drawn.has(id)) f.push(`text block "${id}" was declared but never drawn`);
  for (const t of placed.text) {
    if (!ns.includes(t.P)) f.push(`"${t.id}" was drawn on page ${t.P}, which is not this spread's`);
    if (t.over) f.push(`"${t.id}" overruns its frame`);
    if (t.id !== "folio" && (t.x < 6 || t.x + t.w > 204 || t.y < 5 || t.y + t.h > 292)) f.push(`"${t.id}" on p${t.P} runs past the margin or the fold (x ${t.x.toFixed(1)}-${(t.x + t.w).toFixed(1)}, y ${t.y.toFixed(1)}-${(t.y + t.h).toFixed(1)})`);
  }
  const body = placed.text.filter((t) => t.id !== "folio");
  for (let i = 0; i < body.length; i++) for (let j = i + 1; j < body.length; j++) {
    const a = body[i]!, b = body[j]!;
    if (a.P !== b.P) continue;
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > 1 && iy > 1 && ix * iy > 0.08 * Math.min(a.w * a.h, b.w * b.h)) f.push(`"${a.id}" and "${b.id}" collide on p${a.P}`);
  }
  for (const n of ns) if (n !== 1 && n !== count && !placed.text.some((t) => t.id === "folio" && t.P === n)) f.push(`page ${n} has no folio (K.folio(${n}, colour))`);
  // every word of the copy, somewhere in what was drawn
  const set = new Set(Object.entries(texts).filter(([id]) => drawn.has(id)).flatMap(([, t]) => words(String(t?.text ?? ""))));
  for (const p of pages) {
    // The cover's body is source for its deck and teasers, not copy to set (copyBlock).
    const want = words([clean(p.title), clean(p.deck), p.n === 1 ? "" : clean(p.body)].join(" "));
    const missing = [...new Set(want.filter((w) => !set.has(w)))];
    if (missing.length > Math.max(3, want.length * 0.03)) f.push(`p${p.n}: copy is missing (${missing.length} words, e.g. ${missing.slice(0, 8).join(", ")}); every word of the title, deck and body is placed`);
  }
  return f;
}

/* ------------------------------------------------------------------ prompts */

function authorPrompt(brand: Brand, guide: string, issue: PublicationIssue, pages: PublicationPage[], copy: string, examples: string, before: string[]): string {
  return [
    `You are the designer of ${brand.name}. You design spread ${pages.map((p) => p.n).join("-")} of the issue "${issue.title || issue.subject}" by writing the script that draws it in Affinity, exactly as Ochin 01 was made: one idea per spread, carried by a drawn device (a diagram, a strip, a magnifier, a ruler, a field), photographs cut and placed with intent, type set from the ladder, the brand's shapes used for what they mean.`,
    "",
    "# The design system (the law)", brand.standard.trim(),
    "", "# The kit", guide.trim(),
    "", "# Ochin 01: how it was done (the images attached are these spreads as printed)", examples,
    before.length ? `\n# Spreads already designed in this issue (do not repeat their device or ground)\n${before.join("\n")}` : "",
    "", "# This spread's copy", copy,
    "",
    "# Your answer",
    "One JSON object, nothing else:",
    `{"plan": "one sentence: the spread's idea and its device", "texts": {"id": {"role": "...", "text": "...", "width": 0}}, "script": "the whole script as one string"}`,
    "The script is plain JavaScript using only K, T, C (see the kit); newlines inside the string written as \\n.",
  ].join("\n");
}

function revisePrompt(base: string, last: SpreadVersion, problems: string[], rendered: number): string {
  return [
    base, "",
    `# Your previous version (round ${last.round})`,
    `Plan: ${last.plan}`,
    "Texts:", "```json", JSON.stringify(last.texts, null, 1), "```",
    "Script:", "```js", last.script, "```",
    rendered ? `The first ${rendered === 1 ? "attached image is" : `${rendered} attached images are`} how that version rendered (page by page, left to right); the others are Ochin 01.` : "It did not render.",
    "", "# What is wrong with it (fix every point; keep what works)", ...problems.map((p) => `- ${p}`),
    "", "Answer with the whole corrected spread in the same JSON form.",
  ].join("\n");
}

function eyePrompt(brand: Brand, pages: number[], plan: string, rendered: number, types: string[] = []): string {
  // Told what each page is: a critic that does not know p1 is the cover asks it for a folio and a fold.
  const roles = pages.map((n, i) => `p${n} is ${types[i] ? `a ${types[i]} page` : "a page"}`).join(", ");
  const alone = pages.length === 1
    ? ` It is one page on its own (the ${pages[0] === 1 ? "front" : "back"} cover sits alone, not across a fold), and a cover carries no folio.`
    : "";
  return [
    `You are ${brand.name}'s art director. The first ${rendered === 1 ? "image is" : `${rendered} images are the pages of`} spread ${pages.join("-")} as just rendered, left to right (its idea: ${plan}). ${roles}.${alone} The other images are spreads of Ochin 01, the issue this brand was defined by.`,
    "Hold each page to the rules for its kind of page: what the design system allows on a cover, a section opener or the back cover is not a fault there.",
    // It read the folio's ৪ as an 8 and the designer deleted both folios to please it.
    `The folio at the foot is drawn by the kit and is right: its digits are Bengali (০১২৩৪৫৬৭৮৯, so ৪ is four and ৮ is eight) and this spread's pages are ${pages.join(" and ")}. Never ask for it to be moved, renumbered or removed.`,
    "Only the folio and Bengali lines use Bengali digits; numbers in English copy (dates, years) stay in English digits.",
    "Judge the new spread against them and against the design system below. Be strict: a spread that would not sit in Ochin 01 fails.",
    "", brand.standard.trim(), "",
    "Score 1-10 each: brand (palette, faces, shapes used for their meaning, the bilingual touch), hierarchy (one entry point, a clear reading order), composition (one idea carried by a device; space; nothing cramped or stranded), legibility (contrast, sizes, nothing over a busy picture), craft (alignment, edges, no collisions, nothing clipped or empty that should not be).",
    `Reply as JSON: {"scores": {"brand": 0, "hierarchy": 0, "composition": 0, "legibility": 0, "craft": 0}, "fixes": ["concrete change: which element, where, to what"]}. At most 6 fixes, most important first.`,
  ].join("\n");
}

export function eyeOf(out: Record<string, unknown>): SpreadVersion["eye"] {
  const s = (out.scores ?? {}) as Record<string, unknown>;
  const raw = ["brand", "hierarchy", "composition", "legibility", "craft"].map((k) => Number(s[k]) || 0);
  // Asked for 1-10; a critic that answers out of 100 must not pass everything (72 >= 8).
  const v = Math.max(...raw) > 10 ? raw.map((x) => x / 10) : raw;
  const total = Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
  const fixes = (Array.isArray(out.fixes) ? out.fixes : []).map(String).filter(Boolean).slice(0, 6);
  return { total, pass: total >= 8 && Math.min(...v) >= 7, fixes };
}

/* -------------------------------------------------------------------- pictures */

async function findPictures(ctx: RunnerContext, issue: PublicationIssue, pages: PublicationPage[], dir: string, count: number): Promise<SpreadPicture[]> {
  const file = join(dir, "pictures.json");
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf-8")) as SpreadPicture[];
  const tag = pages[0]!.n;
  const out = await ask(ctx, [
    `You choose the archive photographs for spread ${pages.map((p) => p.n).join("-")} of "${issue.title || issue.subject}", an Ochin issue built from real historical photographs and drawings (Wikimedia Commons, free licences only), with diagrams drawn in code.`,
    "Name only pictures that exist and that the copy is about: a named photograph, a person's portrait, an object, a document. At most 3 for the spread.",
    "The cover always carries the one photograph the issue is about (Ochin 01's cover holds the first surviving photograph inside a lens), and so does any page whose copy is about a named photograph, person or machine. Zero is right only for a page a drawn diagram or type carries better.",
    "", copyBlock(issue, pages, [], count), "",
    `Reply as JSON: {"pictures": [{"page": 4, "name": "short-file-name", "shows": "what it is, for the caption", "queries": ["Commons search words", "a second wording"]}]}`,
  ].join("\n"), `design-pictures-${tag}`);
  const wants = (Array.isArray(out.pictures) ? out.pictures : []).slice(0, 3) as Array<{ page?: number; name?: string; shows?: string; queries?: string[] }>;
  const got: SpreadPicture[] = [];
  for (const w of wants) {
    if (!w.name || !Array.isArray(w.queries)) continue;
    for (const q of w.queries.slice(0, 3)) {
      const thumbDir = join(dir, "candidates", String(w.name));
      const found = await shim<{ results?: Array<{ title: string; desc: string; license: string; w: number; h: number; thumbFile: string | null }> }>(ctx, "/pictures/search", { query: q, limit: 6, thumbDir }).catch(() => ({ results: [] }));
      const list = (found.results ?? []).filter((r) => r.thumbFile);
      if (!list.length) continue;
      const pick = await ask(ctx, [
        `Which of these ${list.length} pictures is "${w.shows}" (for page ${w.page})? They are the attached images, in order:`,
        ...list.map((r, i) => `${i + 1}. ${r.title} - ${r.desc.slice(0, 160)} (${r.w}x${r.h}, ${r.license})`),
        `Reply as JSON: {"choice": 1} with its number, or {"choice": 0} if none of them is it or none is good enough to print.`,
      ].join("\n"), `design-pick-${tag}`, list.map((r) => r.thumbFile!)).catch(() => ({ choice: 0 }));
      const c = Number(pick.choice) || 0;
      if (c < 1 || c > list.length) continue;
      const chosen = list[c - 1]!;
      const fetched = await shim<{ file?: string; w?: number; h?: number; license?: string; artist?: string }>(ctx, "/pictures/fetch", { title: chosen.title, issueDir: issueDir(ctx, issue.id), name: w.name }).catch(() => null);
      if (fetched?.file) got.push({ file: fetched.file, page: Number(w.page) || pages[0]!.n, shows: String(w.shows ?? ""), w: fetched.w ?? chosen.w, h: fetched.h ?? chosen.h, license: fetched.license ?? chosen.license, artist: fetched.artist ?? "" });
      break;
    }
  }
  await writeFile(file, JSON.stringify(got, null, 1), "utf-8");
  return got;
}

/* --------------------------------------------------------------------- author */

interface RunOut { ok?: boolean; error?: { message?: string; stack?: string } | string | null; placed?: Placed }

async function runVersion(ctx: RunnerContext, issue: PublicationIssue, pages: number[], v: { texts: Record<string, unknown>; script: string }): Promise<RunOut> {
  return shim<RunOut>(ctx, "/affinity/spread", { issue, issueDir: issueDir(ctx, issue.id), pages, script: v.script, texts: v.texts });
}

// Affinity writes only to the Desktop and exports one page at a time: each page lands there and is
// copied beside the spread. Returns the pages' images, left to right; empty when none rendered.
async function renderOf(ctx: RunnerContext, issue: PublicationIssue, pages: number[], stem: string): Promise<string[]> {
  const out: string[] = [];
  for (const n of pages) {
    const r = await shim<{ ok?: boolean; image?: string }>(ctx, "/affinity/render", { issue, page: n }).catch(() => null);
    if (!r?.ok || !r.image) continue;
    const to = `${stem}-p${n}.png`;
    try { await copyFile(r.image, to); out.push(to); } catch { out.push(r.image); }
  }
  return out;
}

/** Design one spread: pictures, author, run, check, look, revise. Saved under spreads/sNN. */
export async function authorSpread(ctx: RunnerContext, id: string, pages: number[], { rounds = 3, before = [] as string[] } = {}): Promise<SpreadResult> {
  const issue = await readIssue(ctx, id);
  const brand = loadBrand(issue.brand ?? null);
  if (!brand || !authors(brand)) throw new Error("this issue's brand does not design by authored spreads");
  const count = issue.pages.length;
  const pgs = pages.map((n) => issue.pages.find((p) => p.n === n)!).filter(Boolean);
  const dir = join(issueDir(ctx, id), "spreads", `s${String(pages[0]).padStart(2, "0")}`);
  await mkdir(dir, { recursive: true });

  // A spread already made is replayed, not designed again.
  const saved = join(dir, "result.json");
  if (existsSync(saved)) {
    const r = JSON.parse(await readFile(saved, "utf-8")) as SpreadResult;
    const run = await runVersion(ctx, issue, pages, r.best);
    if (run.ok) { say(ctx, id, `p${pages.join("-")}: replayed`); return r; }
  }

  say(ctx, id, `p${pages.join("-")}: finding pictures`);
  const pictures = await findPictures(ctx, issue, pgs, dir, count);
  const guide = await readFile(join(brand.dir, "author", "LIB.md"), "utf-8");
  const ex = await exampleBlock(brand, examplesFor(pgs, pages[0]!, count));
  const base = authorPrompt(brand, guide, issue, pgs, copyBlock(issue, pgs, pictures, count), ex.text, before);
  const tag = `design-spread-${pages[0]}`;

  const versions: SpreadVersion[] = [];
  const rank = (v: SpreadVersion) => (v.faults.length ? 0 : 100) + (v.eye?.total ?? 0) - v.faults.length;
  let problems: string[] = [], last: SpreadVersion | null = null, lastRender: string[] = [];
  for (let round = 1; round <= rounds; round++) {
    ctx.signal?.throwIfAborted();
    say(ctx, id, `p${pages.join("-")}: designing, round ${round}`);
    // up to three tries to get a version that runs
    let v: SpreadVersion | null = null, run: RunOut = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = last ? revisePrompt(base, last, problems, lastRender.length) : base;
      const images = last && lastRender.length ? [...lastRender, ...ex.images.slice(0, 2)] : ex.images;
      const out = await ask(ctx, prompt, tag, images);
      const texts = (out.texts && typeof out.texts === "object" ? out.texts : {}) as Record<string, unknown>;
      const script = String(out.script ?? "");
      v = { round, plan: String(out.plan ?? ""), texts, script, faults: [], eye: null, render: [] };
      if (!script.trim()) {
        problems = ["the answer had no script"]; last = v; lastRender = [];
        await writeFile(join(dir, `a${round}-${attempt + 1}.json`), JSON.stringify({ ...v, answer: out, error: problems[0] }, null, 1), "utf-8");
        continue;
      }
      run = await runVersion(ctx, issue, pages, v).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      if (run.ok) break;
      const err = typeof run.error === "string" ? run.error : `${run.error?.message ?? "unknown"} ${run.error?.stack ?? ""}`;
      problems = [`the script failed: ${err.slice(0, 600)}`];
      last = v; lastRender = [];
      // Kept, so a spread that never ran says why.
      await writeFile(join(dir, `a${round}-${attempt + 1}.json`), JSON.stringify({ ...v, error: err }, null, 1), "utf-8");
    }
    if (!v || !run.ok) continue;
    const faults = faultsOf(pgs, v.texts as Record<string, { text?: string }>, run.placed ?? { text: [], photo: [], cleared: [] }, count);
    const render = await renderOf(ctx, issue, pages, join(dir, `r${round}`));
    let eye: SpreadVersion["eye"] = null;
    if (render.length) {
      const look = await ask(ctx, eyePrompt(brand, pages, v.plan, render.length, pgs.map((p) => String(p.type ?? ""))), "design-look", [...render, ...ex.images.slice(0, 2)]).catch(() => null);
      if (look) eye = eyeOf(look);
    }
    v = { ...v, faults, eye, render };
    versions.push(v);
    await writeFile(join(dir, `v${round}.json`), JSON.stringify(v, null, 1), "utf-8");
    say(ctx, id, `p${pages.join("-")}: round ${round} - ${faults.length} fault(s), eye ${eye?.total ?? "none"}`);
    if (!faults.length && eye?.pass) break;
    // Good enough, or not getting better: each round is minutes of a designer and a critic.
    if (!faults.length && (eye?.total ?? 0) >= 7.5) break;
    if (versions.length > 1 && rank(v) <= rank(versions[versions.length - 2]!)) break;
    // Revise from the best version so far: a critic that contradicts itself round to round
    // otherwise walks a good spread downhill (cover 8.2 -> 7.2 -> 5).
    const top = [...versions].sort((a, b) => rank(b) - rank(a))[0]!;
    problems = [...top.faults, ...(top.eye?.fixes ?? [])];
    if (!problems.length) problems = ["the eye could not judge it; check every block against the design system"];
    last = top; lastRender = top.render;
  }

  if (!versions.length) throw new Error(`p${pages.join("-")}: no version of the spread ran`);
  const best = [...versions].sort((a, b) => rank(b) - rank(a))[0]!;
  if (best !== versions[versions.length - 1]) await runVersion(ctx, issue, pages, best);
  const result: SpreadResult = { pages, pass: !best.faults.length && !!best.eye?.pass, best, rounds: versions.length };
  await writeFile(saved, JSON.stringify(result, null, 1), "utf-8");
  return result;
}

/** Every spread of the issue, in order, each told what came before it. */
export async function authorIssue(ctx: RunnerContext, id: string, { rounds = 3, only = null as number[] | null } = {}): Promise<SpreadResult[]> {
  const issue = await readIssue(ctx, id);
  const out: SpreadResult[] = [], before: string[] = [];
  // Every spread's pictures up front, four at a time, instead of one spread after another.
  const todo = spreadsOf(issue.pages.length).filter((pages) => !only || pages.some((n) => only.includes(n)));
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map((pages) => {
      const dir = join(issueDir(ctx, id), "spreads", `s${String(pages[0]).padStart(2, "0")}`);
      const pgs = issue.pages.filter((p) => pages.includes(p.n));
      return mkdir(dir, { recursive: true }).then(() => findPictures(ctx, issue, pgs, dir, issue.pages.length)).catch(() => null);
    }));
  }
  for (const pages of spreadsOf(issue.pages.length)) {
    if (only && !pages.some((n) => only.includes(n))) continue;
    const r = await authorSpread(ctx, id, pages, { rounds, before });
    out.push(r);
    before.push(`p${pages.join("-")}: ${r.best.plan}`);
  }
  return out;
}

/** Saved spreads of an issue, for the editor to see where each stands. */
export async function spreadResults(ctx: RunnerContext, id: string): Promise<SpreadResult[]> {
  const dir = join(issueDir(ctx, id), "spreads");
  if (!existsSync(dir)) return [];
  const out: SpreadResult[] = [];
  for (const d of (await readdir(dir)).sort()) {
    const f = join(dir, d, "result.json");
    if (existsSync(f)) out.push(JSON.parse(await readFile(f, "utf-8")) as SpreadResult);
  }
  return out;
}
