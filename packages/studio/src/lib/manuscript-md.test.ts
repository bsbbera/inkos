import { describe, expect, it } from "vitest";
import { manuscriptBlocks } from "./manuscript-md";

const visible = (text: string) =>
  manuscriptBlocks(text).map((b) => ({
    kind: b.kind,
    shown: b.runs.filter((r) => !r.hidden).map((r) => `${r.bold ? "B:" : ""}${r.italic ? "I:" : ""}${text.slice(r.from, r.to)}`).join("|"),
  }));

describe("manuscript blocks", () => {
  it("draws headings, quotes, rules and briefs without their syntax", () => {
    const text = "# The Plant\n\n> A leaf\n> turns blue\n\n---\n\n*visual brief 1 (hero):* A sprig";
    expect(visible(text)).toEqual([
      { kind: "h", shown: "The Plant" },
      { kind: "quote", shown: "A leaf\n|turns blue" },
      { kind: "rule", shown: "" },
      { kind: "brief", shown: "I:visual brief 1 (hero):| A sprig" },
    ]);
  });

  it("reads a rule written straight above a paragraph", () => {
    const [b] = manuscriptBlocks("---\n*visual brief 2:* Leaves");
    expect(b!.kind).toBe("brief");
    expect(b!.ruleBefore).toBe(true);
    expect(visible("---\n*visual brief 2:* Leaves")[0]!.shown).toBe("I:visual brief 2:| Leaves");
  });

  it("pairs emphasis and leaves a lone or spaced star alone", () => {
    expect(visible("**\"Then the cloth.\"** and *soft*")[0]!.shown).toBe("B:\"Then the cloth.\"| and |I:soft");
    expect(visible("5 * 3 is *fifteen")[0]!.shown).toBe("5 * 3 is *fifteen");
  });

  it("keeps every offset pointing into the raw file", () => {
    const text = "Intro.\n\n## Two\n\nBody **bold** end.";
    for (const b of manuscriptBlocks(text)) {
      for (const r of b.runs) expect(r.from >= b.from && r.to <= b.to).toBe(true);
    }
    expect(manuscriptBlocks(text).map((b) => text.slice(b.from, b.to))).toEqual(["Intro.", "## Two", "Body **bold** end."]);
  });
});
