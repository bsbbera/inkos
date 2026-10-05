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
  /**
   * Every type now opens with `research`, not just the magazine.
   *
   * It is conditional in effect rather than in the graph: with no setting
   * pinned the stage finds nothing to do and passes straight through. Putting
   * it in the list for everything is what makes a pinned world reach a book,
   * a short and a storyboard by the same road, instead of the magazine having
   * a research step and every other type inventing its century (22 §3).
   */
  readonly content: ReadonlyArray<string>;
  readonly design: ReadonlyArray<string>;
  readonly build: ReadonlyArray<string>;
  readonly gates: ReadonlyArray<PipelineGate>;
  /**
   * Stages this kind walks past, and why, in the words the screen shows.
   *
   * Every type declares the whole spine. A stage a kind does not need is
   * *skipped*, not absent: absent meant the run had no record of it, the strip
   * did not draw it, and nothing could turn it on for the one work that wanted
   * it — a short story full of real history could not be fact-checked because
   * short stories, as a kind, had no fact-check stage at all.
   *
   * Skipping is a fact the run records. The stage appears in the strip, greyed,
   * carrying this sentence, and the history says it was skipped rather than
   * done. `write → design → build` stay three separate steps for every kind,
   * so a change to one of them lands in one place for all of them.
   */
  readonly skip?: Readonly<Record<string, string>>;
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

/**
 * The one spine every production walks.
 *
 * Content, then design, then build — the same steps in the same order for a
 * novel, a picture book and a magazine. What differs between kinds is which of
 * these steps they skip (see `skip`), never which steps exist. Adding a step
 * here adds it to every kind at once, which is the point: the magazine's
 * cutout work and the novel's reflow are both `build`, and a kind that cannot
 * use a step says so in a sentence instead of dropping out of the graph.
 */
export const SPINE = {
  content: ["research", "plan", "write", "factcheck", "audit", "destyle"],
  design: ["artplan", "generate", "review"],
  build: ["layout", "export"],
} as const;

/** All three sign-offs, for every kind. A skipped macro auto-signs (see `advance`). */
export const ALL_GATES: ReadonlyArray<PipelineGate> = ["content", "design", "build"];

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
      ...SPINE,
      gates: ALL_GATES,
      skip: {
        "content.factcheck": "A novel is not held to the record; ask for a check on a book that needs one.",
        // Reflow-shaped work has no per-unit placement. Text pours across
        // master pages and a chapter has no fixed spread, so there is nothing
        // to do per chapter. The export makes the epub, then the print edition
        // through Typst (typeset.ts) when Typst is installed.
        "build.layout": "A novel reflows: the text pours through master pages, so no chapter is placed by hand.",
      },
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
      ...SPINE,
      gates: ALL_GATES,
      skip: {
        "content.plan": "A short is outlined and written in one pass by its own run.",
        "content.factcheck": "Fiction is not held to the record; ask for a check on a story that needs one.",
        "build.layout": "A short reflows: the text pours through master pages, nothing is placed by hand.",
      },
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
    // The design steps are declared and skipped rather than missing: a
    // screenplay is set to an industry format that is the opposite of
    // art-directed, and saying so on the screen beats leaving a hole where
    // three steps should be — and leaves the door open for the one script
    // that wants a title card.
    pipeline: {
      ...SPINE,
      gates: ALL_GATES,
      skip: {
        "content.factcheck": "A screenplay is fiction; ask for a check on one that needs it.",
        "design.artplan": "A screenplay is set to an industry format, deliberately not art-directed.",
        "design.generate": "A screenplay is set to an industry format, deliberately not art-directed.",
        "design.review": "A screenplay is set to an industry format, deliberately not art-directed.",
      },
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
    /*
     * The type the uniform rails were built to prove.
     *
     * A storybook is a picture book: a spread is one unit of everything — the
     * words on it, the picture beside them, the page it is laid out on — which
     * is why it needs no orchestrator change to exist. It declares the same
     * three macro-stages as everything else and gets the same gates, the same
     * hand-off and the same build, from the graph alone.
     *
     * No destyle stage: the prose is a few hundred words a child hears read
     * aloud, and running a de-AI rewrite over it would flatten exactly the
     * cadence that makes it worth reading twice.
     */
    id: "storybook",
    label: "Storybook",
    outDir: "storybooks",
    skills: ["quire-storybook"],
    factCheck: false,
    images: true,
    auditable: true,
    pipeline: {
      ...SPINE,
      gates: ALL_GATES,
      skip: {
        "content.factcheck": "A picture book is invented, not reported.",
        "content.destyle": "A de-AI rewrite would flatten the cadence a child hears read aloud.",
        // A print PDF of a picture book means an Affinity document with a
        // storybook master, and there is not one yet. What it builds instead
        // is the proof copy — every spread, picture beside words, in one file.
        "build.layout": "No storybook master exists yet: the build makes a proof copy, not a placed document.",
      },
      buildShape: "page-shaped",
      // The proof copy always; the print PDF (Typst) when Typst is installed.
      outputs: ["html", "print-pdf"],
      unit: "spread",
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
      ...SPINE,
      gates: ALL_GATES,
      skip: {
        "content.factcheck": "Panels are invented shots, not reported facts.",
        "content.destyle": "Panel notes are instructions to a camera, not prose to de-slop.",
      },
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
      ...SPINE,
      gates: ALL_GATES,
      skip: {
        "content.factcheck": "An interactive film is invented, not reported.",
        "content.destyle": "Branch text is written to be heard in-scene, not de-slopped as prose.",
        "build.layout": "It ships as a runtime, not a document: nothing is placed on a page.",
      },
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
    // The page writer. Layout and art direction are not listed here because
    // they are not a magazine's alone: `skills/design-skills.ts` binds them to
    // the design and art stages of *every* type, which is where they belong.
    skills: ["quire-magazine-page"],
    factCheck: true,
    images: true,
    auditable: true,
    pipeline: {
      ...SPINE,
      gates: ALL_GATES,
      skip: {
        // The magazine's audit revises as it reads (`publication-audit.ts`
        // carries the ai-tells pass), so a separate de-slop would be a second
        // rewrite of text the first one already settled.
        "content.destyle": "The magazine's audit already rewrites the tells it finds.",
        // Each rendered page is pre-screened as it is laid out, and the
        // editor's look is the design sign-off; a separate pass would be a
        // third review of the same pictures.
        "design.review": "Each page is pre-screened when it is laid out; your look is the design sign-off.",
        "build.layout": "The magazine lays out every page and exports the PDF in one pass.",
      },
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
      ...SPINE,
      gates: ALL_GATES,
      skip: {
        "content.plan": "A translation follows the source's own chapters; there is nothing to outline.",
        "content.factcheck": "A translation is held to its source, not to the record.",
        "content.destyle": "De-slopping would rewrite the translation away from what the author wrote.",
        "design.artplan": "A translation ships as text, in the source's own design.",
        "design.generate": "A translation ships as text, in the source's own design.",
        "design.review": "A translation ships as text, in the source's own design.",
        "build.layout": "A translation reflows: the text pours through master pages.",
      },
      buildShape: "reflow-shaped",
      outputs: ["print-pdf"],
      unit: "chapter",
    },
  },
];

