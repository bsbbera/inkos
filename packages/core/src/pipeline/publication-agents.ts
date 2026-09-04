/**
 * Which agent answers which magazine stage.
 *
 * Every stage of a publication ran through one `createAgentContext("publication")`,
 * so the model laying out a page was the model checking its facts was the model
 * auditing its own prose. One pin for seven jobs is not a routing decision, it
 * is the absence of one — and it made the Agents page lie: "magazine" was a row
 * that could not express "research on something cheap, design on something good".
 *
 * The runner already labels every call with the stage it is in — `ask(prompt,
 * "design")`, `ask(prompt, "audit-12")` — so the split needs no new plumbing.
 * The tag is the routing key; this is the map.
 */

export const PUBLICATION_AGENTS = {
  researcher: "publication-researcher",
  planner: "publication-planner",
  writer: "publication-writer",
  designer: "publication-designer",
  factChecker: "publication-fact-checker",
  auditor: "publication-auditor",
  reviser: "publication-reviser",
  /** The fallback, and the id every older config pinned. */
  publication: "publication",
} as const;

/**
 * The agent for one stage tag.
 *
 * Tags carry an index (`page-12`, `audit-3`) or a sub-step (`research:health`),
 * so matching is on the prefix. An unknown tag falls back to `publication`,
 * which is the id that existed before this split: a stage nobody has thought
 * about keeps the behaviour it had rather than silently losing its pin.
 */
export function agentForStage(tag: string): string {
  const t = tag.toLowerCase();
  if (t.startsWith("research")) return PUBLICATION_AGENTS.researcher;
  if (t === "plan") return PUBLICATION_AGENTS.planner;
  if (t.startsWith("page-")) return PUBLICATION_AGENTS.writer;
  if (t === "design") return PUBLICATION_AGENTS.designer;
  if (t.startsWith("factcheck")) return PUBLICATION_AGENTS.factChecker;
  if (t.startsWith("audit")) return PUBLICATION_AGENTS.auditor;
  if (t.startsWith("revise") || t.startsWith("element-")) return PUBLICATION_AGENTS.reviser;
  return PUBLICATION_AGENTS.publication;
}
