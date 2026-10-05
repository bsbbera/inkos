/**
 * The reflow build (07 §Print, 14 §1.1b): text poured onto pages, and a cover.
 *
 * Books, shorts and translations had no print file at all — the build stopped
 * at an epub, or at "nothing builds this yet". A novel is not a magazine with
 * more pages: it wants running heads, chapters that open on a right-hand page,
 * a gutter that grows with the page count and no widows. Typst does all of that
 * from a source file, deterministically, with every font embedded, on any
 * machine — which also makes it the macOS and no-Affinity path.
 *
 * ponytail: Typst only, no Affinity autoflow script. The page-shaped magazine
 * keeps its Affinity build; an editable Affinity novel waits until someone asks
 * to hand-finish one.
 *
 * Text never goes into Typst markup raw. Every run of prose is a string literal
 * (`#"…"`), which Typst prints verbatim, so an asterisk, a hash or `//` in a
 * manuscript is a character and not an instruction.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { safeChildPath } from "../utils/path-safety.js";
import { readWorld } from "./image-prompt.js";
import {
  coverGeometry, ean13, gutterFor, inspectPdf, interiorPage, isbnDigits, pngSize, preflight,
  readPrintProfile, SERVICES, writePrintPackage,
  type PdfFacts, type PlacedImage, type PrintFinding, type PrintProfile,
} from "./print.js";

/* ------------------------------------------------------------ escaping */

