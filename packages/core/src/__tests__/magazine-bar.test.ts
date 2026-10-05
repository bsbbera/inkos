import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  audienceOf, gradeOf, prescreen, readabilityFindings, surfaceMix,
} from "../pipeline/magazine-bar.js";
import { noteItem, readMarkdownFolder, scoreItem, personalSource, writePersonalConfig } from "../pipeline/personal-sources.js";
import type { PublicationPage } from "../pipeline/publication-runner.js";

const page = (n: number, body: string, extra: Partial<PublicationPage> = {}): PublicationPage => ({
  n, title: `p${n}`, type: "feature", density: "M", section: 1, pillar: "", premise: "", body, ...extra,
});
const DEF = { densities: { L: [40, 120], M: [150, 350], H: [300, 600] } as Record<string, [number, number]> };
const codes = (fs: ReadonlyArray<{ category: string }>) => fs.map((f) => f.category);

describe("the writing bar", () => {
  it("reads an intake's words as one of five readers", () => {
    expect(audienceOf("kids 5-8")).toBe("child-5");
    expect(audienceOf("children aged 9 to 12")).toBe("child-9");
    expect(audienceOf("teenagers")).toBe("teen");
    expect(audienceOf("")).toBe("general");
    expect(audienceOf("professional engineers")).toBe("expert");
  });

  it("grades plain words low and dense words high", () => {
    expect(gradeOf("The cat sat on the mat. It was warm. The sun was out.")).toBeLessThan(3);
    expect(gradeOf("Photosynthetic organisms convert electromagnetic radiation into chemical potential energy through intricate biochemical pathways.")).toBeGreaterThan(12);
  });

  it("flags a page that opens on a definition, for any reader", () => {
    const out = readabilityFindings({ pages: [page(2, "A volcano is a mountain that opens to the hot rock below. It can erupt.")], sections: [] }, DEF);
    expect(codes(out)).toContain("readability/definition-first");
  });

  it("holds a child's page to shorter sentences than an adult's", () => {
    // Sixteen words: over a five-year-old's twelve, under an adult's twenty.
    const body = "The river carried heavy logs down from the mountain forest to the busy town every spring.";
    const child = readabilityFindings({ pages: [page(2, body)], sections: [], audience: "age 5" }, DEF);
    const adult = readabilityFindings({ pages: [page(2, body)], sections: [], audience: "adults" }, DEF);
    expect(codes(child)).toContain("readability/sentence");
    expect(codes(adult)).not.toContain("readability/sentence");
  });

  it("wants numbers compared and facts sourced", () => {
    const out = readabilityFindings({
      pages: [page(2, "Whales are big.", { furniture: [
        { kind: "bignumber", text: "150 tonnes" },
        { kind: "did-you-know", text: "Whales sing." },
      ] })],
      sections: [],
    }, DEF);
    expect(codes(out)).toContain("readability/bare-number");
    expect(codes(out)).toContain("readability/unsourced-fact");
    const fine = readabilityFindings({
      pages: [page(2, "Whales are big.", { furniture: [{ kind: "bignumber", text: "150 tonnes — as heavy as 25 elephants" }] })],
      sections: [],
    }, DEF);
    expect(codes(fine)).not.toContain("readability/bare-number");
  });

  it("names a section after a way of looking, never a school subject", () => {
    const out = readabilityFindings({ pages: [page(2, "Sparks.")], sections: [{ n: 1, title: "Physics" } as never] }, DEF);
    expect(codes(out)).toContain("readability/subject-label");
  });

  it("asks for a did-you-know on every spread", () => {
    const out = readabilityFindings({ pages: [page(2, "One."), page(3, "Two.")], sections: [] }, DEF);
    expect(codes(out)).toContain("readability/no-did-you-know");
  });
});

describe("surface mix", () => {
  it("measures the pictures against the target and flags repeated treatments", () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({
      n: i + 2, briefs: [{ prompt: "x", surface: "illustration", treatment: i < 2 ? "full-bleed" : `t${i}` }],
    })) as never;
    const mix = surfaceMix(pages);
    expect(mix.share.illustration).toBe(1);
    expect(mix.findings.some((f) => f.category === "mix/surface")).toBe(true);
    expect(mix.findings.some((f) => f.category === "mix/treatment")).toBe(true);
  });
});

describe("beauty pre-screen", () => {
  it("names a crowded, loud, busy or flat page and passes a quiet one", () => {
    const bad = prescreen({ whitespace: 0.1, accent: 0.3, busy: 0.3, contrast: 0.02 }, { n: 4, type: "feature" });
    expect(codes(bad)).toEqual(["beauty/crowded", "beauty/loud", "beauty/busy", "beauty/flat"]);
    expect(prescreen({ whitespace: 0.4, accent: 0.08, busy: 0.05, contrast: 0.3 }, { n: 4 })).toEqual([]);
  });
});

describe("personal sources", () => {
  let dir = "";
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("reads a note's frontmatter, inline tags and highlights", () => {
    const item = noteItem("---\ntitle: Tides\ntags: [ocean, moon]\ndate: 2026-08-03\n---\nThe ==moon pulls the sea== twice a day. #science\n> A quoted line", "/v/tides.md", new Date(0));
    expect(item.title).toBe("Tides");
    expect(item.tags).toEqual(["ocean", "moon", "science"]);
    expect(item.highlights).toContain("moon pulls the sea");
    expect(item.highlights).toContain("A quoted line");
    expect(item.date).toBe("2026-08-03");
  });

  it("filters a folder by tag and date, and searches it like the web", async () => {
    dir = await mkdtemp(join(tmpdir(), "quire-personal-"));
    const vault = join(dir, "vault");
    await mkdir(join(vault, "sub"), { recursive: true });
    await writeFile(join(vault, "a.md"), "---\ndate: 2026-08-10\n---\n# Tides\nThe moon moves the sea. #science");
    await writeFile(join(vault, "sub", "b.md"), "---\ndate: 2026-06-01\n---\n# Old tides\nEarlier. #science");
    await writeFile(join(vault, "c.md"), "---\ndate: 2026-08-12\n---\n# Bread\nFlour and water. #cooking");
    const items = await readMarkdownFolder({ dir: vault, tag: "#science", since: "2026-08-01" });
    expect(items.map((i) => i.title)).toEqual(["Tides"]);
    expect(scoreItem(items[0]!, "moon tides")).toBeGreaterThan(0);
    // Sharing "the" with a query is not relevance.
    expect(scoreItem(items[0]!, "the lighthouse on the coast")).toBe(0);

    await writePersonalConfig(dir, { markdown: [{ dir: vault, tag: "science" }] });
    const source = await personalSource(dir);
    expect(source?.kind).toBe("local");
    const hits = await source!.run("tides moon", 5);
    expect(hits[0]?.title).toBe("Tides");
  });
});
