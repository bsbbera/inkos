/*
 * Pages composed by the model (plan 27, Phase 14).
 *
 * The model reads a page and places its frames on the grid itself: type,
 * vector-art areas and picture slots, each picture slot with a brief of what
 * it shows. Code supplies the grid's arithmetic and checks the result for
 * errors only: frames off the grid, type on type, copy that does not fit.
 * Problems go back to the model, in words, for at most two repairs. There is
 * no catalogue of layouts to fall back on: a page that cannot be composed is
 * said to have failed.
 */
import type { DesignSpec, PageLayout } from "./publication-design.js";
import { BLOCK_KINDS, sizeOf, type BlockSlot, type PageBlock } from "./page-blocks.js";
import { contrast } from "../publications/styles.js";
import { PAGE_H, PAGE_W, bodyCapacity, boxOf, edgesOf, geometryOf, titleSize, wordsOf, type Box } from "./layout-engine.js";

/** What a picture slot is for: generated later at its exact size (Phase 11). */
export interface SlotBrief {
  readonly id: string;
  /** generate: ComfyUI; reuse: a picture the workspace already has. */
  readonly route: "generate" | "reuse";
  /** What the picture shows, in a sentence. */
  readonly shows: string;
  /** How it is cropped and where its focus sits. */
  readonly crop?: string;
  /** How dark the picture is where type sits on it: the wireframe is filled at this tone. */
  readonly tone: "dark" | "mid" | "light";
}

export interface ComposedPage {
  readonly idea: string;
  readonly blocks: Array<PageBlock & { box: Box; brief?: SlotBrief }>;
  readonly problems: string[];
  /** Things code changed without asking (a block with nothing to carry, dropped). */
  readonly notes: string[];
}

/** What a page holds, for the composer and the checks. */
export interface PageCopy {
  readonly n: number;
  readonly type: string;
  readonly title?: string | null;
  readonly deck?: string | null;
  readonly body?: string | null;
  readonly pullQuote?: string | null;
  readonly furniture?: ReadonlyArray<{ kind: string; text?: string }>;
}

const TEXT = new Set(["figure", "title", "deck", "kicker", "body", "dropcap", "pull", "panel", "runhead", "wordmark", "folio"]);
const PT = 25.4 / 72;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The grid as the model needs it: cells in mm, rows, and how much body a frame holds. */
export function gridSheet(spec: Pick<DesignSpec, "grid" | "type">, n: number): string {
  const geo = geometryOf(spec);
  const cells = n % 2 ? geo.cells.recto : geo.cells.verso;
  const words = (span: number, columns: number) => {
    const box = boxOf(geo, n, { col: 1, span, row: 0, rows: Math.min(40, geo.rows) });
    return Math.round(bodyCapacity(box, columns, spec) / Math.min(40, geo.rows) * 10) / 10;
  };
  const caps = cells.map((_, i) => i + 1).map((span) => {
    const one = words(span, 1);
    const w = boxOf(geo, n, { col: 1, span, row: 0, rows: 1 }).w;
    return `span ${span}: ${one} words per row in one column` + (w > 100 ? `, ${words(span, 2)} in two` : "");
  });
  return [
    `Page ${PAGE_W} x ${PAGE_H} mm (page ${n}, ${n % 2 ? "right-hand" : "left-hand"}). Grid system: ${geo.system}.`,
    `Cells across (col is 1-based): ${cells.map((c, i) => `${i + 1}: x ${r1(c.x)} w ${r1(c.w)}`).join("; ")}.`,
    `Rows down: ${geo.rows} rows of ${r1(geo.baseline)} mm; row 0 is at y ${r1(geo.top)}, the last ends at y ${r1(geo.foot)}.`,
    geo.guides.length ? `The system's own horizontal lines, as fractions of the depth: ${geo.guides.map((g) => r1(g * 100) / 100).join(", ")}.` : "",
    `"bleed": true runs a frame to the trim on each side where it touches the first or last cell, row 0 or the last row.`,
    `How much body a frame holds (body size ${sizeOf({ kind: "body" }, spec.type?.scale) ?? 9.5} pt): ${caps.join("; ")}.`,
  ].filter(Boolean).join("\n");
}

