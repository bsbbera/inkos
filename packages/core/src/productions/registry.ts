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
      // No layout stage: reflow-shaped work has no per-unit placement. Text
      // pours across master pages and a chapter has no fixed spread, so there
      // is nothing to do per chapter and declaring one would park every book
      // on a stage nothing performs. The print-pdf output waits on the reflow
      // script; the epub does not, and is what this builds today.
      build: ["export"],
      gates: ["content", "design", "build"],
      buildShape: "reflow-shaped",
      outputs: ["epub"],
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
      // Same as the book: nothing to place per unit. A short's print-pdf still
      // has no exporter behind it, so its build stage reports that rather than
      // finishing on a file nobody made.
      build: ["export"],
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
      // One unit, not one per scene: the runner writes `script.md` in a single
      // pass and there is no per-scene artifact to sign off. Declaring scenes
      // would park the run forever waiting for scene 2 of a file that is
      // already finished.
      unit: "work",
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
      // The panels live inside one `storyboard.md`; segmentation is an
      // internal batching detail of the writer, not a unit anyone approves.
      unit: "work",
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
      // Story tree, flags, script and storyboard land as one package from one
      // agent turn. Nothing produces a scene on its own.
      unit: "work",
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

/** A production and one of its units, named the way a run refers to them. */
export interface UnitRef {
  readonly type: string;
  readonly id: string;
  readonly unit: number;
}

/**
 * Which run, and which unit of it, a project-relative path belongs to.
 *
 * The audit screen knows paths and nothing else, so this is the one place that
 * turns a file back into a place in a pipeline. Without it a book could sit at
 * `content.audit` forever while somebody audited every chapter in it, because
 * nothing connected the file that was read to the unit that was waiting.
 *
 * The number comes off the leaf filename: every unit-shaped type already pads
 * one in there (`0003_the-door.md`, `chapter-0004.json`, `02-first-light.md`)
 * and the first run of digits is that number in all three. A type whose unit is
 * the whole work is unit 1 by definition and needs no number at all.
 */
export function refFromPath(path: string): UnitRef | null {
  const parts = path.split("/").filter(Boolean);
  const spec = productionByDir(parts[0] ?? "");
  if (!spec?.pipeline) return null;

  // The magazine keeps its issues one level below its out dir; everything else
  // puts the id straight under it.
  const id = parts[1] === "issues" ? parts[2] : parts[1];
  if (!id) return null;
  if (spec.pipeline.unit === "work") return { type: spec.id, id, unit: 1 };

  const leaf = (parts[parts.length - 1] ?? "").replace(/\.[^.]+$/, "");
  const digits = /(\d+)/.exec(leaf);
  if (!digits) return null;
  const unit = Number(digits[1]);
  // A path that resolves to unit 0 is a naming we do not understand; guessing
  // would report the wrong chapter as read.
  return unit >= 1 ? { type: spec.id, id, unit } : null;
}

/** Where to look for finished work, with the label to file it under. */
export function auditableRoots(): ReadonlyArray<{ dir: string; kind: string; label: string }> {
  return PRODUCTIONS
    .filter((p) => p.auditable)
    .map((p) => ({ dir: p.outDir, kind: p.id, label: p.label }));
}
