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
import { shimGet, type ComfyStatus, type ShimStatus } from "../lib/shim";
import { useEffect, useState } from "react";

const RING = 2 * Math.PI * 19;

interface Nav {
  readonly toBook: (id: string) => void;
  readonly toBooks: () => void;
  readonly toPublication: (id: string) => void;
  readonly toChapter: (bookId: string, chapterNumber: number) => void;
  readonly toRun: () => void;
  readonly toSetup: () => void;
  readonly toNew: () => void;
  readonly toAudit: () => void;
}

/**
 * Which silhouette a creation wears.
 *
 * vermilion.css ships one per form and the screen was using two of them: a
 * short, a storyboard, a script and a translation all had a mark drawn for
 * them and no tile to wear it on, because only books and publications were
 * ever listed here.
 */
const MARKS: Readonly<Record<string, string>> = {
  book: "mark-book",
  short: "mark-short",
  script: "mark-script",
  storyboard: "mark-storyboard",
  "interactive-film": "mark-film",
  publication: "mark-mag",
  translation: "mark-translation",
  play: "mark-world",
};

/**
 * Where a creation has got to, in the words the mock uses.
 *
 * `blocked` is the one state the mock does not draw, and it is the one worth
 * adding: a blocking finding is the difference between work that needs looking
 * at and work that cannot be signed off until someone acts.
 */
