/*
 * The Library: a bookshelf.
 *
 * Everything made, grouped by kind. A work that has been through every stage
 * stands on the shelf with its cover; one that has not shows where it has got
 * to instead - its stages, what is running, how much is read and signed - and
 * opens in Audit, where the work is done.
 *
 * Opening a finished work will show the finished thing. That reader is not
 * built yet, so for now a finished work opens in Audit too.
 */
import { useEffect, useMemo, useState } from "react";
import { buildApiUrl, fetchJson, useApi } from "../hooks/use-api";
import { useLiveRuns } from "../hooks/use-live-runs";
import type { SSEMessage } from "../hooks/use-sse";
import type { BookSummary } from "../shared/contracts";
import type { PublicationSummary } from "../hooks/use-shell-data";
import { Icon } from "../components/ui/icon";
import { Failed } from "../components/ui/states";
import { Orb, orbForStage } from "../components/ui/working";
import { StageDots, stageLabel, type LiveRun } from "../components/stage-rail";
import type { Workflow } from "../components/workflow";
import { vtName } from "../lib/view-transition";

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

/** A work on the shelf, before its stages are known. */
interface Shelved {
  readonly kind: string;
  /** The group it stands in: "Magazines", "Books", "Shorts". */
  readonly group: string;
  /** What is written on its cover: "magazine", "book", "short". */
  readonly coverWord: string;
  readonly id: string;
  readonly title: string;
  /** Sizes, said the way the kind counts itself. */
  readonly size: string;
  readonly tally: FolderCreation | null;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function ProductionsPage({
  kind,
  nav,
  sse,
}: {
  /** Narrows the shelf to one kind ("book", "publication", "short"…); all when absent. */
  readonly kind?: string;
  readonly nav: {
    readonly toAudit: (kind?: string, id?: string) => void;
    readonly toLibrary: (kind?: string) => void;
    readonly toNew: () => void;
  };
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage> };
}) {
  const books = useApi<{ books: readonly BookSummary[] }>("/books");
  const pubs = useApi<{ publications: readonly PublicationSummary[] }>("/publications");
  /* The folder walk: the only place a short, storyboard, script or film is
     listed, and where every kind's read and signed counts come from. */
  const walk = useApi<{ projects: readonly FolderCreation[] }>("/workspace/summary");
  const { runs } = useLiveRuns(sse.messages);

  const all = useMemo<Shelved[]>(() => {
    const byKey = new Map((walk.data?.projects ?? []).map((c) => [`${c.kind}/${c.id}`, c]));
    const shelf: Shelved[] = (books.data?.books ?? []).map((b) => ({
      kind: "book", group: "Books", coverWord: "book", id: b.id, title: b.title,
      size: `${plural(b.chaptersWritten, "chapter")} · ${b.totalWords.toLocaleString()} words`,
      tally: byKey.get(`book/${b.id}`) ?? null,
    }));
    const issues: Shelved[] = (pubs.data?.publications ?? []).map((p) => ({
      kind: "publication", group: "Magazines", coverWord: p.type || "magazine", id: p.id,
      /* An issue has no title until its plan names it. */
      title: p.title || p.subject || p.id,
      size: p.extent > 0 ? `${p.written} of ${plural(p.extent, "page")} written` : "planning",
      tally: byKey.get(`publication/${p.id}`) ?? null,
    }));
    const spoken = new Set([...shelf, ...issues].map((w) => `${w.kind}/${w.id}`));
    const folder: Shelved[] = (walk.data?.projects ?? [])
      .filter((c) => c.files > 0 && !spoken.has(`${c.kind}/${c.id}`) && c.kind !== "publication" && c.kind !== "book")
      .map((c) => ({
        kind: c.kind, group: `${c.label}s`, coverWord: c.label.toLowerCase(), id: c.id, title: c.title,
        size: `${plural(c.files, "file")} · ${c.words.toLocaleString()} words`,
        tally: c,
      }));
    return [...shelf, ...issues, ...folder];
  }, [books.data, pubs.data, walk.data]);

  const groups = useMemo(() => {
    const out = new Map<string, { label: string; works: Shelved[] }>();
    for (const w of all) {
      if (kind && w.kind !== kind) continue;
      const g = out.get(w.kind) ?? { label: w.group, works: [] };
      g.works.push(w);
      out.set(w.kind, g);
    }
    return [...out.entries()].map(([k, g]) => ({ kind: k, ...g }));
  }, [all, kind]);

  const loading = books.loading || pubs.loading || walk.loading;
  const error = books.error ?? pubs.error ?? walk.error;
  const shown = groups.reduce((n, g) => n + g.works.length, 0);
  const working = runs.filter((r) => all.some((w) => w.kind === r.kind && w.id === r.id)).length;

  return (
    <div className="stack-lg">
      <section className="spread items-end">
        <div>
          <h2 className="h-page">Library</h2>
          <p className="dim text-body mt-1">
            {loading && all.length === 0
              ? "Reading the shelf…"
              : all.length === 0
                ? "Nothing made yet."
                : `${plural(shown, "work")}${working ? ` · ${working} being worked on now` : ""}`}
          </p>
        </div>
        <div className="rowflex gap-2">
          {kind ? (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => nav.toLibrary()}>
              Show every kind
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={nav.toNew}>
            <Icon name="plus" size={14} />Start something
          </button>
        </div>
      </section>

      {error ? <Failed what="That did not work." detail={error} /> : null}

      {groups.map((g) => (
        <section key={g.kind} className="shelf" aria-label={g.label}>
          <h3 className="shelf-head">
            <span>{g.label}</span>
            <span className="dim tnum">{g.works.length}</span>
          </h3>
          <div className="shelf-row">
            {g.works.map((w) => (
              <ShelfWork
                key={`${w.kind}/${w.id}`}
                work={w}
                live={runs.find((r) => r.kind === w.kind && r.id === w.id) ?? null}
                onOpen={() => nav.toAudit(w.kind, w.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {!loading && all.length === 0 ? (
        <button type="button" className="tile tile-new" onClick={nav.toNew}>
          <span className="arrow" aria-hidden="true"><Icon name="plus" size={18} /></span>
          <span className="text-body font-semibold">Start something</span>
          <span className="hint">a magazine, a novel, a short, a script or a storyboard</span>
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- one work */

interface Picture { readonly path: string; readonly approved: string | null }

const fileUrl = (path: string) =>
  buildApiUrl(`/project/files/${path.split("/").map(encodeURIComponent).join("/")}`) ?? undefined;

/**
 * One work standing on the shelf. Finished: its cover. Not yet: where it is.
 */
function ShelfWork({ work, live, onOpen }: {
  readonly work: Shelved;
  readonly live: LiveRun | null;
  readonly onOpen: () => void;
}) {
  /* Where it stands, asked of the one route every screen asks. The live run,
     when there is one, is fresher: it is polled while it runs. */
  const status = useApi<{ workflow: Workflow | null }>(
    `/work/${encodeURIComponent(work.kind)}/${encodeURIComponent(work.id)}`,
  );
  const workflow = live?.workflow ?? status.data?.workflow ?? null;
  const stages = workflow?.stages ?? [];
  const doneStages = stages.filter((s) => s.state === "done").length;
  /* End to end: every stage done, and nothing running. Without stages to go
     by, signed off throughout is the nearest thing to finished. */
  const t = work.tally;
  const finished = !live && (stages.length > 0
    ? doneStages === stages.length
    : !!t && t.files > 0 && t.signedOff === t.files);

  /* A cover is a picture the work already has - a chosen one first. */
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    if (!finished) return;
    let alive = true;
    fetchJson<{ assets: ReadonlyArray<Picture> }>(
      `/assets?type=${encodeURIComponent(work.kind)}&id=${encodeURIComponent(work.id)}`,
    )
      .then((d) => {
        const pick = d.assets.find((a) => a.approved) ?? d.assets[0];
        if (alive) setCover(pick ? fileUrl(pick.path) ?? null : null);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [finished, work.kind, work.id]);

  const now = stages.find((s) => s.state === "running") ?? null;
  const failed = stages.find((s) => s.state === "failed") ?? null;
  const next = stages.find((s) => s.state !== "done") ?? null;

  return (
    <button
      type="button"
      className={`book${finished ? " is-finished" : " is-working"}${live ? " is-live" : ""}`}
      onClick={onOpen}
      title={finished ? "Finished. Opens in Audit until the finished reader is built." : "Opens in Audit"}
    >
      {finished ? (
        <span className="book-cover" data-kind={work.coverWord} aria-hidden="true">
          {cover ? <img src={cover} alt="" loading="lazy" /> : (
            <>
              <span className="cover-kind">{work.coverWord}</span>
              <span className="cover-letter">{work.title.trim().replace(/^(the|an?)\s+/i, "").charAt(0)}</span>
            </>
          )}
        </span>
      ) : (
        /* Not a cover: where it has got to. */
        <span className="book-status">
          <span className="book-status-kind">{work.coverWord}</span>
          {stages.length > 0 ? (
            <>
              <span className="book-now">
                {now ? <Orb state={orbForStage(now.stage)} />
                  : failed ? <Icon name="alert" size={13} />
                    : <Icon name="clock" size={13} />}
                <span className="min-w-0">
                  <b>{now ? stageLabel(now.stage) : failed ? `${stageLabel(failed.stage)} stopped` : next ? `Next: ${stageLabel(next.stage)}` : "Ready"}</b>
                  <span className="book-now-detail">{(now ?? failed ?? next)?.detail ?? ""}</span>
                </span>
              </span>
              {now?.count && now.count.total > 0 ? (
                <span className="book-bar" aria-hidden="true">
                  <i style={{ transform: `scaleX(${Math.min(1, now.count.done / now.count.total)})` }} />
                </span>
              ) : null}
              <span className="book-stages">
                <StageDots stages={stages} />
                <span className="tnum">{doneStages} of {stages.length} stages</span>
              </span>
            </>
          ) : (
            <span className="book-now"><Icon name="clock" size={13} /><b>{status.loading ? "Looking…" : "In progress"}</b></span>
          )}
          {t && t.files > 0 ? (
            <span className="book-counts">
              <span><b className="tnum">{t.read}/{t.files}</b> read</span>
              <span><b className="tnum">{t.signedOff}/{t.files}</b> signed</span>
              {t.open > 0 ? <span className={t.blocking ? "is-bad" : "is-warn"}><b className="tnum">{t.open}</b> open</span> : null}
            </span>
          ) : null}
        </span>
      )}
      <span className="book-foot">
        <h4 style={vtName(work.id)}>{work.title}</h4>
        <span className="book-size">{work.size}</span>
        {finished ? <span className="pill pill-ok">finished</span> : live ? <span className="pill pill-live">working now</span> : null}
      </span>
    </button>
  );
}
