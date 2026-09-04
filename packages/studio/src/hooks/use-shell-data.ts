/*
 * What the chrome needs, and only that.
 *
 * The rail's counts, the topbar's model pill and the "waiting on you" number
 * come from here so that every screen shows the same figures. They were being
 * derived independently in the sidebar and on the dashboard, which is how the
 * sidebar could say a book was clear while the dashboard listed it as waiting.
 *
 * The waiting count is chapters pending review. When plan 14 lands its gates
 * API this becomes gates across every production type, and only this file
 * changes.
 */
import { useMemo } from "react";
import { useApi } from "./use-api";
import type { BookSummary } from "../shared/contracts";
import type { PaletteEntry } from "../components/shell/Palette";

export interface PublicationSummary {
  readonly id: string;
  /** The publication definition that made it: magazine, storybook, storyboard. */
  readonly type: string;
  readonly title: string;
  readonly subject: string;
  readonly status: string;
  readonly extent: number;
  readonly pages: number;
  readonly written: number;
  readonly art: number;
  readonly pdf: string | null;
}

export function useShellData() {
  const { data: booksData } = useApi<{ books: readonly BookSummary[] }>("/books");
  const { data: pubData } = useApi<{ publications: readonly PublicationSummary[] }>("/publications");
  const { data: daemon } = useApi<{ running: boolean }>("/daemon");
  const { data: model } = useApi<{ service: string | null; defaultModel: string | null }>(
    "/project/default-model",
  );

  const books = booksData?.books ?? [];
  const publications = pubData?.publications ?? [];

  const waiting = useMemo(
    () => books.reduce((n, b) => n + (b.pendingReview ?? 0), 0),
    [books],
  );

  const tails = useMemo(
    () => ({
      home: waiting,
      books: books.length,
      magazine: publications.length,
      daemon: daemon?.running ? "on" : undefined,
    }),
    [waiting, books.length, publications.length, daemon?.running],
  );

  /* "claude · sonnet-4.6": the agent and the model, because with CLI providers
     the pair is the answer and either half alone is ambiguous. */
  const modelLabel = useMemo(() => {
    if (!model?.service) return null;
    const short = model.service.replace(/Cli$/, "");
    return model.defaultModel ? `${short} · ${model.defaultModel}` : short;
  }, [model?.service, model?.defaultModel]);

  /* Live destinations for the palette. The old sidebar carried expandable
     trees of these; the palette carries them now, searchable, at no width. */
  const paletteExtra = useMemo<PaletteEntry[]>(
    () => [
      ...books.map((b) => ({
        id: `book:${b.id}`,
        icon: "book" as const,
        label: b.title,
        hint: `chapter ${b.lastChapterNumber} of ${b.targetChapters}`,
        group: "Books",
        route: { page: "book" as const, bookId: b.id },
      })),
      ...publications.map((p) => ({
        id: `pub:${p.id}`,
        icon: "magazine" as const,
        label: p.title,
        hint: p.subject,
        group: "Magazine",
        route: { page: "publication" as const, issueId: p.id },
      })),
    ],
    [books, publications],
  );

  return { books, publications, waiting, tails, modelLabel, paletteExtra };
}

/*
 * What the machine is doing, for the rail card.
 *
 * Derived generically from the event names rather than from a list of known
 * runs: every long job on the server broadcasts `<thing>:start` and then
 * `<thing>:complete` or `<thing>:error`, so a new stage appears here the day
 * it starts broadcasting instead of the day someone remembers to add it.
 */
export interface ActiveRun {
  readonly what: string;
  readonly where: string;
  readonly startedAt: number;
}

const RUN_LABELS: Readonly<Record<string, string>> = {
  draft: "Drafting",
  write: "Writing",
  audit: "Auditing",
  revise: "Revising",
  rewrite: "Rewriting",
  style: "Restyling",
  import: "Importing",
  radar: "Scanning",
  fanfic: "Deriving",
  publication: "Building the issue",
  agent: "Working",
  book: "Creating",
};

export function deriveActiveRun(
  messages: readonly { readonly event: string; readonly data: unknown; readonly timestamp: number }[],
): ActiveRun | null {
  let open: ActiveRun | null = null;
  for (const m of messages) {
    const [thing, phase] = m.event.split(":");
    if (!thing || !phase) continue;
    if (phase === "start" || phase === "creating") {
      const d = (m.data ?? {}) as Record<string, unknown>;
      const where =
        typeof d.title === "string" ? d.title
        : typeof d.bookTitle === "string" ? d.bookTitle
        : typeof d.bookId === "string" ? d.bookId
        : "";
      open = { what: RUN_LABELS[thing] ?? thing, where, startedAt: m.timestamp };
    } else if (phase === "complete" || phase === "error" || phase === "created") {
      // Any terminal event closes the card. Runs do not overlap here: the
      // server queues them, and a card that tried to show two at once showed
      // neither clearly.
      open = null;
    }
  }
  return open;
}
