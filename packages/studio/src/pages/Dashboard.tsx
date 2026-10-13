/*
 * Home. Mock 02.
 *
 * Answers two questions in order: what needs me, and what is the machine
 * doing. Everything else is below the fold on purpose.
 *
 * It used to be a shelf - a grid of book cards with a per-card menu, a delete
 * dialog and a row of hero metrics above it. The shelf is its own screen now
 * (mock 03), which left Home free to be the thing the rest of the app does not
 * have: one place that says whether anything is waiting on a person.
 */
import { useMemo } from "react";
import { postApi, useApi } from "../hooks/use-api";

/**
 * The workspace roll-up, as `workspaceSummary` in `api/audit.ts` counts it.
 * read is `checked`, signed off is `approved`, open and blocking come from the
 * findings store - the same vocabulary the audit screen reports in.
 */
export interface Creation {
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
  readonly modified: string;
}

interface WorkspaceSummary {
  readonly projects: ReadonlyArray<Creation>;
  readonly kinds: ReadonlyArray<{
    readonly kind: string;
    readonly label: string;
    readonly projects: number;
    readonly files: number;
    readonly words: number;
    readonly read: number;
    readonly signedOff: number;
    readonly open: number;
    readonly blocking: number;
  }>;
  readonly totals: {
    readonly projects: number;
    readonly files: number;
    readonly words: number;
    readonly read: number;
    readonly signedOff: number;
    readonly open: number;
    readonly blocking: number;
  };
  readonly modified: string | null;
}
import type { SSEMessage } from "../hooks/use-sse";
import type { BookSummary } from "../shared/contracts";
import type { ActiveRun, PublicationSummary } from "../hooks/use-shell-data";
import { Icon, type IconName } from "../components/ui/icon";
import { toast } from "../components/ui/vermilion";
import { Ring } from "../components/ui/working";
import { Num } from "../components/ui/num";
import { titleOf } from "../lib/title-of";
import { standingOf } from "../lib/standing";
import { WorkTile } from "../components/ui/work-tile";
import { shimGet, type ComfyStatus, type ShimStatus } from "../lib/shim";
import { useEffect, useState } from "react";


interface Nav {
  readonly toBook: (id: string) => void;
  readonly toBooks: () => void;
  readonly toPublication: (id: string) => void;
  readonly toChapter: (bookId: string, chapterNumber: number) => void;
  readonly toRun: () => void;
  readonly toSetup: () => void;
  readonly toNew: () => void;
  readonly toAudit: (kind?: string, id?: string) => void;
}

/** One thing a person has to decide. The whole point of the screen. */
interface Gate {
  readonly id: string;
  readonly icon: IconName;
  readonly name: string;
  readonly meta: string;
  readonly verb: string;
  readonly action: string;
  readonly open: () => void;
}