/** What a picture may be (08 §1). */
export type Surface = "photo" | "illustration" | "infographic" | "typographic" | "texture";

/**
 * What pictures a kind of work may have — a type-level rule, so it lives with
 * the types. "Books and stories are illustrated, never photographed; magazines
 * mix photographs, illustration, infographics and type" is decided here and
 * nowhere else: not by the brief, not by the world, not by the model.
 */
export interface ArtPolicy {
  readonly surfaces: ReadonlyArray<Surface>;
  /** `forbidden` appends the anti-photo block to every negative prompt. */
  readonly realism: "forbidden" | "allowed" | "preferred";
  /** One world for the whole work, or one per magazine section. */
  readonly worldScope: "work" | "section";
  /** Which technique pool a world may draw from. */
  readonly techniques: "narrative" | "editorial" | "children" | "technical";
  readonly slots: ReadonlyArray<string>;
  readonly imagesPerUnit: { readonly min: number; readonly max: number };
  /** Share of pictures per surface the work aims for. */
  readonly mix?: Readonly<Record<string, number>>;
}

const PROSE_POLICY: ArtPolicy = {
  surfaces: ["illustration"],
  realism: "forbidden",
  worldScope: "work",
  techniques: "narrative",
  slots: ["cover", "opener", "tailpiece", "plate"],
  imagesPerUnit: { min: 0, max: 1 },
};

const ART_POLICIES: Readonly<Record<string, ArtPolicy>> = {
  book: PROSE_POLICY,
  short: PROSE_POLICY,
  translation: PROSE_POLICY,
  script: { ...PROSE_POLICY, surfaces: ["typographic"], slots: ["cover"] },
  storybook: {
    ...PROSE_POLICY, techniques: "children", slots: ["spread", "cover"], imagesPerUnit: { min: 1, max: 1 },
  },
  storyboard: {
    ...PROSE_POLICY, techniques: "technical", slots: ["panel"], imagesPerUnit: { min: 1, max: 1 },
  },
  "interactive-film": {
    surfaces: ["illustration", "photo"], realism: "allowed", worldScope: "work",
    techniques: "editorial", slots: ["node", "cover"], imagesPerUnit: { min: 1, max: 1 },
  },
  publication: {
    // Order matters: the first is what a picture with no surface of its own
    // becomes, and for a magazine that must be a drawing, not a photograph.
    surfaces: ["illustration", "photo", "infographic", "texture"],
    realism: "allowed",
    worldScope: "section",
    techniques: "editorial",
    slots: ["cover", "opener", "inline", "photo-spread", "infographic", "texture"],
    imagesPerUnit: { min: 1, max: 3 },
    /*
     * A target, not a quota (illustration skill §5.1); magazine-bar.ts measures it.
     *
     * Mostly drawn. The old target put photographs first, and since the art
     * stage also defaulted every picture to the first surface in the list, an
     * issue came back as fifty near-photographs: cluttered, edge to edge, and
     * with nowhere for a line of type. A magazine is drawn work with
     * photographs in it, not the other way round.
     */
    /*
     * No `typographic` share. A typographic page is type, set in the layout —
     * asking a diffusion model for letterforms while every negative refuses
     * lettering is a contradiction it answers with smeared text over a photo.
     */
    mix: { illustration: 0.6, infographic: 0.2, photo: 0.2 },
  },
  play: { ...PROSE_POLICY, realism: "allowed", slots: ["scene"] },
};

export function artPolicyOf(type: string): ArtPolicy | null {
  return ART_POLICIES[type] ?? null;
}

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
