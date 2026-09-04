import { describe, expect, it } from "vitest";
import { deriveActiveRun } from "./use-shell-data";

const at = (event: string, data: unknown = null, timestamp = 1) => ({ event, data, timestamp });

describe("deriveActiveRun", () => {
  it("has nothing to show on an empty stream", () => {
    expect(deriveActiveRun([])).toBeNull();
  });

  it("opens on a start and names the work from the payload", () => {
    expect(deriveActiveRun([at("audit:start", { title: "The Lamp Room" })])).toEqual({
      what: "Auditing",
      where: "The Lamp Room",
      startedAt: 1,
    });
  });

  it("closes on complete and on error alike", () => {
    expect(deriveActiveRun([at("draft:start"), at("draft:complete")])).toBeNull();
    expect(deriveActiveRun([at("draft:start"), at("draft:error")])).toBeNull();
  });

  it("shows the latest run when one follows another", () => {
    const run = deriveActiveRun([
      at("draft:start", { title: "A" }, 1),
      at("draft:complete", null, 2),
      at("revise:start", { bookTitle: "B" }, 3),
    ]);
    expect(run).toEqual({ what: "Revising", where: "B", startedAt: 3 });
  });

  it("names a stage it has never heard of rather than dropping it", () => {
    expect(deriveActiveRun([at("collate:start")])?.what).toBe("collate");
  });

  it("ignores events that are not a start/finish pair", () => {
    expect(deriveActiveRun([at("ping"), at("log", { line: "x" })])).toBeNull();
  });
});
