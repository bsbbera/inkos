import { describe, expect, it } from "vitest";
import { titleOf } from "./title-of";

describe("titleOf", () => {
  it("reads a slug as a title", () => {
    expect(titleOf("the-blue-that-outlasts-the-stone")).toBe("The Blue That Outlasts the Stone");
  });
  it("puts back the apostrophe a slug ate", () => {
    expect(titleOf("the-green-leaf-s-secret")).toBe("The Green Leaf's Secret");
  });
  it("is empty for nothing", () => {
    expect(titleOf("")).toBe("");
  });
});
