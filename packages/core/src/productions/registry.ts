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


/**
 * How a finished thing of this kind gets onto a page.
 *
 * Not a file format - a renderer. `page-shaped` work is composed page by page
 * and placed at fixed positions, which is what the existing Affinity flatplan
 * build does. `reflow-shaped` work is one long text poured through master
 * pages, needing autoflow, running heads and widow control instead - a
 * different script, not a parameter to the same one. Conflating them is why
 * books have no build at all today: the only build that existed was the
 * magazine's, and a novel is not a magazine with more pages.
 */
export type BuildShape =
  | "page-shaped"
  | "reflow-shaped"
  /** Ships as a runtime, not a document. The design spec still drives it. */
  | "not-paper"
  /** Industry format, deliberately not art-directed. */
  | "screenplay"
  | "none";

/** What a run of this kind produces at the end. A book makes two. */
export type BuildOutput = "epub" | "print-pdf" | "screenplay-pdf" | "panel-sheet" | "html";

export type PipelineGate = "content" | "design" | "build";

/**
 * The stage graph every production of this kind walks.
 *
 * One shape for all of them - content, then design, then build, with a gate
 * between each - and only the sub-stages inside differ. That uniformity is the
 * point: the orchestrator owns sequencing, hand-off, resume and events once,
 * and a new production type is a row here rather than a new runner.
 *
 * An empty macro-stage is skipped along with its gate, which is how a script
 * (no art direction) and a translation (no art at all) walk the same rails as
 * a magazine without special cases.
 */
export interface ProductionPipeline {
  readonly content: ReadonlyArray<string>;
  readonly design: ReadonlyArray<string>;
  readonly build: ReadonlyArray<string>;
  readonly gates: ReadonlyArray<PipelineGate>;
  readonly buildShape: BuildShape;
  /**
   * Every artifact the build produces, not one.
   *
   * A book ships an epub and a print PDF from the same approved text; naming a
   * single build target cannot say that, and picking one would have quietly
   * dropped the other.
   */
  readonly outputs: ReadonlyArray<BuildOutput>;
  /**
   * What gets approved one at a time. Gates hold per unit, not per production,
   * so a reader can sign off chapter 3 while chapter 4 is still being written.
   */
  readonly unit: "chapter" | "page" | "spread" | "panel" | "scene" | "work";
}

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
  /**
   * The stage graph, or null for a kind that does not run one.
   *
   * `images` and `factCheck` above were declared and read by nothing - a play
   * world said `images: false` while `play/play-image.ts` sat in the tree
   * generating them. They stay because they describe the kind honestly, and
   * the graph below is now the thing that actually decides what runs.
   */
  readonly pipeline: ProductionPipeline | null;
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
    pipeline: {
      content: ["plan", "write", "audit", "destyle"],
      design: ["artplan", "generate", "review"],
      build: ["layout", "export"],
      gates: ["content", "design", "build"],
      buildShape: "reflow-shaped",
      outputs: ["epub", "print-pdf"],
      unit: "chapter",
    },
  },
  {
    id: "short",
    label: "Short",
    outDir: "shorts",
    skills: ["quire-short-writing"],
    factCheck: false,
    images: true,
    auditable: true,
    pipeline: {
      content: ["write", "audit", "destyle"],
      design: ["artplan", "generate", "review"],
      build: ["layout", "export"],
      gates: ["content", "design", "build"],
      buildShape: "reflow-shaped",
      outputs: ["print-pdf"],
      unit: "work",
    },
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
    // No design macro-stage on purpose. A screenplay is set to an industry
    // format that is the opposite of art-directed, so it walks content then
    // build and its design gate simply does not exist.
    pipeline: {
      content: ["plan", "write", "audit", "destyle"],
      design: [],
      build: ["layout", "export"],
      gates: ["content", "build"],
      buildShape: "screenplay",
      outputs: ["screenplay-pdf"],
      unit: "scene",
    },
  },
  {
    id: "storyboard",
    label: "Storyboard",
    outDir: "storyboards",
    skills: ["quire-storyboard"],
    factCheck: false,
    images: true,
    auditable: true,
    pipeline: {
      content: ["plan", "write", "audit"],
      design: ["artplan", "generate", "review"],
      build: ["layout", "export"],
      gates: ["content", "design", "build"],
      buildShape: "page-shaped",
      outputs: ["panel-sheet"],
      unit: "panel",
    },
  },
  {
    id: "interactive-film",
    label: "Interactive film",
    outDir: "interactive-films",
    skills: ["quire-interactive-film"],
    factCheck: false,
    images: true,
    auditable: true,
    // Ships as a runtime rather than a document, so there is nothing to build
    // to paper - but the design spec still decides how it looks.
    pipeline: {
      content: ["plan", "write", "audit"],
      design: ["artplan", "generate", "review"],
      build: ["export"],
      gates: ["content", "design"],
      buildShape: "not-paper",
      outputs: ["html"],
      unit: "scene",
    },
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
    pipeline: {
      content: ["research", "plan", "write", "factcheck", "audit", "destyle"],
      design: ["artplan", "generate", "review"],
      build: ["layout", "export"],
      gates: ["content", "design", "build"],
      buildShape: "page-shaped",
      outputs: ["print-pdf"],
      unit: "page",
    },
  },
  {
    id: "play",
    label: "Play world",
    outDir: "worlds",
    skills: ["quire-play-world"],
    factCheck: false,
    // `play/play-image.ts` has been generating these all along; the flag said
    // it did not.
    images: true,
    // A live world is state, not a finished text. Auditing one as prose would
    // report on a save file.
    auditable: false,
    // A live world is played, not produced. It has no run to sequence, which
    // is a different statement from having an empty one - hence null rather
    // than a graph with nothing in it.
    pipeline: null,
  },
  {
    id: "translation",
    label: "Translation",
    outDir: "translations",
    skills: ["quire-translation"],
    factCheck: false,
    images: false,
    auditable: true,
    pipeline: {
      content: ["write", "audit", "destyle"],
      design: [],
      build: ["export"],
      gates: ["content", "build"],
      buildShape: "reflow-shaped",
      outputs: ["epub"],
      unit: "chapter",
    },
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