/** The composer's call for one page. */
export function composePrompt(args: {
  readonly issueTitle: string;
  readonly page: PageCopy;
  readonly spec: Pick<DesignSpec, "grid" | "type">;
  readonly direction: string;
  readonly reading?: string;
  readonly section?: string;
  readonly neighbours?: string;
  readonly rules?: readonly string[];
  readonly previous?: { readonly blocks: unknown; readonly problems: readonly string[] };
  readonly note?: string;
  /** The chosen look's most extras; unset is no limit. */
  readonly extras?: number;
}): string {
  const p = args.page;
  const words = wordsOf(p.body);
  const figure = (p.furniture ?? []).find((f) => f.kind === "pull-number")?.text;
  const notes = (p.furniture ?? []).filter((f) => f.kind === "sidefact" || f.kind === "did-you-know").map((f) => f.text);
  const scale = [...(args.spec.type?.scale ?? [])].sort((a, b) => b - a);
  return `You are composing page ${p.n} of "${args.issueTitle}"${args.section ? `, section "${args.section}"` : ""}.
Place every frame of the page on its grid.

THE ISSUE'S DIRECTION (you wrote it; this page follows it):
${args.direction || "(none written)"}
${args.reading ? `\nHOW THIS PAGE READS (your reading of it):\n${args.reading}\n` : ""}${args.neighbours ? `\nTHE PAGES AROUND IT, as composed so far:\n${args.neighbours}\n` : ""}
WHAT IS ON THE PAGE (${p.type}):
- title: ${p.title ?? "(none)"}
${p.deck ? `- deck (standfirst): ${p.deck}\n` : ""}- body: ${words} words. It opens: ${(p.body ?? "").replace(/\s+/g, " ").slice(0, 500)}
${p.pullQuote ? `- pull quote: ${p.pullQuote}\n` : ""}${figure ? `- figure (a number to set large): ${figure}\n` : ""}${notes.length ? `- notes for a panel: ${notes.join(" | ")}\n` : ""}
THE GRID:
${gridSheet(args.spec, p.n)}
Type: ${args.spec.type?.display} (display), ${args.spec.type?.text} (text); scale ${scale.join(" / ")} pt. A title is set at
the largest size and only made smaller when its frame cannot hold it.

FRAMES. Kinds: ${BLOCK_KINDS.filter((k) => k !== "folio").join(", ")}.
- title, body${p.deck ? ", deck" : ""} must be placed. pull, figure and panel carry the content listed above, and are
  left out when the page has none. Set at most two of them: choose the ones that carry this page.
- image: a picture slot, generated later at exactly this size, with "brief": {"shows": "what the picture
  shows, one sentence", "crop": "how it is framed", "tone": "dark|mid|light" (how dark the picture is where
  type sits on it), "route": "generate"}.
- drawn: an area of vector art, drawn afterwards from shapes.
- kicker and panel take "text": a label of a few words on one line (a panel's notes are set from the content above, never put in "text"). body takes "columns" (1-3). dropcap takes "lines" (2-5) and sits
  at the top-left of the body.
- runhead is the running line at the head; wordmark sets the magazine's name; rule is a line.
- "color": ink|paper|accent|field, only when the default would be wrong.

What is checked after you answer (a frame that breaks these is sent back to you):
- every frame is on the grid: col + span - 1 within the cells, row + rows within the rows
- no frame of type covers another frame of type (a dropcap inside the body is fine)
- the body's frame holds all ${words} words with room to spare: size it for about ${Math.ceil(words * 1.1)} (print sets tighter than the estimate); the title fits its frame at no less than half the largest size
- the body is not set on a picture slot (the picture is not made yet, so its contrast is unknown)
- type on a picture reads on its tone: "color": "paper" only on a dark picture, ink only on a light one
- "paper" and "field" are grounds: type in paper off a picture, or in field on drawn art, cannot be seen
- a panel is tall enough for its notes
- the body reads at 35-75 characters a line (a wide frame takes 2 or 3 columns)
${args.extras != null ? `- at most ${args.extras} of pull, figure and panel (the chosen look)
` : ""}- no empty band across the middle of the page (white space is one zone at the head, foot or a side,
  never a hole between frames)
How the built page is scored: one dominant element (a picture, an art area or a figure) holding 40-60 % of
the page's visual weight; paper left empty on 25-50 % of the page; type sizes at least 1.2x apart; every
frame on the grid; type reading against its ground (7:1 body, 4.5:1 labels, 3:1 display).
${args.rules?.length ? `\nTHE EDITOR'S OWN RULES (follow every one):\n${args.rules.map((r) => `- ${r}`).join("\n")}\n` : ""}${args.note ? `\nTHE EDITOR ASKS FOR: ${args.note}\n` : ""}${args.previous ? `\nYOUR LAST ANSWER:\n${JSON.stringify(args.previous.blocks)}\nWHAT WAS WRONG WITH IT (fix every one, keep what worked):\n${args.previous.problems.map((x) => `- ${x}`).join("\n")}\n` : ""}
Return ONLY JSON:
{"idea": "one or two sentences: how this page is composed and why, from its reading",
 "blocks": [{"kind": "...", "col": 1, "span": 1, "row": 0, "rows": 1, "bleed": false}]}`;
}

const isInt = (v: unknown) => Number.isInteger(v);

/**
 * The model's frames, checked. Boxes are computed here from the grid; what is
 * wrong comes back as sentences the model can act on.
 */
/**
 * What the page is set on and what its furniture says, for the checks that need
 * real colours and real words: the builder (cli-shim blockPage) sets a running
 * head as brand + title on the left 60 % and the section on the right 40 %.
 */
export interface PageSetting {
  readonly paper: string;
  readonly field: string;
  readonly ink: string;
  readonly accent: string;
  readonly runhead?: string;
  readonly section?: string;
  /** The chosen look's most extras beside the body (looks.ts); unset is no limit. */
  readonly extras?: number;
  /** The chosen look layers colour: pictures on drawn shapes, type on coloured grounds. */
  readonly layers?: boolean;
}

export function checkComposition(
  raw: unknown, page: PageCopy, spec: Pick<DesignSpec, "grid" | "type">, setting?: PageSetting,
): ComposedPage {
  const geo = geometryOf(spec);
  const cols = geo.cells.recto.length;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.blocks) ? r.blocks : [];
  const problems: string[] = [];
  const notes: string[] = [];
  const blocks: ComposedPage["blocks"] = [];
  const has = {
    deck: !!page.deck, pull: !!page.pullQuote,
    figure: (page.furniture ?? []).some((f) => f.kind === "pull-number"),
    panel: (page.furniture ?? []).some((f) => ["sidefact", "did-you-know", "pull-number"].includes(f.kind)),
  } as Record<string, boolean>;
  let slots = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const kind = String(b.kind ?? "");
    const slotRaw = (b.slot && typeof b.slot === "object" ? b.slot : b) as Record<string, unknown>;
    if (!(BLOCK_KINDS as readonly string[]).includes(kind) || kind === "folio") { problems.push(`"${kind}" is not a frame kind`); continue; }
    if (kind in has && !has[kind]) { notes.push(`dropped the ${kind}: the page has nothing for it to carry`); continue; }
    if (!["col", "span", "row", "rows"].every((k) => isInt(slotRaw[k]))) { problems.push(`the ${kind} needs whole numbers for col, span, row and rows`); continue; }
    const slot: BlockSlot = {
      col: Number(slotRaw.col), span: Number(slotRaw.span), row: Number(slotRaw.row), rows: Number(slotRaw.rows),
      ...(slotRaw.bleed === true ? { bleed: true } : {}),
    };
    if (slot.col < 1 || slot.span < 1 || slot.col + slot.span - 1 > cols) { problems.push(`the ${kind} at col ${slot.col} span ${slot.span} runs off the ${cols} cells`); continue; }
    if (slot.row < 0 || slot.rows < 1 || slot.row + slot.rows > geo.rows) { problems.push(`the ${kind} at row ${slot.row} rows ${slot.rows} runs off the ${geo.rows} rows`); continue; }
    const box = boxOf(geo, page.n, slot);
    const block: PageBlock & { box: Box; brief?: SlotBrief } = {
      kind, slot, box,
      ...(typeof b.text === "string" && b.text.trim() ? { text: b.text.trim().slice(0, 80) } : {}),
      ...(["ink", "paper", "accent", "field"].includes(String(b.color)) ? { color: b.color as PageBlock["color"] } : {}),
      ...(kind === "body" ? { columns: Math.min(3, Math.max(1, Math.round(Number(b.columns) || (box.w > 120 ? 2 : 1)))) } : {}),
      ...(kind === "dropcap" ? { lines: Math.min(5, Math.max(2, Math.round(Number(b.lines) || 3))) } : {}),
    };
    if (kind === "image") {
      const br = (b.brief && typeof b.brief === "object" ? b.brief : {}) as Record<string, unknown>;
      const shows = String(br.shows ?? "").trim();
      if (!shows) problems.push(`the picture slot at col ${slot.col} row ${slot.row} has no brief: say what it shows`);
      (block as { brief?: SlotBrief }).brief = {
        id: `p${page.n}-${++slots}`, route: br.route === "reuse" ? "reuse" : "generate",
        shows: shows.slice(0, 300), ...(br.crop ? { crop: String(br.crop).slice(0, 160) } : {}),
        tone: br.tone === "dark" || br.tone === "light" ? br.tone : "mid",
      };
    }
    if (kind === "body" && blocks.some((x) => x.kind === "body")) { problems.push("a page has one body frame"); continue; }
    blocks.push(block);
  }

  const meets = (a: Box, b: Box) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
  const type = blocks.filter((b) => TEXT.has(b.kind) && b.kind !== "dropcap");
  for (let i = 0; i < type.length; i++) for (let j = i + 1; j < type.length; j++) {
    if (meets(type[i]!.box, type[j]!.box)) problems.push(`the ${type[i]!.kind} and the ${type[j]!.kind} cover each other`);
  }
  const body = blocks.find((b) => b.kind === "body");
  const words = wordsOf(page.body);
  if (words && !body) problems.push(`there is no body frame for the ${words} words`);
  if (body && words) {
    const cap = bodyCapacity(body.box, body.columns, spec);
    // 5 % to spare: Affinity sets tighter than the estimate, and Rain p2 printed cut mid-sentence.
    const need = Math.ceil(words * 1.05);
    if (cap < need) problems.push(`the body frame holds about ${cap} of the ${words} words and needs room to spare (about ${need}): give it about ${Math.ceil((need / Math.max(cap, 1) - 1) * (body.slot as BlockSlot).rows) + 1} more rows, more cells or another column`);
    for (const pic of blocks.filter((b) => b.kind === "image")) if (meets(pic.box, body.box)) problems.push("the body is set on a picture slot");
    // A line is read at 35-75 characters. Rain l2 p2 set 431 words in one 105-character
    // line across the page, and the eye sent it back four rounds running.
    const cols = body.columns ?? 1, gut = spec.grid?.gutterMm ?? 4;
    const pt = sizeOf({ kind: "body" }, spec.type?.scale) ?? 9.5;
    const chars = Math.round(((body.box.w - (cols - 1) * gut) / cols) / (pt * PT * 0.5));
    if (chars > 78) problems.push(`the body's lines run about ${chars} characters; a line reads at 35-75: give it ${Math.ceil(chars * cols / 70)} columns, or fewer cells`);
    else if (chars < 30) problems.push(`the body's lines run about ${chars} characters; a line reads at 35-75: fewer columns, or more cells`);
  }
  // As many extras as the chosen look carries. The minimal look keeps two of pull, figure
  // and panel (Rain l2 p2 carried all three and read as a notice board); a layered look may
  // carry more, and an issue with no look chosen is not limited here.
  const extras = blocks.filter((b) => b.kind === "pull" || b.kind === "figure" || b.kind === "panel");
  if (setting?.extras != null && extras.length > setting.extras) problems.push(`the page sets ${extras.map((b) => b.kind).join(", ")}: the chosen look carries ${setting.extras} beside the body - keep the ones that carry the page`);
  // White space is one deliberate zone, at the head, the foot or a side. An empty band
  // across the middle of the page is a hole: the page falls apart into two (Rain l2 p1).
  {
    const spans = blocks.filter((b) => b.kind !== "runhead" && b.kind !== "rule").map((b) => b.slot as BlockSlot)
      .map((s) => [s.row, s.row + s.rows] as const).sort((a, b) => a[0] - b[0]);
    let reach = spans[0]?.[1] ?? 0;
    for (const [from, to] of spans.slice(1)) {
      if (from - reach > geo.rows * 0.08) problems.push(`rows ${reach}-${from} are empty across the whole page, between frames: that is a hole, not white space - close it, or give it to the picture or the title`);
      reach = Math.max(reach, to);
    }
  }
  // Type set in its own ground's colour is invisible: "paper" is the page's ground (dark on a
  // dark issue), "field" the ground of drawn art. Night Markets set three decks in paper.
  for (const t of type) {
    if (t.color === "paper" && !blocks.some((g) => (g.kind === "image" || g.kind === "drawn") && meets(g.box, t.box))) {
      problems.push(`the ${t.kind} is set in paper, the page's own ground colour, so it cannot be seen: leave "color" out or set it in ink`);
    }
    if (t.color === "field" && blocks.some((g) => g.kind === "drawn" && meets(g.box, t.box))) {
      problems.push(`the ${t.kind} is set in field on drawn art, whose ground is field: it cannot be seen`);
    }
  }
  // A kicker or a panel's heading is set on one line (7.5 pt, tracked): a sentence there
  // overprints the rows below it (Swing Drumming p4).
  for (const b of blocks.filter((x) => (x.kind === "kicker" || x.kind === "panel") && x.text)) {
    const room = b.box.w - (b.kind === "panel" ? 9 : 0);
    const need = b.text!.length * 7.5 * PT * 0.72;
    // Said as what to do: told only that it ran long, the composer broke the sentence with
    // newlines three times running (Rain p3). The heading is a label; the notes carry the facts.
    const fits = Math.floor(room / (7.5 * PT * 0.72));
    if (need > room) problems.push(`the ${b.kind}'s "text" is a one-line label of at most ${fits} characters, and "${b.text!.replace(/\s+/g, " ")}" is ${b.text!.length}: give it a label of a few words, or leave "text" out - ${b.kind === "panel" ? "the panel's notes are set below it on their own" : "it is not a sentence"}`);
  }
  if (setting) {
    // A named colour must read on the ground it is set on: paper, or field under drawn art.
    // Pictures are judged by their promised tone below. Rain p3 set its kicker in paper on a
    // mid field at 1.9:1, legal by name and unreadable on the page.
    const hex: Record<string, string> = { ink: setting.ink, paper: setting.paper, accent: setting.accent, field: setting.field };
    const SMALL = new Set(["body", "deck", "kicker", "runhead", "panel"]);
    for (const t of type) {
      if (!t.color || blocks.some((g) => g.kind === "image" && meets(g.box, t.box))) continue;
      const onField = blocks.some((g) => g.kind === "drawn" && meets(g.box, t.box));
      const ratio = contrast(hex[t.color], onField ? setting.field : setting.paper);
      const least = SMALL.has(t.kind) ? 4.5 : 3;
      if (ratio !== null && ratio < least) {
        problems.push(`the ${t.kind} is set in ${t.color} on ${onField ? "the field" : "the paper"} at ${ratio.toFixed(1)}:1; it needs ${least}:1 - set it in another colour or leave "color" out`);
      }
    }
    // The running head is set on one line at 7 pt, tracked: too narrow a slot breaks it into pieces (Rain p2).
    const rh = blocks.find((b) => b.kind === "runhead");
    if (rh) {
      const em = 7 * PT * 0.72;
      const need = Math.max((setting.runhead ?? "").length * em / 0.6, (setting.section ?? "").length * em / 0.4);
      if (need > rh.box.w) problems.push(`the runhead is ${r1(rh.box.w)} mm wide; its words need about ${Math.ceil(need)} mm on one line: give it more cells`);
    }
  }
  // Type on a picture: its colour must suit the tone the picture was promised in.
  for (const pic of blocks.filter((b) => b.kind === "image")) {
    const tone = pic.brief?.tone ?? "mid";
    for (const t of type.filter((x) => meets(x.box, pic.box) && x.kind !== "body")) {
      const c = t.color;   // no colour: the builder picks whichever reads on the ground
      if (c === "paper" && tone !== "dark") problems.push(`the ${t.kind} is set in paper on a ${tone} picture: make the picture dark there, or set it in ink`);
      if (c === "ink" && tone === "dark") problems.push(`the ${t.kind} is set in ink on a dark picture: set it in paper, or make the picture light there`);
    }
  }
  // A panel holds its notes, measured as the builder sets them (cli-shim blockPage).
  const panel = blocks.find((b) => b.kind === "panel");
  if (panel) {
    const rows = (page.furniture ?? []).filter((f) => f.kind === "sidefact" || f.kind === "did-you-know").map((f) => f.text ?? "");
    if (!blocks.some((b) => b.kind === "figure")) {
      const fig = (page.furniture ?? []).find((f) => f.kind === "pull-number")?.text;
      if (fig) rows.unshift(fig);
    }
    const pw = panel.box.w - 9;
    const need = 17 + rows.reduce((h, t) => {
      const at = t.search(/:\s|\s[—–]\s/);
      const label = at > 0 ? t.slice(0, at) : "", value = at > 0 ? t.slice(at) : t;
      const vs = value.length > 34 ? 10 : 14;
      return h + (label ? Math.ceil(label.length * 6.2 * PT * 0.62 / pw) * 3.4 + 1.6 : 0)
        + Math.ceil(value.length * vs * PT * 0.5 / pw) * vs * PT * 1.25 + 1.5 + 3.5;
    }, 0);
    if (rows.length && need > panel.box.h + 0.5) problems.push(`the panel is ${r1(panel.box.h)} mm tall; its ${rows.length} notes need about ${r1(need)} mm at ${r1(panel.box.w)} mm wide`);
  }
  const scale = [...(spec.type?.scale ?? [])].sort((a, b) => b - a);
  const title = blocks.find((b) => b.kind === "title");
  if (page.title && !title) problems.push("there is no title frame");
  if (title && page.title) {
    const top = sizeOf({ kind: "title" }, scale) ?? 28;
    const size = titleSize(page.title, title.box, top);
    if (size < top / 2) problems.push(`the title frame (${r1(title.box.w)} x ${r1(title.box.h)} mm) only holds the title at ${size} pt of ${top}: make it wider or taller`);
    else if (size < top) (title as { size?: number }).size = size;
  }
  const deck = blocks.find((b) => b.kind === "deck");
  if (page.deck && !deck) problems.push("there is no deck frame for the standfirst");
  if (deck && page.deck) {
    const need = Math.ceil(page.deck.length * 8.5 * PT * 0.5 / Math.max(1, deck.box.w - 4)) * 8.5 * PT * 1.3;
    if (need > deck.box.h + 0.5) problems.push(`the deck frame is ${r1(deck.box.h)} mm tall; the standfirst needs about ${r1(need)} mm even at 8.5 pt`);
  }
  const idea = typeof r.idea === "string" ? r.idea.slice(0, 400) : "";
  return { idea, blocks, problems: [...new Set(problems)], notes };
}

