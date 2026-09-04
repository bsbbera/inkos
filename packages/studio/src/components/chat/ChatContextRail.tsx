/**
 * What the conversation is about — the mock's left column.
 *
 * Clicking anything here puts it in the composer as a reference rather than
 * opening another screen, which is why it is chrome-coloured and not paper:
 * it is the material of the conversation, not a place to navigate to.
 *
 * A conversation about a short, an issue or a storyboard has no `bookId`, and
 * for a long time that meant this column showed nothing at all: the three
 * groups below were written for a book and gated on a book. A workspace with
 * no books in it — which is most of them — got an empty rail forever. The
 * subject is resolved from the production the session actually wrote to when
 * there is no book, and only a chat that has made nothing yet falls back to
 * naming the shelf.
 */
import { useEffect, useState } from "react";
import { Book, ChevronDown, FileText, Layers, MessageSquare, Trash2, Users } from "lucide-react";
import { fetchJson } from "../../hooks/use-api";
import { useChatStore } from "../../store/chat";
import { foundationFileLabel, roleFromPath } from "../../lib/truth-display";
import { useResizable } from "../../hooks/use-resizable";
import {
  clearBookCreateSessionId,
  clearProjectChatSessionId,
  getBookCreateSessionId,
  getProjectChatSessionId,
} from "../../pages/chat-page-state";
import { whenLabel } from "./ChatMessage";
import { sessionProduction } from "./chat-session-files";
import { TypeMark } from "../TypeMark";
import type { SessionSummary } from "../../store/chat/types";

interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
}

interface TruthFile {
  readonly name: string;
}

/** What the column shows, from a book or from a production. One shape. */
interface Subject {
  /** The work's own name — what it is called on its title page. */
  readonly title: string;
  /**
   * The name the person typed, which is not the title.
   *
   * A run called `the-second-law` produced a story called "The Hand That
   * Knows Where I'm Wrong", and the column showed only the second one. Every
   * conversation in the switcher below opened with the words "The Second
   * Law", the paths on screen all read `shorts/the-second-law/...`, and
   * nothing anywhere connected the two — so the column named a thing the
   * reader had no way to recognise as the thing they were looking at.
   */
  readonly id: string;
  /** Its silhouette, so the type is drawn rather than spelled. */
  readonly kind: string;
  readonly sub: string;
  readonly chapters: ReadonlyArray<{ number: number; title: string; wants: boolean }>;
  readonly people: ReadonlyArray<{ key: string; name: string; note: string }>;
  readonly truth: ReadonlyArray<{ key: string; name: string; label: string }>;
}

interface ProductionContext {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly chapters: ReadonlyArray<{ number: number; title: string; words: number }>;
  readonly people: ReadonlyArray<{ name: string; note: string }>;
  readonly truth: ReadonlyArray<{ path: string; name: string; label: string }>;
}

interface BookMeta {
  readonly title?: string;
  readonly name?: string;
}

/** Chapters that still want a person carry the warning dot, and only those. */
const WANTS_YOU = new Set(["ready-for-review", "needs-revision", "blocked"]);

/** What a conversation was for, in one word, where it is not just a chat. */
const KIND_LABEL: Readonly<Record<string, string>> = {
  "book-create": "starting a book",
  book: "book",
  short: "short",
  script: "script",
  storyboard: "storyboard",
  play: "world",
  publication: "issue",
  edit: "edit",
  "interactive-film": "film",
  "interactive-film-authoring": "film",
};

/**
 * Every conversation in the workspace, newest first.
 *
 * The app kept sessions and could not show them: ChatPage lists
 * `sessionIdsByBook[activeBookId]`, so a chat started outside a book — which
 * is most of them — existed on disk, held its whole transcript, and had no row
 * anywhere in the UI to get back to it. Closing the app lost the thread.
 *
 * It sits in this rail rather than in a column of its own because the frame
 * gives up a fourth column at the first breakpoint, and because "which
 * conversation" and "what is it about" are the same axis. It is the one thing
 * here that navigates: everything below puts a reference in the composer, and
 * a row that switches the transcript under you needs the marker to say so.
 */
