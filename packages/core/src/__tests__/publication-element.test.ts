import { describe, expect, it } from "vitest";
import { parseElementAddress } from "../pipeline/publication-runner.js";

describe("parseElementAddress", () => {
  it("reads a page and an element", () => {
    expect(parseElementAddress("page:16/deck")).toEqual({ page: 16, kind: "deck", index: undefined });
  });

  it("reads one item out of a list", () => {
    expect(parseElementAddress("page:16/furniture:2")).toEqual({ page: 16, kind: "furniture", index: 2 });
  });

  // Bare page:N is the common case in an editor's note ("page 16 reads flat"),
  // and the body is what that means.
  it("treats a bare page as its body", () => {
    expect(parseElementAddress("page:3")).toEqual({ page: 3, kind: "body", index: undefined });
  });

  it("names the elements when the address is not one", () => {
    expect(() => parseElementAddress("section 1 of page 16")).toThrow(/element address/);
    expect(() => parseElementAddress("page:16/headline")).toThrow(/unknown element "headline"/);
  });
});
