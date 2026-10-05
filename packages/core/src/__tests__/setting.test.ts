import { describe, expect, it } from "vitest";
import {
  bibleSections, buildSettingCard, makeSetting, settingFromEra, type Lexicon,
} from "../pipeline/setting.js";
import { findAnachronisms, anachronismFindings, severityFor } from "../pipeline/anachronism.js";
import { parseLexicon, parseGuess } from "../pipeline/setting-research.js";
import { openPromises, seriesBrief, type Series } from "../pipeline/series.js";

const BIBLE = `# Setting bible — Calcutta, 1943

## Daily life & objects

- punkah pulled by a rope over the desks
- anna coins and pice in a clerk's pocket
- hurricane lamp on the tram platform
- jute sacks stacked at the dock

## Money, prices & work

- a clerk earns about 40 rupees a month
- tram fare is one anna

## Speech & register

- clerks say "Sir" to British officers, "babu" between peers
- children address a father as "Baba"

## Place & senses

- monsoon mould in the files
- tram bells and crows at dawn
`;

const LEXICON: Lexicon = {
  prefer: [{ term: "tram", for: "streetcar" }, { term: "dada", gloss: "elder brother" }],
  forbidden: [
    { term: "okay", reason: "Americanism, rare in 1943 Bengali speech" },
    { term: "plastic bag", reason: "not until the 1960s" },
    { term: "Kolkata", reason: "renamed in 2001" },
  ],
  addressForms: [{ speaker: "child", to: "father", form: "Baba" }],
};

describe("setting", () => {
  it("reads a place and a year out of free text", () => {
    const setting = makeSetting({ place: "Calcutta", time: "1943", fidelity: "strict" });
    expect(setting.place.name).toBe("Calcutta");
    expect(setting.time.from).toBe("1943");
    expect(setting.kind).toBe("historical");
    expect(setting.fidelity).toBe("strict");
    expect(setting.enabled).toBe(true);
  });

  it("calls a world with no year a made-up one", () => {
    expect(makeSetting({ place: "the Nine Realms", time: "" }).kind).toBe("secondary-world");
  });

  it("reads the old era block without switching it on", () => {
    const migrated = settingFromEra({ enabled: true, period: "1943", region: "Calcutta" });
    expect(migrated?.place.name).toBe("Calcutta");
    // The old flag is set by a heading existing, which is not a person asking
    // for research — so a migrated setting is inert until someone pins it.
    expect(migrated?.enabled).toBe(false);
    expect(settingFromEra({ enabled: true })).toBeNull();
    expect(settingFromEra(null)).toBeNull();
  });

  it("splits a bible by its fixed headings", () => {
    const sections = bibleSections(BIBLE);
    expect(Object.keys(sections)).toContain("Daily life & objects");
    expect(sections["Money, prices & work"]).toContain("40 rupees");
  });
});

describe("the setting card", () => {
  const setting = makeSetting({ place: "Kolkata", then: "Calcutta", time: "1943", fidelity: "strict" });

  it("puts the plan's own words first", () => {
    const card = buildSettingCard({
      setting, bible: BIBLE, lexicon: LEXICON,
      plan: "A clerk rides the tram to the dock and counts coins.",
    });
    const objects = card.split("\n").find((l) => l.startsWith("Objects:")) ?? "";
    // The tram and the coins were asked for; the punkah was not, so it comes
    // after them rather than first in bible order.
    expect(objects.indexOf("tram")).toBeLessThan(objects.indexOf("punkah"));
    expect(card).toContain("Calcutta, 1943");
    expect(card).toContain("strict");
  });

  it("carries what to say and what never to say", () => {
    const card = buildSettingCard({ setting, bible: BIBLE, lexicon: LEXICON, plan: "" });
    expect(card).toContain("tram (not streetcar)");
    expect(card).toContain("Do not:");
    expect(card).toContain("plastic bag");
    expect(card).toContain('child → father: "Baba"');
  });

  it("stays inside its budget", () => {
    const card = buildSettingCard({ setting, bible: BIBLE, lexicon: LEXICON, plan: "", limit: 20 });
    expect(Math.ceil(card.length / 4)).toBeLessThanOrEqual(40);
    expect(card.split("\n")[0]).toContain("SETTING CARD");
  });

  it("is empty-handed rather than wrong when nothing is researched", () => {
    expect(buildSettingCard({ setting, bible: "", lexicon: null, plan: "x" })).toContain("SETTING CARD");
  });
});

