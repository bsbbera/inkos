/**
 * What the composer says is running.
 *
 * Chat is not one model any more. A single turn can hand off to the planner,
 * then the writer, then the auditor, each of which may be pinned somewhere
 * else, so a bar that names the default model is telling the truth only
 * between agents. When one is running, it says so and names the model that
 * agent actually resolved to.
 */

export interface RunningTool {
  readonly agent?: string;
  readonly status: "running" | "processing" | "completed" | "error";
}

export interface RouteLike {
  readonly service?: string;
  readonly model: string;
}

/** The agent of the last still-running sub-agent, if any. */
export function runningAgent(tools: ReadonlyArray<RunningTool> | undefined): string | null {
  if (!tools) return null;
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    const tool = tools[i]!;
    if (tool.agent && (tool.status === "running" || tool.status === "processing")) return tool.agent;
  }
  return null;
}

export function modelBar(input: {
  readonly tools?: ReadonlyArray<RunningTool>;
  readonly routes?: Readonly<Record<string, RouteLike>>;
  readonly roleLabels?: Readonly<Record<string, string>>;
  /** What the bar says when no agent is running: the project's default. */
  readonly fallback: string;
}): { readonly agent: string | null; readonly text: string } {
  const agent = runningAgent(input.tools);
  if (!agent) return { agent: null, text: input.fallback };
  const route = input.routes?.[agent];
  const who = input.roleLabels?.[agent] ?? agent;
  // An agent with no row is still worth naming; the model is the default one.
  return { agent, text: route ? `${who} · ${route.model}` : `${who} · ${input.fallback}` };
}
