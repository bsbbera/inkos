/**
 * From a PDF to a bound copy (07 §Print, sellable feature 11 #1).
 *
 * The build gate ended at a file. The product ends at a book in the post, and
 * everything between the two is arithmetic: how thick the paper is, so how wide
 * the spine is, so how big the cover is; whether the page count suits the
 * binding; whether the fonts are in the file. None of it needs a model, so none
 * of it uses one — a preflight that could be talked out of a finding is not a
 * preflight.
 *
 * Nothing here submits or pays for anything. Every service gets a folder that
 * is ready to upload and a checklist in its own words; the person uploads. Lulu
 * does have a print API, but it takes files by public URL, and this app keeps a
 * person's manuscript on their own machine.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type Binding = "perfect" | "saddle" | "case";
export type Stock = "white" | "cream" | "color";
export type PrintService = "kdp" | "lulu" | "ingramspark" | "blurb" | "local";

export interface Trim {
  /** Millimetres, because every other number here is. */
  readonly w: number;
  readonly h: number;
  readonly name: string;
}

export interface PrintProfile {
  readonly trim: Trim;
  readonly binding: Binding;
  readonly stock: Stock;
  readonly colour: "mono" | "colour";
  readonly service: PrintService;
  /** Paper weight, used only by `local`, whose thickness nobody publishes. */
  readonly gsm?: number;
  /** Interior pictures run off the edge. Storybooks do; novels do not. */
  readonly bleed: boolean;
  readonly isbn?: string;
  readonly price?: string;
  readonly author?: string;
  readonly blurb?: string;
}

const IN = 25.4;

export const TRIMS: Readonly<Record<string, Trim>> = {
  "6x9in": { w: 6 * IN, h: 9 * IN, name: "6 × 9 in" },
  "5.5x8.5in": { w: 5.5 * IN, h: 8.5 * IN, name: "5.5 × 8.5 in" },
  "5x8in": { w: 5 * IN, h: 8 * IN, name: "5 × 8 in" },
  A5: { w: 148, h: 210, name: "A5" },
  "8.5x8.5in": { w: 8.5 * IN, h: 8.5 * IN, name: "8.5 × 8.5 in (square)" },
  "8x10in": { w: 8 * IN, h: 10 * IN, name: "8 × 10 in" },
  A4: { w: 210, h: 297, name: "A4" },
  letter: { w: 8.5 * IN, h: 11 * IN, name: "US Letter" },
};

export interface ServiceSpec {
  readonly label: string;
  readonly bleedMm: number;
  /**
   * `kdp`: interior bleed on the three outside edges only (page = trim + one
   * bleed wide, two tall). `all`: every edge, the rest of the trade's habit.
   */
  readonly bleedModel: "kdp" | "all";
  /** Inches of spine per page, by stock. */
  readonly perPage: Readonly<Record<Stock, number>>;
  /**
   * The spine table is an approximation of the service's own calculator and
   * the checklist says so. Only KDP publishes a flat per-page figure.
   */
  readonly approx: boolean;
  readonly minPages: Readonly<Record<Binding, number>>;
  readonly maxPages: number;
  /** Below this, the service prints no text on the spine. */
  readonly spineTextMinPages: number;
  readonly bindings: ReadonlyArray<Binding>;
  readonly upload: string;
  readonly interiorFormat: string;
}

