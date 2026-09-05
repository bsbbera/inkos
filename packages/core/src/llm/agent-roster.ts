/**
 * Every agent a model can be pinned to, named once.
 *
 * The names were only ever string literals at call sites — `agentCtxFor("writer")`
 * here, `createAgentContext("short-writer")` there — so nothing could list them.
 * A settings page cannot offer a routing table it has to guess the rows of, and
 * that is most of why the routing UI was a free-text box: nobody could say what
 * the legal keys were.
 *
 * They also drifted. `state-validator` is written three times and `stateValidator`
 * once, for the same agent, so a pin on either covered part of its work and the
 * rest silently ran the global model. `ALIASES` closes that without breaking the
 * configs people already have.
 *
 * The rule for being in this list: the id is actually passed to
 * `createAgentContext`/`agentCtxFor` somewhere that runs. An agent nobody
 * instantiates (PolisherAgent is exported and never constructed) is not offered
 * — a routing row that changes nothing is worse than a missing one.
 */

export type AgentGroup =
  | "book"
  | "checks"
  | "short"
  | "storybook"
  | "script"
  | "magazine"
  | "interactive"
  | "chat";

export interface AgentRole {
  readonly id: string;
  /** What the row is called. */
  readonly label: string;
  /** One line, in the user's terms, under the label. */
  readonly does: string;
  readonly group: AgentGroup;
}

export const AGENT_ROSTER: ReadonlyArray<AgentRole> = [
  // Books — the long-fiction runner.
  { id: "architect", label: "architect", does: "plans the foundation before any chapter exists", group: "book" },
  { id: "planner", label: "planner", does: "plans each chapter against the outline", group: "book" },
  { id: "writer", label: "writer", does: "drafts chapters", group: "book" },
  { id: "reviser", label: "reviser", does: "rewrites what the audit flagged", group: "book" },
  { id: "composer", label: "composer", does: "assembles context and the rule stack", group: "book" },
  { id: "chapter-analyzer", label: "chapter analyzer", does: "reads an imported chapter back into canon", group: "book" },
  { id: "fanfic-canon-importer", label: "canon importer", does: "rebuilds a world from someone else's book", group: "book" },

  // Checks — the passes that judge finished work.
  { id: "auditor", label: "auditor", does: "checks a chapter against the truth files", group: "checks" },
  { id: "story-audit", label: "story audit", does: "audits anything already written", group: "checks" },
  { id: "foundation-reviewer", label: "foundation reviewer", does: "reviews the foundation before writing starts", group: "checks" },
  { id: "state-validator", label: "state validator", does: "checks the story state persisted correctly", group: "checks" },
  { id: "destyler", label: "de-AI styler", does: "rewrites prose the detector scored as machine-written", group: "checks" },

  // Short fiction — its own multi-stage runner.
  { id: "short-outline", label: "short outline", does: "outlines a short", group: "short" },
  { id: "short-outline-review", label: "short outline review", does: "checks the outline before drafting", group: "short" },
  { id: "short-writer", label: "short writer", does: "drafts the short", group: "short" },
  { id: "short-draft-review", label: "short draft review", does: "reads the draft back", group: "short" },
  { id: "short-revise", label: "short revise", does: "rewrites the short", group: "short" },
  { id: "short-package", label: "short package", does: "titles, blurbs and packages it", group: "short" },

  // Script and storyboard.
  { id: "script-creation", label: "script", does: "writes the screenplay", group: "script" },
  { id: "storyboard-creation", label: "storyboard", does: "breaks a script into shots", group: "script" },

  // Magazine — one stage, one agent. These ran on a single shared context
  // until the tag each stage already passes was made the routing key.
  { id: "publication-researcher", label: "magazine research", does: "searches the web and extracts what is citable", group: "magazine" },
  { id: "publication-planner", label: "magazine planner", does: "turns a subject into a page-by-page issue plan", group: "magazine" },
  { id: "publication-writer", label: "magazine writer", does: "writes each page and its visual briefs", group: "magazine" },
  { id: "publication-designer", label: "designer", does: "decides layout, grid and type, then hands the build to Affinity", group: "magazine" },
  { id: "publication-fact-checker", label: "fact checker", does: "verifies each claim against a source", group: "magazine" },
  { id: "publication-auditor", label: "magazine auditor", does: "reads the finished pages back", group: "magazine" },
  { id: "publication-reviser", label: "magazine reviser", does: "rewrites a page or one element of it", group: "magazine" },
  { id: "publication", label: "magazine (other)", does: "any magazine stage with no agent of its own yet", group: "magazine" },

  // Picture books. One pin, not two: planning the spreads and writing them are
  // the same voice a few hundred words apart, and splitting the row would offer
  // a choice nobody has a reason to make differently.
  { id: "storybook", label: "storybook", does: "plans and writes a picture book, spread by spread", group: "storybook" },

  // Interactive and live.
  { id: "interactive-film-creation", label: "interactive film", does: "writes the branching film", group: "interactive" },
  { id: "film-authoring", label: "film authoring", does: "edits a film from chat", group: "interactive" },
  { id: "play", label: "play", does: "runs a live world turn by turn", group: "interactive" },

  // Everything else.
  { id: "radar", label: "radar", does: "scans the market for what is selling", group: "chat" },
  { id: "forecast", label: "forecast", does: "projects where the story is heading", group: "chat" },
];