describe("the anachronism pass", () => {
  it("finds a forbidden word and quotes the sentence", () => {
    const text = "He looked at the ledger. \"That is okay with me,\" said the clerk. Rain came.";
    const hits = findAnachronisms(text, LEXICON);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.term).toBe("okay");
    // The quote has to be findable in the file or the finding cannot be located.
    expect(text).toContain(hits[0]!.quote);
    expect(hits[0]!.quote.length).toBeGreaterThan("okay".length);
  });

  it("does not fire inside a longer word", () => {
    expect(findAnachronisms("The train was full of hokay nonsense.", LEXICON)).toHaveLength(0);
    expect(findAnachronisms("She walked to the tramway.", {
      ...LEXICON, forbidden: [{ term: "tram", reason: "test" }],
    })).toHaveLength(0);
  });

  it("reports one row per term, not per occurrence", () => {
    const text = "okay. okay. okay. Then he said okay again.";
    expect(findAnachronisms(text, LEXICON)).toHaveLength(1);
  });

  it("suggests the word the lexicon prefers", () => {
    const found = anachronismFindings({
      text: "He boarded the streetcar at dawn and paid his fare.",
      lexicon: { ...LEXICON, forbidden: [{ term: "streetcar", reason: "American" }] },
      fidelity: "strict",
    });
    expect(found[0]!.suggestion).toContain('Use "tram"');
    expect(found[0]!.severity).toBe("blocking");
    expect(found[0]!.category).toBe("anachronism/streetcar");
  });

  it("lets fidelity decide how hard it bites", () => {
    expect(severityFor("strict")).toBe("blocking");
    expect(severityFor("flavour")).toBe("warning");
    expect(severityFor("loose")).toBe("note");
    expect(severityFor(undefined)).toBe("warning");
  });

  it("does nothing without a word list", () => {
    expect(findAnachronisms("anything at all", null)).toHaveLength(0);
    expect(findAnachronisms("anything at all", { ...LEXICON, forbidden: [] })).toHaveLength(0);
  });
});

describe("research output", () => {
  it("keeps the word list safe to iterate", () => {
    const lexicon = parseLexicon({
      prefer: [{ term: "tram", for: "streetcar" }, { term: "" }, "junk"],
      forbidden: [{ term: "okay", reason: "" }, { term: "okay", reason: "dup" }, { nope: 1 }],
      addressForms: [{ speaker: "child", to: "father", form: "Baba" }],
      currency: { unit: "rupee", sub: "anna" },
    });
    expect(lexicon.prefer).toHaveLength(1);
    // Duplicates and blanks would each become a separate finding on every
    // chapter, so they are dropped where they arrive.
    expect(lexicon.forbidden).toHaveLength(1);
    expect(lexicon.forbidden[0]!.reason).toBe("not of this time or place");
    expect(lexicon.currency?.unit).toBe("rupee");
  });

  it("clamps a detector's confidence", () => {
    expect(parseGuess({ place: "Calcutta", time: "1943", confidence: 0.8 }).confidence).toBe(0.8);
    expect(parseGuess({ confidence: 5 }).confidence).toBe(1);
    expect(parseGuess({}).confidence).toBe(0);
  });
});

describe("a series", () => {
  const series: Series = {
    id: "lamp", title: "The Lamp Cycle",
    works: [{ type: "book", id: "one", order: 1 }, { type: "book", id: "two", order: 2 }],
    promises: [
      { id: "p1", text: "who sent the envelope", openedIn: "one", paidIn: null, at: "" },
      { id: "p2", text: "the brother's debt", openedIn: "one", paidIn: "two", at: "" },
    ],
    at: "",
  };

  it("knows what is still owed", () => {
    expect(openPromises(series).map((p) => p.id)).toEqual(["p1"]);
  });

  it("hands the next book the earlier book's own words", () => {
    const brief = seriesBrief(series, "two");
    expect(brief).toContain("The Lamp Cycle");
    expect(brief).toContain("who sent the envelope");
    expect(brief).not.toContain("the brother's debt");
  });

  it("says nothing to the first work in a series", () => {
    expect(seriesBrief({ ...series, works: [{ type: "book", id: "one", order: 1 }] }, "one")).toBe("");
    expect(seriesBrief(null, "one")).toBe("");
  });
});