// ponytail: per-page spine figures are flat averages. KDP's are its published
// numbers; the others drift by paper line, so the checklist sends people to the
// service's own calculator before they upload.
export const SERVICES: Readonly<Record<PrintService, ServiceSpec>> = {
  kdp: {
    label: "Amazon KDP",
    bleedMm: 0.125 * IN,
    bleedModel: "kdp",
    perPage: { white: 0.002252, cream: 0.0025, color: 0.002347 },
    approx: false,
    minPages: { perfect: 24, saddle: Infinity, case: 75 },
    maxPages: 828,
    spineTextMinPages: 79,
    bindings: ["perfect", "case"],
    upload: "https://kdp.amazon.com/en_US/bookshelf",
    interiorFormat: "PDF, fonts embedded",
  },
  lulu: {
    label: "Lulu",
    bleedMm: 0.125 * IN,
    bleedModel: "all",
    perPage: { white: 0.0025, cream: 0.0025, color: 0.0025 },
    approx: true,
    minPages: { perfect: 32, saddle: 4, case: 24 },
    maxPages: 800,
    spineTextMinPages: 80,
    bindings: ["perfect", "saddle", "case"],
    upload: "https://www.lulu.com/create",
    interiorFormat: "PDF, fonts embedded",
  },
  ingramspark: {
    label: "IngramSpark",
    bleedMm: 0.125 * IN,
    bleedModel: "all",
    perPage: { white: 0.0025, cream: 0.0027, color: 0.0025 },
    approx: true,
    minPages: { perfect: 18, saddle: 4, case: 18 },
    maxPages: 1200,
    spineTextMinPages: 48,
    bindings: ["perfect", "saddle", "case"],
    upload: "https://myaccount.ingramspark.com",
    interiorFormat: "PDF/X-1a or PDF/X-4, fonts embedded",
  },
  blurb: {
    label: "Blurb",
    bleedMm: 0.125 * IN,
    bleedModel: "all",
    perPage: { white: 0.0025, cream: 0.0025, color: 0.0025 },
    approx: true,
    minPages: { perfect: 24, saddle: 20, case: 20 },
    maxPages: 480,
    spineTextMinPages: 48,
    bindings: ["perfect", "saddle", "case"],
    upload: "https://www.blurb.com/pdf-to-book",
    interiorFormat: "PDF/X-3 or PDF/X-4, fonts embedded",
  },
  local: {
    label: "Local print shop",
    bleedMm: 3,
    bleedModel: "all",
    // Unused: `local` derives thickness from gsm.
    perPage: { white: 0, cream: 0, color: 0 },
    approx: true,
    minPages: { perfect: 32, saddle: 4, case: 32 },
    maxPages: 1000,
    spineTextMinPages: 64,
    bindings: ["perfect", "saddle", "case"],
    upload: "",
    interiorFormat: "PDF, fonts embedded, 3 mm bleed",
  },
};

/** What a kind of work usually is on paper, before anyone says otherwise. */
export function defaultProfile(type: string): PrintProfile {
  switch (type) {
    case "storybook":
      return { trim: TRIMS["8.5x8.5in"]!, binding: "case", stock: "color", colour: "colour", service: "lulu", bleed: true };
    case "publication":
      return { trim: TRIMS.A4!, binding: "saddle", stock: "color", colour: "colour", service: "local", gsm: 115, bleed: true };
    case "storyboard":
      return { trim: { w: 297, h: 210, name: "A4 landscape" }, binding: "saddle", stock: "white", colour: "colour", service: "local", gsm: 100, bleed: false };
    case "script":
      return { trim: TRIMS.letter!, binding: "perfect", stock: "white", colour: "mono", service: "local", gsm: 80, bleed: false };
    case "short":
      return { trim: TRIMS.A5!, binding: "perfect", stock: "cream", colour: "mono", service: "kdp", bleed: false };
    default:
      return { trim: TRIMS["6x9in"]!, binding: "perfect", stock: "cream", colour: "mono", service: "kdp", bleed: false };
  }
}

export const printPathOf = (workDir: string) => join(workDir, "print.json");

export async function readPrintProfile(workDir: string, type: string): Promise<PrintProfile> {
  const base = defaultProfile(type);
  const saved = await readFile(printPathOf(workDir), "utf-8")
    .then((t) => JSON.parse(t) as Partial<PrintProfile>)
    .catch(() => ({} as Partial<PrintProfile>));
  return normaliseProfile({ ...base, ...saved }, type);
}

