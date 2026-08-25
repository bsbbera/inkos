import { describe, expect, it } from "vitest";
import {
  PUBLICATION_DIMENSIONS,
  buildAuditPrompt,
  buildRevisePrompt,
  isSlopFinding,
  parseAuditFindings,
} from "../pipeline/publication-review.js";
import type { PublicationFinding } from "../pipeline/publication-audit.js";
import type { PublicationIssue, PublicationPage } from "../pipeline/publication-runner.js";
import type { PublicationDefinition } from "../publications/types.js";

const definition = {
  id: "magazine",
  label: "magazine",
  densities: { light: [80, 160], heavy: [400, 600] },
  defaultDensity: "light",
} as unknown as PublicationDefinition;

const page = (over: Partial<PublicationPage> = {}): PublicationPage => ({
  n: 7,
  title: "The thing light touched",
  type: "feature",
  density: "heavy",
  section: 1,
  pillar: "chemistry",
  premise: "Silver halide remembers a photon.",
  body: "A grain of silver bromide is struck by a photon and never forgets it.",
  ...over,
});

const issue = (over: Partial<PublicationIssue> = {}): PublicationIssue => ({
  id: "issue-a",
  type: "magazine",
  series: "s",
  subject: "Photography",
  angle: "a",
  title: "Light Touched",
  thesis: "A photograph is a chemical memory.",
  extent: 16,
  status: "writing",
  createdAt: "now",
  research: { sources: ["Rowlands 1998"] },
  sections: [{ n: 1, label: "one", question: "How does film remember?", colour: "silver", from: 1, to: 8 }],
  pages: [page()],
  ...over,
});

describe("what a page is judged on", () => {
  // The claim made to the user is "37 dimensions". Six are the rule pass in
  // publication-audit (word band, paragraph uniformity, hedge density,
  // formulaic transitions, list-shaped prose, cross-page repetition); the rest
  // are here. If this number moves, the claim moves with it.
  it("carries the 31 dimensions the model reads for", () => {
    expect(PUBLICATION_DIMENSIONS).toHaveLength(31);
    expect(new Set(PUBLICATION_DIMENSIONS.map((d) => d.n)).size).toBe(31);
  });

  it("puts every dimension in the prompt, with the page and its section", () => {
    const prompt = buildAuditPrompt(issue(), page(), definition, issue().sections[0]);
    for (const d of PUBLICATION_DIMENSIONS) expect(prompt).toContain(d.name);
    expect(prompt).toContain("How does film remember?");
    expect(prompt).toContain("400-600");
    expect(prompt).toContain("silver bromide");
  });

  // A page audited without the rest of the issue cannot catch a contradiction
  // or a repeat, which is half of what dimensions 26-28 are for.
  it("shows the page what the other pages say", () => {
    const two = issue({ pages: [page(), page({ n: 8, title: "Grain", body: "Grain is the trace." })] });
    expect(buildAuditPrompt(two, page(), definition, undefined)).toContain("Grain is the trace");
  });
});

describe("reading what the model sent back", () => {
  it("labels a finding with the dimension it names", () => {
    const [f] = parseAuditFindings({
      findings: [{ dimension: 7, severity: "warning", description: "1998 appears nowhere in the research", suggestion: "Cut it." }],
    }, 7);
    expect(f.category).toBe("dim7/Unsourced specificity");
    expect(f.page).toBe(7);
    expect(f.description).toBe("p7: 1998 appears nowhere in the research");
  });

  it("keeps a finding whose dimension number is nonsense, since the words still are not", () => {
    const [f] = parseAuditFindings({ findings: [{ dimension: 99, description: "the deck lies" }] }, 3);
    expect(f.category).toBe("dim/unlabelled");
    expect(f.suggestion).toBe("Fix as described.");
  });

  // The audit never blocks, so a third severity would imply a gate that is not
  // there.
  it("has only two severities, whatever the model called it", () => {
    const out = parseAuditFindings({
      findings: [{ severity: "critical", description: "a" }, { severity: "info", description: "b" }],
    }, 1);
    expect(out.map((f) => f.severity)).toEqual(["warning", "info"]);
  });

  it("drops entries with nothing in them rather than filing empty findings", () => {
    expect(parseAuditFindings({ findings: [{ description: "  " }, null, "x"] }, 1)).toEqual([]);
    expect(parseAuditFindings({}, 1)).toEqual([]);
  });
});

describe("which findings de-AI-ification is allowed to touch", () => {
  const finding = (category: string): PublicationFinding =>
    ({ page: 1, severity: "warning", category, description: "d", suggestion: "s" });

  it("takes the rule pass's tells and the model's prose dimensions", () => {
    expect(isSlopFinding(finding("ai-tell/Paragraph uniformity"))).toBe(true);
    expect(isSlopFinding(finding("repetition/lexical"))).toBe(true);
    expect(isSlopFinding(finding("dim28/Cliché imagery"))).toBe(true);
    expect(isSlopFinding(finding("dim30/Filler"))).toBe(true);
  });

  // The point of a separate deslop pass: it must not quietly rewrite a page
  // over a sourcing problem the user did not ask it to touch.
  it("leaves everything else alone", () => {
    expect(isSlopFinding(finding("length"))).toBe(false);
    expect(isSlopFinding(finding("dim7/Unsourced specificity"))).toBe(false);
    expect(isSlopFinding(finding("audit/unavailable"))).toBe(false);
  });
});

describe("turning findings back into a page", () => {
  const findings: PublicationFinding[] = [
    { page: 7, severity: "warning", category: "dim7/Unsourced specificity", description: "p7: 1998 is invented", suggestion: "Cut the date." },
  ];

  it("gives the model the problems, the page, and the band to stay inside", () => {
    const prompt = buildRevisePrompt(issue(), page(), definition, findings);
    expect(prompt).toContain("1998 is invented");
    expect(prompt).toContain("Cut the date.");
    expect(prompt).toContain("400-600 words");
    expect(prompt).toContain("silver bromide");
  });

  // A revise pass allowed to research is the writer stage under another name,
  // and it re-introduces exactly what dimension 7 exists to catch.
  it("forbids new facts and offers a way to reject a wrong finding", () => {
    const prompt = buildRevisePrompt(issue(), page(), definition, findings);
    expect(prompt).toMatch(/Do not add a number, date, name or quote/);
    expect(prompt).toContain("rejected");
  });

  it("falls back to the default band for a density the definition does not name", () => {
    expect(buildRevisePrompt(issue(), page({ density: "invented" }), definition, findings))
      .toContain("80-160 words");
  });
});
