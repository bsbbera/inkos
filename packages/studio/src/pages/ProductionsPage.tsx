/*
 * The shelf. Mock 03-books.
 *
 * Everything the user has made, as tiles, with the type carried by a
 * silhouette rather than a label - the disc is drawn once in the legend and
 * never named again anywhere else in the app.
 *
 * Books and magazines are the same screen with a different source, because
 * they are the same question ("what have I got, and what needs me") and two
 * near-identical grids would drift apart within a month.
 */
import { useArrivals } from "../hooks/use-arrivals";
import { useMemo, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { BookSummary } from "../shared/contracts";
import type { PublicationSummary } from "../hooks/use-shell-data";
import { Icon } from "../components/ui/icon";
import { Failed } from "../components/ui/states";
import { standingOf } from "../lib/standing";
import { WorkTile } from "../components/ui/work-tile";

type Filter = "all" | "drafting" | "waiting" | "done";

/** What the tile is, reduced to the four states a shelf is scanned for. */
interface Production {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  /** What it is, written on its cover: "book", "storybook", "magazine". */
  readonly kind: string;
  readonly state: Exclude<Filter, "all">;
  readonly badge: { readonly label: string; readonly tone: string };
  readonly open: () => void;
}

/** One creation as the folder walk reports it — `GET /workspace/summary`. */
interface FolderCreation {
  readonly kind: string;
  readonly label: string;
  readonly id: string;
  readonly title: string;
  readonly files: number;
  readonly words: number;
  readonly read: number;
  readonly signedOff: number;
  readonly open: number;
  readonly blocking: number;
}


function bookState(b: BookSummary): Production["state"] {
  // The gate first: a book with a chapter waiting is waiting, whatever its
  // configured status says. `targetChapters` defaults to 200 and is a wish,
  // not a fact, so it decides nothing here - the book's own status does.
  if (b.pendingReview > 0) return "waiting";
  if (b.status === "completed") return "done";
  return "drafting";
}

/* Status only. The kind ("storybook") used to sit in this same slot whenever
   a work was drafting, so one place on the card meant two different things;
   the kind is on the cover now and this pill always means where it stands. */
function badgeFor(state: Production["state"]): Production["badge"] {
  if (state === "waiting") return { label: "needs a read", tone: "pill pill-warn" };
  if (state === "done") return { label: "signed off", tone: "pill pill-ok" };
  return { label: "drafting", tone: "pill" };
}

export function ProductionsPage({
  kind,
  nav,
}: {
  readonly kind: "books" | "magazines";
  readonly nav: {
    readonly toBook: (id: string) => void;
    readonly toPublication: (id: string) => void;
    readonly toNew: () => void;
    /* Where a folder-derived production opens. Shorts, storyboards, scripts
       and films have no detail screen of their own; the audit is the screen
       that reads them. */
    readonly toAudit: (kind?: string, id?: string) => void;
  };
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const books = useApi<{ books: readonly BookSummary[] }>(
    kind === "books" ? "/books" : "",
  );
  const pubs = useApi<{ publications: readonly PublicationSummary[] }>(
    kind === "magazines" ? "/publications" : "",
  );
  /* The folder walk, which is the only place a short, storyboard, script or
     film is listed. This page called itself "productions" and offered
     "book · storybook · short · script" from its empty state while reading
     /books alone — so a finished 50,000-word short sat in the workspace and
     the shelf said "No productions yet". Books keep their own row: they carry
     a real title and progress in chapters, which the walk cannot see. */
  const walk = useApi<{ projects: readonly FolderCreation[] }>("/workspace/summary");
  /* Runs stopped at a gate. Home raises these first; a shelf that did not
     read them said "none waiting" over three issues Home said were. */
  const gated = useApi<{ waiting: ReadonlyArray<{ ref: { id: string } }> }>("/productions/waiting");

  const items = useMemo<Production[]>(() => {
    if (kind === "books") {
      const shelf = (books.data?.books ?? []).map((b) => {
        const state = bookState(b);
        return {
          id: b.id,
          title: b.title,
          detail: `${b.chaptersWritten} of ${b.targetChapters} chapters · ${b.totalWords.toLocaleString()} words`,
          kind: "book",
          state,
          badge: badgeFor(state),
          open: () => nav.toBook(b.id),
        };
      });
      const spoken = new Set(shelf.map((row) => row.id));
      const stopped = new Set((gated.data?.waiting ?? []).map((w) => w.ref.id));
      const folder = (walk.data?.projects ?? [])
        // Issues have their own shelf; a book already spoke for itself above.
        .filter((c) => c.kind !== "publication" && c.files > 0 && !spoken.has(c.id))
        .map((c): Production => {
          // Same vocabulary the rest of the app counts in: a blocking finding
          // outranks reading, and nothing is done until it is signed off.
          const standing = standingOf(c, stopped.has(c.id));
          return {
            id: c.id,
            title: c.title,
            detail: [
              `${c.files} file${c.files === 1 ? "" : "s"}`,
              `${c.words.toLocaleString()} words`,
              c.blocking > 0 ? `${c.blocking} blocking` : `${c.read} of ${c.files} read`,
            ].join(" · "),
            kind: c.label.toLowerCase(),
            state: standing.state,
            badge: standing,
            open: () => nav.toAudit(c.kind, c.id),
          };
        });
      return [...shelf, ...folder];
    }
    const byId = new Map((walk.data?.projects ?? []).map((c) => [c.id, c]));
    const stopped = new Set((gated.data?.waiting ?? []).map((w) => w.ref.id));
    return (pubs.data?.publications ?? []).map((p) => {
      const standing = p.status === "approved" || p.pdf
        ? { state: "done" as const, label: "signed off", tone: "pill pill-ok" }
        : standingOf(byId.get(p.id), stopped.has(p.id) || /gate|review/.test(p.status));
      return {
        id: p.id,
        title: p.title,
        // The subject is the brief's sentence, not a caption; the cover and
        // the title already say what it is about.
        detail: `${p.written} of ${p.extent} pages written`,
        kind: p.type,
        state: standing.state,
        badge: standing,
        open: () => nav.toPublication(p.id),
      };
    });
  }, [kind, books.data, pubs.data, walk.data, gated.data, nav]);

  const shown = filter === "all" ? items : items.filter((i) => i.state === filter);
  const tiles = useArrivals(shown, (p) => p.id);
  const waiting = items.filter((i) => i.state === "waiting").length;
  const loading = kind === "books" ? (books.loading || walk.loading) : pubs.loading;
  const error = kind === "books" ? books.error : pubs.error;
  const noun = kind === "books" ? "book" : "issue";

  const headline =
    items.length === 0
      ? `No ${noun}s yet`
      : waiting === 0
        ? `${items.length} ${noun}${items.length === 1 ? "" : "s"}, none waiting`
        : `${items.length} ${noun}${items.length === 1 ? "" : "s"}, ${waiting} waiting on you`;

  return (
    <div className="stack-lg">
      <section>
        <div className="spread mb-4.5 items-end">
          <div>
            <h2 className="h-page">{loading ? "Reading the shelf…" : headline}</h2>
          </div>
          <div className="rowflex">
            {(["all", "drafting", "waiting", "done"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="pill"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {error ? <Failed what="That did not work." detail={error} /> : null}

        <div className="tiles">
          {tiles.map(({ item: p, motion }) => (
            <WorkTile
              key={p.id}
              id={p.id}
              title={p.title}
              kind={p.kind}
              detail={p.detail}
              badge={p.badge}
              onOpen={p.open}
              {...(motion ? { className: motion } : {})}
            />
          ))}

          {/* New belongs in the shelf it adds to, not floating over it. */}
          <button type="button" className="tile tile-new" onClick={nav.toNew}>
            <span className="arrow" aria-hidden="true">
              <Icon name="plus" size={18} />
            </span>
            <span className="text-body font-semibold">Start something</span>
            <span className="hint">{kind === "books" ? "a novel, a short, a script or a storyboard" : "a new issue"}</span>
          </button>
        </div>

        {shown.length === 0 && items.length > 0 ? (
          <p className="dim mt-3.5">
            Nothing is {filter} right now.
          </p>
        ) : null}
      </section>
    </div>
  );
}
