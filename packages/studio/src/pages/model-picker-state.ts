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
  /** What the CLI calls it — "GLM-5.2 High". Absent when it offered no name. */
  readonly name?: string;
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
      // A name only counts when it is not the id echoed back: the studio's
      // models route fills `name: id` for endpoints that send none, and a slug
      // in the name field is worse than no name, because it silences the
      // fallback that would have tidied it.
      ...(model.name && model.name !== model.id ? { name: model.name } : {}),
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

/**
 * The name to show for one model.
 *
 * The CLI's own name wins whenever there is one. Devin sends
 * `{ value: "glm-5-2", name: "GLM-5.2 High" }` over ACP and the whole chain
 * used to discard it — twice, once in the shim and once in the model probe —
 * so this file tried to reconstruct a display name from the slug instead.
 * That cannot work. `glm-5-2` is "GLM-5.2 High"; `gpt-5-6-sol` is not "GPT 5 6
 * Sol"; the version separators are gone and the marketing name was never in
 * the id to begin with. The fix was to stop dropping the answer.
 *
 * The derived form below is the fallback only, for CLIs that genuinely send no
 * names — claude's four aliases, antigravity's list. It tidies casing and
 * nothing more, and it is allowed to be imperfect because it is never used
 * where a real name exists.
 *
 * Purely presentational: `id` is still what gets sent.
 */
export function modelLabel(variant: ModelVariant, base: string): string {
  return variant.name ?? prettyModelName(base, variant.variant);
}

export function prettyModelName(base: string, variant = ""): string {
  const slug = base.slice(base.indexOf("/") + 1);
  const words = slug.split("-").map((word) => {
    // Version fragments stay digits; a lone letter-run gets a capital.
    if (/^\d+$/.test(word)) return word;
    if (KNOWN_CAPS[word]) return KNOWN_CAPS[word];
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  const name = words.join(" ");
  if (!variant) return name;
  const suffix = variant.split(" ")
    .map((w) => KNOWN_CAPS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `${name} ${suffix}`;
}

/** Words whose conventional casing is not "first letter up". */
const KNOWN_CAPS: Record<string, string> = {
  gpt: "GPT", glm: "GLM", swe: "SWE", api: "API",
  xhigh: "XHigh", "1m": "1M", oss: "OSS", k2: "K2", k3: "K3",
  v4: "V4", ai: "AI",
};

/**
 * One provider's models, and the providers you could switch to.
 *
 * The picker used to stack every provider's list into one scroll, so choosing
 * a devin model meant scrolling past antigravity's and vice versa — with 183
 * devin ids in the middle of it. A person picking a model has already decided
 * which CLI is running; the other CLIs' models are not candidates, they are
 * obstacles.
 *
 * So: providers are a strip you switch on, and the list below shows one
 * provider. Returns the resolved provider too, because the requested one may
 * no longer be connected and the caller must not render an empty list.
 */
export function scopeToProvider<T extends { service: string }>(
  groups: ReadonlyArray<T>,
  service: string | null,
): { readonly current: T | null; readonly providers: ReadonlyArray<T> } {
  if (groups.length === 0) return { current: null, providers: [] };
  const current = groups.find((g) => g.service === service) ?? groups[0]!;
  return { current, providers: groups };
}
