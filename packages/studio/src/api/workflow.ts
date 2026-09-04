/**
 * What state a piece of work is in, said the same way for every kind of work.
 *
 * The magazine screen grew a vocabulary the rest of the app never got: stages
 * derived from what is on disk rather than from a stored status string, gates
 * that name what is keeping them shut, and a run that can be picked back up
 * from the stage it died at. Books had none of it. A book's chapter carried a
 * `status` field and nothing anywhere turned twelve of those into "where is
 * this book, and what does it need from me".
 *
 * The three ideas worth keeping, and why:
 *
 *   Derived, not stored. A status written down at the end of a run is a lie
 *   the moment anything touches the files outside that run - and tools now do
 *   exactly that. Every state here is computed from the artefacts.
 *
 *   A shut gate names its own remedy. "Cannot build" with no reason is what
 *   makes a gate feel like a bug rather than a decision.
 *
 *   Blockers and warnings are different things. A blocker means the sign-off
 *   is refused. A warning means go ahead, but know this first. Collapsing them
 *   into one list means either nagging about nothing or hiding something.
 */

import { blocksApproval, type ChapterMeta, type Finding } from "@actalk/quire-core";

export type StageState = "done" | "partial" | "pending";

export interface WorkflowStage {
  readonly stage: string;
  readonly state: StageState;
  /** What actually happened, in words. "16/16 pages written", not "true". */
  readonly detail: string;
}

export interface Approval {
  readonly at: string;
  readonly by: string;
}

export interface WorkflowGate {
  readonly name: string;
  readonly label: string;
  readonly approved: Approval | null;
  /** Hard: the sign-off is refused while any of these stand. */
  readonly blockers: readonly string[];
  /** Soft: sign off if you like, but know these first. */
  readonly warnings: readonly string[];
  readonly canApprove: boolean;
}

export interface Workflow {
  readonly kind: string;
  readonly stages: readonly WorkflowStage[];
  readonly gates: readonly WorkflowGate[];
  /** The terminal gate every kind has: can this thing ship, and if not, why. */
  readonly done: { readonly can: boolean; readonly blockers: readonly string[] };
  readonly running: boolean;
  readonly lastError: { readonly at?: string; readonly stage?: string; readonly message: string } | null;
}

/** A gate, with the blocker/warning split made explicit at the call site. */
export function gate(
  name: string,
  label: string,
  approved: Approval | null,
  blockers: readonly string[],
  warnings: readonly string[] = [],
): WorkflowGate {
  return { name, label, approved, blockers, warnings, canApprove: blockers.length === 0 };
}

/** `done`, `partial` or `pending` from a count against a total. */
export function partOf(done: number, total: number): StageState {
  if (total === 0) return "pending";
  if (done === 0) return "pending";
  return done < total ? "partial" : "done";
}

/* ------------------------------------------------------------------- books */

/** Chapter statuses that mean the words exist, whatever happens to them next. */
const WRITTEN: ReadonlySet<string> = new Set([
  "drafted", "auditing", "audit-passed", "audit-failed", "state-degraded",
  "revising", "ready-for-review", "approved", "rejected", "published", "imported",
]);

/** Statuses that mean a person has signed the chapter off. */
const SIGNED: ReadonlySet<string> = new Set(["approved", "published"]);

/** Statuses that mean the chapter has been read against the book's own rules. */
const AUDITED: ReadonlySet<string> = new Set([
  "audit-passed", "audit-failed", "revising", "ready-for-review", "approved", "published",
]);

/** Statuses that mean it stopped rather than that it is waiting. */
const STOPPED: ReadonlySet<string> = new Set(["audit-failed", "rejected", "state-degraded"]);

export interface BookWorkflowInput {
  readonly chapters: readonly ChapterMeta[];
  /** What the book is aiming at. A wish, not a fact - it gates nothing. */
  readonly targetChapters?: number;
  /** Every finding on record, of any state, across the whole project. */
  readonly findings: readonly Finding[];
  /** Which project-relative path a chapter's markdown lives at, if it exists. */
  readonly pathOf: (chapter: number) => string | null;
  readonly running?: boolean;
}

/**
 * A book's stages and gates, derived the way a magazine's are.
 *
 * The stages follow a chapter through its life rather than naming pipeline
 * steps, because that is what a reviewer is actually tracking: planned, then
 * written, then read, then signed off, then out.
 */