/** A Typst string literal holding `text` exactly. */
export function lit(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

/** One line of prose with **strong** and *emphasis* kept, everything else literal. */
export function inline(text: string): string {
  const out: string[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|(?<![\p{L}\p{N}])_([^_\s][^_]*)_(?![\p{L}\p{N}])/gu;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push(`#${lit(text.slice(at, m.index))}`);
    if (m[1] !== undefined) out.push(`#strong(${lit(m[1])})`);
    else out.push(`#emph(${lit(m[2] ?? m[3] ?? "")})`);
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(`#${lit(text.slice(at))}`);
  return out.join("");
}

/**
 * Markdown prose as Typst content: headings, paragraphs, scene breaks and
 * block quotes. Anything else is a paragraph, which is what it reads as.
 */
export function prose(markdown: string, opts: { readonly chapterLevel?: number } = {}): string {
  const lift = (opts.chapterLevel ?? 1) - 1;
  const blocks = markdown.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const out: string[] = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(block);
    if (heading && !block.includes("\n")) {
      const level = Math.min(6, heading[1]!.length + lift);
      out.push(`#heading(level: ${level})[${inline(heading[2]!.trim())}]`);
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(block)) {
      out.push(`#align(center)[#v(0.4em)#${lit("*   *   *")}#v(0.4em)]`);
      continue;
    }
    if (block.startsWith(">")) {
      const text = block.split("\n").map((l) => l.replace(/^>\s?/, "")).join(" ");
      out.push(`#quote(block: true)[${inline(text)}]`);
      continue;
    }
    out.push(inline(block.split("\n").map((l) => l.trim()).join(" ")));
  }
  return out.join("\n\n");
}

const mm = (n: number) => `${Math.round(n * 100) / 100}mm`;

const SERIF = `("Libertinus Serif", "Georgia", "Times New Roman", "Noto Serif CJK SC", "SimSun")`;
const MONO = `("Courier Prime", "Courier New", "Noto Sans Mono CJK SC", "SimSun")`;

/* ------------------------------------------------------------ interior */

export interface Chapter {
  readonly title: string;
  readonly body: string;
}

/** Words to pages at a trade trim, near enough to choose a gutter from. */
export function estimatePages(chapters: ReadonlyArray<Chapter>, profile: PrintProfile): number {
  const words = chapters.reduce((n, c) => n + (c.body.match(/[\p{L}\p{N}']+/gu) ?? []).length
    + (c.body.match(/\p{Script=Han}/gu) ?? []).length / 2, 0);
  const perPage = Math.max(120, Math.round(320 * (profile.trim.w * profile.trim.h) / (152.4 * 228.6)));
  // Each chapter opens on a fresh right-hand page, about one and a half pages lost.
  return Math.max(24, Math.ceil(words / perPage + chapters.length * 1.5 + 4));
}

/**
 * A novel's interior: title page, contents, chapters opening recto, running
 * heads (book title left, chapter right), folios, widow and orphan control.
 */
export function interiorSource(input: {
  readonly title: string;
  readonly author?: string;
  readonly chapters: ReadonlyArray<Chapter>;
  readonly profile: PrintProfile;
  readonly language?: "zh" | "en";
}): string {
  const { profile } = input;
  const page = interiorPage(profile);
  const pages = estimatePages(input.chapters, profile);
  const inside = gutterFor(pages);
  const lang = input.language ?? "en";
  const body = input.chapters.map((c) => [
    `#pagebreak(to: "odd", weak: true)`,
    `#heading(level: 1)[${inline(c.title)}]`,
    prose(c.body.replace(/^#\s+.+\n/, ""), { chapterLevel: 2 }),
  ].join("\n\n")).join("\n\n");

  return `// Typeset by Quire. Edit the manuscript, not this file: it is rebuilt.
#set document(title: ${lit(input.title)}${input.author ? `, author: ${lit(input.author)}` : ""})
#set page(
  width: ${mm(page.w)}, height: ${mm(page.h)},
  margin: (inside: ${mm(inside + page.bleed)}, outside: ${mm(14 + page.bleed)}, top: ${mm(17 + page.bleed)}, bottom: ${mm(19 + page.bleed)}),
  header: context {
    let p = here().page()
    let opening = query(heading.where(level: 1)).any(h => h.location().page() == p)
    if p <= 4 or opening { return }
    set text(size: 8.5pt, style: "italic")
    if calc.even(p) { ${lit(input.title)} } else {
      let hs = query(heading.where(level: 1).before(here()))
      if hs.len() > 0 { align(right, hs.last().body) }
    }
  },
  footer: context {
    let p = here().page()
    if p > 4 { align(center, text(size: 9pt, counter(page).display())) }
  },
)
#set text(font: ${SERIF}, size: ${lang === "zh" ? "10.5pt" : "11pt"}, lang: ${lit(lang)}, hyphenate: ${lang === "en"}, costs: (widow: 100%, orphan: 100%))
#set par(justify: true, leading: ${lang === "zh" ? "0.9em" : "0.62em"}, first-line-indent: ${lang === "zh" ? "2em" : "1.2em"}, spacing: ${lang === "zh" ? "0.9em" : "0.62em"})
#show heading.where(level: 1): it => {
  v(26%)
  align(center, text(size: 17pt, weight: "regular", it.body))
  v(2.2em)
}
#show heading.where(level: 2): it => {
  v(0.8em)
  align(center, text(size: 11pt, style: "italic", it.body))
  v(0.5em)
}

// Half-title, title page, contents.
#page(header: none, footer: none)[#v(30%)#align(center, text(size: 14pt, ${lit(input.title)}))]
#page(header: none, footer: none)[]
#page(header: none, footer: none)[
  #v(24%)
  #align(center)[
    #text(size: 24pt, ${lit(input.title)})
    ${input.author ? `#v(1.4em)\n    #text(size: 13pt, ${lit(input.author)})` : ""}
  ]
]
#page(header: none, footer: none)[]
#outline(title: ${lit(lang === "zh" ? "目录" : "Contents")}, depth: 1, indent: 0pt)
#counter(page).update(1)

${body}
`;
}

/* ------------------------------------------------------------ pictures */

export interface Spread {
  readonly words: string;
  /** Absolute path, or null for a spread with no picture yet. */
  readonly image: string | null;
}

/**
 * A picture book: each spread's picture runs across both pages and off every
 * edge, the words sit on the right-hand page in a paper-coloured panel.
 *
 * The picture is placed once at full-spread width and shifted left on the
 * recto; the gutter falls where it falls in the drawing, which is how a
 * printed spread works and why the art is landscape.
 */
export function storybookSource(input: {
  readonly title: string;
  readonly author?: string;
  readonly spreads: ReadonlyArray<Spread>;
  readonly profile: PrintProfile;
  readonly root: string;
  readonly paper?: string;
  readonly ink?: string;
}): string {
  const { profile } = input;
  const page = interiorPage(profile);
  const b = page.bleed;
  const W = profile.trim.w;
  const H = page.h;
  const spreadW = 2 * W + 2 * b;
  const rectoShift = SERVICES[profile.service].bleedModel === "kdp" ? -(W + b) : -W;
  const paper = input.paper ?? "#fbf8f1";
  const ink = input.ink ?? "#201d18";
  const src = (file: string) => lit(`/${relative(input.root, file).replace(/\\/g, "/")}`);
  const pic = (file: string, dx: number) =>
    `#box(width: 100%, height: 100%, clip: true)[#move(dx: ${mm(dx)})[#image(${src(file)}, width: ${mm(spreadW)}, height: ${mm(H)}, fit: "cover")]]`;

  const pages = input.spreads.map((s) => {
    const words = `#block(width: 100%, inset: 7mm, radius: 1.5mm, fill: rgb(${lit(paper)}).transparentize(8%))[#set text(fill: rgb(${lit(ink)})); #par(justify: false)[${inline(s.words.replace(/\n+/g, " "))}]]`;
    if (!s.image) {
      return `#page[]\n#page[#align(horizon + center, box(width: 76%)[${words}])]`;
    }
    return [
      `#page[${pic(s.image, 0)}]`,
      `#page[${pic(s.image, rectoShift)}#place(bottom + center, dy: -${mm(14 + b)}, box(width: ${mm(W * 0.72)})[${words}])]`,
    ].join("\n");
  }).join("\n");

  return `// Typeset by Quire.
#set document(title: ${lit(input.title)}${input.author ? `, author: ${lit(input.author)}` : ""})
#set page(width: ${mm(page.w)}, height: ${mm(page.h)}, margin: 0pt, fill: rgb(${lit(paper)}))
#set text(font: ${SERIF}, size: 18pt, fill: rgb(${lit(ink)}))
#page[#align(horizon + center)[#text(size: 30pt, ${lit(input.title)})${input.author ? `#v(1em)#text(size: 15pt, ${lit(input.author)})` : ""}]]
#page[]
${pages}
${input.spreads.length % 2 ? "" : "#page[]"}
`;
}

/** A panel sheet: six pictures to a landscape page, captioned, then the boards' text. */
export function panelSheetSource(input: {
  readonly title: string;
  readonly panels: ReadonlyArray<{ readonly image: string; readonly caption: string }>;
  readonly text: string;
  readonly profile: PrintProfile;
  readonly root: string;
}): string {
  const page = interiorPage(input.profile);
  const src = (file: string) => lit(`/${relative(input.root, file).replace(/\\/g, "/")}`);
  const cells = input.panels.map((p, i) => `[#image(${src(p.image)}, width: 100%, height: 52mm, fit: "cover")
#text(size: 8pt)[#strong(${lit(String(i + 1))}) #${lit(p.caption)}]]`).join(",\n");
  return `// Typeset by Quire.
#set document(title: ${lit(input.title)})
#set page(width: ${mm(page.w)}, height: ${mm(page.h)}, margin: 12mm,
  header: align(right, text(size: 8pt, ${lit(input.title)})),
  footer: context align(center, text(size: 8pt, counter(page).display())))
#set text(font: ${SERIF}, size: 10pt)
${input.panels.length ? `#grid(columns: (1fr, 1fr, 1fr), gutter: 6mm,\n${cells}\n)` : ""}
${input.text.trim() ? `#pagebreak()\n#columns(2)[${prose(input.text)}]` : ""}
`;
}

/* ------------------------------------------------------------ screenplay */

/**
 * A screenplay in the industry layout: Courier 12 on Letter, scene headings in
 * capitals, character cues and dialogue at their fixed indents.
 *
 * Read from the plain text the script runner writes: a Markdown heading or an
 * INT./EXT. line is a scene; a short capitalised line — or "Name: line", the
 * habit of Chinese scripts — is a cue; (brackets) are a parenthetical; a line
 * ending "TO:" is a transition; the rest is action.
 */
export function screenplaySource(input: { readonly title: string; readonly author?: string; readonly text: string }): string {
  const out: string[] = [];
  const lines = input.text.replace(/\r\n/g, "\n").split("\n");
  let cue = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { cue = false; continue; }
    const md = /^#{1,6}\s+(.+)$/.exec(line);
    if (md || /^(INT\.|EXT\.|INT\/EXT|I\/E)/i.test(line) || /^第.{1,4}[场集幕]/.test(line)) {
      out.push(`#scene(${lit((md ? md[1]! : line).toUpperCase())})`);
      cue = false;
      continue;
    }
    if (/TO:$/.test(line) && line === line.toUpperCase()) { out.push(`#transition(${lit(line)})`); cue = false; continue; }
    const said = /^([^:：\s]{1,16})[:：]\s*(.+)$/.exec(line);
    if (said) { out.push(`#cue(${lit(said[1]!)})`, `#dialogue(${lit(said[2]!)})`); cue = true; continue; }
    if (/^[（(].+[)）]$/.test(line) && cue) { out.push(`#paren(${lit(line)})`); continue; }
    if (line.length <= 30 && /\p{Lu}/u.test(line) && line === line.toUpperCase() && !/[.!?]$/.test(line)) {
      out.push(`#cue(${lit(line)})`);
      cue = true;
      continue;
    }
    out.push(cue ? `#dialogue(${lit(line)})` : `#action(${lit(line)})`);
  }
  return `// Typeset by Quire.
#set document(title: ${lit(input.title)})
#set page(paper: "us-letter", margin: (left: 1.5in, right: 1in, top: 1in, bottom: 1in),
  header: context { if here().page() > 1 { align(right, counter(page).display() + ".") } })
#set text(font: ${MONO}, size: 12pt)
#set par(justify: false, leading: 0.55em, spacing: 1em)
#let scene(t) = block(above: 1.6em, below: 1em, strong(t))
#let action(t) = block(t)
#let cue(t) = block(above: 1em, below: 0pt, pad(left: 2.2in, upper(t)))
#let paren(t) = block(above: 0pt, below: 0pt, pad(left: 1.6in, right: 2in, t))
#let dialogue(t) = block(above: 0pt, pad(left: 1in, right: 1.5in, t))
#let transition(t) = block(align(right, t))
#page(header: none)[#v(35%)#align(center)[#upper(${lit(input.title)})${input.author ? `#v(1em)written by#v(0.5em)${lit(input.author)}` : ""}]]
${out.join("\n")}
`;
}

/* ------------------------------------------------------------ cover */

/** The full wrap: back with blurb and barcode, spine, front with the art or the title. */
export function coverSource(input: {
  readonly title: string;
  readonly author?: string;
  readonly profile: PrintProfile;
  readonly pages: number;
  readonly image?: string | null;
  readonly root: string;
  readonly paper?: string;
  readonly ink?: string;
}): string {
  const { profile } = input;
  const geo = coverGeometry(profile, input.pages);
  const paper = input.paper ?? "#f4efe4";
  const ink = input.ink ?? "#1d1a16";
  const safe = geo.safe;
  const src = (file: string) => lit(`/${relative(input.root, file).replace(/\\/g, "/")}`);
  const front = input.image
    ? `#place(top + left, dx: ${mm(geo.front.x)}, dy: 0mm, box(width: ${mm(geo.front.w + geo.bleed)}, height: ${mm(geo.height)}, clip: true, image(${src(input.image)}, width: 100%, height: 100%, fit: "cover")))
#place(top + left, dx: ${mm(geo.front.x + safe)}, dy: ${mm(geo.bleed + safe + 8)}, box(width: ${mm(geo.front.w - 2 * safe)}, inset: 5mm, fill: rgb(${lit(paper)}).transparentize(12%))[#align(center)[#text(size: 26pt, ${lit(input.title)})${input.author ? `#v(0.6em)#text(size: 13pt, ${lit(input.author)})` : ""}]])`
    : `#place(top + left, dx: ${mm(geo.front.x + safe)}, dy: ${mm(geo.bleed + geo.height * 0.26)}, box(width: ${mm(geo.front.w - 2 * safe)})[#align(center)[#text(size: 30pt, ${lit(input.title)})${input.author ? `#v(1.2em)#text(size: 14pt, ${lit(input.author)})` : ""}]])`;

  const spine = geo.spineText && geo.spine >= 6
    ? `#place(top + left, dx: ${mm(geo.spineAt.x)}, dy: ${mm(geo.bleed)}, box(width: ${mm(geo.spine)}, height: ${mm(profile.trim.h)})[#align(center + horizon)[#rotate(90deg, reflow: true)[#text(size: ${Math.min(11, Math.max(6, geo.spine * 0.55)).toFixed(1)}pt)[#${lit(input.title)}${input.author ? `#h(1.2em)#${lit(input.author)}` : ""}]]]])`
    : "";

  let barcode = "";
  if (profile.isbn && typeof isbnDigits(profile.isbn) === "string") {
    const bars = ean13(profile.isbn);
    const module = 0.33;
    const rects: string[] = [];
    for (let i = 0; i < bars.length; i += 1) {
      if (bars[i] !== "1") continue;
      let run = 1;
      while (bars[i + run] === "1") run += 1;
      const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
      rects.push(`#place(dx: ${mm(3.6 + i * module)}, dy: 3mm, rect(width: ${mm(run * module)}, height: ${guard ? "24.5mm" : "22.9mm"}, fill: black, stroke: none))`);
      i += run - 1;
    }
    const digits = isbnDigits(profile.isbn) as string;
    barcode = `#place(bottom + left, dx: ${mm(geo.back.x + geo.back.w - safe - 40)}, dy: -${mm(geo.bleed + safe)}, box(width: 40mm, height: 32mm, fill: white)[
${rects.join("\n")}
#place(bottom + center, dy: -1mm, text(font: ${MONO}, size: 7pt, fill: black, ${lit(`ISBN ${digits.slice(0, 3)}-${digits.slice(3)}`)}))
])`;
  }
  const blurb = profile.blurb
    ? `#place(top + left, dx: ${mm(geo.back.x + safe + 4)}, dy: ${mm(geo.bleed + safe + 12)}, box(width: ${mm(geo.back.w - 2 * safe - 8)})[#set par(justify: true); #text(size: 10.5pt, ${lit(profile.blurb)})])`
    : "";
  const price = profile.price
    ? `#place(bottom + left, dx: ${mm(geo.back.x + safe)}, dy: -${mm(geo.bleed + safe)}, text(size: 9pt, ${lit(profile.price)}))`
    : "";

  return `// Typeset by Quire. Full wrap: back | spine | front, ${mm(geo.bleed)} bleed.
#set document(title: ${lit(`${input.title} — cover`)})
#set page(width: ${mm(geo.width)}, height: ${mm(geo.height)}, margin: 0pt, fill: rgb(${lit(paper)}))
#set text(font: ${SERIF}, fill: rgb(${lit(ink)}))
${front}
${spine}
${blurb}
${barcode}
${price}
`;
}

/* ------------------------------------------------------------ compiling */

/** Where Typst is, or null. `QUIRE_TYPST` wins over the PATH. */
export function typstBinary(): string | null {
  const candidates = [process.env.QUIRE_TYPST, "typst"].filter(Boolean) as string[];
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { windowsHide: true, encoding: "utf-8" });
    if (r.status === 0) return bin;
  }
  return null;
}

export class TypstMissing extends Error {
  constructor() {
    super("Typst is not installed, so no print PDF can be made. Install it (winget install --id Typst.Typst, or brew install typst) and resume the run; the .typ source is already written.");
    this.name = "TypstMissing";
  }
}

/**
 * Write `source` beside `outPdf` and compile it.
 *
 * `root` is the Typst project root, which is what image paths starting with `/`
 * resolve against — the workspace, so art never has to be copied.
 */
export async function compileTypst(input: {
  readonly source: string;
  readonly outPdf: string;
  readonly root: string;
  readonly signal?: AbortSignal;
}): Promise<{ readonly pdf: string; readonly typ: string; readonly warnings: string }> {
  const typ = input.outPdf.replace(/\.pdf$/i, ".typ");
  await mkdir(dirname(input.outPdf), { recursive: true });
  await writeFile(typ, input.source, "utf-8");
  const bin = typstBinary();
  if (!bin) throw new TypstMissing();
  const { code, err } = await new Promise<{ code: number | null; err: string }>((res) => {
    const p = spawn(bin, ["compile", "--root", input.root, typ, input.outPdf], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); });
    input.signal?.addEventListener("abort", () => p.kill(), { once: true });
    p.on("close", (code) => res({ code, err }));
    p.on("error", (e) => res({ code: -1, err: String(e) }));
  });
  if (code !== 0) throw new Error(`Typst could not typeset ${typ}: ${err.trim().slice(0, 800)}`);
  return { pdf: input.outPdf, typ, warnings: err.trim() };
}

