/**
 * Turning a CLI's flat model list back into the shape it actually has.
 *
 * devin offers 183 models and the picker listed all 183 as siblings — about
 * twenty screens of scrolling through strings like
 * `devin/gpt-5-6-sol-xhigh-priority`. They are not 183 things. They are ~30
 * models, each offered at several reasoning efforts and a couple of delivery
 * modes, and the id says so: the dimensions are right there in the suffix and
 * the UI was the only part that had lost them.
 *
 * The suffix vocabulary is fixed and small, so this reads the id rather than
 * asking the CLI to describe itself — a probe cannot report it either.
 */

/** How hard the model is asked to think. Ordered as a person would rank them. */
const EFFORT = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/** How the answer is delivered, orthogonal to effort. */
const MODIFIER = ["fast", "priority", "1m"] as const;

const EFFORT_SET: ReadonlySet<string> = new Set(EFFORT);
const MODIFIER_SET: ReadonlySet<string> = new Set(MODIFIER);

export interface ModelVariant {
  /** The full id, which is still what gets sent. */
  readonly id: string;
  /** "high", "max fast", or "" when the model has no variants at all. */
  readonly variant: string;
  readonly contextWindow?: number;
}

export interface ModelFamily {
  /** `devin/claude-opus-5` — what a person actually chooses between. */
  readonly base: string;
  readonly variants: ReadonlyArray<ModelVariant>;
}

/**
 * Split `devin/claude-opus-5-xhigh-fast` into its model and its variant.
 *
 * Only trailing tokens from the two known vocabularies are taken, and never
 * all of them: `devin/max` is a model called max, not a variant of nothing.
 */
export function splitModelId(id: string): { base: string; variant: string } {
  const slash = id.indexOf("/");
  const prefix = slash === -1 ? "" : id.slice(0, slash + 1);
  const parts = id.slice(slash + 1).split("-");
  const tail: string[] = [];
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    if (!EFFORT_SET.has(last) && !MODIFIER_SET.has(last)) break;
    tail.unshift(parts.pop()!);
  }
  return { base: prefix + parts.join("-"), variant: tail.join(" ") };
}

/** Rank within a family: by effort, then by modifier, so the order reads. */
function variantOrder(variant: string): number {
  if (variant === "") return -1;
  const words = variant.split(" ");
  const effort = words.findIndex((w) => EFFORT_SET.has(w));
  const rank = effort === -1 ? EFFORT.length : EFFORT.indexOf(words[effort] as typeof EFFORT[number]);
  return rank * 10 + words.filter((w) => MODIFIER_SET.has(w)).length;
}

/**
 * Group a service's models into families, preserving the order they arrived
 * in — the CLI lists its own preferred models first and that is information.
 */
export function toFamilies(
  models: ReadonlyArray<{ id: string; name?: string; contextWindow?: number }>,
): ReadonlyArray<ModelFamily> {
  const families = new Map<string, ModelVariant[]>();
  for (const model of models) {
    const { base, variant } = splitModelId(model.id);
    const entry: ModelVariant = {
      id: model.id,
      variant,
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    };
    const existing = families.get(base);
    if (existing) existing.push(entry);
    else families.set(base, [entry]);
  }
  return [...families].map(([base, variants]) => ({
    base,
    variants: [...variants].sort((a, b) => variantOrder(a.variant) - variantOrder(b.variant)),
  }));
}
