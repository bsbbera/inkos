/**
 * Which model answers for which agent.
 *
 * The mechanism existed — `ProjectConfig.modelOverrides` keyed by agent name —
 * and two things were missing from it. The name was matched literally, so one
 * agent written two ways got routed two ways. And a pin was trusted absolutely:
 * pin the writer to a CLI, switch that CLI off in the agents panel, and the run
 * still asked for it and failed at the model, when the honest answer was "that
 * one is gone, use the default".
 *
 * So resolution is a decision with a reason attached, not a lookup. The reason
 * is what the settings page renders — a row that says "uses the default" is
 * telling the truth about a missing pin, and a row that says "pinned model is
 * not reachable" is telling the truth about a present one. Silently falling back
 * and silently failing look identical from the outside; only one of them should
 * happen, and the user should be able to see it.
 *
 * Pure. Nothing here reads a file, builds a client, or knows a base URL.
 */

import type { AgentLLMOverride } from "../models/project.js";
import { canonicalAgentId } from "./agent-roster.js";

/** What a pin can be. A bare string is a model on the project's own client. */
export type ModelPin = string | AgentLLMOverride;

export interface RouteTarget {
  /** Absent for a bare-string pin: it rides the project's configured service. */
  readonly service?: string;
  readonly model: string;
}

export type RouteSource = "pin" | "global";

export interface ResolvedRoute extends RouteTarget {
  readonly source: RouteSource;
  /** The pin's full object form, when it carried a base URL or key of its own. */
  readonly override?: AgentLLMOverride;
  /**
   * Set only when a pin was found and refused. The route is the global one; this
   * says what was asked for and why it could not be honoured.
   */
  readonly droppedPin?: {
    readonly model: string;
    readonly service?: string;
    readonly reason: "unreachable";
  };
}

export interface RouteInput {
  readonly agent: string;
  readonly overrides?: Readonly<Record<string, ModelPin>> | undefined;
  /** Where everything lands when nothing more specific is set. */
  readonly global: RouteTarget;
  /**
   * Whether a target can be reached right now. Omit to trust every pin — which
   * is correct offline, in tests, and anywhere the caller has no live roster.
   */
  readonly isAvailable?: (target: RouteTarget) => boolean;
}

function targetOf(pin: ModelPin): RouteTarget {
  if (typeof pin === "string") return { model: pin };
  return pin.service ? { service: pin.service, model: pin.model } : { model: pin.model };
}

/**
 * Look up the agent's pin, check it is usable, and say which way it went.
 *
 * The canonical id is looked up first and the literal name second, so a config
 * written before the roster existed still resolves while new writes are
 * normalised.
 */
export function resolveAgentRoute(input: RouteInput): ResolvedRoute {
  const canonical = canonicalAgentId(input.agent);
  const pin = input.overrides?.[canonical] ?? input.overrides?.[input.agent];
  if (pin === undefined) return { ...input.global, source: "global" };

  const target = targetOf(pin);
  if (!target.model) return { ...input.global, source: "global" };

  if (input.isAvailable && !input.isAvailable(target)) {
    return {
      ...input.global,
      source: "global",
      droppedPin: {
        model: target.model,
        ...(target.service ? { service: target.service } : {}),
        reason: "unreachable",
      },
    };
  }

  return {
    ...target,
    source: "pin",
    ...(typeof pin === "string" ? {} : { override: pin }),
  };
}

/**
 * Every agent's route in one pass, for the settings page.
 *
 * The page has to show unpinned agents too — "uses the default" is a row, not an
 * absence — so this walks the roster the caller hands it rather than the keys of
 * the overrides object.
 */
export function resolveRoutingTable(input: {
  readonly agents: ReadonlyArray<string>;
  readonly overrides?: Readonly<Record<string, ModelPin>> | undefined;
  readonly global: RouteTarget;
  readonly isAvailable?: (target: RouteTarget) => boolean;
}): Readonly<Record<string, ResolvedRoute>> {
  const out: Record<string, ResolvedRoute> = {};
  for (const agent of input.agents) {
    out[canonicalAgentId(agent)] = resolveAgentRoute({
      agent,
      ...(input.overrides ? { overrides: input.overrides } : {}),
      global: input.global,
      ...(input.isAvailable ? { isAvailable: input.isAvailable } : {}),
    });
  }
  return out;
}

/**
 * Rewrite an overrides map onto canonical names, dropping empties.
 *
 * Run on every save, so the file converges on one spelling instead of
 * accumulating both. A pin whose model is blank is a deleted row, not a pin to
 * nothing.
 */
export function normalizeOverrides(
  overrides: Readonly<Record<string, ModelPin>> | undefined,
): Record<string, ModelPin> {
  const out: Record<string, ModelPin> = {};
  for (const [name, pin] of Object.entries(overrides ?? {})) {
    const model = typeof pin === "string" ? pin.trim() : pin?.model?.trim();
    if (!model) continue;
    out[canonicalAgentId(name)] = typeof pin === "string" ? model : { ...pin, model };
  }
  return out;
}
