/**
 * The composer's `/`.
 *
 * The case that decides the design is the one it must NOT fire on: this app
 * prints `shorts/the-second-law/final/full.md` in almost every reply, and a
 * menu that opened on those slashes would be worse than no menu.
 */
import { describe, expect, it } from "vitest";
import { applySlashPick, matchSkills, slashToken } from "./skill-ui-state";

describe("slashToken", () => {
  it("opens on a slash at the head of the composer", () => {
    expect(slashToken("/", 1)).toEqual({ query: "", start: 0, end: 1 });
  });

  it("carries what has been typed so far", () => {
    expect(slashToken("/short", 6)).toEqual({ query: "short", start: 0, end: 6 });
  });

  it("opens on a slash at the head of any line", () => {
    expect(slashToken("write this\n/audit", 17)).toEqual({ query: "audit", start: 11, end: 17 });
  });

  it("stays shut on a path, which is what this app prints most", () => {
    const text = "look at shorts/the-second-law/final/full.md";
    expect(slashToken(text, text.length)).toBeNull();
  });

  it("stays shut once the token has a space after it", () => {
    expect(slashToken("/audit the chapter", 18)).toBeNull();
  });

  it("stays shut when the caret is not in the token", () => {
    expect(slashToken("/audit", 0)).toBeNull();
  });
});

describe("matchSkills", () => {
  const skills = [
    { id: "quire-short-writing", name: "Short writing" },
    { id: "coastal-gothic", name: "Coastal gothic" },
    { id: "de-slop", name: "Short de-slop pass" },
  ];

  it("puts an id prefix match ahead of a mere mention", () => {
    // "co" starts `coastal-gothic`'s id; it only appears mid-string in the
    // other two, so the one being typed toward comes first.
    expect(matchSkills(skills, "co").map((s) => s.id)).toEqual([
      "coastal-gothic",
    ]);
  });

  it("keeps every substring match when none is a prefix", () => {
    expect(matchSkills(skills, "short").map((s) => s.id)).toEqual([
      "quire-short-writing",
      "de-slop",
    ]);
  });

  it("returns everything for an empty query", () => {
    expect(matchSkills(skills, "")).toHaveLength(3);
  });

  it("matches on the name too", () => {
    expect(matchSkills(skills, "gothic").map((s) => s.id)).toEqual(["coastal-gothic"]);
  });
});

describe("applySlashPick", () => {
  it("takes the token out, because the skill becomes a chip", () => {
    expect(applySlashPick("/audit", { query: "audit", start: 0, end: 6 })).toBe("");
    expect(applySlashPick("write this\n/aud", { query: "aud", start: 11, end: 15 })).toBe("write this\n");
  });
});
