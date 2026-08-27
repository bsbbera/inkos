import { describe, expect, it } from "vitest";
import { briefsOf, readBriefs, outstanding, type PublicationPage } from "../pipeline/publication-runner.js";

const page = (over: Partial<PublicationPage> = {}): PublicationPage => ({
  n: 1, title: "t", type: "feature", density: "M", section: 1,
  pillar: "origin", premise: "p", body: "b", ...over,
});

describe("readBriefs", () => {
  // The whole point: a page decides how many pictures it wants, including none.
  it("takes a list of briefs", () => {
    const out = readBriefs({
      image_prompts: [
        { prompt: "a dawn doorstep", orientation: "landscape", role: "hero" },
        { prompt: "a chalk detail", orientation: "square", role: "inset" },
      ],
    }, page());
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ prompt: "a chalk detail", orientation: "square", role: "inset" });
  });

  it("accepts a list of bare strings", () => {
    expect(readBriefs({ image_prompts: ["one", "two"] }, page()).map((b) => b.prompt))
      .toEqual(["one", "two"]);
  });

  it("still accepts the single-string shape a model may answer in anyway", () => {
    expect(readBriefs({ image_prompt: "one picture", image_orientation: "portrait" }, page()))
      .toEqual([{ prompt: "one picture", orientation: "portrait" }]);
  });

  it("treats no prompt as no picture rather than as a failure", () => {
    expect(readBriefs({ image_prompt: "" }, page())).toEqual([]);
    expect(readBriefs({}, page())).toEqual([]);
    expect(readBriefs({ image_prompts: [] }, page())).toEqual([]);
  });

  it("drops an empty entry inside a list without dropping its neighbours", () => {
    expect(readBriefs({ image_prompts: ["a", "", { prompt: "  " }, "b"] }, page()))
      .toHaveLength(2);
  });

  it("inherits the page's existing orientation when the model omits one", () => {
    const existing = page({ briefs: [{ prompt: "old", orientation: "portrait" }] });
    expect(readBriefs({ image_prompts: ["new"] }, existing)[0]!.orientation).toBe("portrait");
  });
});

describe("briefsOf", () => {
  it("reads the list when there is one", () => {
    expect(briefsOf(page({ briefs: [{ prompt: "a", orientation: "landscape" }] }))).toHaveLength(1);
  });

  // Issues written before the list exist in the workspace right now.
  it("lifts a legacy single brief so an old issue still renders", () => {
    const legacy = { ...page(), brief: { prompt: "old one", orientation: "square" } } as PublicationPage;
    expect(briefsOf(legacy)).toEqual([{ prompt: "old one", orientation: "square" }]);
  });

  it("reads a legacy page with an empty brief as no briefs", () => {
    const legacy = { ...page(), brief: { prompt: "", orientation: "landscape" } } as PublicationPage;
    expect(briefsOf(legacy)).toEqual([]);
  });

  it("returns nothing for a page that has neither", () => {
    expect(briefsOf(page())).toEqual([]);
  });
});

describe("outstanding art", () => {
  const issue = (pages: PublicationPage[]) => ({ pages } as never);

  it("counts a page whose briefs are all unrendered", () => {
    expect(outstanding(issue([page({ n: 1, briefs: [{ prompt: "a", orientation: "landscape" }] })]), "art", false))
      .toEqual([1]);
  });

  it("still counts a page with one of two images done", () => {
    const p = page({
      n: 3,
      briefs: [{ prompt: "a", orientation: "landscape" }, { prompt: "b", orientation: "square" }],
      images: ["art/03-1.png"],
    });
    expect(outstanding(issue([p]), "art", false)).toEqual([3]);
  });

  it("leaves a fully rendered page alone", () => {
    const p = page({
      n: 4,
      briefs: [{ prompt: "a", orientation: "landscape" }],
      images: ["art/04.png"],
    });
    expect(outstanding(issue([p]), "art", false)).toEqual([]);
  });

  // A plate wants a picture; a contents page does not, and used to throw.
  it("never queues a page that asked for no picture", () => {
    expect(outstanding(issue([page({ n: 2, briefs: [] })]), "art", false)).toEqual([]);
  });
});
