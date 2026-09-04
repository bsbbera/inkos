import { describe, expect, it } from "vitest";
import { deriveGates } from "./Dashboard";
import type { BookSummary } from "../shared/contracts";
import type { PublicationSummary } from "../hooks/use-shell-data";
import type { Creation } from "./Dashboard";

const book = (over: Partial<BookSummary>): BookSummary => ({
  id: "lamp",
  title: "The Lamp Room",
  status: "active",
  platform: "other",
  genre: "mystery",
  targetChapters: 22,
  chapterWordCount: 3000,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  chaptersWritten: 9,
  chapterCount: 9,
  lastChapterNumber: 9,
  totalWords: 71400,
  approvedChapters: 8,
  pendingReview: 0,
  pendingReviewChapters: [],
  failedChapters: 0,
  ...over,
});

const issue = (over: Partial<PublicationSummary>): PublicationSummary => ({
  id: "fathom-4",
  type: "magazine",
  title: "Fathom 4",
  subject: "the deep",
  status: "drafting",
  extent: 64,
  pages: 64,
  written: 28,
  art: 0,
  pdf: null,
  ...over,
});

const work = (over: Partial<Creation>): Creation => ({
  kind: "short",
  label: "Shorts",
  id: "closing-time",
  title: "Closing Time",
  files: 3,
  words: 4200,
  read: 3,
  signedOff: 3,
  open: 0,
  blocking: 0,
  modified: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("deriveGates", () => {
  it("is empty when nothing needs a person", () => {
    expect(deriveGates([book({})], [issue({})])).toEqual([]);
  });

  it("names the chapter when exactly one is waiting", () => {
    const [gate] = deriveGates([book({ pendingReview: 1, pendingReviewChapters: [9] })], []);
    expect(gate.name).toBe("Chapter 9 needs a read");
    expect(gate.action).toBe("Read it");
  });

  it("counts them, and lists which, when several are waiting", () => {
    const [gate] = deriveGates(
      [book({ pendingReview: 3, pendingReviewChapters: [9, 12, 27] })],
      [],
    );
    expect(gate.name).toBe("3 chapters need a read");
    expect(gate.meta).toContain("chapters 9, 12 and 27");
    expect(gate.action).toBe("Read them");
  });

  // A stopped chapter is not a decision, but it is still waiting on a person,
  // and nothing else in the app would ever mention it.
  it("raises stopped chapters separately from the review gate", () => {
    const gates = deriveGates([book({ pendingReview: 1, pendingReviewChapters: [9], failedChapters: 2 })], []);
    expect(gates.map((g) => g.verb)).toEqual(["needs a read", "stopped"]);
  });

  it("raises an issue only when its status is a gate", () => {
    expect(deriveGates([], [issue({ status: "art" })])).toEqual([]);
    const [gate] = deriveGates([], [issue({ status: "copy-gate" })]);
    expect(gate.name).toBe("Fathom 4 is at a gate");
    expect(gate.meta).toContain("28 of 64 pages");
  });

  /* The folder is the work. A creation nobody has signed off is waiting on a
     person whether or not it happens to be a chapter of a book. */
  it("says nothing about a creation that is read and signed off", () => {
    expect(deriveGates([], [], [work({})])).toEqual([]);
  });

  it("raises unread files, counted and named", () => {
    const [gate] = deriveGates([], [], [work({ files: 22, read: 6, signedOff: 0 })]);
    expect(gate.name).toBe("16 files need a read");
    expect(gate.meta).toContain("Closing Time");
    expect(gate.action).toBe("Read them");
  });

  it("raises the signature once everything has been read", () => {
    const [gate] = deriveGates([], [], [work({ files: 3, read: 3, signedOff: 0 })]);
    expect(gate.verb).toBe("sign off");
    expect(gate.name).toBe("Closing Time is ready to sign off");
  });

  // A blocking finding is not a heavier warning, it is a different state:
  // there is no signing off around it, so it outranks a queue of reading.
  it("puts a blocked creation ahead of one that only needs reading", () => {
    const gates = deriveGates([], [], [
      work({ id: "unread", title: "Unread", files: 4, read: 0, signedOff: 0 }),
      work({ id: "held", title: "Held", files: 4, read: 4, signedOff: 0, open: 9, blocking: 2 }),
    ]);
    expect(gates.map((g) => g.verb)).toEqual(["blocked", "needs a read"]);
    expect(gates[0].name).toBe("2 findings block Held");
  });

  it("lets a book speak once rather than in two vocabularies", () => {
    const gates = deriveGates(
      [book({ pendingReview: 1, pendingReviewChapters: [9] })],
      [],
      [work({ kind: "book", label: "Books", id: "lamp", title: "The Lamp Room", files: 9, read: 0, signedOff: 0 })],
    );
    expect(gates).toHaveLength(1);
    expect(gates[0].verb).toBe("needs a read");
  });
});
