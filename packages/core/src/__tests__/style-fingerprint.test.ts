import { describe, expect, it, vi } from "vitest";
import { blendTarget, distance, fingerprint, gaps } from "../agents/style-fingerprint.js";
import { chooseExemplars, exemplarsFor, exemplarBlock } from "../pipeline/exemplars.js";
import { normaliseBlend, droppedFacets } from "../pipeline/blend.js";
import { chunkProse, quotedLinesKept, restyleProse } from "../pipeline/restyle.js";

/* Two writers, deliberately unalike: one clipped and spoken, one long and
   subordinate. Within-author distance must come out well under between-author
   distance or the number means nothing. */
const CLIPPED_A = `
"You're late," she said. "Again."

"Traffic." He hung the coat. "The bridge was out."

"It's always the bridge." She did not look up. "Sit. Eat."

He sat. The soup was cold. He ate it anyway.

"I'm going," she said. "Tomorrow."

"Where?"

"Does it matter?" She stood. "No. It doesn't."
`;

const CLIPPED_B = `
"Don't," he said. "Don't start."

"I'm not starting." She shut the door. "I'm finishing."

The kettle went. Nobody moved to take it off.

"You said a week." He rubbed his eyes. "It's been three."

"I know what I said." She sat. "I know exactly what I said."

He waited. She did not go on. Outside, a car turned around.
`;

const ORNATE_A = `
The house, which had stood upon the ridge since before the war — before, indeed, anyone
now living could recall a time when it had not stood there — settled each winter a little
further into the soft, unresisting earth, so that the windows on the northern side, which
had once looked out upon the whole of the valley and the pale thread of the river running
through it, now admitted only the light of a sky perpetually the colour of wet slate.

Within, the rooms preserved their arrangement with the fidelity of a museum: the chairs
turned inward toward a fire nobody lit; the long table, polished by generations of sleeves,
bearing its solitary bowl of wax fruit; the clock, which had not been wound since the
spring, holding its hands at twenty past four in a gesture of patient and permanent refusal.
`;