function creationBadge(p: {
  files: number; read: number; signedOff: number; blocking: number;
}): { readonly label: string; readonly tone: string } {
  if (p.files > 0 && p.signedOff === p.files) return { label: "approved", tone: "pill pill-ok" };
  if (p.blocking > 0) return { label: "blocked", tone: "pill pill-bad" };
  if (p.read < p.files) return { label: "needs a read", tone: "pill pill-warn" };
  return { label: "drafting", tone: "pill pill-fill" };
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
export function deriveGates(
  books: readonly BookSummary[],
  publications: readonly PublicationSummary[],
  creations: readonly Creation[] = [],
): Omit<Gate, "open">[] {
  const gates: Omit<Gate, "open">[] = [];

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
        icon: "check",
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
  }>({ shim: null, comfy: null, affinity: null });

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
    return deriveGates(books, publications, named).map((g) => {
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
          } else if (book) nav.toBook(book.id);
          // Reading, findings and the signature all live on one screen, so
          // every gate the folder raises opens the same one.
          else nav.toAudit();
        },
      };
    });
  }, [books, publications, named, nav]);

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
      mark: "mark-book",
      when: new Date(b.updatedAt).getTime(),
      badge:
        b.pendingReview > 0
          ? { label: "needs a read", tone: "pill pill-warn" }
          : b.status === "completed"
            ? { label: "approved", tone: "pill pill-ok" }
            : { label: b.status, tone: "pill pill-fill" },
      detail: `${b.chaptersWritten} of ${b.targetChapters} chapters · ${b.genre}`,
      open: () => nav.toBook(b.id),
    }));
    /* An issue had no timestamp at all and sorted to the bottom of the row
       for ever, however recently it was worked on. The folder walk knows when
       its files last changed, which is the same question. */
    const touched = new Map(creations.map((p) => [p.id, p.modified]));
    const fromPubs = publications.map((p) => ({
      id: p.id,
      title: p.title,
      mark: p.type === "storybook" ? "mark-story" : "mark-mag",
      when: new Date(touched.get(p.id) ?? 0).getTime(),
      badge: { label: p.status, tone: "pill pill-fill" },
      detail: `${p.written} of ${p.extent} pages · ${p.type}`,
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
        mark: MARKS[p.kind] ?? "mark-book",
        when: new Date(p.modified).getTime(),
        badge: creationBadge(p),
        detail: `${p.read} of ${p.files} read · ${p.label.toLowerCase()}`,
        open: nav.toAudit,
      }));
    return [...fromBooks, ...fromPubs, ...fromFolder]
      .sort((a, b) => b.when - a.when)
      .slice(0, 4);
  }, [books, publications, creations, nav]);

  const nothingYet = recent.length === 0;

  return (
    <div className="stack-lg">
      {/* ── The work so far, as a sentence ──────────────────────────────
          Three numerals on one line, labels inline underneath. Not three
          stat cards: the relationship between the numbers is the
          information, and cards would break it into three facts. */}
      <section className="crop" style={{ padding: "6px 0 4px" }}>
        <span className="disc stroke" style={{ width: 210, height: 210, left: -110, top: -96, opacity: 0.32 }} />
        <span className="disc dots" style={{ width: 82, height: 82, left: -52, bottom: -58, opacity: 0.28 }} />
        <div className="spread" style={{ alignItems: "flex-end", position: "relative" }}>
          <div className="rowflex" style={{ gap: 26, alignItems: "flex-end" }}>
            <div>
              <div className="numeral" style={{ fontSize: 68 }}>{String(approved).padStart(2, "0")}</div>
              <div className="label" style={{ marginTop: 9 }}>approved</div>
            </div>
            <div>
              <div className="numeral ghost" style={{ fontSize: 68 }}>{String(inFlight).padStart(2, "0")}</div>
              <div className="label" style={{ marginTop: 9 }}>in flight</div>
            </div>
            <div>
              <div className="numeral ghost" style={{ fontSize: 68 }}>{String(thisMonth).padStart(2, "0")}</div>
              <div className="label" style={{ marginTop: 9 }}>this month</div>
            </div>
          </div>
          {newest ? (
            <div className="rowflex">
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{newest.title}</div>
                <div className="dim" style={{ fontSize: 11 }}>
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
          <span className="disc fill" style={{ width: 230, height: 230, right: -118, top: -128, opacity: 0.13 }} />
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
          <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
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
                    <span className="pill pill-warn">{g.verb}</span>
                    <span className="act">
                      <span className="btn btn-line btn-sm">{g.action}</span>
                    </span>
                    <Icon name="chevR" size={16} className="dim" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── The live run, and the machine under it ───────────────────── */}
      <section className="cols cols-a">
        <div className="dark crop" style={{ padding: "20px 22px" }}>
          <span className="disc dots dots-light" style={{ width: 150, height: 150, right: -54, bottom: -64 }} />
          <div className="spread" style={{ alignItems: "flex-start", position: "relative" }}>
            <div>
              <div className="label">{run ? "Running now" : "Idle"}</div>
              <h3 style={{ fontSize: 17.5, marginTop: 8 }}>
                {run ? run.what : "Nothing is running"}
              </h3>
              <p className="muted" style={{ fontSize: 14, marginTop: 3 }}>
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
              <svg className="ring" viewBox="0 0 44 44" aria-hidden="true">
                <circle className="t" cx="22" cy="22" r="19" />
                <circle className="v" cx="22" cy="22" r="19" style={{ strokeDasharray: RING, strokeDashoffset: RING * 0.75 }} />
              </svg>
            ) : null}
          </div>

          {run && lastLine ? (
            <div className="msg" style={{ position: "relative", marginTop: 18 }}>
              <span className="who-av model">Q</span>
              <div className="body">
                <div className="tag">{lastLine.tag}</div>
                <p style={{ fontSize: 14, lineHeight: 1.55 }}>
                  {lastLine.text}
                  <span className="caret" />
                </p>
              </div>
            </div>
          ) : null}

          <div className="rowflex" style={{ marginTop: 16, position: "relative" }}>
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
              <span className="disc dots" style={{ width: 96, height: 96, right: -40, top: -44, opacity: 0.24 }} />
              <div className="spread">
                <h3 className="h-panel">In this folder</h3>
                <span className="dim" style={{ fontSize: 11 }}>
                  {creations.length} {creations.length === 1 ? "creation" : "creations"}
                  {" · "}{workspace.totals.words.toLocaleString()} words
                </span>
              </div>

              <div className="rowflex" style={{ marginTop: 10 }}>
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

              <div style={{ marginTop: 12 }}>
                {workspace.kinds.filter((k) => k.files > 0).map((k) => (
                  <div key={k.kind} className="spread" style={{ padding: "3px 0", fontSize: 12 }}>
                    <span>
                      {k.label}
                      <span className="dim" style={{ marginLeft: 7 }}>
                        {k.projects} {k.projects === 1 ? "creation" : "creations"}
                        {" · "}{k.files} {k.files === 1 ? "file" : "files"}
                      </span>
                    </span>
                    <span className="dim mono" style={{ fontSize: 11 }}>
                      {k.read}/{k.files} read
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
            <span className="disc stroke-l" style={{ width: 120, height: 120, right: -46, bottom: -52 }} />
            <h3 className="h-panel">The machine</h3>
            <div className="rowflex" style={{ marginTop: 10 }}>
              <span className={machine.shim ? "pill pill-ok" : "pill pill-bad"}>
                {machine.shim
                  ? `shim · ${machine.shim.agents.length} provider${machine.shim.agents.length === 1 ? "" : "s"}`
                  : "shim unreachable"}
              </span>
              <span className={machine.comfy?.up ? "pill pill-ok" : "pill pill-warn"}>
                {machine.comfy?.up ? "ComfyUI up" : machine.comfy?.installed ? "ComfyUI stopped" : "ComfyUI not installed"}
              </span>
              <span className={machine.affinity?.running ? "pill pill-ok" : "pill pill-warn"}>
                {machine.affinity?.running ? "Affinity open" : "Affinity closed"}
              </span>
              <span className={daemon?.running ? "pill pill-ok" : "pill"}>
                {daemon?.running ? "daemon on" : "daemon off"}
              </span>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Affinity only has to be open when an issue is being built.
            </p>
          </div>

          {books.some((b) => b.status === "active") ? (
            <div className="panel">
              <h3 className="h-panel">Next in the queue</h3>
              <div className="rows" style={{ marginTop: 8 }}>
                {books
                  .filter((b) => b.status === "active")
                  .slice(0, 3)
                  .map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className="row"
                      style={{ padding: "10px 4px" }}
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
        <div className="spread" style={{ marginBottom: 14 }}>
          <h3 className="h-panel">Back to work</h3>
          <button type="button" className="link" onClick={nav.toBooks}>
            All productions →
          </button>
        </div>
        <div className="tiles">
          {recent.map((r) => (
            <button key={r.id} type="button" className="tile crop" onClick={r.open}>
              <span className={`mark ${r.mark}`}>
                <span className="d1" />
                <span className="d2" />
              </span>
              <span className="top">
                <span className={r.badge.tone}>{r.badge.label}</span>
              </span>
              <h4>{r.title}</h4>
              <span className="who">{r.detail}</span>
            </button>
          ))}
          <button type="button" className="tile tile-new" onClick={nav.toNew}>
            <span className="arrow" aria-hidden="true">
              <Icon name="plus" size={18} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Start something</span>
            <span className="hint">book · storybook · short · script</span>
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
