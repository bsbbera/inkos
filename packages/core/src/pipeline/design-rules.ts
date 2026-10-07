/*
 * The golden rules a design spec must hold before anything renders (08 §5).
 *
 * Seven rules were written down; this enforces the ones a spec can answer on
 * its own, from what it declares, and leaves the rest to the page score:
 *
 *   6  no run of full-bleed pages longer than the law (default 2)
 *   7  a break from the rules is declared (`breaks` on a page), at most once
 *      per section (default 1)
 *      and a page does not carry more blocks than the law allows
 *
 * Whitespace, dominant weight and 60-30-10 are properties of the picture, not
 * of the spec; their numbers are kept (`minWhitespace`, `dominantMin`) so the
 * measuring pass has them, and checked nowhere here.
 *
 * The law's numbers are data. An accepted taste rule of kind `number` is
 * written here (`writeMath`) and the next design check enforces it, which is
 * how a repeated mistake becomes unbuildable (18 §4).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignSpec } from "./publication-design.js";

export interface DesignMath {
  readonly maxFullBleedRun?: number;
  readonly maxBreaksPerSection?: number;
  readonly maxBlocksPerPage?: number;
  /** Kept for the render-time measurement; not checkable from a spec. */
  readonly minWhitespace?: number;
  readonly dominantMin?: number;
  /** Least ratio between two type sizes on a page (page-blocks.ts, default 1.2). */
  readonly minScaleStep?: number;
  /** Characters a body line may hold (default 35-75). */
  readonly measureMin?: number;
  readonly measureMax?: number;
}

export const DEFAULT_MATH = { maxFullBleedRun: 2, maxBreaksPerSection: 1 } as const;

export interface SectionSpan { readonly n: number; readonly label?: string; readonly from: number; readonly to: number }

/** Every break a spec declares, for the gate to show as a badge rather than a warning. */
export function declaredBreaks(spec: DesignSpec | null | undefined): Array<{ page: number; note: string }> {
  const out: Array<{ page: number; note: string }> = [];
  for (const [key, layout] of Object.entries(spec?.pages ?? {})) {
    for (const note of layout.breaks ?? []) out.push({ page: Number(key), note });
  }
  return out.sort((a, b) => a.page - b.page);
}

/** What the spec breaks, as sentences. Empty means it holds. */
export function goldenRules(
  spec: DesignSpec | null | undefined,
  sections: ReadonlyArray<SectionSpan> | undefined,
  math: DesignMath = {},
): string[] {
  const bad: string[] = [];
  if (!spec) return bad;
  const law = { ...DEFAULT_MATH, ...math };
  const pages = Object.entries(spec.pages ?? {})
    .map(([key, layout]) => ({ n: Number(key), layout }))
    .filter((p) => Number.isInteger(p.n))
    .sort((a, b) => a.n - b.n);

  // Rule 6: a run of full-bleed pages.
  let run: number[] = [];
  const closeRun = (): void => {
    if (run.length > law.maxFullBleedRun) {
      bad.push(`pages ${run[0]}-${run[run.length - 1]} are ${run.length} full-bleeds in a row - the law is ${law.maxFullBleedRun}`);
    }
    run = [];
  };
  for (const p of pages) {
    const last = run[run.length - 1];
    if (p.layout.imageSlot === "full-bleed" && (last === undefined || p.n === last + 1)) run.push(p.n);
    else { closeRun(); if (p.layout.imageSlot === "full-bleed") run = [p.n]; }
  }
  closeRun();

  // Rule 7: breaks are declared, and rationed per section.
  const sectionOf = (n: number) => sections?.find((s) => n >= s.from && n <= s.to);
  const perSection = new Map<string, number>();
  for (const { page, note } of declaredBreaks(spec)) {
    if (!note.trim()) bad.push(`page ${page} declares a break without saying what it breaks`);
    const s = sectionOf(page);
    const key = s ? (s.label ?? `section ${s.n}`) : "the issue";
    perSection.set(key, (perSection.get(key) ?? 0) + 1);
  }
  for (const [name, count] of perSection) {
    if (count > law.maxBreaksPerSection) {
      bad.push(`${name} declares ${count} breaks - the law is ${law.maxBreaksPerSection}`);
    }
  }

  // A taste rule's own limit: how much one page is asked to carry.
  if (math.maxBlocksPerPage !== undefined) {
    for (const p of pages) {
      const count = p.layout.blocks?.length ?? 0;
      if (count > math.maxBlocksPerPage) {
        bad.push(`page ${p.n} carries ${count} blocks - the law is ${math.maxBlocksPerPage}`);
      }
    }
  }
  return bad;
}

/**
 * Repair what a spec breaks, the cheapest way, without asking a model.
 *
 * A run of full-bleeds loses its later pages to a top-set picture, surplus
 * breaks past the section's ration are dropped (the later ones), and a page
 * carrying too many blocks keeps the first ones. What it changed is returned,
 * so the person is told rather than surprised. Anything it cannot mend (a break
 * with no explanation) is left for the check to report.
 */
