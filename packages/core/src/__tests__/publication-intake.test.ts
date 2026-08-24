import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDefinition } from "../publications/types.js";

const def = JSON.parse(readFileSync(
  join(import.meta.dirname, "../../publications/magazine.json"),
  "utf-8",
)) as Record<string, unknown>;

describe("intake declarations", () => {
  it("still validates with intake declared", () => {
    expect(validateDefinition(def as never)).toEqual([]);
  });

  // The gap this closes: a forty-page run used to start with whatever the
  // model guessed, and the user saw the guess only in the finished issue.
  it("requires a subject and an angle before a run may start", () => {
    const required = (def.intake as Array<{ id: string; required?: boolean }>)
      .filter((f) => f.required).map((f) => f.id);
    expect(required).toEqual(["subject", "angle"]);
  });

  it("lets everything else default", () => {
    const optional = (def.intake as Array<{ id: string; required?: boolean }>)
      .filter((f) => !f.required).map((f) => f.id);
    expect(optional).toEqual(["extent", "notes"]);
  });

  it("gives every field a question to ask", () => {
    for (const field of def.intake as Array<{ question: string }>) {
      expect(field.question.length).toBeGreaterThan(10);
    }
  });

  it("refuses an intake field with no question", () => {
    const broken = { ...def, intake: [{ id: "subject", label: "Subject" }] };
    expect(validateDefinition(broken as never).join(" ")).toMatch(/id and a question/);
  });
});
