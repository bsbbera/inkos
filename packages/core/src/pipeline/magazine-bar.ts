/**
 * The magazine's bar (13 §4b, §9): what every page is held to before a person
 * is asked to look at it.
 *
 * A magazine sells on the flip and reads only if the copy is as designed as
 * the page. So: sentences a reader of this age can hold, one idea opened on a
 * thing rather than a definition, a did-you-know on every spread with a
 * source, numbers compared to something the reader knows, section names that
 * are ways of looking rather than school subjects — and a rendered page that
 * is not crowded, loud or busy.
 *
 * All of it is counting. None of it needs a model, which is why it runs on
 * every page every time and why a page can be failed by it without argument.
 */
import type { PublicationDefinition } from "../publications/types.js";
import type { PublicationFinding } from "./publication-audit.js";
import type { PublicationIssue, PublicationPage } from "./publication-runner.js";

export type Audience = "child-5" | "child-9" | "teen" | "general" | "expert";

interface Bar {
  /** Average words per sentence, at most. Characters for Chinese. */
  readonly sentence: number;
  /** Flesch-Kincaid grade, at most. English only. */
  readonly grade: number;
  /** Longest paragraph, in words. */
  readonly paragraph: number;
  /** Words a page may carry: light / feature / dense (design-skill §1). */
  readonly caps: readonly [number, number, number];
}

export const BARS: Readonly<Record<Audience, Bar>> = {
  "child-5": { sentence: 12, grade: 4, paragraph: 45, caps: [60, 120, 180] },
  "child-9": { sentence: 14, grade: 6, paragraph: 60, caps: [120, 220, 300] },
  teen: { sentence: 18, grade: 8, paragraph: 90, caps: [180, 350, 450] },
  general: { sentence: 20, grade: 10, paragraph: 110, caps: [180, 350, 450] },
  expert: { sentence: 26, grade: 14, paragraph: 160, caps: [350, 500, 650] },
};

/** The bar's name as a person reads it in a finding. */
const READERS: Readonly<Record<Audience, string>> = {
  "child-5": "readers around 5", "child-9": "readers around 9", teen: "teen readers",
  general: "general readers", expert: "expert readers",
};
const PAGE_WEIGHT = ["a light page", "a feature page", "a dense page"] as const;

/** Whatever the intake said about the reader, as one of the five bars. */
export function audienceOf(text: string | undefined | null): Audience {
  const t = String(text ?? "").toLowerCase();
  if (!t) return "general";
  if (/expert|professional|academic|specialist|专业/.test(t)) return "expert";
  // An age, when one is given, decides: the youngest reader named sets the bar.
  const ages = [...t.matchAll(/\d{1,2}/g)].map((m) => Number(m[0])).filter((n) => n >= 2 && n <= 18);
  if (ages.length && /age|year|yr|岁|kid|child|reader|-|–|\bto\b/.test(t)) {
    const low = Math.min(...ages);
    return low <= 6 ? "child-5" : low <= 11 ? "child-9" : low <= 16 ? "teen" : "general";
  }
  if (/teen|young adult|青少年/.test(t)) return "teen";
  if (/pre-?school|toddler|five|幼儿/.test(t)) return "child-5";
  if (/kid|child|children|junior|儿童|孩子/.test(t)) return "child-9";
  return "general";
}

const isZh = (text: string) => (text.match(/\p{Script=Han}/gu) ?? []).length > text.length * 0.15;

export function sentencesOf(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?。！？])\s*/u).map((s) => s.trim()).filter((s) => s.length > 1);
}

const wordsOf = (text: string) => (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []);

/** Syllables by vowel groups — the Flesch habit, close enough to rank pages by. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

/** Flesch-Kincaid grade level of English prose. */
export function gradeOf(text: string): number {
  const s = sentencesOf(text);
  const words = wordsOf(text);
  if (!s.length || !words.length) return 0;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return Math.round((0.39 * (words.length / s.length) + 11.8 * (syl / words.length) - 15.59) * 10) / 10;
}

