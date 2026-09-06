import { describe, expect, it } from "vitest";
import { titleOf } from "./AuditPage";

describe("a folder name, read as a title", () => {
  it("turns a slug into words", () => {
    expect(titleOf("the-lamp-room")).toBe("The Lamp Room");
  });

  it("keeps small words small, except at the front", () => {
    expect(titleOf("the-kolam-drawn-at-dawn-on-south-indian-doorsteps"))
      .toBe("The Kolam Drawn at Dawn on South Indian Doorsteps");
    expect(titleOf("of-mice-and-men")).toBe("Of Mice and Men");
  });

  it("takes underscores as well as hyphens", () => {
    expect(titleOf("closing_time")).toBe("Closing Time");
  });

  it("leaves somebody's own capitals alone", () => {
    // A slug is all lowercase by construction, so anything else was typed on
    // purpose and is not ours to normalise.
    expect(titleOf("the-McKay-letters")).toBe("The McKay Letters");
  });

  it("keeps an acronym as an acronym", () => {
    expect(titleOf("NASA-and-the-moon")).toBe("Nasa and the Moon");
  });

  it("gives back what it got when there is nothing to format", () => {
    expect(titleOf("")).toBe("");
    expect(titleOf("---")).toBe("---");
  });

  it("does not choke on a timestamp id", () => {
    expect(titleOf("1787906146772-psqj0a")).toBe("1787906146772 Psqj0a");
  });
});
