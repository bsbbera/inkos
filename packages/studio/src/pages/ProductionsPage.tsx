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
import { useMemo, useState } from "react";
import { useApi } from "../hooks/use-api";
import type { BookSummary } from "../shared/contracts";
import type { PublicationSummary } from "../hooks/use-shell-data";
import { Icon } from "../components/ui/icon";

type Filter = "all" | "drafting" | "waiting" | "done";

/** What the tile is, reduced to the four states a shelf is scanned for. */
interface Production {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly mark: string;
  readonly state: Exclude<Filter, "all">;
  readonly badge: { readonly label: string; readonly tone: string };
  readonly open: () => void;
}

/* The publication definition id decides the silhouette. An unknown type gets
   the magazine halftone rather than no mark at all: a tile with no identity
   is worse than one with an approximate one. */
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

const MARKS: Readonly<Record<string, string>> = {
  magazine: "mark-mag",
  // Keyed by production kind as well as publication type, because the folder
  // walk reports the kind ids from PRODUCTIONS, not the magazine's own types.
  book: "mark-book",
  "interactive-film": "mark-film",
  play: "mark-world",
  translation: "mark-script",
  publication: "mark-mag",
  storybook: "mark-story",
  storyboard: "mark-storyboard",
  short: "mark-short",
  script: "mark-script",
  film: "mark-film",
  world: "mark-world",
};

function bookState(b: BookSummary): Production["state"] {
  // The gate first: a book with a chapter waiting is waiting, whatever its
  // configured status says. `targetChapters` defaults to 200 and is a wish,
  // not a fact, so it decides nothing here - the book's own status does.
  if (b.pendingReview > 0) return "waiting";
  if (b.status === "completed") return "done";
  return "drafting";
}

function badgeFor(state: Production["state"], written: string): Production["badge"] {
  if (state === "waiting") return { label: "needs a read", tone: "pill pill-warn" };
  if (state === "done") return { label: "approved", tone: "pill pill-ok" };
  return { label: written, tone: "pill pill-fill" };
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
    readonly toAudit: () => void;
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
  const walk = useApi<{ projects: readonly FolderCreation[] }>(
    kind === "books" ? "/workspace/summary" : "",
  );

  const items = useMemo<Production[]>(() => {
    if (kind === "books") {
      const shelf = (books.data?.books ?? []).map((b) => {
        const state = bookState(b);
        return {
          id: b.id,
          title: b.title,
          detail: `${b.chaptersWritten} of ${b.targetChapters} chapters · ${b.totalWords.toLocaleString()} words`,
          mark: "mark-book",
          state,
          badge: badgeFor(state, b.status || "drafting"),
          open: () => nav.toBook(b.id),
        };
      });
      const spoken = new Set(shelf.map((row) => row.id));
      const folder = (walk.data?.projects ?? [])
        // Issues have their own shelf; a book already spoke for itself above.
        .filter((c) => c.kind !== "publication" && c.files > 0 && !spoken.has(c.id))
        .map((c): Production => {
          // Same vocabulary the rest of the app counts in: a blocking finding
          // outranks reading, and nothing is done until it is signed off.
          const state: Production["state"] =
            c.signedOff >= c.files ? "done"
            : c.blocking > 0 || c.read >= c.files ? "waiting"
            : "drafting";
          return {
            id: c.id,
            title: c.title,
            detail: [
              `${c.files} file${c.files === 1 ? "" : "s"}`,
              `${c.words.toLocaleString()} words`,
              c.blocking > 0 ? `${c.blocking} blocking` : `${c.read} of ${c.files} read`,
            ].join(" · "),
            mark: MARKS[c.kind] ?? "mark-short",
            state,
            badge: badgeFor(state, c.label.toLowerCase()),
            open: () => nav.toAudit(),
          };
        });
      return [...shelf, ...folder];
    }
    return (pubs.data?.publications ?? []).map((p) => {
      const state: Production["state"] =
        p.status === "approved" || p.pdf ? "done"
        : p.status.includes("gate") || p.status.includes("review") ? "waiting"
        : "drafting";
      return {
        id: p.id,
        title: p.title,
        detail: `${p.written} of ${p.extent} pages · ${p.subject}`,
        mark: MARKS[p.type] ?? "mark-mag",
        state,
        badge: badgeFor(state, p.status || "drafting"),
        open: () => nav.toPublication(p.id),
      };
    });
  }, [kind, books.data, pubs.data, walk.data, nav]);

  const shown = filter === "all" ? items : items.filter((i) => i.state === filter);
  const waiting = items.filter((i) => i.state === "waiting").length;
  const loading = kind === "books" ? (books.loading || walk.loading) : pubs.loading;
  const error = kind === "books" ? books.error : pubs.error;
  const noun = kind === "books" ? "production" : "issue";

  const headline =
    items.length === 0
      ? `No ${noun}s yet`
      : waiting === 0
        ? `${items.length} ${noun}${items.length === 1 ? "" : "s"}, none waiting`
        : `${items.length} ${noun}${items.length === 1 ? "" : "s"}, ${waiting} want${waiting === 1 ? "s" : ""} a read`;

  return (
    <div className="stack-lg">
      <section>
        <div className="spread" style={{ marginBottom: 18, alignItems: "flex-end" }}>
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

        {error ? <div className="fail">{error}</div> : null}

        <div className="tiles">
          {shown.map((p) => (
            <button key={p.id} type="button" className="tile crop" onClick={p.open}>
              <span className={`mark ${p.mark}`}>
                <span className="d1" />
                <span className="d2" />
              </span>
              <span className="top">
                <span className={p.badge.tone}>{p.badge.label}</span>
              </span>
              <h4>{p.title}</h4>
              <span className="who">{p.detail}</span>
            </button>
          ))}

          {/* New belongs in the shelf it adds to, not floating over it. */}
          <button type="button" className="tile tile-new" onClick={nav.toNew}>
            <span className="arrow" aria-hidden="true">
              <Icon name="plus" size={18} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Start something</span>
            <span className="hint">book · storybook · short · script</span>
          </button>
        </div>

        {shown.length === 0 && items.length > 0 ? (
          <p className="dim" style={{ marginTop: 14 }}>
            Nothing is {filter} right now.
          </p>
        ) : null}
      </section>
    </div>
  );
}