function ago(iso: string | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** A short, plain list: "9", "9 and 12", "9, 12 and 27". */
function join(numbers: readonly number[]): string {
  if (numbers.length <= 1) return String(numbers[0] ?? "");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * Everything waiting on a person, in the order it is waiting.
 *
 * This read books and issues and nothing else, so it answered "has a chapter
 * finished" and called that the whole question. A folder holding a short with
 * three blocking findings and sixteen unread files reported "clear", because
 * none of those files is a chapter of a book. Nothing in the work is finished
 * until it is signed off, and the sign-off is a person's - so every creation
 * in the folder is a claim on the person until it is.
 *
 * The three states are ranked, not listed: a blocking finding cannot be signed
 * off around, an unread file cannot be judged, and a read one is only waiting
 * on the decision itself.
 */
/** One production stopped at a gate, as `GET /productions/waiting` reports it. */
export interface PipelineWaiting {
  readonly ref: { readonly type: string; readonly id: string };
  readonly gate: string;
  readonly units: readonly number[];
  readonly stage: string;
}

const GATE_WORDS: Readonly<Record<string, { name: string; verb: string; act: string }>> = {
  content: { name: "is written and read", verb: "sign off the writing", act: "Sign it off" },
  design: { name: "has its pictures", verb: "sign off the design", act: "Sign it off" },
  build: { name: "is laid out", verb: "sign off the build", act: "Sign it off" },
};

export function deriveGates(
  books: readonly BookSummary[],
  publications: readonly PublicationSummary[],
  creations: readonly Creation[] = [],
  waiting: readonly PipelineWaiting[] = [],
): Omit<Gate, "open">[] {
  const gates: Omit<Gate, "open">[] = [];

  /*
   * A gate the pipeline is actually standing at, which outranks everything
   * below it.
   *
   * The rest of this function infers what a person might owe the work by
   * counting files: how many are unread, how many unsigned. That inference was
   * all there was, because no production recorded where it had got to. These
   * rows are not inferred - the run has stopped, and it cannot move until
   * somebody says so.
   */
  /* The run knows the work by its folder; a book or an issue also knows its
     real title, and that is the one a person gave it. */
  const realTitle = (id: string) =>
    books.find((b) => b.id === id)?.title ?? publications.find((p) => p.id === id)?.title ?? titleOf(id);
  for (const w of waiting) {
    const words = GATE_WORDS[w.gate] ?? { name: `is at the ${w.gate} gate`, verb: w.gate, act: "Open" };
    gates.push({
      id: `pipeline:${w.ref.type}/${w.ref.id}`,
      // A pen, not a tick: the tick reads as "done", and this is still owed.
      icon: "pencil",
      name: `${realTitle(w.ref.id)} ${words.name}`,
      // The stage repeats the gate ("gate:design") the name already says.
      meta: [w.ref.type, `${w.units.length} unit${w.units.length === 1 ? "" : "s"} pending`]
        .join(" · "),
      verb: words.verb,
      action: words.act,
    });
  }

  for (const b of books) {
    if (b.pendingReview > 0) {
      const many = b.pendingReview > 1;
      gates.push({
        id: `book:${b.id}`,
        icon: "book",
        name: many
          ? `${b.pendingReview} chapters need a read`
          : `Chapter ${b.pendingReviewChapters[0]} needs a read`,
        meta: [b.title, many ? `chapters ${join(b.pendingReviewChapters)}` : null, ago(b.updatedAt)]
          .filter(Boolean)
          .join(" · "),
        verb: "needs a read",
        action: many ? "Read them" : "Read it",
      });
    }
    // A stopped chapter is not waiting on a decision, but it is waiting on a
    // person, and nothing else in the app would ever mention it.
    if (b.failedChapters > 0) {
      gates.push({
        id: `book-failed:${b.id}`,
        icon: "alert",
        name: `${b.failedChapters} chapter${b.failedChapters === 1 ? "" : "s"} stopped`,
        meta: `${b.title} · audit failed, rejected or out of sync`,
        verb: "stopped",
        action: "Look",
      });
    }
  }

  for (const p of publications) {
    if (/gate|review|approval/i.test(p.status)) {
      gates.push({
        id: `pub:${p.id}`,
        icon: "magazine",
        name: `${p.title} is at a gate`,
        meta: `${p.written} of ${p.extent} pages · ${p.status}`,
        verb: "judge it",
        action: "Open",
      });
    }
  }

  /* A book or an issue that already raised a gate above has said its piece;
     the folder walk would only say it again in a second vocabulary. */
  const spoken = new Set(gates.map((g) => g.id.split(":")[1]));
  for (const w of waiting) spoken.add(w.ref.id);
  const blocked: Omit<Gate, "open">[] = [];
  const unread: Omit<Gate, "open">[] = [];
  const unsigned: Omit<Gate, "open">[] = [];

  for (const c of creations) {
    if (c.files === 0 || spoken.has(c.id)) continue;
    const id = `work:${c.kind}/${c.id}`;
    const form = c.label.toLowerCase();

    if (c.blocking > 0) {
      blocked.push({
        id,
        icon: "alert",
        name: `${c.blocking} finding${c.blocking === 1 ? "" : "s"} block${c.blocking === 1 ? "s" : ""} ${c.title}`,
        meta: [form, `${c.open} open`, `${c.read} of ${c.files} read`].join(" · "),
        verb: "blocked",
        action: "Open the audit",
      });
      continue;
    }

    const left = c.files - c.read;
    if (left > 0) {
      unread.push({
        id,
        icon: "eye",
        name: `${left} file${left === 1 ? "" : "s"} need${left === 1 ? "s" : ""} a read`,
        meta: [c.title, form, c.open > 0 ? `${c.open} open` : null]
          .filter(Boolean)
          .join(" · "),
        verb: "needs a read",
        action: left === 1 ? "Read it" : "Read them",
      });
      continue;
    }

    // Read through and nothing holding it: the only thing left is the
    // signature, which is the one part of the work that is never automatic.
    if (c.signedOff < c.files) {
      unsigned.push({
        id,
        icon: "pencil",
        name: `${c.title} is ready to sign off`,
        meta: [form, `${c.files} file${c.files === 1 ? "" : "s"} read`].join(" · "),
        verb: "sign off",
        action: "Sign it off",
      });
    }
  }

  return [...gates, ...blocked, ...unread, ...unsigned];
}

export function Dashboard({
  nav,
  sse,
  books,
  publications,
  run,
}: {
  readonly nav: Nav;
  readonly sse: { readonly messages: readonly SSEMessage[] };
  readonly books: readonly BookSummary[];
  readonly publications: readonly PublicationSummary[];
  readonly run: ActiveRun | null;
}) {
  const { data: daemon } = useApi<{ running: boolean }>("/daemon");
  const [machine, setMachine] = useState<{
    shim: ShimStatus | null;
    comfy: ComfyStatus | null;
    affinity: { running?: boolean } | null;
    /* The shim probes every agent before it answers, which takes seconds; a
       null before that is "not asked yet", not "unreachable". */
    checked: boolean;
  }>({ shim: null, comfy: null, affinity: null, checked: false });

  /* The machine panel is the shim's business, not Studio's, so it is three
     cross-origin calls rather than three more Studio routes proxying them. */
  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      shimGet<ShimStatus>("/status"),
      shimGet<ComfyStatus>("/comfy/status"),
      shimGet<{ running?: boolean }>("/affinity/status"),
    ]).then(([s, c, a]) => {
      if (!alive) return;
      setMachine({
        shim: s.status === "fulfilled" ? s.value : null,
        comfy: c.status === "fulfilled" ? c.value : null,
        affinity: a.status === "fulfilled" ? a.value : null,
        checked: true,
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  // A clock only while something is on it.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [run]);

  /**
   * The month, as a sentence — counted in creations, not in files.
   *
   * These counted chapters of books, so a folder holding a short, a storyboard
   * and an issue opened on 00 / 00 / 00. Counting files instead fixed that and
   * introduced a worse problem: "42 written" is a true number in a unit nobody
   * works in. A person has three pieces of work, not forty-two files.
   *
   * So all three count creations: approved when every file in it is signed
   * off, in flight while any is not, and touched in the last thirty days for
   * the third. Counting files there read "42 this month" over three pieces of
   * work nobody had started that month — a true number, in a unit the label
   * does not use, next to two numerals that do.
   */
  const { data: workspace } = useApi<WorkspaceSummary>("/workspace/summary");
  /* Every run that has stopped and cannot start itself again. Until now this
     question had an answer on the server and no reader anywhere. */
  const { data: waitingData } = useApi<{ waiting: PipelineWaiting[] }>("/productions/waiting");
  const creations = workspace?.projects ?? [];
  const approved = workspace
    ? creations.filter((p) => p.files > 0 && p.signedOff === p.files).length
    : books.filter((b) => b.status === "completed").length;
  const inFlight = workspace
    ? creations.filter((p) => p.files > 0 && p.signedOff < p.files).length
    : Math.max(0, books.length - approved);
  const thisMonth = useMemo(() => {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return creations.filter((p) => new Date(p.modified).getTime() >= since).length;
  }, [creations]);

  /* A folder name is the only name the walk has, and it is the name a
     generator wrote, not the one on the cover: "The Kolam Drawn At Dawn On
     South Indian Doorsteps The Mathem" is a slug read back as prose. Where the
     app already knows the real title, it wins. */
  const named = useMemo(() => {
    const real = new Map<string, string>();
    for (const b of books) real.set(b.id, b.title);
    for (const p of publications) real.set(p.id, p.title);
    return creations.map((c) => {
      const title = real.get(c.id);
      return title ? { ...c, title } : c;
    });
  }, [creations, books, publications]);

  const newest = useMemo(() => {
    const sorted = [...books].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return sorted[0] ?? null;
  }, [books]);

  const gates = useMemo(() => {
    return deriveGates(books, publications, named, waitingData?.waiting ?? []).map((g) => {
      const bookId = g.id.startsWith("book") ? g.id.split(":")[1] : null;
      const pubId = g.id.startsWith("pub:") ? g.id.slice(4) : null;
      const book = bookId ? books.find((b) => b.id === bookId) : undefined;
      const chapter = book?.pendingReviewChapters[0];
      return {
        ...g,
        open: () => {
          if (pubId) nav.toPublication(pubId);
          else if (book && g.id.startsWith("book:") && chapter !== undefined) {
            nav.toChapter(book.id, chapter);
          } else if (book) nav.toAudit("book", book.id);
          // Reading, findings and the signature all live on one screen; the
          // gate names the work, so the screen opens on it.
          else {
            const ref = /^(?:pipeline|work):([^/]+)\/(.+)$/.exec(g.id);
            if (ref?.[1] === "publication") nav.toPublication(ref[2]!);
            else nav.toAudit(ref?.[1], ref?.[2]);
          }
        },
      };
    });
  }, [books, publications, named, waitingData, nav]);

  /* The last line the run produced. A stage dot says where it is; this says it
     is genuinely alive, which a dot cannot. */
  const lastLine = useMemo(() => {
    for (let i = sse.messages.length - 1; i >= 0; i -= 1) {
      const m = sse.messages[i];
      if (m.event === "ping" || m.event === "log") continue;
      const d = (m.data ?? {}) as Record<string, unknown>;
      const text = ["message", "text", "title"].map((k) => d[k]).find((v) => typeof v === "string");
      if (typeof text === "string" && text.trim()) return { tag: m.event.replace(/:/g, " · "), text };
    }
    return null;
  }, [sse.messages]);

  const recent = useMemo(() => {
    const fromBooks = books.map((b) => ({
      id: b.id,
      title: b.title,
      kind: "book",
      when: new Date(b.updatedAt).getTime(),
      badge:
        b.pendingReview > 0
          ? { label: "needs a read", tone: "pill pill-warn" }
          : b.status === "completed"
            ? { label: "signed off", tone: "pill pill-ok" }
            : { label: "drafting", tone: "pill" },
      detail: `${b.chaptersWritten} of ${b.targetChapters} chapters · ${b.genre}`,
      open: () => nav.toAudit("book", b.id),
    }));
    /* An issue had no timestamp at all and sorted to the bottom of the row
       for ever, however recently it was worked on. The folder walk knows when
       its files last changed, which is the same question. */
    const touched = new Map(creations.map((p) => [p.id, p.modified]));
    const byId = new Map(creations.map((p) => [p.id, p]));
    const stopped = new Set((waitingData?.waiting ?? []).map((w) => w.ref.id));
    const fromPubs = publications.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.type,
      when: new Date(touched.get(p.id) ?? 0).getTime(),
      // The run's own word ("designed") said where the pipeline was, not what
      // the work wants from you; the shelf and the gates use this one.
      badge: p.pdf || p.status === "approved"
        ? { label: "signed off", tone: "pill pill-ok" }
        : standingOf(byId.get(p.id), stopped.has(p.id)),
      detail: `${p.written} of ${p.extent} pages written`,
      open: () => nav.toPublication(p.id),
    }));
    /* Everything else that was written in this folder. A short, a storyboard,
       a script and a translation each have a silhouette drawn for them and had
       no tile to wear it on, because only these two lists were ever read; a
       workspace of shorts showed one card saying "Start something". Books and
       issues keep their own rows — they carry a real title and progress in
       chapters and pages, which a folder walk cannot know. */
    const known = new Set([...fromBooks, ...fromPubs].map((r) => r.id));
    const fromFolder = creations
      .filter((p) => !known.has(p.id) && p.files > 0)
      .map((p) => ({
        id: p.id,
        title: p.title,
        kind: p.label.toLowerCase(),
        when: new Date(p.modified).getTime(),
        badge: standingOf(p, stopped.has(p.id)),
        detail: `${p.read} of ${p.files} read`,
        open: () => nav.toAudit(p.kind, p.id),
      }));
    return [...fromBooks, ...fromPubs, ...fromFolder]
      .sort((a, b) => b.when - a.when)
      .slice(0, 4);
  }, [books, publications, creations, waitingData, nav]);

  const nothingYet = recent.length === 0;

  return (
    <div className="stack-lg">
      {/* ── The work so far, as a sentence ──────────────────────────────
          Three numerals on one line, labels inline underneath. A number is
          bright when it counts something and ghosted at zero; no leading
          zeros, which read as a clock. Not three
          stat cards: the relationship between the numbers is the
          information, and cards would break it into three facts. */}
      <section className="crop px-0 pt-1.5 pb-1">
        <div className="spread items-end relative">
          <div className="rowflex gap-6.5 items-end">
            <div>
              <div className={approved ? "numeral numeral-ok text-d3" : "numeral ghost text-d3"}><Num value={approved} /></div>
              <div className="label mt-2.5">approved</div>
            </div>
            <div>
              <div className={inFlight ? "numeral numeral-ink text-d3" : "numeral ghost text-d3"}><Num value={inFlight} /></div>
              <div className="label mt-2.5">in flight</div>
            </div>
            <div>
              <div className={thisMonth ? "numeral numeral-ink text-d3" : "numeral ghost text-d3"}><Num value={thisMonth} /></div>
              <div className="label mt-2.5">this month</div>
            </div>
          </div>
          {newest ? (
            <div className="rowflex">
              <div className="text-right">
                <div className="text-body font-medium">{newest.title}</div>
                <div className="dim text-cap">
                  last touched {ago(newest.updatedAt)}
                </div>
              </div>
              <button
                type="button"
                className="arrow"
                aria-label={`Open ${newest.title}`}
                onClick={() => nav.toBook(newest.id)}
              >
                <Icon name="arrR" size={18} />
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Waiting on you ──────────────────────────────────────────────
          The most important element in the app. Every open gate as a row,
          named in the product's own words, action one click away. */}
      <section>
        <div className="panel panel-flush crop">
          <div className="panel-head">
            <h3 className="h-panel grow">Waiting on you</h3>
            {gates.length ? (
              <span className="pill pill-warn">
                {gates.length} gate{gates.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="pill pill-ok">clear</span>
            )}
          </div>
          <div className="panel-body pt-1 pb-2">
            {gates.length === 0 ? (
              <p className="hint">
                {nothingYet
                  ? "Nothing here yet. Start something and this fills with the decisions only you can make."
                  : "Nothing is waiting on a decision. When a chapter finishes or a page is laid out, it appears here."}
              </p>
            ) : (
              <div className="rows">
                {gates.map((g) => (
                  <button key={g.id} type="button" className="row" onClick={g.open}>
                    <span className="glyph">
                      <Icon name={g.icon} size={15} />
                    </span>
                    <span className="grow">
                      <span className="name">{g.name}</span>
                      <span className="meta">{g.meta}</span>
                    </span>
                    {/* One label: the row is the button. A pill naming the state
                        beside a button naming the act said the same thing twice. */}
                    <span className={g.verb === "blocked" ? "pill pill-bad" : "pill pill-warn"} title={g.action}>{g.verb}</span>
                    <Icon name="chevR" size={16} className="dim" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── The live run, and the machine under it ───────────────────── */}
      {/* items-start: stretched to the height of the column beside it, an idle
          run card was half a screen of empty charcoal. */}
      <section className="cols cols-a items-start">
        <div className="dark crop py-5 px-5.5">
          <div className="spread items-start relative">
            <div>
              <div className="label">{run ? "Running now" : "Idle"}</div>
              <h3 className="text-lead mt-2">
                {run ? run.what : "Nothing is running"}
              </h3>
              <p className="muted text-body mt-1">
                {run
                  ? [run.where, `started ${ago(new Date(run.startedAt).toISOString())}`]
                      .filter(Boolean)
                      .join(" · ")
                  : daemon?.running
                    ? "The daemon is on and waiting for work."
                    : "The daemon is off. Start a chapter, an audit or an issue build."}
              </p>
            </div>
            {run ? (
              <Ring />
            ) : null}
          </div>

          {run && lastLine ? (
            <div className="msg relative mt-4.5">
              <span className="who-av model">Q</span>
              <div className="body">
                <div className="tag">{lastLine.tag}</div>
                <p className="text-body leading-normal">
                  {lastLine.text}
                  <span className="caret" />
                </p>
              </div>
            </div>
          ) : null}

          <div className="rowflex mt-4 relative">
            <button type="button" className="btn btn-sm" onClick={nav.toRun}>
              {run ? "Watch it" : "Open the run view"} <Icon name="arrR" size={14} className="ico" />
            </button>
          </div>
        </div>

        <div className="stack">
          {/* What is in the folder, kind by kind.
              The folder can be pointed anywhere, so "which folder" and "what
              is in it" are different questions and the second one belongs
              here, beside the run and the machine, not buried in Setup. */}
          {workspace && workspace.totals.files > 0 ? (
            <div className="panel crop" role="link" tabIndex={0} onClick={nav.toBooks}
                 onKeyDown={(e) => { if (e.key === "Enter") nav.toBooks(); }}>
              <div className="spread">
                <h3 className="h-panel">In this folder</h3>
                <span className="dim text-cap">
                  {creations.length} {creations.length === 1 ? "creation" : "creations"}
                  {" · "}{workspace.totals.words.toLocaleString()} words
                </span>
              </div>

              <div className="rowflex mt-2.5">
                <span className="pill">
                  {workspace.totals.read} of {workspace.totals.files} read
                </span>
                <span className={workspace.totals.signedOff > 0 ? "pill pill-ok" : "pill"}>
                  {workspace.totals.signedOff} signed off
                </span>
                {workspace.totals.open > 0 ? (
                  <span className="pill pill-warn">{workspace.totals.open} open</span>
                ) : null}
                {/* Blocking is the one count that stops a sign-off rather than
                    describing one, so it is the one that gets the loud pill. */}
                {workspace.totals.blocking > 0 ? (
                  <span className="pill pill-bad">{workspace.totals.blocking} blocking</span>
                ) : null}
              </div>

              <div className="mt-3">
                {workspace.kinds.filter((k) => k.files > 0).map((k) => (
                  <div key={k.kind} className="spread py-1 px-0 text-small">
                    <span>
                      {k.label}
                      <span className="dim ml-2">
                        {k.projects} {k.projects === 1 ? "creation" : "creations"}
                        {" · "}{k.files} {k.files === 1 ? "file" : "files"}
                      </span>
                    </span>
                    <span className="dim text-cap tnum">
                      {k.read} of {k.files} read
                      {k.open > 0 ? ` · ${k.open} open` : ""}
                      {k.blocking > 0 ? ` · ${k.blocking} blocking` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="panel crop" role="link" tabIndex={0} onClick={nav.toSetup}
               onKeyDown={(e) => { if (e.key === "Enter") nav.toSetup(); }}>
            <h3 className="h-panel">The machine</h3>
            <div className="rowflex mt-2.5">
              {!machine.checked ? (
                <span className="pill">Checking the machine…</span>
              ) : (
              <>
              <span className={machine.shim ? "pill pill-ok" : "pill pill-bad"}>
                {machine.shim
                  ? `${machine.shim.agents.length} model connection${machine.shim.agents.length === 1 ? "" : "s"}`
                  : "Models unreachable"}
              </span>
              {/* Stopped and closed are resting states, not faults: each is
                  only needed while pictures or a layout are being made. */}
              <span className={machine.comfy?.up ? "pill pill-ok" : machine.comfy?.installed ? "pill" : "pill pill-warn"}>
                {machine.comfy?.up ? "ComfyUI up" : machine.comfy?.installed ? "ComfyUI resting" : "ComfyUI not installed"}
              </span>
              <span className={machine.affinity?.running ? "pill pill-ok" : "pill"}>
                {machine.affinity?.running ? "Affinity open" : "Affinity closed"}
              </span>
              </>
              )}
              <span className={daemon?.running ? "pill pill-ok" : "pill"}>
                {daemon?.running ? "daemon on" : "daemon off"}
              </span>
            </div>
            <p className="hint mt-2.5">
              Affinity only has to be open when an issue is being built.
            </p>
          </div>

          {books.some((b) => b.status === "active") ? (
            <div className="panel">
              <h3 className="h-panel">Next in the queue</h3>
              <div className="rows mt-2">
                {books
                  .filter((b) => b.status === "active")
                  .slice(0, 3)
                  .map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className="row py-2.5"
                      onClick={() => void writeNext(b, nav)}
                    >
                      <span className="num tnum">{b.chaptersWritten + 1}</span>
                      <span className="grow">
                        <span className="name">Draft chapter {b.chaptersWritten + 1}</span>
                        <span className="meta">{b.title}</span>
                      </span>
                      <Icon name="clock" size={15} className="dim" />
                    </button>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Recent ──────────────────────────────────────────────────────
          Least urgent, so it is last. The silhouette means the row is
          scannable before a title is read. */}
      <section>
        <div className="spread mb-3.5">
          <h3 className="h-panel">Back to work</h3>
          <button type="button" className="link" onClick={nav.toBooks}>
            All productions →
          </button>
        </div>
        <div className="tiles">
          {recent.map((r) => (
            <WorkTile key={r.id} id={r.id} title={r.title} kind={r.kind} detail={r.detail} badge={r.badge} onOpen={r.open} />
          ))}
          <button type="button" className="tile tile-new" onClick={nav.toNew}>
            <span className="arrow" aria-hidden="true">
              <Icon name="plus" size={18} />
            </span>
            <span className="text-body font-semibold">Start something</span>
            <span className="hint">a novel, an issue, a short, a script</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/** Queue the next chapter. The row is a button because it does something. */
async function writeNext(book: BookSummary, nav: Nav) {
  try {
    await postApi(`/books/${encodeURIComponent(book.id)}/write-next`);
    toast(`Drafting chapter ${book.chaptersWritten + 1} of ${book.title}.`);
    nav.toRun();
  } catch (e) {
    toast(e instanceof Error ? e.message : "Could not start that chapter.");
  }
}