const DEFINITION_EN = /^(?:(?:a|an|the)\s+)?[\p{L}-]+(?:\s+[\p{L}-]+){0,3}\s+(?:is|are|was|were|means|refers to)\s+(?:a|an|the|one|when|how|what)\b/iu;
const DEFINITION_ZH = /^.{1,12}(?:是一种|是指|指的是|就是)/u;
const COMPARED = /\b(?:as (?:big|heavy|tall|long|fast|far|old|many|much|wide|deep|hot|cold|bright|loud)\b|than|times|like|about the size|the size of|equal to|same as|enough to|≈)|相当于|比|倍|那么/iu;
const SUBJECTS = new Set([
  "physics", "chemistry", "biology", "mathematics", "maths", "math", "history", "geography", "science",
  "economics", "astronomy", "geology", "literature", "物理", "化学", "生物", "数学", "历史", "地理", "科学",
]);

const kindIs = (kind: string, re: RegExp) => re.test(kind.toLowerCase().replace(/[\s_-]+/g, ""));

/**
 * The writing bar over every written page of an issue.
 *
 * Findings in the publication audit's own shape, so they sit beside the AI-tell
 * and length findings and go through the same revise pass.
 */
export function readabilityFindings(
  issue: Pick<PublicationIssue, "pages" | "sections"> & { readonly audience?: string },
  definition: Pick<PublicationDefinition, "densities">,
): PublicationFinding[] {
  const audience = audienceOf(issue.audience);
  const bar = BARS[audience];
  const out: PublicationFinding[] = [];
  const written = issue.pages.filter((p) => p.body && p.body.trim());
  // Lightest density first, so a density's rank picks its word cap.
  const densityRank = Object.entries(definition.densities)
    .sort((a, b) => a[1][1] - b[1][1])
    .map(([code]) => code);

  for (const page of written) {
    const body = page.body as string;
    const zh = isZh(body);
    const sentences = sentencesOf(body);
    const avg = sentences.length
      ? sentences.reduce((n, s) => n + (zh ? s.replace(/\s/g, "").length / 2 : wordsOf(s).length), 0) / sentences.length
      : 0;
    if (avg > bar.sentence) {
      out.push({
        page: page.n, severity: "warning", category: "readability/sentence",
        description: `p${page.n} averages ${Math.round(avg)} ${zh ? "character pairs" : "words"} a sentence; for ${READERS[audience]} keep it under ${bar.sentence}.`,
        suggestion: "Split the long sentences; one idea each.",
      });
    }
    if (!zh) {
      const grade = gradeOf(body);
      if (grade > bar.grade) {
        out.push({
          page: page.n, severity: "warning", category: "readability/grade",
          description: `p${page.n} reads at grade ${grade}; the bar for ${READERS[audience]} is ${bar.grade}.`,
          suggestion: "Shorter words and shorter sentences; explain the one hard word with a picture or a glossary chip.",
        });
      }
    }
    const long = body.split(/\n\s*\n/).find((p) => wordsOf(p).length > bar.paragraph);
    if (long) {
      out.push({
        page: page.n, severity: "warning", category: "readability/paragraph",
        description: `p${page.n} has a ${wordsOf(long).length}-word paragraph; the bar is ${bar.paragraph}.`,
        suggestion: "Break it where the idea turns.",
        quote: long.trim().slice(0, 120),
      });
    }
    const first = sentences[0] ?? "";
    if (first && (zh ? DEFINITION_ZH : DEFINITION_EN).test(first)) {
      out.push({
        page: page.n, severity: "warning", category: "readability/definition-first",
        description: `p${page.n} opens on a definition.`,
        suggestion: "Open on a thing the reader can see — a scene, an object, a number — and define it second, in one sentence.",
        quote: first.slice(0, 160),
      });
    }
    const rank = Math.max(0, densityRank.indexOf(page.density));
    const cap = bar.caps[Math.min(2, rank)];
    const count = zh ? body.replace(/\s/g, "").length / 2 : wordsOf(body).length;
    if (cap && count > cap) {
      out.push({
        page: page.n, severity: "warning", category: "readability/over-cap",
        description: `p${page.n} carries ${Math.round(count)} words; ${PAGE_WEIGHT[Math.min(2, rank)]} for ${READERS[audience]} holds ${cap}.`,
        suggestion: "Cut to the cap — the copy has to fit the plate.",
      });
    }
    for (const f of page.furniture ?? []) {
      if (kindIs(f.kind, /bignumber|number|stat/) && !COMPARED.test(f.text)) {
        out.push({
          page: page.n, severity: "warning", category: "readability/bare-number",
          description: `p${page.n}: a big number with nothing to compare it to.`,
          suggestion: "Compare it to something the reader knows: \"as heavy as 40 elephants\".",
          quote: f.text.slice(0, 120),
        });
      }
      if (kindIs(f.kind, /didyouknow|fact/) && !f.source) {
        out.push({
          page: page.n, severity: "warning", category: "readability/unsourced-fact",
          description: `p${page.n}: a did-you-know with no source.`,
          suggestion: "Give it the source it came from, or cut it.",
          quote: f.text.slice(0, 120),
        });
      }
    }
  }

  // A spread is two facing pages; the cover stands alone on page 1.
  const spreads = new Map<number, PublicationPage[]>();
  for (const page of written) {
    const key = page.n === 1 ? 0 : Math.floor(page.n / 2);
    spreads.set(key, [...(spreads.get(key) ?? []), page]);
  }
  for (const [key, pages] of spreads) {
    if (key === 0) continue;
    const has = pages.some((p) => (p.furniture ?? []).some((f) => kindIs(f.kind, /didyouknow|fact/)));
    if (!has) {
      out.push({
        page: pages[0]!.n, severity: "info", category: "readability/no-did-you-know",
        description: `Spread ${pages.map((p) => p.n).join("–")} has no did-you-know.`,
        suggestion: "One genuinely surprising, sourced fact per spread.",
      });
    }
  }

  for (const section of issue.sections ?? []) {
    const title = String((section as { title?: unknown }).title ?? "").trim();
    if (!title) continue;
    const words = title.toLowerCase().split(/\s+/);
    if (words.some((w) => SUBJECTS.has(w.replace(/[^\p{L}]/gu, ""))) && audience !== "expert") {
      out.push({
        page: 0, severity: "warning", category: "readability/subject-label",
        description: `Section "${title}" is named after a school subject.`,
        suggestion: "Name it as a way of looking: \"Zoom in\", \"Long ago\", \"How it works\".",
      });
    } else if (words.length > 3) {
      out.push({
        page: 0, severity: "info", category: "readability/section-name",
        description: `Section "${title}" is ${words.length} words; three or fewer reads as a place in the magazine.`,
        suggestion: "Shorten the section name.",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------ connections */

/** Words a cue is matched on: the cue itself, or its longest word for a name. */
const mentions = (text: string, cue: string): boolean => {
  const t = text.toLowerCase();
  const c = cue.toLowerCase().trim();
  if (!c) return false;
  if (t.includes(c)) return true;
  const longest = c.split(/\s+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0];
  return longest ? t.includes(longest) : false;
};

const contentWords = (text: string): string[] =>
  [...new Set((text.toLowerCase().match(/[a-zÀ-ɏ]{5,}/g) ?? []))]
    .filter((w) => !STOP.has(w));
const STOP = new Set(["which", "where", "there", "their", "about", "would", "could", "every", "never",
  "these", "those", "being", "after", "before", "still", "while", "other", "thing", "things"]);

/**
 * The brand's connection rules, counted (13 rev. B).
 *
 * The flatplan says which pages are tied to which and what recurs; this checks
 * the copy kept those promises. Every check reads the text for the cue word the
 * plan gave, so a bridge either reached the page or it did not — no model
 * reading, no argument. A page that broke a promise gets a warning the revise
 * pass acts on; what belongs to the whole issue is said once, on page 0.
 */
export function connectionFindings(
  issue: {
    readonly pages: ReadonlyArray<PublicationPage>;
    readonly sections?: ReadonlyArray<{ n: number; from: number; to: number }>;
    readonly web?: PublicationIssue["web"];
  },
): PublicationFinding[] {
  const out: PublicationFinding[] = [];
  const web = issue.web;
  const textOf = (p: PublicationPage) => `${p.title ?? ""} ${p.deck ?? ""} ${p.body ?? ""}`;
  const written = issue.pages.filter((p) => p.body && p.body.trim());
  if (!written.length) return out;

  // Bridges: the plan tied this page to another; the copy must say so. Front
  // and back matter point at pages by number already, and a plate or the map
  // is not prose a bridge can be written into.
  const UNBRIDGED = new Set(["cover", "contents", "plate", "map", "statement"]);
  for (const page of written.filter((p) => !UNBRIDGED.has(p.type))) {
    const links = (page.links ?? []).filter((l) => l.cue);
    if (!links.length) continue;
    const text = textOf(page);
    const kept = links.some((l) => mentions(text, l.cue) || new RegExp(`\\bp(?:age|\\.)?\\s?${l.to}\\b`, "i").test(text));
    if (!kept) {
      const l = links[0]!;
      out.push({
        page: page.n, severity: "warning", category: "connection/bridge",
        description: `p${page.n} never reaches the page it is tied to: p${l.to} — ${l.why}`,
        suggestion: `Write the bridge into the text, naturally, using "${l.cue}".`,
      });
    }
  }

  // The planning stays backstage. A page that says "the opening node of the
  // connection web" is showing the reader the scaffolding; the live indigo run
  // did exactly that on its imprint page.
  for (const page of written) {
    const leak = /\b(connection web|(?:opening |first |this )?node of|nodes? of the web|web's? (?:ring|node)s?)\b/i
      .exec(page.body ?? "");
    if (leak) {
      out.push({
        page: page.n, severity: "warning", category: "connection/machinery",
        description: `p${page.n} names the issue's planning to the reader: "${leak[0]}"`,
        suggestion: "Say the connection itself — the place, the person, the object — not the word for it.",
        quote: leak[0],
      });
    }
  }

  if (!web) return out;

  // Threads recur, or they are not threads.
  for (const thread of web.threads) {
    const on = written.filter((p) => thread.cue.some((c) => mentions(textOf(p), c))).map((p) => p.n);
    if (on.length < 3) {
      out.push({
        page: 0, severity: "warning", category: "connection/thread",
        description: `the thread "${thread.name}" surfaces on ${on.length} page${on.length === 1 ? "" : "s"}`
          + `${on.length ? ` (p${on.join(", p")})` : ""}; a thread recurs at least three times`,
        suggestion: `Let "${thread.name}" come back on pages planned to carry it.`,
      });
    }
  }

  // The wonder moment is told twice, from different sides.
  if (web.wonder?.cue.length) {
    const on = written.filter((p) => web.wonder!.cue.some((c) => mentions(textOf(p), c)));
    if (on.length < 2) {
      out.push({
        page: 0, severity: "info", category: "connection/wonder",
        description: `the wonder moment appears on ${on.length} page${on.length === 1 ? "" : "s"}; echo it at least twice`,
        suggestion: `Tell "${web.wonder.text}" again from another page's side.`,
      });
    }
  }

  // The ending answers the opening.
  const lastSection = [...(issue.sections ?? [])].sort((a, b) => b.n - a.n)[0];
  const asked = contentWords(`${web.question} ${web.centre}`);
  if (lastSection && asked.length) {
    // From the last section to the back cover: a closing page the planner left
    // outside every section still closes the issue.
    const closing = written.filter((p) => p.n >= lastSection.from && p.type !== "cover");
    const answers = closing.some((p) => asked.filter((w) => textOf(p).toLowerCase().includes(w)).length >= 2);
    const last = closing[closing.length - 1];
    if (last && !answers) {
      out.push({
        page: last.n, severity: "warning", category: "connection/ending",
        description: `the last section never comes back to the question the issue opened on: "${web.question}"`,
        suggestion: "Answer the opening question here, with what the reader now holds, and land in their own life.",
      });
    }
  }

  // Voices are real or absent.
  for (const page of written.filter((p) => p.type === "voices")) {
    const quoted = /["“”«»]/.test(page.body ?? "");
    if (quoted && !(page.sources ?? []).length) {
      out.push({
        page: page.n, severity: "warning", category: "connection/voices",
        description: `p${page.n} quotes people and names no source for the words`,
        suggestion: "Keep only quotes the research holds verbatim, with their source; describe the rest without quotation marks.",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------ surface mix */

export const DEFAULT_MIX: Readonly<Record<string, number>> = {
  photo: 0.4, illustration: 0.35, infographic: 0.15, typographic: 0.1,
};

export interface SurfaceMix {
  readonly counts: Readonly<Record<string, number>>;
  readonly share: Readonly<Record<string, number>>;
  readonly target: Readonly<Record<string, number>>;
  /** Surfaces more than 15 points off target, and repeated treatments. */
  readonly findings: ReadonlyArray<PublicationFinding>;
}

/**
 * What the issue's pictures are, against what a magazine wants them to be
 * (illustration skill §5.1). A target, never a quota: the finding is a note.
 */
export function surfaceMix(
  pages: ReadonlyArray<Pick<PublicationPage, "n" | "briefs">>,
  target: Readonly<Record<string, number>> = DEFAULT_MIX,
): SurfaceMix {
  const counts: Record<string, number> = {};
  const firstTreatment: Array<{ n: number; treatment?: string }> = [];
  for (const page of [...pages].sort((a, b) => a.n - b.n)) {
    const briefs = (page.briefs ?? []) as ReadonlyArray<{ surface?: string; treatment?: string }>;
    for (const b of briefs) {
      const s = b.surface ?? "illustration";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    firstTreatment.push({ n: page.n, ...(briefs[0]?.treatment ? { treatment: briefs[0].treatment } : {}) });
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const share: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) share[k] = total ? Math.round((v / total) * 100) / 100 : 0;
  const findings: PublicationFinding[] = [];
  if (total >= 6) {
    for (const [surface, want] of Object.entries(target)) {
      const got = share[surface] ?? 0;
      if (Math.abs(got - want) > 0.15) {
        findings.push({
          page: 0, severity: "info", category: "mix/surface",
          description: `${Math.round(got * 100)}% of the pictures are ${surface}; the issue aims for about ${Math.round(want * 100)}%.`,
          suggestion: got > want ? `Swap a few ${surface} slots for another surface.` : `Give a few more slots to ${surface}.`,
        });
      }
    }
  }
  for (let i = 1; i < firstTreatment.length; i += 1) {
    const a = firstTreatment[i - 1]!;
    const b = firstTreatment[i]!;
    if (a.treatment && a.treatment === b.treatment && b.n === a.n + 1) {
      findings.push({
        page: b.n, severity: "info", category: "mix/treatment",
        description: `p${a.n} and p${b.n} both open on a ${b.treatment} picture.`,
        suggestion: "Adjacent pages never share a treatment; change one.",
      });
    }
  }
  return { counts, share, target, findings };
}

/* ------------------------------------------------------------ pre-screen */

/** What the shim measures on a rendered page (`POST /image/inspect`). */
export interface PageMetrics {
  /** Share of the page within reach of its ground colour. */
  readonly whitespace: number;
  /** Share of strongly saturated pixels. */
  readonly accent: number;
  /** Mean luminance step between neighbouring samples, 0-1. */
  readonly busy: number;
  /** Standard deviation of luminance, 0-1. */
  readonly contrast: number;
}

/**
 * The machine beauty pre-screen (13 §9): a page that fails this never reaches
 * the person as it is. Thresholds from the design skill: ≥ 25 % void on an
 * editorial page (50 % on a breather), accent ≤ 18 % unless a break is
 * declared, and a floor on contrast so a washed-out page is caught.
 */
export function prescreen(
  metrics: PageMetrics,
  page: { readonly n: number; readonly type?: string; readonly breakDeclared?: boolean },
): PublicationFinding[] {
  const out: PublicationFinding[] = [];
  const breather = /breather|plate|opener/.test(String(page.type ?? "").toLowerCase());
  const floor = /breather/.test(String(page.type ?? "").toLowerCase()) ? 0.5 : 0.25;
  if (metrics.whitespace < floor && !breather) {
    out.push({
      page: page.n, severity: "warning", category: "beauty/crowded",
      description: `p${page.n} leaves ${Math.round(metrics.whitespace * 100)}% of the page empty; it needs at least ${Math.round(floor * 100)}%.`,
      suggestion: "Drop a block, shrink the dominant or move to a lighter archetype.",
    });
  }
  if (metrics.accent > 0.18 && !page.breakDeclared) {
    out.push({
      page: page.n, severity: "warning", category: "beauty/loud",
      description: `p${page.n} is ${Math.round(metrics.accent * 100)}% accent colour; the budget is 18%.`,
      suggestion: "Pull the accent back to rules, numbers and one panel — or declare the page a break.",
    });
  }
  if (metrics.busy > 0.16) {
    out.push({
      page: page.n, severity: "warning", category: "beauty/busy",
      description: `p${page.n} reads as busy (${metrics.busy.toFixed(2)}).`,
      suggestion: "Fewer elements; let one thing dominate.",
    });
  }
  if (metrics.contrast < 0.08) {
    out.push({
      page: page.n, severity: "warning", category: "beauty/flat",
      description: `p${page.n} is washed out (contrast ${metrics.contrast.toFixed(2)}).`,
      suggestion: "Darken the ink or lighten the ground; nothing on the page stands forward.",
    });
  }
  return out;
}
