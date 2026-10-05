/*
 * Start something. Mock 28-new.
 *
 * The thirteen ways to begin, grouped by what each one needs from the user -
 * which is the question they are really answering. They used to be a
 * thirteen-item list in the sidebar, where they outweighed the four places
 * anyone actually goes every day and none of them had room to say what it was
 * for; the rail carries one door now and the choosing happens here.
 *
 * Every tile does exactly what its sidebar item did: opens a real chat session
 * with the composer seeded, so pressing one says what it is for instead of
 * producing an indistinguishable blank chat.
 */
import { useApi } from "../hooks/use-api";
import { useChatStore } from "../store/chat";
import { clearBookCreateSessionId, setProjectChatSessionId } from "./chat-page-state";
import { tr } from "../lib/app-language";
import { Icon } from "../components/ui/icon";

interface Way {
  readonly id: string;
  readonly mark: string;
  readonly tag: string;
  readonly title: string;
  readonly what: string;
  readonly start: () => void;
}

export function StartPage({
  nav,
}: {
  readonly nav: {
    readonly toChat: () => void;
    readonly toBookCreate: () => void;
  };
}) {
  const createDraftSession = useChatStore((s) => s.createDraftSession);
  const setInput = useChatStore((s) => s.setInput);
  const { data: types } = useApi<{
    types: ReadonlyArray<{ id: string; label: string; description: string | null }>;
  }>("/publications/types");

  /** A seeded conversation: the instruction, never the answer. */
  const seeded = (seed: string) => () => {
    const sessionId = createDraftSession(null, "chat");
    setProjectChatSessionId(sessionId);
    setInput(seed);
    nav.toChat();
  };

  const mode = (
    kind: "short" | "play" | "script" | "storyboard" | "interactive-film",
    playMode?: "guided" | "open",
  ) => () => {
    const sessionId = createDraftSession(null, kind, playMode);
    setProjectChatSessionId(sessionId);
    setInput("");
    nav.toChat();
  };

  const fromNothing: Way[] = [
    {
      id: "novel",
      mark: "mark-book",
      tag: "longest",
      title: "Long novel",
      what: "Chapter by chapter, through draft, audit and revise. The form the rest of the app is shaped around.",
      /* Every other tile makes a fresh draft; this one only changed route, so
         ChatPage read `quire.book-create.session-id` back out of localStorage
         and reopened the last unfinished book setup. Nothing ever cleared that
         key except a book actually being created, so a setup abandoned once
         became the permanent answer to "start something". Reloading #/book/new
         still resumes — it is pressing this tile that means start over. */
      start: () => {
        clearBookCreateSessionId();
        setInput("");
        nav.toBookCreate();
      },
    },
    {
      id: "short",
      mark: "mark-short",
      tag: "one sitting",
      title: "Short story",
      what: "One file, one arc. The same loop as a novel, without the chapter machinery.",
      start: mode("short"),
    },
    {
      id: "script",
      mark: "mark-script",
      tag: "ruled",
      title: "Script",
      what: "Scenes, slugs and speakers. Prose rules do not apply, and the audit knows it.",
      start: mode("script"),
    },
    {
      id: "storyboard",
      mark: "mark-storyboard",
      tag: "drawn",
      title: "Storyboard",
      what: "Panels with a line of direction each. Goes to Images for the frames.",
      start: mode("storyboard"),
    },
    /* The publication types are read from the machine, not listed here: a type
       the user installs shows up without a code change. */
    ...(types?.types ?? []).map((t) => ({
      id: `pub:${t.id}`,
      mark: t.id === "storybook" ? "mark-story" : "mark-mag",
      tag: "printed",
      title: t.label,
      what:
        t.description ??
        "A staged issue: brief, flatplan, per-page copy, artwork, and a laid-out PDF.",
      start: seeded(tr(`做一本${t.label}，主题：`, `Create a ${t.label.toLowerCase()} about `)),
    })),
  ];

  const fromSomething: Way[] = [
    {
      id: "fanfic",
      mark: "mark-fanfic",
      tag: "orbits a work",
      title: "Fanfic",
      what: "Someone else’s world, your story. Import the canon first and it becomes truth files.",
      start: seeded(tr("写一篇同人，原作：", "Write fan fiction based on ")),
    },
    {
      id: "spinoff",
      mark: "mark-side",
      tag: "beside a work",
      title: "Side-story",
      what: "A minor character’s week. Shares truth files with the book it hangs off.",
      start: seeded(tr("写一部外传，原作：", "Write a spinoff of ")),
    },
    {
      id: "continuation",
      mark: "mark-continuation",
      tag: "carries on",
      title: "Continuation",
      what: "Picks up where a finished book stopped, with its canon and its voice already loaded.",
      start: seeded(tr("继续写这部作品：", "Continue this work: ")),
    },
    {
      id: "imitation",
      mark: "mark-imitation",
      tag: "same hand",
      title: "Imitation",
      what: "A new story in a studied voice. The style pack is built from the source before a word is written.",
      start: seeded(tr("模仿这位作家的风格写作：", "Write in the style of ")),
    },
    {
      id: "translation",
      mark: "mark-translation",
      tag: "same book, twice",
      title: "Translation",
      what: "Chapter for chapter, with the terms fixed once and held. Exports EPUB, PDF, plain text.",
      start: seeded(tr("把这部作品翻译成：", "Translate this work into ")),
    },
  ];

  const steered: Way[] = [
    {
      id: "film",
      mark: "mark-film",
      tag: "shot",
      title: "Interactive film",
      what: "Scenes with choices between them, and a frame for every beat. The heaviest form in the app.",
      start: mode("interactive-film"),
    },
    {
      id: "branching",
      mark: "mark-branch",
      tag: "forks",
      title: "Branching play",
      what: "A story graph rather than a spine. Every ending has to be reachable, and the audit checks that.",
      start: mode("play", "guided"),
    },
    {
      id: "open",
      mark: "mark-world",
      tag: "no edge",
      title: "Open world",
      what: "Places, people and state, with no fixed order. The reader goes where they like and the canon holds.",
      start: mode("play", "open"),
    },
  ];

  return (
    <div className="stack-lg">
      <section className="crop pb-0">
        <span className="disc fill w-57.5 h-57.5 -right-28 -top-31 opacity-13" />
        <span className="disc stroke w-29.5 h-29.5 -right-9.5 -top-8.5 opacity-40" />
        <span className="disc dots w-24 h-24 -left-14.5 -bottom-16.5 opacity-28" />
        <h2 className="h-page">What are you making?</h2>
        <p className="muted text-body mt-2.5 max-w-measure">
          Picking one opens a conversation, not a form. You describe it, the machine asks a few
          questions and writes the first truth files as you answer, and nothing lands on disk
          until you say so.
        </p>
      </section>

      <Group label="From nothing" aside="You bring the idea" ways={fromNothing} />
      <Group label="From something that exists" aside="You bring a source" ways={fromSomething} />
      <Group label="Steered by a reader" aside="Somebody else decides what happens" ways={steered} />

      <div
        role="link"
        tabIndex={0}
        className="panel crop"
        onClick={() => seeded("")()}
        onKeyDown={(e) => {
          if (e.key === "Enter") seeded("")();
        }}
      >
        <span className="disc stroke-l w-37.5 h-37.5 -right-16 -bottom-17.5" />
        <div className="spread">
          <div>
            <h3 className="h-panel">Not sure which</h3>
            <p className="note text-body mt-1">
              Describe it in a sentence and Quire will pick the form, set up the folder and write
              the first truth file. You can change the form afterwards.
            </p>
          </div>
          <span className="arrow arrow-lg">
            <Icon name="arrR" size={20} />
          </span>
        </div>
      </div>
    </div>
  );
}

function Group({
  label,
  aside,
  ways,
}: {
  readonly label: string;
  readonly aside: string;
  readonly ways: readonly Way[];
}) {
  if (ways.length === 0) return null;
  return (
    <section>
      <div className="rowflex gap-3 mb-3.5">
        <span className="label">{label}</span>
        <span className="flex-1 h-0.25 bg-(--line)" />
        <span className="dim text-cap">{aside}</span>
      </div>
      <div className="tiles">
        {ways.map((w) => (
          <button key={w.id} type="button" className="tile crop" onClick={w.start}>
            <span className={`mark ${w.mark}`}>
              <span className="d1" />
              <span className="d2" />
            </span>
            <span className="top">
              <span className="label">{w.tag}</span>
            </span>
            <h4>{w.title}</h4>
            <span className="who">{w.what}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
