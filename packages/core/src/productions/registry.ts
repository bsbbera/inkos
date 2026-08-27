/**
 * The things this app makes, in one place.
 *
 * There was no such place. Each production declared itself by being wired up:
 * a session kind here, a tool there, an output directory chosen inside its own
 * runner, a skill id in a table that covered eight of them and not the ninth.
 * Anything that needed to reason about productions as a set — the audit screen
 * listing finished work, a settings page, a report — had to keep its own copy
 * of the list, and every copy drifted.
 *
 * The audit screen's copy is the one that proved it: it looked for scripts in
 * `scripts/` while the script runner had always written them to `dramas/`, so
 * scripts were invisible to the checks. Play worlds were missing outright.
 *
 * This is deliberately thin. It is what something outside a production needs to
 * know about it, not a framework for building one.
 */

export interface ProductionSpec {
  readonly id: string;
  readonly label: string;
  /** Where finished work of this kind is written, relative to the workspace. */
  readonly outDir: string;
  /** Craft skills the runs use. Empty when the production binds none. */
  readonly skills: ReadonlyArray<string>;
  /** Whether written work is worth checking against the web. */
  readonly factCheck: boolean;
  /** Whether the production produces image prompts at all. */
  readonly images: boolean;
  /** Whether finished work of this kind can be audited as prose. */
  readonly auditable: boolean;
}

export const PRODUCTIONS: ReadonlyArray<ProductionSpec> = [
  {
    id: "book",
    label: "Book",
    outDir: "books",
    skills: ["quire-long-writing", "quire-story-review"],
    factCheck: false,
    images: true,
    auditable: true,
  },
  {
    id: "short",
    label: "Short",
    outDir: "shorts",
    skills: ["quire-short-writing"],
    factCheck: false,
    images: true,
    auditable: true,
  },
  {
    id: "script",
    // Written to `dramas/`, which is why the audit screen could never find one.
    label: "Script",
    outDir: "dramas",
    skills: ["quire-script-writing"],
    factCheck: false,
    images: false,
    auditable: true,
  },
  {
    id: "storyboard",
    label: "Storyboard",
    outDir: "storyboards",
    skills: ["quire-storyboard"],
    factCheck: false,
    images: true,
    auditable: true,
  },
  {
    id: "interactive-film",
    label: "Interactive film",
    outDir: "interactive-films",
    skills: ["quire-interactive-film"],
    factCheck: false,
    images: true,
    auditable: true,
  },
  {
    id: "publication",
    label: "Publication",
    // A publication type names its own outDir; this is the built-in magazine's.
    outDir: "Magazine",
    skills: [],
    factCheck: true,
    images: true,
    auditable: true,
  },
  {
    id: "play",
    label: "Play world",
    outDir: "worlds",
    skills: ["quire-play-world"],
    factCheck: false,
    images: false,
    // A live world is state, not a finished text. Auditing one as prose would
    // report on a save file.
    auditable: false,
  },
  {
    id: "translation",
    label: "Translation",
    outDir: "translations",
    skills: ["quire-translation"],
    factCheck: false,
    images: false,
    auditable: true,
  },
];

export function productionByDir(dir: string): ProductionSpec | undefined {
  return PRODUCTIONS.find((p) => p.outDir.toLowerCase() === dir.toLowerCase());
}

/** Where to look for finished work, with the label to file it under. */
export function auditableRoots(): ReadonlyArray<{ dir: string; kind: string; label: string }> {
  return PRODUCTIONS
    .filter((p) => p.auditable)
    .map((p) => ({ dir: p.outDir, kind: p.id, label: p.label }));
}
