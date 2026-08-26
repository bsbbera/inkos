import { describe, expect, it } from "vitest";
import { PublicationCreateActionPayloadSchema } from "../interaction/action-envelope.js";

/**
 * The envelope and the tool have to agree on where a run may stop.
 *
 * They did not: publication_create defaults stopAt to "audit", and the
 * envelope's enum stopped at "write", so a proposed magazine was rejected at
 * validation and the pipeline was never reached.
 */
describe("publicationCreate.stopAt", () => {
  const stages = ["research", "plan", "write", "audit"] as const;

  it.each(stages)("accepts %s — every stage the tool accepts", (stopAt) => {
    const parsed = PublicationCreateActionPayloadSchema.safeParse({ subject: "kolam", stopAt });
    expect(parsed.success).toBe(true);
  });

  it("still refuses art and build: both need the copy approved first", () => {
    for (const stopAt of ["art", "build"]) {
      expect(PublicationCreateActionPayloadSchema.safeParse({ subject: "kolam", stopAt }).success)
        .toBe(false);
    }
  });
});
