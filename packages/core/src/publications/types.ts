/**
 * A publication type, described as data rather than code.
 *
 * The magazine pipeline was a whole engine of its own: subject -> research ->
 * flatplan -> pages -> art -> PDF, with its editorial law written into the
 * prompts. Every new kind of publication that way is another engine to keep
 * alive. So the law and the voice move out into a definition, and one runner
 * executes any of them.
 *
 * Definitions are plain JSON so a new publication type is a file the user
 * drops in, not a code change. That is also why prompts are templates with
 * {{placeholders}} rather than functions.
 */

/** Words a page of a given density can hold at this publication's grid. */
export type DensityBudget = Readonly<Record<string, readonly [number, number]>>;

export interface PublicationRules {
  /**
   * A page type that must land on a recto (odd page). In the magazine this is
   * the section plate; the rule is what forces even-length sections.
   */
  readonly rectoOnlyType?: string;
  /** Sections must have an even page count. Follows from rectoOnlyType. */
  readonly evenSections?: boolean;
  /** The extent itself must be even, so the last spread is complete. */
  readonly evenExtent?: boolean;
  /** No more than `max` pages of `density` in a row. */
  readonly maxConsecutiveDensity?: { readonly density: string; readonly max: number };
  /** Every research pillar must appear on at least one page. */
  readonly requireAllPillars?: boolean;
  /** Reported, never enforced: the observed density split is informational. */
  readonly reportDensityMix?: boolean;
}

export interface PublicationPrompts {
  /** Voice and register. Prefixed to every other prompt. */
  readonly voice: string;
  /** The research axes this publication is built from. */
  readonly pillars: string;
  /** Stage prompts. Each must ask for JSON only. */
  readonly research: string;
  readonly plan: string;
  readonly page: string;
}

export interface PublicationDefinition {
  readonly id: string;
  readonly label: string;
  readonly labelZh?: string;
  /** One line, shown under the title on the publication's own page. */
  readonly description?: string;

  /** Page-count bounds. `default` is used when the user does not say. */
  readonly extent: {
    readonly min: number;
    readonly max: number;
    readonly default: number;
  };

  /** Research axes. Pages declare which one they serve. */
  readonly pillars: readonly string[];
  /** Page types the planner may choose from. */
  readonly archetypes: readonly string[];
  /** Density codes and the word budget each one implies. */
  readonly densities: DensityBudget;
  /** Density used when the planner does not give one. */
  readonly defaultDensity: string;

  readonly rules: PublicationRules;
  readonly prompts: PublicationPrompts;

  /** Whether the art stage exists at all for this type. */
  readonly needsImages: boolean;
  /** Whether a PDF is built at the end. */
  readonly needsPdf: boolean;

  /** Where issues of this type are stored, relative to the workspace. */
  readonly outDir: string;
}

export interface PublicationDefinitionSource {
  readonly definition: PublicationDefinition;
  /** "builtin" ships with Quire; "user" was found in the workspace. */
  readonly source: "builtin" | "user";
  readonly path?: string;
}

const REQUIRED_PROMPTS: ReadonlyArray<keyof PublicationPrompts> = [
  "voice", "pillars", "research", "plan", "page",
];

/**
 * Validate a definition loaded from disk.
 *
 * Returns the problems rather than throwing: one malformed file the user is
 * still editing must not take away every other publication type, exactly as a
 * malformed SKILL.md does not take away every skill.
 */
export function validateDefinition(value: unknown): string[] {
  const problems: string[] = [];
  const def = value as Partial<PublicationDefinition> | null;
  if (!def || typeof def !== "object") return ["definition is not an object"];

  if (!def.id || !/^[a-z0-9-]+$/.test(def.id)) {
    problems.push("id must be lowercase letters, digits and hyphens");
  }
  if (!def.label) problems.push("label is required");

  const extent = def.extent;
  if (!extent || typeof extent.min !== "number" || typeof extent.max !== "number"
    || typeof extent.default !== "number") {
    problems.push("extent needs numeric min, max and default");
  } else {
    if (extent.min > extent.max) problems.push("extent.min is greater than extent.max");
    if (extent.default < extent.min || extent.default > extent.max) {
      problems.push("extent.default is outside extent.min..max");
    }
  }

  if (!Array.isArray(def.pillars) || def.pillars.length === 0) {
    problems.push("at least one pillar is required");
  }
  if (!Array.isArray(def.archetypes) || def.archetypes.length === 0) {
    problems.push("at least one archetype is required");
  }

  const densities = def.densities;
  if (!densities || Object.keys(densities).length === 0) {
    problems.push("at least one density is required");
  } else {
    for (const [code, range] of Object.entries(densities)) {
      if (!Array.isArray(range) || range.length !== 2
        || typeof range[0] !== "number" || typeof range[1] !== "number") {
        problems.push(`density ${code} must be a [min, max] word range`);
      } else if (range[0] > range[1]) {
        problems.push(`density ${code} has min above max`);
      }
    }
    if (!def.defaultDensity || !(def.defaultDensity in densities)) {
      problems.push("defaultDensity must name one of the densities");
    }
  }

  const prompts = def.prompts;
  if (!prompts) {
    problems.push("prompts are required");
  } else {
    for (const key of REQUIRED_PROMPTS) {
      if (!prompts[key] || typeof prompts[key] !== "string") {
        problems.push(`prompts.${key} is required`);
      }
    }
  }

  const rules = def.rules;
  if (rules?.maxConsecutiveDensity) {
    const { density, max } = rules.maxConsecutiveDensity;
    if (densities && density && !(density in densities)) {
      problems.push(`maxConsecutiveDensity names unknown density ${density}`);
    }
    if (typeof max !== "number" || max < 1) {
      problems.push("maxConsecutiveDensity.max must be at least 1");
    }
  }
  if (rules?.rectoOnlyType && Array.isArray(def.archetypes)
    && !def.archetypes.includes(rules.rectoOnlyType)) {
    problems.push(`rectoOnlyType names unknown archetype ${rules.rectoOnlyType}`);
  }

  if (!def.outDir) problems.push("outDir is required");
  return problems;
}

/**
 * Fill {{placeholders}} in a prompt template.
 *
 * Deliberately not a template engine: definitions come from the user's own
 * directory, so the substitution has to be inert. A missing key renders empty
 * rather than throwing — half a prompt is still worth sending, and a hard
 * failure mid-run would cost the whole stage.
 */
export function renderTemplate(
  template: string,
  values: Readonly<Record<string, string | number | undefined>>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? "" : String(value);
  });
}
