import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  addRule, applies, causeProposals, cloneTaste, distillGroups, exportTastePack, importTastePack,
  noteTrial, parseDistill, readRules, rulesFor, type TasteEvent,
} from "../pipeline/taste-engine.js";

let n = 0;
const ev = (over: Partial<TasteEvent>): TasteEvent => ({
  id: `fb_${(n += 1)}`, at: new Date(Date.now() + n * 1000).toISOString(),
  ref: { type: "storybook", id: "moon" }, surface: "image", verdict: "redo", source: "gallery", ...over,
});
const tmp = () => mkdtemp(join(tmpdir(), "quire-taste-engine-"));

describe("counting causes into rules", () => {
  it("proposes a rule for a work once a cause is pressed five times", () => {
    const events = Array.from({ length: 5 }, () => ev({ cause: ["too busy"] }));
    const out = causeProposals(events, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ scope: { surface: "image", work: "storybook/moon" }, text: expect.stringMatching(/simple/) });
    expect(causeProposals(events.slice(0, 4), [])).toEqual([]);
  });

  it("counts a hand-finished final three times", () => {
    const out = causeProposals([ev({ cause: ["too long"], surface: "content", source: "final", verdict: "tweak" }), ev({ cause: ["too long"], surface: "content", source: "final", verdict: "tweak" })], []);
    expect(out).toHaveLength(1);
  });

  it("widens to everywhere when two works say the same", () => {
    const events = [
      ...Array.from({ length: 3 }, () => ev({ cause: ["realism"] })),
      ...Array.from({ length: 3 }, () => ev({ cause: ["realism"], ref: { type: "book", id: "b" } })),
    ];
    expect(causeProposals(events, []).map((p) => p.scope)).toEqual([{ surface: "image" }]);
  });

  it("never proposes what is already a rule or was already proposed", () => {
    const events = Array.from({ length: 6 }, () => ev({ cause: ["too busy"] }));
    const first = causeProposals(events, []);
    expect(causeProposals(events, first)).toEqual([]);
  });

  it("ignores keeps and chips it has no rule for", () => {
    expect(causeProposals(Array.from({ length: 9 }, () => ev({ verdict: "keep", cause: ["too busy"] })), [])).toEqual([]);
    expect(causeProposals(Array.from({ length: 9 }, () => ev({ cause: ["other"] })), [])).toEqual([]);
  });
});

describe("the model half", () => {
  it("groups worded verdicts and keeps only cited, new rules", () => {
    const events = Array.from({ length: 5 }, (_, i) => ev({ note: `too dark ${i}` }));
    const [group] = distillGroups(events);
    expect(group?.events).toHaveLength(5);
    const ids = events.map((e) => e.id);
    const out = parseDistill({ rules: [
      { text: "Keep night scenes lit by one warm source.", evidence: ids.slice(0, 3) },
      { text: "Uncited rule.", evidence: ["fb_nope"] },
      { text: "Existing rule.", evidence: ids },
    ] }, group!, ["Existing rule."]);
    expect(out.map((r) => r.text)).toEqual(["Keep night scenes lit by one warm source."]);
  });
});

describe("rules in force", () => {
  it("apply only where their scope says", () => {
    const rule = { scope: { work: "book/b", surface: "content" } };
    expect(applies(rule, { type: "book", id: "b", surface: "content" })).toBe(true);
    expect(applies(rule, { type: "book", id: "c", surface: "content" })).toBe(false);
    expect(applies(rule, { type: "book", id: "b", surface: "image" })).toBe(false);
    expect(applies({ scope: {} }, { type: "short", id: "x" })).toBe(true);
    expect(applies({ scope: {}, retired: "now" }, { type: "short", id: "x" })).toBe(false);
  });

  it("reach the prompt newest first, and are flagged after three redos", async () => {
    const root = await tmp();
    await addRule(root, { text: "Older.", kind: "sentence", scope: { work: "book/b" }, evidence: [], source: "distill" });
    await new Promise((r) => setTimeout(r, 5));
    const rule = await addRule(root, { text: "Newer.", kind: "sentence", scope: { work: "book/b" }, evidence: [], source: "distill" });
    expect(await rulesFor(root, { type: "book", id: "b" })).toEqual(["Newer.", "Older."]);
    const later = (i: number) => new Date(Date.parse(rule.at) + (i + 1) * 1000).toISOString();
    for (let i = 0; i < 3; i += 1) {
      await noteTrial(root, ev({ at: later(i), ref: { type: "book", id: "b" }, surface: "content", verdict: "redo" }));
    }
    const after = (await readRules(root)).find((r) => r.id === rule.id);
    expect(after?.trial).toEqual({ seen: 3, redo: 3 });
    expect(after?.review).toBe(true);
  });
});