/** The page's layout from a checked composition. */
export function layoutOf(c: ComposedPage, spec: Pick<DesignSpec, "grid" | "type">, n: number, before?: PageLayout): PageLayout {
  // A pattern or old art from an earlier design has no place on a composed page.
  // What was measured on the old layout is not true of this one.
  const { pattern: _p, mirror: _m, art: _a, shapes: _s, artIdea: _i, variant: _v, measured: _x, ...rest } = before ?? ({} as PageLayout);
  return {
    ...rest,
    layout: c.idea || before?.layout || "composed",
    imageSlot: c.blocks.some((b) => b.kind === "image") ? "inset" : "none",
    blocks: c.blocks,
    edges: edgesOf(geometryOf(spec), n),
    composed: { idea: c.idea, problems: c.problems },
  };
}

/** One line per composed page, for the next page's composer: what its neighbours did. */
export function compositionSummary(n: number, c: ComposedPage): string {
  const parts = c.blocks.filter((b) => b.kind !== "runhead").map((b) => {
    const s = b.slot as BlockSlot;
    return `${b.kind} c${s.col}+${s.span} r${s.row}+${s.rows}${s.bleed ? " bleed" : ""}`;
  });
  return `p${n}: ${c.idea} [${parts.join(", ")}]`;
}

/** Every picture slot of an issue, for ComfyUI (Phase 11): exact size, what it shows, its section's look. */
export function slotManifest(
  spec: DesignSpec,
  worldOf: (n: number) => { imagePrompt?: string; negative?: string; idiom?: string } | null,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [key, l] of Object.entries(spec.pages ?? {})) {
    for (const b of (l.blocks ?? []) as Array<PageBlock & { brief?: SlotBrief }>) {
      if (b.kind !== "image" || !b.brief || !b.box) continue;
      const w = worldOf(Number(key));
      const px = (mm: number) => Math.round(mm / 25.4 * 300);
      out.push({
        id: b.brief.id, page: Number(key), route: b.brief.route, shows: b.brief.shows,
        ...(b.brief.crop ? { crop: b.brief.crop } : {}),
        mm: { w: b.box.w, h: b.box.h }, px: { w: px(b.box.w), h: px(b.box.h) },
        aspect: Math.round(b.box.w / b.box.h * 1000) / 1000,
        style: [spec.imageDirection, w?.imagePrompt].filter(Boolean).join(" "),
        ...(w?.negative ? { negative: w.negative } : {}),
      });
    }
  }
  return out;
}
