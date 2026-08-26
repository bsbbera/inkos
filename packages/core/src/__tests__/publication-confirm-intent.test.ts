import { describe, expect, it } from "vitest";
import { RequestedIntentSchema } from "../interaction/action-envelope.js";
import { createPublicationCreateTool } from "../agent/index.js";

/**
 * publication_create was offered by propose_action and had no confirm branch
 * in the API server, so confirming a magazine card threw
 * UNSUPPORTED_CONFIRMED_ACTION. The tool was not even exported for the server
 * to reach. Both halves are pinned here.
 */
describe("publication_create is confirmable", () => {
  it("is an intent a confirmation card may carry", () => {
    expect(RequestedIntentSchema.safeParse("publication_create").success).toBe(true);
  });

  it("exports the tool the confirm branch builds", () => {
    expect(typeof createPublicationCreateTool).toBe("function");
  });
});