describe("the fingerprint", () => {
  it("tells two writers apart more than it tells one writer from himself", () => {
    const a = fingerprint(CLIPPED_A, "en");
    const b = fingerprint(CLIPPED_B, "en");
    const c = fingerprint(ORNATE_A, "en");
    const within = distance(a, b);
    const between = distance(a, c);
    // The whole point of the measure. If this fails, "is it in the voice?" has
    // no operational answer and the verify pass below is theatre.
    expect(within).toBeLessThan(between);
    expect(between - within).toBeGreaterThan(0.15);
  });

  it("says a text is identical to itself", () => {
    expect(distance(fingerprint(CLIPPED_A, "en"), fingerprint(CLIPPED_A, "en"))).toBe(0);
  });

  it("refuses to compare across languages", () => {
    expect(distance(fingerprint(CLIPPED_A, "en"), fingerprint("这是一个句子。很短。", "zh"))).toBe(1);
    expect(distance(undefined, fingerprint(CLIPPED_A, "en"))).toBe(1);
  });

  it("measures what a reader would name", () => {
    const spoken = fingerprint(CLIPPED_A, "en");
    const written = fingerprint(ORNATE_A, "en");
    expect(spoken.dialogueRatio).toBeGreaterThan(written.dialogueRatio);
    expect(written.sentenceBuckets[7]).toBeGreaterThan(spoken.sentenceBuckets[7] ?? 0);
    // Short sentences make short paragraphs but not one-sentence ones: a line
    // of dialogue plus its beat is two. The ornate sample is the one whose
    // paragraphs are each a single very long sentence.
    expect(written.oneSentenceParagraphs).toBeGreaterThan(spoken.oneSentenceParagraphs);
    expect(spoken.fragmentRate).toBeGreaterThan(written.fragmentRate);
  });

  it("works on Chinese without pretending it has spaces", () => {
    const zh = fingerprint("他走了。她没有回头。天很黑。\n\n“别走，”她说。“再等一下。”", "zh");
    expect(zh.language).toBe("zh");
    expect(zh.functionWords["的"]).toBeGreaterThanOrEqual(0);
    expect(zh.sentenceBuckets.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  });

  it("names the biggest gaps in words a person can act on", () => {
    const said = gaps(fingerprint(CLIPPED_A, "en"), fingerprint(ORNATE_A, "en"));
    expect(said.length).toBeGreaterThan(0);
    expect(said.join(" ")).toMatch(/dialogue|sentences|paragraphs/);
    expect(said.join(" ")).toMatch(/yours is/);
  });
});

describe("a blend", () => {
  const a = fingerprint(CLIPPED_A, "en");
  const b = fingerprint(ORNATE_A, "en");

  it("takes a facet from its owner rather than averaging it", () => {
    const target = blendTarget([
      { profile: b, weight: 0.75 },
      { profile: a, weight: 0.25, facets: ["dialogue"] },
    ]);
    // Dialogue is owned by the clipped writer outright, even though the ornate
    // one holds three quarters of the weight.
    expect(target?.dialogueRatio).toBe(a.dialogueRatio);
    expect(target?.sensoryDensity).not.toBe(a.sensoryDensity);
  });

  it("averages what nobody claimed", () => {
    const target = blendTarget([{ profile: a, weight: 0.5 }, { profile: b, weight: 0.5 }]);
    const low = Math.min(a.hapaxRatio, b.hapaxRatio);
    const high = Math.max(a.hapaxRatio, b.hapaxRatio);
    expect(target?.hapaxRatio).toBeGreaterThanOrEqual(low);
    expect(target?.hapaxRatio).toBeLessThanOrEqual(high);
  });

  it("passes a single voice through untouched", () => {
    expect(blendTarget([{ profile: a, weight: 1 }])).toBe(a);
    expect(blendTarget([])).toBeUndefined();
  });
});

describe("the blend schema", () => {
  it("normalises weights to one and keeps the dominant voice", () => {
    const parts = normaliseBlend([
      { id: "chandler", weight: 6, facets: ["sentence"] },
      { id: "didion", weight: 2, facets: ["description"] },
      { id: "me", weight: 2, facets: ["dialogue"] },
    ], "chandler");
    expect(parts).toHaveLength(3);
    expect(parts!.reduce((n, p) => n + p.weight, 0)).toBeCloseTo(1, 2);
    expect(parts![0]!.id).toBe("chandler");
  });

  it("gives a contested facet to the heavier voice", () => {
    const raw = [
      { id: "a", weight: 0.7, facets: ["dialogue"] },
      { id: "b", weight: 0.3, facets: ["dialogue"] },
    ];
    const parts = normaliseBlend(raw, "a");
    expect(parts!.find((p) => p.id === "a")!.facets).toContain("dialogue");
    expect(parts!.find((p) => p.id === "b")!.facets).toHaveLength(0);
    // The loser is reported rather than silently dropped, so the mixer can say so.
    expect(droppedFacets(raw, parts)).toEqual([{ id: "b", facet: "dialogue", wonBy: "a" }]);
  });

  it("adds the applied voice when the blend forgot it", () => {
    const parts = normaliseBlend([{ id: "didion", weight: 1, facets: [] }], "chandler");
    expect(parts!.map((p) => p.id)).toContain("chandler");
  });

  it("caps a blend at five and drops nonsense", () => {
    const parts = normaliseBlend(
      [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `v${n}`, weight: 1, facets: ["nope"] })),
      "v1",
    );
    expect(parts!.length).toBeLessThanOrEqual(5);
    expect(parts!.every((p) => p.facets.length === 0)).toBe(true);
  });

  it("means 'no blend' when nothing was sent", () => {
    expect(normaliseBlend(undefined, "x")).toBeNull();
    expect(normaliseBlend([], "x")).toBeNull();
  });
});

