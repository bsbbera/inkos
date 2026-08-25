import { describe, expect, it } from "vitest";
import { auditPages, summarize } from "../pipeline/publication-audit.js";
import type { PublicationPage } from "../pipeline/publication-runner.js";
import type { PublicationDefinition } from "../publications/types.js";

/** Only the fields the auditor reads; the rest of a definition is irrelevant here. */
const definition = {
  densities: { light: [80, 160], heavy: [400, 700] },
} as unknown as PublicationDefinition;

const page = (n: number, density: string, body: string | null): PublicationPage => ({
  n,
  title: `p${n}`,
  type: "feature",
  density,
  section: 1,
  pillar: "one",
  premise: "",
  body,
});

/** Varied prose, comfortably inside the light band, with nothing to flag. */
const clean = (seed: string) => [
  `${seed} arrived before the rest of the street had woken.`,
  "",
  "A kettle. Steam against a cold window, and the small clatter of a spoon finding "
  + "the bottom of a cup that someone else had already used twice that morning.",
  "",
  "Later, much later, the shutters went up one by one along the row, and the noise "
  + "of the day took over from the noise of the night without anyone noticing the "
  + "exact moment it happened, because it never happens at an exact moment.",
].join("\n");

describe("auditPages", () => {
  it("says nothing about an issue with nothing wrong", () => {
    const findings = auditPages(
      [page(1, "light", clean("Tuesday")), page(2, "light", clean("Thursday"))],
      definition,
    );
    expect(findings.filter((f) => f.category === "length")).toEqual([]);
  });

  it("ignores pages that have not been written yet", () => {
    expect(auditPages([page(1, "light", null), page(2, "light", "")], definition)).toEqual([]);
  });

  it("warns when a page runs under its density budget", () => {
    const findings = auditPages([page(1, "heavy", "Three words only.")], definition);
    const length = findings.find((f) => f.category === "length");
    expect(length?.severity).toBe("warning");
    expect(length?.description).toContain("400-700");
    expect(length?.page).toBe(1);
  });

  it("warns when a page runs over its density budget", () => {
    const findings = auditPages(
      [page(1, "light", Array.from({ length: 400 }, (_, i) => `word${i}`).join(" "))],
      definition,
    );
    expect(findings.some((f) => f.category === "length" && f.severity === "warning")).toBe(true);
  });

  it("does not judge the length of a density the definition never declared", () => {
    const findings = auditPages([page(1, "unknown-density", "short")], definition);
    expect(findings.filter((f) => f.category === "length")).toEqual([]);
  });

  it("flags a page that repeats the rest of the issue", () => {
    const repeated = "The kettle goes on before the city does, every single morning, "
      + "the kettle goes on before the city does, and the kettle goes on before the city does.";
    const findings = auditPages(
      [page(1, "light", repeated), page(2, "light", repeated), page(3, "light", repeated)],
      definition,
    );
    expect(findings.some((f) => f.category.startsWith("repetition/"))).toBe(true);
  });

  it("reports findings without ever claiming to have fixed anything", () => {
    // The contract the length governor sets upstream: warn, never rewrite. The
    // auditor returns findings and touches no page.
    const pages = [page(1, "heavy", "Too short.")];
    const before = JSON.stringify(pages);
    auditPages(pages, definition);
    expect(JSON.stringify(pages)).toBe(before);
  });
});

describe("summarize", () => {
  it("is explicit when there is nothing to say", () => {
    expect(summarize([])).toBe("no findings");
  });

  it("counts warnings separately from the total", () => {
    const line = summarize([
      { page: 1, severity: "warning", category: "length", description: "", suggestion: "" },
      { page: 1, severity: "info", category: "repetition/x", description: "", suggestion: "" },
      { page: 4, severity: "warning", category: "length", description: "", suggestion: "" },
    ]);
    expect(line).toBe("3 findings (2 warnings) across 2 pages");
  });
});