export function repairGoldenRules(
  spec: DesignSpec,
  sections: ReadonlyArray<SectionSpan> | undefined,
  math: DesignMath = {},
): { spec: DesignSpec; repairs: string[] } {
  const law = { ...DEFAULT_MATH, ...math };
  const repairs: string[] = [];
  const pages: Record<string, PageLayoutLike> = {};
  for (const [k, v] of Object.entries(spec.pages ?? {})) pages[k] = { ...v };
  const numbers = Object.keys(pages).map(Number).filter(Number.isInteger).sort((a, b) => a - b);

  let run = 0, prev = -2;
  for (const n of numbers) {
    const bleed = pages[String(n)]!.imageSlot === "full-bleed";
    run = bleed ? (n === prev + 1 ? run + 1 : 1) : 0;
    prev = bleed ? n : -2;
    if (bleed && run > law.maxFullBleedRun) {
      pages[String(n)] = { ...pages[String(n)]!, imageSlot: "top" };
      repairs.push(`page ${n}: full-bleed became a top picture, to end a run of ${law.maxFullBleedRun + 1}`);
      run = 0; prev = -2;
    }
  }

  const sectionOf = (n: number) => sections?.find((s) => n >= s.from && n <= s.to);
  const used = new Map<string, number>();
  for (const n of numbers) {
    const layout = pages[String(n)]!;
    if (!layout.breaks?.length) continue;
    const key = String(sectionOf(n)?.n ?? "none");
    const keep: string[] = [];
    for (const note of layout.breaks) {
      if ((used.get(key) ?? 0) < law.maxBreaksPerSection) { keep.push(note); used.set(key, (used.get(key) ?? 0) + 1); }
      else repairs.push(`page ${n}: dropped a break past the section's ${law.maxBreaksPerSection}`);
    }
    pages[String(n)] = { ...layout, breaks: keep };
  }

  if (math.maxBlocksPerPage !== undefined) {
    for (const n of numbers) {
      const blocks = pages[String(n)]!.blocks;
      if (blocks && blocks.length > math.maxBlocksPerPage) {
        pages[String(n)] = { ...pages[String(n)]!, blocks: blocks.slice(0, math.maxBlocksPerPage) };
        repairs.push(`page ${n}: kept the first ${math.maxBlocksPerPage} of ${blocks.length} blocks`);
      }
    }
  }
  return { spec: { ...spec, pages: pages as DesignSpec["pages"] }, repairs };
}

type PageLayoutLike = { -readonly [K in keyof DesignSpec["pages"][string]]: DesignSpec["pages"][string][K] };

/*
 * ------------------------------------------------------------- number rules
 */

/** A taste rule written as a sentence, read as a number the checker can hold. Null when it is not one. */
export function parseNumberRule(text: string): { key: keyof DesignMath; value: number } | null {
  const t = text.toLowerCase();
  const most = "(?:no more than|at most|max(?:imum)?(?: of)?|up to|≤)";
  const share = (m: RegExpMatchArray | null): number | null => {
    if (!m) return null;
    const v = Number(m[1]);
    return v > 1 ? v / 100 : v;
  };

  let m = t.match(new RegExp(`${most}\\s*(\\d+)\\s*full[- ]?bleeds?`));
  if (m) return { key: "maxFullBleedRun", value: Number(m[1]) };
  m = t.match(/(\d+)\s*full[- ]?bleeds?\s*(?:in a row|running|at most|max)/);
  if (m) return { key: "maxFullBleedRun", value: Number(m[1]) };

  m = t.match(new RegExp(`${most}\\s*(\\d+)\\s*breaks?\\s*(?:per|a|each)\\s*section`));
  if (m) return { key: "maxBreaksPerSection", value: Number(m[1]) };

  m = t.match(new RegExp(`${most}\\s*(\\d+)\\s*(?:blocks?|elements?)\\s*(?:per|on a|on each|a)\\s*page`));
  if (m) return { key: "maxBlocksPerPage", value: Number(m[1]) };

  const ws = share(t.match(/whitespace[^0-9]*?(\d+(?:\.\d+)?)\s*%?/));
  if (ws !== null && ws > 0 && ws <= 1) return { key: "minWhitespace", value: ws };

  m = t.match(/(?:sizes?|scale|steps?)[^0-9]*?(\d+(?:\.\d+)?)\s*(?:x|×|times)/);
  if (m && Number(m[1]) > 1 && Number(m[1]) < 4) return { key: "minScaleStep", value: Number(m[1]) };

  m = t.match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*char/);
  if (m) return { key: "measureMax", value: Number(m[2]) };

  const dom = share(t.match(/dominant[^0-9]*?(\d+(?:\.\d+)?)\s*%?/));
  if (dom !== null && dom > 0 && dom <= 1) return { key: "dominantMin", value: dom };
  return null;
}

const mathFile = (root: string) => join(root, "_taste", "math.json");

async function readAll(root: string): Promise<Record<string, DesignMath>> {
  try { return JSON.parse(await readFile(mathFile(root), "utf-8")) as Record<string, DesignMath>; } catch { return {}; }
}

/** `global`, `type:publication`, `world:<register>` or `work:<type>/<id>`, from a proposal's scope. */
export function mathScopeOf(scope: Readonly<Record<string, string>>): string {
  if (scope.work) return `work:${scope.work}`;
  if (scope.world) return `world:${scope.world}`;
  if (scope.type) return `type:${scope.type}`;
  return "global";
}

/** Write one number into a scope's math block. */
export async function writeMath(root: string, scope: string, key: keyof DesignMath, value: number): Promise<void> {
  const all = await readAll(root);
  all[scope] = { ...(all[scope] ?? {}), [key]: value };
  await mkdir(join(root, "_taste"), { recursive: true });
  await writeFile(mathFile(root), JSON.stringify(all, null, 2), "utf-8");
}

/** The law for one issue: global, then its type, then its worlds, then the issue itself - later wins. */
export async function readMath(
  root: string,
  work: { readonly type: string; readonly id: string; readonly worlds?: ReadonlyArray<string> },
): Promise<DesignMath> {
  const all = await readAll(root);
  const keys = ["global", `type:${work.type}`, ...(work.worlds ?? []).map((w) => `world:${w}`), `work:${work.type}/${work.id}`];
  return keys.reduce<DesignMath>((m, k) => ({ ...m, ...(all[k] ?? {}) }), {});
}