describe("exemplars", () => {
  const sample = [ORNATE_A, CLIPPED_A, ORNATE_A, CLIPPED_B].join("\n\n");

  it("keeps a dialogue passage and a descriptive one", () => {
    const chosen = chooseExemplars(sample, "en");
    expect(chosen.length).toBeGreaterThan(1);
    expect(chosen.map((e) => e.kind)).toContain("dialogue");
    expect(chosen.map((e) => e.kind)).toContain("description");
  });

  it("shows a conversation the conversational exemplar", () => {
    const all = chooseExemplars(sample, "en");
    const forTalk = exemplarsFor(all, CLIPPED_B, "en");
    expect(forTalk[0]!.kind).toBe("dialogue");
  });

  it("quotes the passages rather than describing them", () => {
    const block = exemplarBlock(chooseExemplars(sample, "en").slice(0, 1), "en");
    expect(block).toContain("real passages");
    expect(block.length).toBeGreaterThan(100);
    expect(exemplarBlock([], "en")).toBe("");
  });
});

describe("chunked restyle", () => {
  it("splits long prose and keeps headings as boundaries", () => {
    const long = ["# One", "a ".repeat(700), "# Two", "b ".repeat(700)].join("\n\n");
    const chunks = chunkProse(long, "en");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("# One");
    expect(chunks.some((c) => c.includes("# Two"))).toBe(true);
  });

  it("leaves a short piece in one chunk", () => {
    expect(chunkProse(CLIPPED_A, "en")).toHaveLength(1);
  });

  it("counts the spoken lines that survived", () => {
    expect(quotedLinesKept(CLIPPED_A, CLIPPED_A, "en")).toBe(1);
    expect(quotedLinesKept(CLIPPED_A, ORNATE_A, "en")).toBe(0);
    // Nothing to check when there was no dialogue to begin with.
    expect(quotedLinesKept(ORNATE_A, ORNATE_A, "en")).toBeNull();
  });

  it("refuses a rewrite that dropped the dialogue", async () => {
    // Long enough to pass the length guard, so the only thing that can catch
    // this is the line check.
    const flattened = CLIPPED_A.replace(/"/g, "");
    await expect(restyleProse({
      text: CLIPPED_A,
      styleGuide: "## Voice\nDry.",
      language: "en",
      chat: vi.fn().mockResolvedValue(flattened),
    })).rejects.toThrow(/spoken lines/);
  });

  /* For the verify pass, both attempts have to be the same size as the source
     and carry no dialogue, so the length and spoken-line guards stay out of
     the way and the only thing deciding the outcome is the distance. */
  const PLAIN_CLIPPED = `
He woke before the alarm. The room was cold. He did not get up.

Outside a van reversed. Someone laughed. A door went.

He counted the cracks in the ceiling. Nine. Always nine.

The kettle had boiled an hour ago. It would need boiling again.

He got up. He did not open the curtains. He put on yesterday's shirt.

There was nothing in the fridge. There was never anything in the fridge.
`;

  const PLAIN_ORNATE = `
He woke some while before the alarm was due to sound, in a room whose coldness had
by then become less a condition of the air than a property of the building itself,
and lay for a time without moving, as though the act of rising required a decision
he had not yet been given the materials to make.

Outside, a van reversed with that patient mechanical insistence which belongs
entirely to early mornings, and somebody laughed at something he would never learn,
and a door closed upon the whole small transaction as if to file it away.
`;

  it("retries once against the measured gaps, and keeps the better try", async () => {
    const target = fingerprint(PLAIN_CLIPPED, "en");
    const chat = vi.fn()
      .mockResolvedValueOnce(PLAIN_ORNATE)
      .mockResolvedValueOnce(PLAIN_CLIPPED);
    const out = await restyleProse({
      text: PLAIN_ORNATE, styleGuide: "## Voice\nClipped.", language: "en", chat, target,
    });
    expect(chat).toHaveBeenCalledTimes(2);
    // The second prompt names what the first attempt actually got wrong.
    const [, retryUser] = chat.mock.calls[1] as [string, string];
    expect(retryUser).toContain("What the last attempt got wrong");
    expect(retryUser).toMatch(/yours is/);
    expect(out.text).toContain("Always nine");
    expect(out.after!).toBeLessThan(out.before!);
  });

  it("does not retry a rewrite that already landed", async () => {
    const chat = vi.fn().mockResolvedValue(PLAIN_CLIPPED);
    await restyleProse({
      text: PLAIN_CLIPPED, styleGuide: "## Voice", language: "en", chat,
      target: fingerprint(PLAIN_CLIPPED, "en"),
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