export const AGENT_GROUP_LABELS: Readonly<Record<AgentGroup, string>> = {
  book: "Books",
  checks: "Checks",
  short: "Short fiction",
  storybook: "Storybook",
  script: "Script & storyboard",
  magazine: "Magazine",
  interactive: "Interactive & live",
  chat: "Elsewhere",
};

/**
 * Old spellings that must keep resolving.
 *
 * A config written before this file exists may pin `stateValidator`; dropping it
 * would silently move that agent back to the global model, which is exactly the
 * failure this list is here to prevent.
 */
const ALIASES: Readonly<Record<string, string>> = {
  stateValidator: "state-validator",
  statevalidator: "state-validator",
  destyle: "destyler",
  deslop: "destyler",
  detector: "destyler",
  storyAudit: "story-audit",
  foundationReviewer: "foundation-reviewer",
  chapterAnalyzer: "chapter-analyzer",
};

const ROSTER_IDS = new Set(AGENT_ROSTER.map((role) => role.id));

/** The one spelling of an agent name. Unknown names pass through unchanged. */
export function canonicalAgentId(name: string): string {
  const trimmed = name.trim();
  return ALIASES[trimmed] ?? trimmed;
}

export function isKnownAgent(name: string): boolean {
  return ROSTER_IDS.has(canonicalAgentId(name));
}

export function agentRole(name: string): AgentRole | undefined {
  const id = canonicalAgentId(name);
  return AGENT_ROSTER.find((role) => role.id === id);
}

/**
 * The rows a person actually sets.
 *
 * Twenty-six agents is the truth of the pipeline and the wrong shape for a
 * settings page: `writer`, `short-writer` and `play` are one decision — "who
 * writes prose" — split three ways because three runners happen to call three
 * ids. Nobody wants a fast model for chapters and an expensive one for shorts;
 * they want a writing model. So the page offers jobs, and a job's pin is
 * written to every agent that does it.
 *
 * Per-agent pins keep working underneath: `modelOverrides` is still keyed by
 * agent id, the resolver never sees a job, and a config that pins one member by
 * hand still resolves. A job simply writes all of its members at once.
 */
export interface AgentJob {
  readonly id: string;
  readonly label: string;
  readonly does: string;
  readonly members: ReadonlyArray<string>;
}

export const AGENT_JOBS: ReadonlyArray<AgentJob> = [
  {
    id: "planner",
    label: "Planner",
    does: "Decides what happens before anything is written — outlines, foundations, scripts, shot lists.",
    members: [
      "architect", "planner", "composer",
      "short-outline", "script-creation", "storyboard-creation",
      "interactive-film-creation", "film-authoring", "publication-planner",
    ],
  },
  {
    id: "writer",
    label: "Writer",
    does: "Writes the prose: chapters, shorts, magazine copy, live turns.",
    members: ["writer", "short-writer", "play", "publication-writer", "publication"],
  },
  {
    id: "reviewer",
    label: "Reviewer",
    does: "Judges finished work — audits, reviews, state and continuity checks.",
    members: [
      "auditor", "story-audit", "foundation-reviewer", "state-validator",
      "short-outline-review", "short-draft-review",
      "publication-auditor", "publication-fact-checker",
    ],
  },
  {
    id: "reviser",
    label: "Reviser",
    does: "Rewrites what a review flagged, then packages the result.",
    members: ["reviser", "short-revise", "short-package", "publication-reviser"],
  },
  {
    id: "destyler",
    label: "De-AI styler",
    does: "Rewrites prose the detector scored as machine-written.",
    members: ["destyler"],
  },
  {
    id: "designer",
    label: "Designer",
    does: "Decides how a page looks — grid, type, colour — and drives the Affinity build.",
    members: ["publication-designer"],
  },
  {
    id: "researcher",
    label: "Researcher",
    does: "Reads the outside world back in — market scans, forecasts, imported canon.",
    members: ["radar", "forecast", "chapter-analyzer", "fanfic-canon-importer", "publication-researcher"],
  },
];

/** Which job an agent belongs to, or null for one no job claims. */
export function jobOf(agent: string): AgentJob | undefined {
  const id = canonicalAgentId(agent);
  return AGENT_JOBS.find((job) => job.members.includes(id));
}