export function bookWorkflow(input: BookWorkflowInput): Workflow {
  const { chapters, findings, pathOf } = input;
  const total = chapters.length;
  const target = input.targetChapters ?? 0;

  const written = chapters.filter((ch) => WRITTEN.has(ch.status));
  const audited = chapters.filter((ch) => AUDITED.has(ch.status));
  const signed = chapters.filter((ch) => SIGNED.has(ch.status));
  const waiting = chapters.filter((ch) => ch.status === "ready-for-review");
  const stopped = chapters.filter((ch) => STOPPED.has(ch.status));
  const published = chapters.filter((ch) => ch.status === "published");
  const words = chapters.reduce((n, ch) => n + (ch.wordCount ?? 0), 0);

  /* Findings are held against a file path, so a chapter's blockers are found
     by asking where that chapter lives. A chapter with no file on disk has no
     findings, which is not the same as having been cleared. */
  const openBlockers = chapters.flatMap((ch) => {
    const path = pathOf(ch.number);
    if (!path) return [];
    return findings
      .filter((f) => f.path === path && blocksApproval(f))
      .map((f) => ({ chapter: ch.number, finding: f }));
  });

  const stages: WorkflowStage[] = [
    {
      stage: "plan",
      state: total === 0 ? "pending" : target > 0 && total < target ? "partial" : "done",
      detail: total === 0
        ? "no chapters yet"
        : target > 0 ? `${total} of ${target} chapters planned` : `${total} chapters planned`,
    },
    {
      stage: "write",
      state: partOf(written.length, total),
      detail: total === 0
        ? "nothing to write yet"
        : `${written.length}/${total} chapters written, ${words.toLocaleString()} words`,
    },
    {
      stage: "audit",
      state: partOf(audited.length, total),
      detail: total === 0
        ? "nothing to read yet"
        : openBlockers.length > 0
          ? `${audited.length}/${total} read, ${openBlockers.length} contradict${
            openBlockers.length === 1 ? "s" : ""
          } the book`
          : `${audited.length}/${total} read`,
    },
    {
      stage: "review",
      state: partOf(signed.length, total),
      detail: total === 0
        ? "nothing to sign off"
        : waiting.length > 0
          ? `${signed.length}/${total} approved, ${waiting.length} waiting on you`
          : `${signed.length}/${total} approved`,
    },
    {
      stage: "publish",
      state: partOf(published.length, total),
      detail: published.length === 0 ? "not published" : `${published.length}/${total} published`,
    },
  ];

  /* The copy gate. Approving a book whose chapters are not all signed off is
     a real thing an editor may want to do, so unwritten chapters warn rather
     than block. A chapter that stopped is a different matter - it is not
     waiting for a decision, it failed, and signing over it hides that. */
  const copyWarnings: string[] = [];
  if (total === 0) copyWarnings.push("there are no chapters yet");
  else if (written.length < total) {
    copyWarnings.push(`${total - written.length} chapters are still unwritten`);
  }
  if (waiting.length > 0) {
    copyWarnings.push(
      `${waiting.length} chapter${waiting.length === 1 ? "" : "s"} ${
        waiting.length === 1 ? "is" : "are"
      } waiting for a read`,
    );
  }
  const copyBlockers: string[] = [];
  if (stopped.length > 0) {
    copyBlockers.push(
      `${stopped.length} chapter${stopped.length === 1 ? "" : "s"} stopped rather than finished (${
        stopped.map((ch) => ch.number).join(", ")
      })`,
    );
  }

  /* The audit gate. This is the one the approve route already enforces; it is
     stated here so the screen can say so before the button is pressed rather
     than as a 409 afterwards. */
  const auditBlockers: string[] = [];
  if (total > 0 && audited.length === 0) auditBlockers.push("no chapter has been read yet");
  if (openBlockers.length > 0) {
    const where = [...new Set(openBlockers.map((b) => b.chapter))].sort((a, b) => a - b);
    auditBlockers.push(
      `${openBlockers.length} finding${openBlockers.length === 1 ? "" : "s"} contradict${
        openBlockers.length === 1 ? "s" : ""
      } the book (chapter${where.length === 1 ? "" : "s"} ${where.join(", ")})`,
    );
  }

  const gates: WorkflowGate[] = [
    gate("copy", "Copy", null, copyBlockers, copyWarnings),
    gate("audit", "Audit", null, auditBlockers),
  ];

  const doneBlockers: string[] = [];
  if (total === 0) doneBlockers.push("there are no chapters yet");
  else if (signed.length < total) {
    doneBlockers.push(`${total - signed.length} chapters are not approved`);
  }
  doneBlockers.push(...auditBlockers, ...copyBlockers);

  return {
    kind: "book",
    stages,
    gates,
    done: { can: doneBlockers.length === 0, blockers: doneBlockers },
    running: input.running ?? false,
    lastError: null,
  };
}

/* --------------------------------------------------- every other production */

/** One finished file, as the audit screen already knows it. */
export interface WorkItem {
  readonly path: string;
  readonly words: number;
  readonly audit: {
    readonly checked?: string;
    readonly approved?: Approval | null;
  };
}