describe("taste packs", () => {
  it("round-trip voices, worlds and rules, never feedback", async () => {
    const root = await tmp();
    await mkdir(join(root, "styles", "lyric", "samples"), { recursive: true });
    await writeFile(join(root, "styles", "lyric", "style_guide.md"), "# Lyric");
    await writeFile(join(root, "styles", "lyric", "samples", "01-typical.md"), "A passage.");
    await mkdir(join(root, "storybooks", "moon", "design"), { recursive: true });
    await writeFile(join(root, "storybooks", "moon", "design", "world.json"), JSON.stringify({ technique: "gouache" }));
    await mkdir(join(root, "_taste"), { recursive: true });
    await writeFile(join(root, "_taste", "feedback.jsonl"), "{\"secret\":true}\n");
    await addRule(root, { text: "Simple pictures.", kind: "sentence", scope: { surface: "image", work: "storybook/moon" }, evidence: [], source: "distill" });

    const { file, manifest } = await exportTastePack(root, {
      id: "moon-look", styles: ["lyric"], works: [{ type: "storybook", id: "moon" }], rules: true,
    });
    expect(manifest.contains).toMatchObject({ styles: ["lyric"], worlds: ["storybook-moon"], rules: 1 });
    const zip = await JSZip.loadAsync(await readFile(file));
    expect(Object.keys(zip.files).some((k) => k.includes("feedback"))).toBe(false);

    const other = await tmp();
    const out = await importTastePack(other, await readFile(file));
    expect(out.styles).toEqual(["pack-moon-look-lyric"]);
    expect(existsSync(join(other, "styles", "pack-moon-look-lyric", "samples", "01-typical.md"))).toBe(true);
    expect(existsSync(join(other, "_taste", "packs", "moon-look", "worlds", "storybook-moon.json"))).toBe(true);
    // The work is not there; the rule keeps what it is for and waits to be accepted.
    expect(out.rules).toEqual([{ text: "Simple pictures.", kind: "sentence", scope: { surface: "image" } }]);
    expect(await readRules(other)).toEqual([]);
  });

  it("refuses to write outside the folder it unpacks into", async () => {
    const zip = new JSZip();
    zip.file("taste-pack.json", JSON.stringify({ id: "evil", version: 1, contains: { styles: [], worlds: [], kits: [], rules: 0 } }));
    zip.file("styles/x/../../../../escaped.txt", "no");
    const root = await tmp();
    await importTastePack(root, await zip.generateAsync({ type: "nodebuffer" }));
    expect(existsSync(join(root, "..", "escaped.txt"))).toBe(false);
    expect(existsSync(join(root, "escaped.txt"))).toBe(false);
  });
});

describe("clone taste", () => {
  it("copies the look and the work's own rules to another work", async () => {
    const root = await tmp();
    for (const id of ["one", "two"]) await mkdir(join(root, "storybooks", id, "design"), { recursive: true });
    await writeFile(join(root, "storybooks", "one", "design", "world.json"), "{\"technique\":\"riso\"}");
    await writeFile(join(root, "storybooks", "one", "style.json"), "{\"id\":\"lyric\"}");
    await writeFile(join(root, "storybooks", "one", "style_guide.md"), "# Lyric");
    await addRule(root, { text: "Riso only.", kind: "sentence", scope: { work: "storybook/one" }, evidence: [], source: "distill" });
    const out = await cloneTaste(root, { type: "storybook", id: "one" }, { type: "storybook", id: "two" });
    expect(out.rules).toBe(1);
    // The guide is the voice; without it the new work reports no style at all.
    expect(await readFile(join(root, "storybooks", "two", "style_guide.md"), "utf-8")).toBe("# Lyric");
    expect(await readFile(join(root, "storybooks", "two", "design", "world.json"), "utf-8")).toContain("riso");
    expect(await rulesFor(root, { type: "storybook", id: "two" })).toEqual(["Riso only."]);
  });
});