function Conversations() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const activateSession = useChatStore((s) => s.activateSession);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const removeSession = useChatStore((s) => s.deleteSession);
  // Enough to notice a session being created, renamed or deleted without
  // subscribing to every keystroke of the transcript.
  const known = useChatStore((s) => Object.keys(s.sessions).length);
  const [sessions, setSessions] = useState<ReadonlyArray<SessionSummary>>([]);
  /* Deleting a conversation is not undoable, so the row asks first rather than
     the browser: a window.confirm cannot say which files survive, and that is
     the whole question someone has at that moment. */
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ sessions?: ReadonlyArray<SessionSummary> }>("/sessions?bookId=all")
      .then((data) => { if (!cancelled) setSessions(data.sessions ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeSessionId, known]);

  /* The two localStorage keys that reopen a conversation by id. Leaving a
     deleted id in either one makes ChatPage ask the server for a session that
     is gone every time the route is entered. */
  const forget = (sessionId: string) => {
    if (getBookCreateSessionId() === sessionId) clearBookCreateSessionId();
    if (getProjectChatSessionId() === sessionId) clearProjectChatSessionId();
  };

  const remove = async (sessionId: string) => {
    setConfirming(null);
    forget(sessionId);
    await removeSession(sessionId);
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  };

  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  if (recent.length === 0) return null;

  return (
    <Group
      label={`Conversations · ${recent.length}`}
      className="grp-switch"
      icon={<MessageSquare size={12} aria-hidden="true" />}
    >
      {recent.slice(0, 8).map((session) => {
        const here = session.sessionId === activeSessionId;
        const kind = session.sessionKind ? KIND_LABEL[session.sessionKind] : undefined;

        if (confirming === session.sessionId) {
          return (
            <div key={session.sessionId} className="row" style={{ padding: "8px 4px", display: "block" }}>
              <div className="name trunc" style={{ fontSize: 13 }}>
                Delete “{session.title ?? "Untitled"}”?
              </div>
              <div className="meta" style={{ fontSize: 11, whiteSpace: "normal", marginTop: 2 }}>
                The transcript goes for good. Chapters, shorts and issues it
                wrote stay on disk — delete those from Books or Audit.
              </div>
              <div className="rowflex" style={{ gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-bad btn-sm"
                  onClick={() => { void remove(session.sessionId); }}
                >
                  Delete
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </div>
            </div>
          );
        }

        return (
          <div
            key={session.sessionId}
            className="row"
            aria-current={here ? "true" : undefined}
            style={{ padding: "8px 4px" }}
          >
            <button
              type="button"
              className="grow"
              style={{ background: "transparent", border: 0, padding: 0, textAlign: "left", cursor: "pointer", minWidth: 0 }}
              onClick={() => {
                if (here) return;
                activateSession(session.sessionId);
                void loadSessionDetail(session.sessionId);
              }}
            >
              <span className="name trunc" style={{ display: "block" }}>
                {session.title ?? "Untitled"}
              </span>
              <span className="meta trunc" style={{ fontSize: 11, display: "block" }}>
                {[kind, whenLabel(session.updatedAt)].filter(Boolean).join(" · ")}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm row-act"
              aria-label={`Delete ${session.title ?? "this conversation"}`}
              title="Delete this conversation"
              onClick={() => setConfirming(session.sessionId)}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </Group>
  );
}

export interface ChatContextRailProps {
  readonly bookId?: string;
  /** Puts a reference into the composer. The rail never navigates. */
  readonly onReference?: (text: string) => void;
}

export function ChatContextRail({ bookId, onReference }: ChatContextRailProps) {
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);
  const sessionId = useChatStore((s) => s.activeSessionId);
  const messages = useChatStore((s) => (sessionId ? s.sessions[sessionId]?.messages : undefined));
  const [title, setTitle] = useState<string | null>(null);
  const [chapters, setChapters] = useState<ReadonlyArray<ChapterMeta>>([]);
  const [truth, setTruth] = useState<ReadonlyArray<TruthFile>>([]);
  const [made, setMade] = useState<ProductionContext | null>(null);
  const [books, setBooks] = useState<ReadonlyArray<{ readonly id: string; readonly title?: string }>>([]);

  /* What this conversation made, when it did not make a book. Derived rather
     than stored: the run named its own output paths, and the alternative is a
     second copy of the subject that can disagree with the files on disk. */
  const production = bookId ? null : sessionProduction(messages);
  const madeKey = production ? production.dir + "/" + production.id : null;

  // Only the case with nothing made needs the shelf, and only to name what a
  // chat can be pointed at. Anything with a subject already knows its own.
  useEffect(() => {
    if (bookId || madeKey) return;
    let cancelled = false;
    void fetchJson<{ books?: ReadonlyArray<{ id: string; title?: string }> }>("/books")
      .then((data) => { if (!cancelled) setBooks(data.books ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookId, madeKey, bookDataVersion]);

  useEffect(() => {
    if (bookId || !madeKey) { setMade(null); return; }
    let cancelled = false;
    void fetchJson<ProductionContext>(`/production/${madeKey}/context`)
      .then((data) => { if (!cancelled) setMade(data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookId, madeKey, bookDataVersion]);

  useEffect(() => {
    if (!bookId) {
      setTitle(null); setChapters([]); setTruth([]);
      return;
    }
    let cancelled = false;
    void fetchJson<{ book?: BookMeta; chapters?: ChapterMeta[] }>(`/books/${bookId}`)
      .then((data) => {
        if (cancelled) return;
        setTitle(data.book?.title ?? data.book?.name ?? bookId);
        setChapters(data.chapters ?? []);
      })
      .catch(() => undefined);
    void fetchJson<{ files?: TruthFile[] }>(`/books/${bookId}/truth`)
      .then((data) => { if (!cancelled) setTruth(data.files ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookId, bookDataVersion]);

  /**
   * One subject, whichever source it came from.
   *
   * The three groups below used to be written for a book and gated on a book,
   * so a workspace whose work is all shorts got an empty column forever.
   * Resolving to a single shape here is what lets a short be described by the
   * same three groups the mock draws.
   */
  const subject: Subject | null = bookId
    ? {
        title: title ?? bookId,
        id: bookId,
        kind: "book",
        sub: `${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`,
        // Newest first, and only what fits a glance. The rail is a reminder of
        // what is in play, not the chapter list — that screen already exists.
        chapters: [...chapters]
          .sort((a, b) => b.number - a.number)
          .slice(0, 3)
          .map((ch) => ({ number: ch.number, title: ch.title, wants: WANTS_YOU.has(ch.status) })),
        people: truth
          .map((f) => roleFromPath(f.name))
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .map((r) => ({ key: r.path, name: r.name, note: r.tier === "major" ? "leads" : "appears" })),
        truth: truth
          .map((f) => ({
            key: f.name,
            name: f.name.split("/").pop() ?? f.name,
            label: foundationFileLabel(f.name),
          }))
          .filter((f): f is { key: string; name: string; label: string } => f.label !== undefined),
      }
    : made
      ? {
          title: made.title,
          id: production?.id ?? made.id,
          kind: made.kind,
          sub:
            made.chapters.length > 0
              ? `${made.chapters.length} chapter${made.chapters.length === 1 ? "" : "s"}`
              : "",
          chapters: [...made.chapters]
            .sort((a, b) => b.number - a.number)
            .slice(0, 3)
            .map((ch) => ({ number: ch.number, title: ch.title, wants: false })),
          people: made.people.map((p) => ({ key: p.name, name: p.name, note: p.note })),
          truth: made.truth.map((f) => ({ key: f.path, name: f.name, label: f.label })),
        }
      : null;

  /* Draggable, because the column now holds a list rather than a reminder.
     A conversation title is as long as its first sentence and 236px cut most
     of them mid-word, with no way to see more; the book sidebar on the other
     side of this screen has been resizable the whole time, using this hook. */
  const { width, gripProps } = useResizable({
    key: "quire.chat.context",
    initial: 236,
    min: 180,
    max: 460,
    side: "end",
  });

  return (
    <aside className="subrail" style={{ width }}>
      <div
        {...gripProps}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the column"
        title="Drag to resize · double-click for the default width"
        className="subrail-grip"
      />
      <div className="subrail-head">
        <div className="label">Talking about</div>
        {/*
          The parent, drawn as a parent.

          Every group in this column used to be the same 11px uppercase label
          over the same putty, so the work and the three things describing it
          read as four siblings. The work now holds a surface of its own — the
          only tinted region in the rail — and the silhouette sits at its left
          at full size, where an icon belongs on the thing it identifies.
        */}
        <div className="subj-card" aria-current="true">
          <span className="subj-mark">
            {subject ? <TypeMark kind={subject.kind} size={17} /> : <Book size={16} aria-hidden="true" />}
          </span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="subj-title">{subject?.title ?? "This project"}</span>
            {/* The line that answers "which one is this": the mono id is the
                name the person typed and the one every path on screen agrees
                with. The title alone matched nothing. */}
            <span className="subj-id">
              {subject ? (
                <>
                  <span className="mono trunc">{subject.id}</span>
                  {subject.sub ? <span className="sep">{subject.sub}</span> : null}
                </>
              ) : (
                <span>{`${books.length} book${books.length === 1 ? "" : "s"} here`}</span>
              )}
            </span>
          </span>
          <span className="subj-switch" aria-hidden="true"><ChevronDown size={15} /></span>
        </div>
      </div>

      <div className="subrail-body">
        {/* Indented under a hairline that runs the height of the three groups.
            Containment drawn rather than implied: what is inside the spine
            belongs to the work above it, and the switcher below it does not. */}
        {subject ? (
          <div className="of-work">
            {subject.chapters.length > 0 ? (
              <Group label="Chapters" icon={<Layers size={12} aria-hidden="true" />}>
                {subject.chapters.map((ch) => (
                  <button
                    key={ch.number}
                    type="button"
                    className="row"
                    style={{ padding: "8px 4px" }}
                    onClick={() => onReference?.(`chapter ${ch.number}`)}
                  >
                    <span className="num tnum" style={{ width: "1.9em" }}>
                      {String(ch.number).padStart(2, "0")}
                    </span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="name trunc">{ch.title}</span>
                    </span>
                    {ch.wants ? (
                      <span className="sev sev-warn" style={{ width: 6, height: 6, borderRadius: "50%" }} />
                    ) : null}
                  </button>
                ))}
              </Group>
            ) : null}

            {subject.people.length > 0 ? (
              <Group label="People" icon={<Users size={12} aria-hidden="true" />}>
                {subject.people.slice(0, 6).map((person) => (
                  <button
                    key={person.key}
                    type="button"
                    className="row"
                    style={{ padding: "8px 4px" }}
                    onClick={() => onReference?.(person.name)}
                  >
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="name trunc">{person.name}</span>
                      <span className="meta trunc">{person.note}</span>
                    </span>
                  </button>
                ))}
              </Group>
            ) : null}

            {subject.truth.length > 0 ? (
              <Group label="Truth" icon={<FileText size={12} aria-hidden="true" />}>
                {subject.truth.slice(0, 6).map((file) => (
                  <button
                    key={file.key}
                    type="button"
                    className="row"
                    style={{ padding: "8px 4px" }}
                    onClick={() => onReference?.(file.name)}
                  >
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="name mono trunc" style={{ fontSize: 11 }}>{file.name}</span>
                    </span>
                    <span className="pill" style={{ fontSize: 11 }}>{file.label}</span>
                  </button>
                ))}
              </Group>
            ) : null}
          </div>
        ) : (
          <Group label="Books" icon={<Book size={12} aria-hidden="true" />}>
            {books.length === 0 ? (
              <p className="hint" style={{ fontSize: 11, padding: "2px 4px" }}>
                Nothing started yet.
              </p>
            ) : books.slice(0, 8).map((book) => (
              <button
                key={book.id}
                type="button"
                className="row"
                style={{ padding: "8px 4px" }}
                onClick={() => onReference?.(book.title ?? book.id)}
              >
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="name trunc">{book.title ?? book.id}</span>
                </span>
              </button>
            ))}
          </Group>
        )}

        {/* Last, and quieter, because it answers a different question.
            It was first, and sixteen near-identical rows of "Write a short
            story called The Second Law" then stood between the head that
            named the work and the three groups describing it — so the
            description read as belonging to nothing. It is a switcher, not
            part of the subject, and it sits below the subject entire. */}
        <Conversations />
      </div>
    </aside>
  );
}

function Group({ label, className, icon, children }: {
  readonly label: string;
  readonly className?: string;
  readonly icon?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={className ? `grp ${className}` : "grp"}>
      <div className="label">
        {icon ? <span className="label-icon">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div className="rows">{children}</div>
    </div>
  );
}
