import { describe, expect, it } from "vitest";
import { LOOK_PASS, layoutHash, lookPrompt, parseLook, referencePages } from "../pipeline/page-look.js";

describe("the page looked at", () => {
  it("fails a page with a fatal fault whatever score it was given (Rain p2: cut text)", () => {
    const look = parseLook({
      first: "the drop", score: 92, dims: { hierarchy: 90, type: 40, bogus: "x" },
      defects: [{ severity: "fatal", what: "body stops mid-sentence", where: "body", fix: "give the body two more rows" }, { what: "" }],
      lesson: "null",
    }, "abc");
    expect(look.pass).toBe(false);
    expect(look.defects).toHaveLength(1);
    expect(look.dims).toEqual({ hierarchy: 90, type: 40 });
    expect(look.lesson).toBeNull();
    expect(look.layout).toBe("abc");
  });

  it("passes at the bar with only minor faults, and keeps the lesson", () => {
    const look = parseLook({ score: LOOK_PASS, defects: [{ severity: "minor", what: "tight kicker" }], lesson: "A deck ends a line above the body." }, "x");
    expect(look.pass).toBe(true);
    expect(look.lesson).toMatch(/deck/);
    expect(parseLook({ score: 200 }, "x").score).toBe(100);
    expect(parseLook(null, "x").pass).toBe(false);
  });

  it("tells the eye how the story ends, so cut text can be seen", () => {
    const p = lookPrompt({ title: "Rain", page: { n: 2, type: "feature", title: "The Bun", deck: "d", body: "One. Two words here. It ends with this line." }, rules: ["Keep the runhead."], measured: ["the body oversets 12 words"] });
    expect(p).toMatch(/ends with: "It ends with this line\."/);
    expect(p).toMatch(/oversets 12 words/);
    expect(p).toMatch(/- Keep the runhead\./);
  });

  it("knows a composition by its content", () => {
    expect(layoutHash({ blocks: [1] })).toBe(layoutHash({ blocks: [1] }));
    expect(layoutHash({ blocks: [1] })).not.toBe(layoutHash({ blocks: [2] }));
  });
});

describe("the reference pages", () => {
  it("shows a rotating three of the chosen look's set, and none when no look is chosen", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "refs-"));
    expect(await referencePages(root, 1)).toEqual([]);
    const set = join(root, "_taste", "references", "minimal");
    mkdirSync(set, { recursive: true });
    for (const f of ["01.jpg", "02.jpg", "03.png", "04.jpg", "notes.txt"]) writeFileSync(join(set, f), "x");
    // No look chosen: no set is imposed, however many the editor has.
    expect(await referencePages(root, 1)).toEqual([]);
    const names = async (n: number) => (await referencePages(root, n, 3, "minimal")).map((p) => p.slice(-6));
    expect(await names(1)).toEqual(["04.jpg", "01.jpg", "02.jpg"]);
    expect(await names(2)).toEqual(["03.png", "04.jpg", "01.jpg"]);
  });
});