export interface ProjectWorkflowInput {
  readonly kind: string;
  readonly kindLabel: string;
  readonly items: readonly WorkItem[];
  readonly findings: readonly Finding[];
  /** Whatever the production's own runner last recorded, if it records one. */
  readonly runStage?: { readonly stage: string; readonly state: string; readonly detail: string };
  readonly running?: boolean;
  readonly lastError?: { readonly stage?: string; readonly message: string } | null;
}

/**
 * What a runner's status word means for the stage row that shows it.
 *
 * `needs-review` is the one worth getting right: the run finished, and it is
 * waiting on a person. That is done work, not work in progress - saying
 * "partial" made a finished short read as though it had stalled part-way.
 * Whether a person has since read it is the gates' business, not the stage's.
 */
function runState(status: string): { state: StageState; detail: string } {
  switch (status) {
    case "complete": return { state: "done", detail: "finished" };
    case "needs-review": return { state: "done", detail: "finished, waiting for a read" };
    case "running": return { state: "partial", detail: "running now" };
    case "failed": return { state: "pending", detail: "stopped on an error" };
    case "cancelled": return { state: "pending", detail: "cancelled" };
    case "pending": return { state: "pending", detail: "not started" };
    /* An unknown status is reported rather than mapped to a guess. */
    default: return { state: "partial", detail: status };
  }
}

/**
 * Stages and gates for a short, a script, a storyboard, an interactive film -
 * anything made of finished files rather than of chapters or pages.
 *
 * These kinds had no workflow at all: the audit screen listed their files and
 * that was the entire surface. They cannot have a magazine's seven stages,
 * because their runners do not record seven - but "written, read, signed off"
 * is true of every one of them, and so are the two gates. Inventing stages a
 * production never claimed would be worse than three honest ones.
 */
export function projectWorkflow(input: ProjectWorkflowInput): Workflow {
  const { items, findings } = input;
  const total = items.length;
  const paths = new Set(items.map((i) => i.path));

  const read = items.filter((i) => i.audit.checked);
  const signed = items.filter((i) => i.audit.approved);
  const words = items.reduce((n, i) => n + i.words, 0);

  /* Only this project's files. A findings store holds every project's, and a
     short must not be gated on a contradiction found in somebody's novel. */
  const open = findings.filter((f) => paths.has(f.path) && blocksApproval(f));

  const stages: WorkflowStage[] = [];
  /* The production's own stage first when it keeps one - it is the only thing
     here that knows about research, or rendering, or a failed export. */
  if (input.runStage) {
    const { state, detail } = runState(input.runStage.state);
    stages.push({
      stage: input.runStage.stage,
      state,
      /* An error beats the status word: "failed" tells you less than the
         reason it failed, and the reason is right there on the snapshot. */
      detail: input.runStage.detail || detail,
    });
  }
  stages.push(
    {
      stage: "write",
      state: total === 0 ? "pending" : "done",
      detail: total === 0
        ? "nothing written yet"
        : `${total} file${total === 1 ? "" : "s"}, ${words.toLocaleString()} words`,
    },
    {
      stage: "audit",
      state: partOf(read.length, total),
      detail: total === 0
        ? "nothing to read yet"
        : open.length > 0
          ? `${read.length}/${total} read, ${open.length} contradict${open.length === 1 ? "s" : ""} the work`
          : `${read.length}/${total} read`,
    },
    {
      stage: "review",
      state: partOf(signed.length, total),
      detail: total === 0 ? "nothing to sign off" : `${signed.length}/${total} approved`,
    },
  );

  const copyWarnings: string[] = [];
  if (read.length < total) {
    copyWarnings.push(
      `${total - read.length} file${total - read.length === 1 ? "" : "s"} ${
        total - read.length === 1 ? "has" : "have"
      } never been read`,
    );
  }
  if (signed.length < total) {
    copyWarnings.push(`${total - signed.length} of ${total} are not signed off`);
  }

  const auditBlockers: string[] = [];
  if (total > 0 && read.length === 0) auditBlockers.push("nothing has been read yet");
  if (open.length > 0) {
    auditBlockers.push(
      `${open.length} finding${open.length === 1 ? "" : "s"} contradict${
        open.length === 1 ? "s" : ""
      } the work`,
    );
  }

  const doneBlockers: string[] = [];
  if (total === 0) doneBlockers.push("there is nothing here yet");
  else if (signed.length < total) {
    doneBlockers.push(`${total - signed.length} of ${total} files are not approved`);
  }
  doneBlockers.push(...auditBlockers);

  return {
    kind: input.kind,
    stages,
    gates: [
      gate("copy", "The writing", null, [], copyWarnings),
      gate("audit", "Read against its own rules", null, auditBlockers),
    ],
    done: { can: doneBlockers.length === 0, blockers: doneBlockers },
    running: input.running ?? false,
    lastError: input.lastError ?? null,
  };
}