/**
 * A profile as the screen sent it, held to what the service can do.
 *
 * A trim may arrive as a preset name or as millimetres; a binding the service
 * does not offer falls back to its first, rather than producing a cover for a
 * book nobody will print.
 */
export function normaliseProfile(raw: Record<string, unknown> | Partial<PrintProfile>, type: string): PrintProfile {
  const base = defaultProfile(type);
  const r = raw as Record<string, unknown>;
  const service = (Object.keys(SERVICES) as PrintService[]).includes(r.service as PrintService)
    ? r.service as PrintService : base.service;
  const spec = SERVICES[service];
  const trimRaw = r.trim;
  let trim: Trim = base.trim;
  if (typeof trimRaw === "string" && TRIMS[trimRaw]) trim = TRIMS[trimRaw]!;
  else if (trimRaw && typeof trimRaw === "object") {
    const t = trimRaw as Partial<Trim>;
    const w = Number(t.w);
    const h = Number(t.h);
    if (w >= 50 && h >= 50 && w <= 600 && h <= 600) trim = { w, h, name: String(t.name ?? `${Math.round(w)} × ${Math.round(h)} mm`) };
  }
  const binding = spec.bindings.includes(r.binding as Binding) ? r.binding as Binding : spec.bindings[0]!;
  const stock = (["white", "cream", "color"] as Stock[]).includes(r.stock as Stock) ? r.stock as Stock : base.stock;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const isbn = str(r.isbn);
  const price = str(r.price);
  const author = str(r.author);
  const blurb = str(r.blurb);
  const gsm = Number(r.gsm);
  return {
    trim, binding, stock, service,
    colour: r.colour === "mono" || r.colour === "colour" ? r.colour : base.colour,
    bleed: typeof r.bleed === "boolean" ? r.bleed : base.bleed,
    ...(gsm >= 40 && gsm <= 400 ? { gsm } : base.gsm ? { gsm: base.gsm } : {}),
    ...(isbn ? { isbn } : {}),
    ...(price ? { price } : {}),
    ...(author ? { author } : {}),
    ...(blurb ? { blurb } : {}),
  };
}

