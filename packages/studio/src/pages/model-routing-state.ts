/**
 * The routing table, as the settings page needs it.
 *
 * Pure: no fetch, no store, no React. The page reads a table from
 * `/project/model-routing` and writes pins back; everything between those two
 * points is here so it can be tested without a browser.
 *
 * The one rule worth stating: a row exists for every agent, not for every pin.
 * "uses the default" is an answer a person came to this page to read, and a
 * table that only lists overrides cannot give it.
 */

export interface AgentRole {
  readonly id: string;
  readonly label: string;
  readonly does: string;
  readonly group: string;
}

export interface ResolvedRoute {
  readonly service?: string;
  readonly model: string;
  readonly source: "pin" | "global";
  readonly droppedPin?: {
    readonly model: string;
    readonly service?: string;
    readonly reason: "unreachable";
  };
}

export type ModelPin = string | { readonly service?: string; readonly model: string };

export interface AgentJob {
  readonly id: string;
  readonly label: string;
  readonly does: string;
  readonly members: ReadonlyArray<string>;
}

export interface RoutingTable {
  readonly roster: ReadonlyArray<AgentRole>;
  readonly jobs?: ReadonlyArray<AgentJob>;
  readonly groups: Readonly<Record<string, string>>;
  readonly global: { readonly service: string | null; readonly model: string | null };
  readonly overrides: Readonly<Record<string, ModelPin>>;
  readonly routes: Readonly<Record<string, ResolvedRoute>>;
}

export interface RoutingRow {
  readonly role: AgentRole;
  readonly route: ResolvedRoute;
  /** The `service::model` value of this row's control, or "" for the default. */
  readonly value: string;
}

export interface RoutingGroup {
  readonly id: string;
  readonly label: string;
  readonly rows: ReadonlyArray<RoutingRow>;
}

/** `service::model`, because a model id may itself contain a slash. */
export function pinValue(pin: ModelPin | undefined): string {
  if (pin === undefined) return "";
  if (typeof pin === "string") return `::${pin}`;
  return `${pin.service ?? ""}::${pin.model}`;
}

export function parsePinValue(value: string): ModelPin | null {
  if (!value) return null;
  const at = value.indexOf("::");
  if (at < 0) return null;
  const service = value.slice(0, at);
  const model = value.slice(at + 2);
  if (!model) return null;
  return service ? { service, model } : model;
}

/** Roster into the groups the page renders, in the order the table declared. */
export function routingGroups(table: RoutingTable | null): ReadonlyArray<RoutingGroup> {
  if (!table) return [];
  const order: string[] = [];
  const byGroup = new Map<string, RoutingRow[]>();
  for (const role of table.roster) {
    const route = table.routes[role.id];
    if (!route) continue;
    if (!byGroup.has(role.group)) {
      byGroup.set(role.group, []);
      order.push(role.group);
    }
    byGroup.get(role.group)!.push({
      role,
      route,
      value: pinValue(table.overrides[role.id]),
    });
  }
  return order.map((id) => ({
    id,
    label: table.groups[id] ?? id,
    rows: byGroup.get(id)!,
  }));
}

/**
 * What the row says to the right of the agent's name.
 *
 * Three states, and the third is the one that used to be invisible: a pin
 * pointing at a provider that is switched off or has lost its key. The run
 * falls back to the global model either way; saying so is the difference
 * between a fallback and a mystery.
 */
export function routeSummary(route: ResolvedRoute): {
  readonly text: string;
  readonly tone: "default" | "pinned" | "dropped";
} {
  if (route.droppedPin) {
    const asked = route.droppedPin.service
      ? `${route.droppedPin.service} · ${route.droppedPin.model}`
      : route.droppedPin.model;
    return { text: `${asked} is not reachable — using the default`, tone: "dropped" };
  }
  if (route.source === "global") return { text: "uses the default", tone: "default" };
  return {
    text: route.service ? `${route.service} · ${route.model}` : route.model,
    tone: "pinned",
  };
}

/** Set or clear one agent's pin. Clearing removes the key rather than storing null. */
export function withPin(
  overrides: Readonly<Record<string, ModelPin>>,
  agent: string,
  pin: ModelPin | null,
): Record<string, ModelPin> {
  const next = { ...overrides };
  if (pin === null) delete next[agent];
  else next[agent] = pin;
  return next;
}

export function pinnedCount(overrides: Readonly<Record<string, ModelPin>>): number {
  return Object.keys(overrides).length;
}

export interface JobRow {
  readonly job: AgentJob;
  /** "" when the job has no pin, or when its members disagree. */
  readonly value: string;
  readonly summary: { readonly text: string; readonly tone: "default" | "pinned" | "dropped" };
}

/**
 * One row per job, not per agent.
 *
 * A job is pinned only when every member agrees; a job whose members were
 * pinned separately says so rather than picking one of them to display and
 * quietly overwriting the others on the next save.
 */
export function jobRows(table: RoutingTable | null): ReadonlyArray<JobRow> {
  if (!table?.jobs) return [];
  return table.jobs.map((job) => {
    const values = job.members.map((id) => pinValue(table.overrides[id]));
    const first = values[0] ?? "";
    const agreed = values.every((value) => value === first);
    if (!agreed) {
      return { job, value: "", summary: { text: "set per agent", tone: "pinned" as const } };
    }
    // Any member's route will do once they agree; the first that resolved wins.
    const route = job.members.map((id) => table.routes[id]).find(Boolean);
    return {
      job,
      value: first,
      summary: route ? routeSummary(route) : { text: "uses the default", tone: "default" as const },
    };
  });
}

/** Write one job's pin to every agent that does that job. */
export function withJobPin(
  overrides: Readonly<Record<string, ModelPin>>,
  job: AgentJob,
  pin: ModelPin | null,
): Record<string, ModelPin> {
  let next = { ...overrides };
  for (const member of job.members) next = withPin(next, member, pin);
  return next;
}