/* ------------------------------------------------------------ gathering */

async function readJsonMaybe<T>(file: string): Promise<T | null> {
  return await readFile(file, "utf-8").then((t) => JSON.parse(t) as T).catch(() => null);
}

/** The work's title, from whichever meta file this type keeps. */
export async function titleOf(workDir: string, fallback: string): Promise<string> {
  for (const name of ["book.json", "storybook.json", "final/short-story.json", "manifest.json", "project.json", "publication.json"]) {
    const meta = await readJsonMaybe<{ title?: unknown }>(join(workDir, name));
    if (typeof meta?.title === "string" && meta.title.trim()) return meta.title.trim();
  }
  return fallback.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const sortedMd = async (dir: string) =>
  (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".md") && !/\.pre-audit\./.test(n)).sort();

/** A chapter's own title: its first heading, or the filename without the number. */
function chapterTitle(markdown: string, name: string, n: number): string {
  const h = /^#\s+(.+)$/m.exec(markdown);
  if (h) return h[1]!.trim();
  const slug = name.replace(/\.md$/, "").replace(/^\d+[_-]?/, "").replace(/[-_]+/g, " ").trim();
  return slug || `Chapter ${n}`;
}

/** The chapters of a reflow-shaped work, in order, as the reader gets them. */
export async function chaptersOf(projectRoot: string, type: string, id: string, outDir: string): Promise<Chapter[]> {
  const dir = safeChildPath(projectRoot, join(outDir, id));
  if (type === "translation") {
    const out: Chapter[] = [];
    const files = (await readdir(join(dir, "translated")).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
    for (const name of files) {
      const ch = await readJsonMaybe<{ title?: string; number?: number; segments?: Array<{ target?: string; source?: string }> }>(join(dir, "translated", name));
      if (!ch?.segments?.length) continue;
      const body = ch.segments.map((s) => (s.target ?? "").trim()).filter(Boolean).join("\n\n");
      if (body) out.push({ title: ch.title ?? `Chapter ${ch.number ?? out.length + 1}`, body });
    }
    return out;
  }
  const chaptersDir = type === "short" ? join(dir, "final", "chapters") : join(dir, "chapters");
  const out: Chapter[] = [];
  for (const [i, name] of (await sortedMd(chaptersDir)).entries()) {
    const body = await readFile(join(chaptersDir, name), "utf-8");
    out.push({ title: chapterTitle(body, name, i + 1), body });
  }
  return out;
}

/** The picture a unit's gallery settled on — the approved one, else the first drawn. */
export async function chosenImage(artDir: string, unit: number, slot?: string): Promise<string | null> {
  const names = (await readdir(artDir).catch(() => [] as string[]))
    .filter((n) => n.startsWith(`${unit}-`) && /\.(png|jpe?g)$/i.test(n) && (!slot || n.includes(slot)))
    .sort();
  for (const name of names) {
    const recipe = await readJsonMaybe<{ approved?: unknown }>(join(artDir, name.replace(/\.[^.]+$/, ".recipe.json")));
    if (typeof recipe?.approved === "string") return join(artDir, name);
  }
  return names[0] ? join(artDir, names[0]) : null;
}

export const exists = (file: string) => existsSync(file);

/* ------------------------------------------------------------ the edition */

export interface PrintEdition {
  readonly interior: string;
  readonly cover: string | null;
  readonly pages: number;
  readonly findings: ReadonlyArray<PrintFinding>;
  readonly packageDir: string;
  readonly blocking: number;
}

const hanShare = (text: string) => (text.match(/\p{Script=Han}/gu) ?? []).length / Math.max(1, text.length);

/**
 * Typeset a work for print, make its cover, preflight both and write the
 * upload folder. Everything lands in `<work>/build/print/`.
 *
 * `interiorPdf` skips typesetting for work that already has its interior — the
 * magazine, whose pages Affinity lays out.
 */
export async function buildPrintEdition(input: {
  readonly projectRoot: string;
  readonly type: string;
  readonly id: string;
  /** Workspace-relative folder of the work. */
  readonly workRel: string;
  readonly interiorPdf?: string;
  readonly onProgress?: (message: string) => void;
  readonly signal?: AbortSignal;
}): Promise<PrintEdition> {
  const root = input.projectRoot;
  const work = safeChildPath(root, input.workRel);
  const out = join(work, "build", "print");
  const profile = await readPrintProfile(work, input.type);
  const title = await titleOf(work, input.id);
  const author = profile.author;
  const world = (await readWorld(root, input.type, input.id)) as { paper?: string; ink?: string } | null;
  const colours = { ...(world?.paper ? { paper: world.paper } : {}), ...(world?.ink ? { ink: world.ink } : {}) };
  const art = join(work, "art", "generated");
  const images: PlacedImage[] = [];
  const place = async (file: string | null, placedMm: number) => {
    if (!file) return;
    const px = await pngSize(file);
    if (px) images.push({ file, px, placedMm });
  };

  let interior = input.interiorPdf ?? null;
  if (!interior) {
    let source: string;
    if (input.type === "storybook") {
      const { loadStorybook, spreadPath, spreadWords } = await import("./storybook-runner.js");
      const meta = await loadStorybook(root, input.id);
      const spreads: Spread[] = [];
      for (let unit = 1; unit <= meta.spreads; unit += 1) {
        const words = await readFile(safeChildPath(root, spreadPath(input.id, unit)), "utf-8").then(spreadWords).catch(() => "");
        const image = await chosenImage(art, unit);
        await place(image, 2 * profile.trim.w + 2 * interiorPage(profile).bleed);
        spreads.push({ words, image });
      }
      source = storybookSource({ title, ...(author ? { author } : {}), spreads, profile, root, ...colours });
    } else if (input.type === "storyboard") {
      const dirs = [join(work, "assets", "selected"), art, join(work, "assets", "generated")];
      const panels: Array<{ image: string; caption: string }> = [];
      for (const dir of dirs) {
        const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort();
        for (const name of names) panels.push({ image: join(dir, name), caption: name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") });
        if (panels.length) break;
      }
      const text = await readFile(join(work, "storyboard.md"), "utf-8").catch(() => "");
      if (!panels.length && !text.trim()) throw new Error(`${input.workRel} has no panels and no storyboard.md to set`);
      source = panelSheetSource({ title, panels, text, profile, root });
    } else if (input.type === "script") {
      const text = await readFile(join(work, "script.md"), "utf-8").catch(() => "");
      if (!text.trim()) throw new Error(`${input.workRel}/script.md is missing or empty`);
      source = screenplaySource({ title, ...(author ? { author } : {}), text });
    } else {
      const outDir = input.workRel.split(/[\\/]/)[0]!;
      const chapters = await chaptersOf(root, input.type, input.id, outDir);
      if (!chapters.length) throw new Error(`${input.workRel} has no chapters to typeset`);
      const language = hanShare(chapters.map((c) => c.body).join("").slice(0, 4000)) > 0.15 ? "zh" : "en";
      source = interiorSource({ title, ...(author ? { author } : {}), chapters, profile, language });
    }
    input.onProgress?.(`Typesetting ${title} for print (${profile.trim.name}, ${profile.binding})…`);
    interior = (await compileTypst({ source, outPdf: join(out, "interior.pdf"), root, ...(input.signal ? { signal: input.signal } : {}) })).pdf;
  }

  const facts = await inspectPdf(interior);
  let cover: string | null = null;
  let coverFacts: PdfFacts | null = null;
  if (profile.binding !== "saddle") {
    const image = await chosenImage(art, 1, "cover");
    const geo = coverGeometry(profile, facts.pages);
    await place(image, geo.front.w + geo.bleed);
    input.onProgress?.(`Cover: ${geo.width} × ${geo.height} mm, spine ${geo.spine} mm for ${facts.pages} pages`);
    cover = (await compileTypst({
      source: coverSource({ title, ...(author ? { author } : {}), profile, pages: facts.pages, image, root, ...colours }),
      outPdf: join(out, "cover.pdf"), root, ...(input.signal ? { signal: input.signal } : {}),
    })).pdf;
    coverFacts = await inspectPdf(cover);
  }

  const findings = preflight({ profile, interior: facts, cover: coverFacts, images, spineText: true });
  const pkg = await writePrintPackage({ outDir: out, title, profile, interior, cover, pages: facts.pages, findings });
  input.onProgress?.(pkg.blocking
    ? `Print folder written with ${pkg.blocking} blocking preflight finding${pkg.blocking === 1 ? "" : "s"}: ${pkg.dir}`
    : `Print folder ready for ${SERVICES[profile.service].label}: ${pkg.dir}`);
  return { interior, cover, pages: facts.pages, findings, packageDir: pkg.dir, blocking: pkg.blocking };
}
