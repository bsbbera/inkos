/*
 * Presets: one knob instead of a pin per agent (20 §4).
 *
 * Every connected model gets a card (reasoning, speed, cost, context, vision,
 * web), every agent a line of needs, and a preset picks, per agent, the
 * best-scoring connected model that meets them:
 *
 *   best      the strongest reasoner
 *   balanced  reasoning and speed against cost
 *   frugal    the cheapest that still qualifies
 *
 * Pins still win (model-routing.ts). With no preset set nothing here runs, so a
 * workspace routes exactly as it did before until someone picks one.
 *
 * Pure: the host hands in the connected models; nothing is read or fetched.
 */
import { canonicalAgentId } from "./agent-roster.js";

export type ModelPreset = "best" | "balanced" | "frugal";
export const MODEL_PRESETS: ReadonlyArray<ModelPreset> = ["best", "balanced", "frugal"];

export interface ModelCard {
  readonly service: string;
  readonly model: string;
  /** 1–5. */
  readonly reasoning: number;
  /** 1–5, 5 fastest. */
  readonly speed: number;
  /** 1–5, 5 dearest. A CLI's is its quota burn, not money. */
  readonly cost: number;
  /** Tokens. */
  readonly context: number;
  readonly vision: boolean;
  /** Can search the web itself: every CLI browses on its own account. */
  readonly web: boolean;
}

export interface Needs {
  readonly reasoning?: number;
  readonly speed?: number;
  readonly maxCost?: number;
  readonly context?: number;
  readonly vision?: boolean;
  readonly web?: boolean;
}

const DEEP: Needs = { reasoning: 4, context: 100_000 };
const JUDGE: Needs = { reasoning: 4 };
const QUICK: Needs = { speed: 4, maxCost: 2 };
const RESEARCH: Needs = { web: true, context: 100_000 };

/** One line per agent; an agent not listed takes whatever scores best. */
export const AGENT_NEEDS: Readonly<Record<string, Needs>> = {
  architect: DEEP, planner: DEEP, writer: DEEP, reviser: DEEP, "fanfic-canon-importer": DEEP,
  "short-outline": DEEP, "short-writer": DEEP, "short-revise": DEEP,
  "script-creation": DEEP, "storyboard-creation": DEEP, storybook: DEEP, "interactive-film-creation": DEEP,
  "publication-planner": DEEP, "publication-writer": DEEP, "publication-reviser": DEEP,
  auditor: JUDGE, "story-audit": JUDGE, "foundation-reviewer": JUDGE, "state-validator": JUDGE,
  "short-outline-review": JUDGE, "short-draft-review": JUDGE, "publication-auditor": JUDGE, publication: JUDGE,
  destyler: QUICK, composer: QUICK, "chapter-analyzer": QUICK, "short-package": QUICK, play: { speed: 4 },
  "film-authoring": { speed: 4 },
  "publication-researcher": RESEARCH, "publication-fact-checker": RESEARCH, radar: RESEARCH, forecast: RESEARCH,
  "publication-designer": { vision: true },
};

export const needsOf = (agent: string): Needs => AGENT_NEEDS[canonicalAgentId(agent)] ?? {};

/** Facts pi's catalogue knows about a model, when it knows it. */
export interface KnownModel {
  readonly reasoning?: boolean;
  readonly contextWindow?: number;
  readonly input?: ReadonlyArray<string>;
  /** $ per million input tokens. */
  readonly costInput?: number;
}

/**
 * A model's card, from pi's facts where it has them and from its name where not.
 *
 * ponytail: the name tiers (opus/pro/high · sonnet/medium · haiku/flash/mini/low)
 * are a heuristic; a model named against them scores wrong until pi knows it.
 */
export function describeModel(service: string, model: string, known: KnownModel = {}): ModelCard {
  const id = model.toLowerCase();
  const tier = /opus|[-/]pro\b|\bpro\b|-high\b|thinking|\bmax\b|terra|gpt-5(\.\d+)?$/.test(id) ? 3
    : /haiku|flash|mini|nano|lite|-low\b|small|fast|\b\d+b\b/.test(id) ? 1
      : 2;
  const priced = known.costInput;
  const cost = priced === undefined || priced === 0
    ? (tier === 3 ? 5 : tier === 2 ? 3 : 1)
    : priced <= 0.5 ? 1 : priced <= 2 ? 2 : priced <= 5 ? 3 : priced <= 15 ? 4 : 5;
  return {
    service,
    model,
    reasoning: tier === 3 ? 5 : tier === 2 ? 4 : known.reasoning ? 4 : 3,
    speed: tier === 3 ? 2 : tier === 2 ? 3 : 5,
    cost,
    context: known.contextWindow || (/claude|gemini|gpt-5|glm|kimi|qwen/.test(id) ? 200_000 : 128_000),
    vision: known.input ? known.input.includes("image") : /claude|gpt-4o|gpt-5|gemini|kimi|vision|vl\b/.test(id),
    web: /Cli$/.test(service),
  };
}

export function meets(card: ModelCard, needs: Needs): boolean {
  return (needs.reasoning === undefined || card.reasoning >= needs.reasoning)
    && (needs.speed === undefined || card.speed >= needs.speed)
    && (needs.maxCost === undefined || card.cost <= needs.maxCost)
    && (needs.context === undefined || card.context >= needs.context)
    && (!needs.vision || card.vision)
    && (!needs.web || card.web);
}

const SCORE: Readonly<Record<ModelPreset, (c: ModelCard) => number>> = {
  best: (c) => c.reasoning * 10 + c.context / 1e6,
  balanced: (c) => c.reasoning * 3 + c.speed * 2 - c.cost * 2,
  frugal: (c) => -c.cost * 10 + c.speed * 2 + c.reasoning,
};

export interface PresetPick {
  readonly card: ModelCard;
  /** What the routing page shows: "Frugal → claude/haiku: speed 5, cost 1, meets de-AI styler needs". */
  readonly reason: string;
}

const LABEL: Readonly<Record<ModelPreset, string>> = { best: "Best", balanced: "Balanced", frugal: "Frugal" };

/** The connected model a preset gives this agent, or null when none meets its needs. */
export function pickForAgent(
  agent: string,
  preset: ModelPreset,
  cards: ReadonlyArray<ModelCard>,
): PresetPick | null {
  const needs = needsOf(agent);
  let best: ModelCard | null = null;
  for (const card of cards) {
    if (!meets(card, needs)) continue;
    if (!best || SCORE[preset](card) > SCORE[preset](best)) best = card;
  }
  if (!best) return null;
  const facts = `reasoning ${best.reasoning}, speed ${best.speed}, cost ${best.cost}`;
  const why = Object.keys(needs).length ? `meets ${canonicalAgentId(agent)} needs` : "no special needs";
  return { card: best, reason: `${LABEL[preset]} → ${best.model}: ${facts}, ${why}` };
}