export async function writePrintProfile(workDir: string, profile: PrintProfile): Promise<void> {
  await mkdir(workDir, { recursive: true });
  await writeFile(printPathOf(workDir), `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
}

/** Spine width in millimetres. A saddle-stitched booklet has none. */
export function spineWidth(profile: PrintProfile, pages: number): number {
  if (profile.binding === "saddle") return 0;
  if (profile.service === "local") {
    // A leaf is two pages; 80 gsm uncoated is about a tenth of a millimetre.
    const leafMm = (profile.gsm ?? 80) / 800;
    return round((pages / 2) * leafMm);
  }
  return round(pages * SERVICES[profile.service].perPage[profile.stock] * IN);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The interior page as the file must be, bleed included. */
export function interiorPage(profile: PrintProfile): { w: number; h: number; bleed: number } {
  if (!profile.bleed) return { w: profile.trim.w, h: profile.trim.h, bleed: 0 };
  const spec = SERVICES[profile.service];
  const b = spec.bleedMm;
  return spec.bleedModel === "kdp"
    ? { w: round(profile.trim.w + b), h: round(profile.trim.h + 2 * b), bleed: b }
    : { w: round(profile.trim.w + 2 * b), h: round(profile.trim.h + 2 * b), bleed: b };
}

export interface CoverGeometry {
  readonly width: number;
  readonly height: number;
  readonly bleed: number;
  readonly spine: number;
  /** Where each panel starts, from the left edge of the full wrap. */
  readonly back: { readonly x: number; readonly w: number };
  readonly spineAt: { readonly x: number; readonly w: number };
  readonly front: { readonly x: number; readonly w: number };
  /** Text keeps this far from every trim and fold. */
  readonly safe: number;
  readonly spineText: boolean;
}

/** Front, spine and back in one sheet, with bleed on every outside edge. */
export function coverGeometry(profile: PrintProfile, pages: number): CoverGeometry {
  const spec = SERVICES[profile.service];
  const bleed = spec.bleedMm;
  const spine = spineWidth(profile, pages);
  const { w, h } = profile.trim;
  return {
    width: round(bleed + w + spine + w + bleed),
    height: round(bleed + h + bleed),
    bleed,
    spine,
    back: { x: bleed, w },
    spineAt: { x: round(bleed + w), w: spine },
    front: { x: round(bleed + w + spine), w },
    safe: 6.35,
    spineText: profile.binding !== "saddle" && pages >= spec.spineTextMinPages,
  };
}

/** The inside margin a book of this thickness needs so the gutter eats no words. */
export function gutterFor(pages: number): number {
  // KDP's published minimums, plus the 6 mm a reader's thumb wants.
  const min = pages <= 150 ? 0.375 : pages <= 300 ? 0.5 : pages <= 500 ? 0.625 : pages <= 700 ? 0.75 : 0.875;
  return round(min * IN + 6);
}

/* ------------------------------------------------------------ the barcode */

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** An ISBN-13 as digits, or the reason it is not one. */
export function isbnDigits(isbn: string): string | { readonly error: string } {
  const digits = isbn.replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(digits)) return { error: "an ISBN-13 has 13 digits" };
  if (!/^97[89]/.test(digits)) return { error: "an ISBN-13 starts 978 or 979" };
  const sum = [...digits.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[12]) ? digits : { error: `the check digit should be ${check}` };
}

/** EAN-13 as 95 modules, "1" for a bar. Throws on a bad ISBN; check it first. */
export function ean13(isbn: string): string {
  const digits = isbnDigits(isbn);
  if (typeof digits !== "string") throw new Error(`Not a valid ISBN: ${digits.error}`);
  const parity = PARITY[Number(digits[0])]!;
  let left = "";
  for (let i = 1; i <= 6; i += 1) {
    const d = Number(digits[i]);
    left += parity[i - 1] === "L" ? L[d] : G[d];
  }
  let right = "";
  for (let i = 7; i <= 12; i += 1) right += R[Number(digits[i])];
  return `101${left}01010${right}101`;
}

/* ------------------------------------------------------------ preflight */

export interface PrintFinding {
  readonly severity: "blocking" | "warning" | "note";
  readonly code: string;
  readonly message: string;
}

export interface PdfFacts {
  readonly pages: number;
  /** Every page's size in millimetres, first page first. */
  readonly sizes: ReadonlyArray<{ readonly w: number; readonly h: number }>;
  /** False: a font is referenced and not in the file. Null: could not tell. */
  readonly fontsEmbedded: boolean | null;
}

export interface PlacedImage {
  readonly file: string;
  readonly px: { readonly w: number; readonly h: number };
  /** How wide it prints, in millimetres. */
  readonly placedMm: number;
}

/**
 * Read the facts a preflight needs out of a PDF.
 *
 * ponytail: fonts are judged by a byte scan for font descriptors against
 * embedded font programs. A file that hides both inside compressed object
 * streams reads as "could not tell", never as a pass.
 */
export async function inspectPdf(file: string): Promise<PdfFacts> {
  const buf = await readFile(file);
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const sizes: Array<{ w: number; h: number }> = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view as number[];
    sizes.push({ w: round(((x1 - x0) / 72) * IN), h: round(((y1 - y0) / 72) * IN) });
  }
  const raw = buf.toString("latin1");
  const descriptors = (raw.match(/\/Type\s*\/FontDescriptor/g) ?? []).length;
  const programs = (raw.match(/\/FontFile[23]?\s/g) ?? []).length;
  const fontsEmbedded = descriptors === 0 ? null : programs >= descriptors;
  return { pages: pdf.numPages, sizes, fontsEmbedded };
}

/** PNG pixel size from its header, without decoding it. */
export async function pngSize(file: string): Promise<{ w: number; h: number } | null> {
  const buf = await readFile(file).catch(() => null);
  if (!buf || buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol;

/**
 * Every check a print service runs on upload, run here first, in its words.
 *
 * Pure: facts in, findings out. The service's own wording is used where it has
 * one, because "your manuscript's page size doesn't match your trim size" is
 * the sentence the person will see again on the upload screen.
 */
export function preflight(input: {
  readonly profile: PrintProfile;
  readonly interior: PdfFacts;
  readonly cover?: PdfFacts | null;
  readonly images?: ReadonlyArray<PlacedImage>;
  /** The cover carries spine text. */
  readonly spineText?: boolean;
}): ReadonlyArray<PrintFinding> {
  const { profile, interior } = input;
  const spec = SERVICES[profile.service];
  const out: PrintFinding[] = [];
  const pages = interior.pages;

  if (!spec.bindings.includes(profile.binding)) {
    out.push({ severity: "blocking", code: "binding", message: `${spec.label} does not offer ${profile.binding} binding.` });
  }
  const min = spec.minPages[profile.binding];
  if (pages < min) {
    out.push({ severity: "blocking", code: "pages-min", message: `${spec.label} needs at least ${min} pages for ${profile.binding} binding; this has ${pages}.` });
  }
  if (pages > spec.maxPages) {
    out.push({ severity: "blocking", code: "pages-max", message: `${spec.label} prints at most ${spec.maxPages} pages; this has ${pages}.` });
  }
  if (profile.binding === "saddle" && pages % 4 !== 0) {
    out.push({ severity: "blocking", code: "pages-four", message: `A saddle-stitched book is folded sheets, so its page count must divide by 4; this has ${pages}. Add ${4 - (pages % 4)} blank pages.` });
  }
  if (pages % 2 !== 0 && profile.binding !== "saddle") {
    out.push({ severity: "warning", code: "pages-even", message: `An odd page count (${pages}) gets a blank page added at the back by the printer.` });
  }

  const want = interiorPage(profile);
  const wrong = interior.sizes.findIndex((s) => !near(s.w, want.w) || !near(s.h, want.h));
  if (wrong >= 0) {
    const got = interior.sizes[wrong]!;
    out.push({
      severity: "blocking", code: "page-size",
      message: `Your manuscript's page size doesn't match your trim size: page ${wrong + 1} is ${got.w} × ${got.h} mm, the ${profile.trim.name}${want.bleed ? " with bleed" : ""} page is ${want.w} × ${want.h} mm.`,
    });
  }

  if (interior.fontsEmbedded === false) {
    out.push({ severity: "blocking", code: "fonts", message: "Some fonts are not embedded. Every font must be inside the PDF or the printer substitutes its own." });
  } else if (interior.fontsEmbedded === null) {
    out.push({ severity: "note", code: "fonts-unknown", message: "Could not confirm the fonts are embedded; the upload screen will say if they are not." });
  }

  for (const image of input.images ?? []) {
    if (image.placedMm <= 0) continue;
    const dpi = Math.round(image.px.w / (image.placedMm / IN));
    if (dpi < 200) {
      out.push({ severity: "blocking", code: "dpi", message: `${basename(image.file)} prints at ${dpi} dpi — it will look soft. Print wants 300; upscale it or print it smaller.` });
    } else if (dpi < 300) {
      out.push({ severity: "warning", code: "dpi", message: `${basename(image.file)} prints at ${dpi} dpi; print wants 300.` });
    }
  }

  if (input.cover) {
    const geo = coverGeometry(profile, pages);
    const size = input.cover.sizes[0];
    if (size && (!near(size.w, geo.width, 1) || !near(size.h, geo.height, 1))) {
      out.push({ severity: "blocking", code: "cover-size", message: `The cover is ${size.w} × ${size.h} mm; for ${pages} pages it must be ${geo.width} × ${geo.height} mm.` });
    }
    if (input.spineText && !geo.spineText) {
      out.push({ severity: "warning", code: "spine-text", message: `${spec.label} prints no spine text below ${spec.spineTextMinPages} pages.` });
    }
  }
  if (!profile.isbn && profile.service !== "local") {
    out.push({ severity: "note", code: "isbn", message: `No ISBN. ${spec.label} can assign a free one, and the back cover is left clear for its barcode.` });
  }
  if (spec.approx && profile.binding !== "saddle") {
    out.push({ severity: "note", code: "spine-approx", message: `The spine width is an estimate for ${spec.label}. Check it against their cover calculator before uploading.` });
  }
  return out;
}

/* ---------------------------------------------------------- the package */

export interface PrintPackage {
  readonly dir: string;
  readonly files: ReadonlyArray<string>;
  readonly blocking: number;
}

/**
 * A folder that is ready to upload, and the steps in the service's order.
 *
 * Never a submission: ordering spends money and ships to an address, and both
 * are decisions for the person at the upload screen.
 */
export async function writePrintPackage(input: {
  readonly outDir: string;
  readonly title: string;
  readonly profile: PrintProfile;
  readonly interior: string;
  readonly cover?: string | null;
  readonly pages: number;
  readonly findings: ReadonlyArray<PrintFinding>;
}): Promise<PrintPackage> {
  const spec = SERVICES[input.profile.service];
  const dir = join(input.outDir, input.profile.service);
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  const put = async (from: string, name: string) => {
    await copyFile(from, join(dir, name));
    files.push(join(dir, name));
  };
  await put(input.interior, "interior.pdf");
  if (input.cover) await put(input.cover, "cover.pdf");
  const geo = coverGeometry(input.profile, input.pages);
  const blocking = input.findings.filter((f) => f.severity === "blocking").length;
  await writeFile(join(dir, "print.json"), `${JSON.stringify({ ...input.profile, pages: input.pages, spineMm: geo.spine, cover: geo }, null, 2)}\n`, "utf-8");
  await writeFile(join(dir, "preflight.json"), `${JSON.stringify(input.findings, null, 2)}\n`, "utf-8");
  files.push(join(dir, "print.json"), join(dir, "preflight.json"));
  const checklist = [
    `# ${input.title} — ${spec.label}`,
    "",
    `${input.pages} pages · ${input.profile.trim.name} · ${input.profile.binding} · ${input.profile.stock} ${input.profile.colour === "mono" ? "black & white" : "colour"}`,
    input.profile.binding === "saddle" ? "No spine (saddle stitched)." : `Spine: ${geo.spine} mm${SERVICES[input.profile.service].approx ? " (estimate — check the service's calculator)" : ""}.`,
    `Cover sheet: ${geo.width} × ${geo.height} mm including ${geo.bleed} mm bleed.`,
    "",
    blocking
      ? `**${blocking} blocking finding${blocking === 1 ? "" : "s"} — fix before uploading:**`
      : "Preflight found nothing blocking.",
    ...input.findings.map((f) => `- [${f.severity}] ${f.message}`),
    "",
    "## Steps",
    spec.upload ? `1. Open ${spec.upload}` : "1. Take this folder to the print shop, or send it.",
    `2. Choose ${input.profile.trim.name}, ${input.profile.binding} binding, ${input.profile.stock} paper, ${input.profile.colour === "mono" ? "black & white" : "colour"} interior.`,
    `3. Upload \`interior.pdf\` as the interior (${spec.interiorFormat}).`,
    input.cover ? "4. Upload `cover.pdf` as a single full-wrap cover." : "4. The cover is page one of the interior.",
    "5. Order one proof copy first, and read it on paper before ordering more.",
    "",
    "Quire did not upload or order anything.",
    "",
  ].join("\n");
  await writeFile(join(dir, "CHECKLIST.md"), checklist, "utf-8");
  files.push(join(dir, "CHECKLIST.md"));
  return { dir, files, blocking };
}
