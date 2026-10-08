/**
 * The beauty gate (13 §9, Phase 6): the rendered pages, one at a time, with
 * the machine's score card beside each and one gesture per page.
 *
 * Keep · redesign (same words, new layout) · re-world (the section's look) ·
 * tweak (one change, said in a line). The "what went wrong?" chips are the
 * score's own seven dimensions, so a person's verdict and the machine's score
 * feed one learning stream. A redo touches that page only; the page is laid
 * out again in Affinity and scored before it comes back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./ui/icon";
import { Empty, Failed, Loading } from "./ui/states";
import { toast, useQueueKeys } from "./ui/vermilion";

type Verdict = "keep" | "redesign" | "re-world" | "tweak";
type Dim = "G" | "H" | "W" | "C" | "T" | "I" | "R";

interface Score {
  readonly at: string;
  readonly total: number;
  readonly pass: boolean;
  readonly dims: Readonly<Record<Dim, number | null>>;
  readonly cause: Dim | null;
  readonly causeLine: string;
  readonly notes: ReadonlyArray<{ readonly dim: Dim; readonly penalty: number; readonly says: string }>;
}
interface Bundle {
  readonly page: { readonly n: number; readonly title: string; readonly type: string };
  readonly section: { readonly n: number; readonly label: string } | null;
  readonly world: { readonly register: string; readonly idiom: string } | null;
  readonly mark: { readonly state: "approved" | "locked" } | null;
  readonly render: string | null;
  readonly layout: { readonly built: string; readonly warnings: ReadonlyArray<string> } | null;
  readonly score: { readonly latest: Score; readonly history: ReadonlyArray<Score> } | null;
  readonly reviews: ReadonlyArray<{ readonly at: string; readonly verdict: Verdict; readonly note?: string; readonly cause?: ReadonlyArray<string> }>;
  readonly chips: ReadonlyArray<string>;
}

const DIM_NAME: Readonly<Record<Dim, string>> = {
  G: "Grid", H: "Hierarchy", W: "Whitespace", C: "Colour", T: "Typography", I: "Image fit", R: "Rules",
};
const VERDICTS: ReadonlyArray<{ readonly v: Verdict; readonly label: string; readonly title: string; readonly asks: boolean }> = [
  { v: "keep", label: "😍 Keep", title: "This page is right", asks: false },
  { v: "redesign", label: "🔁 Redesign", title: "Same words, a new layout", asks: true },
  { v: "re-world", label: "🎨 Re-world", title: "A different look for this page's section", asks: true },
  { v: "tweak", label: "✏️ Tweak", title: "Nearly - change one thing", asks: true },
];

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((out as { error?: string }).error || `HTTP ${res.status}`);
  return out as T;
}

export function BeautyGate({ issueId, pages, running, onChanged }: {
  readonly issueId: string;
  readonly pages: ReadonlyArray<{ readonly n: number; readonly title: string }>;
  readonly running: boolean;
  readonly onChanged: () => void;
}) {
  const api = `/api/v1/publications/${encodeURIComponent(issueId)}`;
  const [at, setAt] = useState(0);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<Verdict | null>(null);
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  /** A redo in flight: the score time it is waiting to see change. */
  const [waiting, setWaiting] = useState<string | null>(null);
  const [bust, setBust] = useState(0);
  const n = pages[Math.min(at, pages.length - 1)]?.n;

  const load = useCallback(async () => {
    if (n === undefined) return;
    try {
      setBundle(await call<Bundle>(`${api}/pages/${n}/bundle`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, n]);

  useEffect(() => { setBundle(null); setAsking(null); setPicked([]); setNote(""); void load(); }, [load]);

  // A redesign runs as a job: watch the page until its score moves on.
  const since = useRef<string | null>(null);
  since.current = waiting;
  useEffect(() => {
    if (waiting === null) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const b = await call<Bundle>(`${api}/pages/${n}/bundle`);
        if ((b.score?.latest.at ?? "") !== since.current || Date.now() - started > 600_000) {
          setBundle(b); setWaiting(null); setBust(Date.now()); onChanged();
        }
      } catch { /* the next tick tries again */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [waiting, api, n, onChanged]);

  useQueueKeys({
    enabled: pages.length > 0,
    onNext: () => setAt((i) => Math.min(i + 1, pages.length - 1)),
    onPrev: () => setAt((i) => Math.max(i - 1, 0)),
  });

  if (!pages.length) return <Empty icon="layers" title="There are no pages to look at yet." />;

  const send = async (verdict: Verdict) => {
    if (n === undefined) return;
    setBusy(verdict);
    try {
      const out = await call<{ job?: unknown }>(`${api}/pages/${n}/verdict`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict, cause: picked, note }),
      });
      setAsking(null); setPicked([]); setNote("");
      if (out.job) {
        toast(verdict === "re-world" ? "Choosing another world, then laying the page out again…" : "Redesigning the page, then laying it out again…");
        setWaiting(bundle?.score?.latest.at ?? "");
      } else {
        toast("Kept.");
        await load();
      }
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const layOut = async () => {
    if (n === undefined) return;
    setBusy("layout");
    try {
      await call(`${api}/pages/${n}/score`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: true }),
      });
      setBust(Date.now());
      await load();
      onChanged();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const score = bundle?.score?.latest ?? null;
  const locked = bundle?.mark?.state === "locked";
  const lastVerdict = bundle?.reviews[bundle.reviews.length - 1];

  return (
    <div className="stack">
      <div className="spread items-end">
        <div>
          <h3 className="h-panel">The pages, as they print</h3>
          <p className="hint mt-1">
            Each page is laid out and scored before you see it. One verdict per page; a redo touches that page only.
          </p>
        </div>
        <div className="rowflex gap-2 items-center">
          <button type="button" className="btn btn-quiet btn-sm" disabled={at === 0} onClick={() => setAt(at - 1)} aria-label="Previous page">
            <Icon name="up" size={14} />
          </button>
          <span className="mono text-cap tnum">p{n} · {at + 1} of {pages.length}</span>
          <button type="button" className="btn btn-quiet btn-sm" disabled={at >= pages.length - 1} onClick={() => setAt(at + 1)} aria-label="Next page">
            <Icon name="down" size={14} />
          </button>
          <span className="kbd">J</span><span className="kbd">K</span>
        </div>
      </div>

      {error ? <Failed what="Could not open this page." detail={error} retry={() => void load()} /> : null}
      {!bundle && !error ? <Loading what="Opening the page…" rows={3} /> : null}

      {bundle ? (
        /* The page leads: 7 to 5, the card beside it. */
        <div className="cols cols-a items-start">
          {/* ---- the page ---- */}
          <div className="panel">
            <div className="panel-body grid place-items-center min-h-120">
              {bundle.render ? (
                <img
                  src={`${bundle.render}?v=${bust || score?.at || ""}`}
                  alt={`Page ${bundle.page.n}, ${bundle.page.title}, as laid out`}
                  className="max-w-full max-h-[78vh] shadow-lg"
                />
              ) : (
                <Empty compact icon="image" title="This page has not been laid out yet.">
                  Laying it out opens Affinity, builds the page, renders it and scores it.
                </Empty>
              )}
            </div>
            <div className="panel-body border-t border-t-(--line) rowflex gap-2 flex-wrap items-center">
              <span className="grow min-w-0">
                <b className="text-body">{bundle.page.title}</b>
                <span className="dim text-cap block">
                  {bundle.page.type}
                  {bundle.section ? ` · ${bundle.section.label}` : ""}
                  {bundle.world ? ` · ${bundle.world.register}` : ""}
                  {bundle.layout ? ` · built from ${bundle.layout.built === "blocks" ? "its spec's blocks" : "its type's arrangement"}` : ""}
                </span>
              </span>
              <button type="button" className="btn btn-line btn-sm" disabled={busy !== null || waiting !== null || running} onClick={() => void layOut()}>
                <Icon name="redo" size={13} />{busy === "layout" ? "Laying out…" : bundle.render ? "Lay out again" : "Lay out & score"}
              </button>
            </div>
          </div>

          {/* ---- the card ---- */}
          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <h3>Score</h3>
                {score ? (
                  <span className={score.pass ? "pill pill-ok" : "pill pill-warn"}>
                    {score.total} · {score.pass ? "passes" : "below the bar"}
                  </span>
                ) : <span className="dim text-cap">not scored</span>}
              </div>
              <div className="panel-body">
                {score ? (
                  <>
                    {score.causeLine ? <p className="text-small mb-3">{score.causeLine}</p> : null}
                    <div className="stack gap-2">
                      {(Object.keys(DIM_NAME) as Dim[]).map((d) => (
                        <div key={d} className="rowflex gap-2 items-center">
                          <span className="text-cap w-24">{DIM_NAME[d]}</span>
                          <span className="bar grow">
                            <i style={{ transform: `scaleX(${(score.dims[d] ?? 0) / 100})`, ...(score.dims[d] === null ? { opacity: 0 } : {}) }} />
                          </span>
                          <span className="mono text-cap tnum w-8 text-right">{score.dims[d] ?? "–"}</span>
                        </div>
                      ))}
                    </div>
                    {score.notes.filter((x) => x.penalty >= 1).length ? (
                      <ul className="hint mt-3 pl-4.5">
                        {score.notes.filter((x) => x.penalty >= 1).slice(0, 6).map((x, i) => (
                          <li key={i}>{DIM_NAME[x.dim]}: {x.says}</li>
                        ))}
                      </ul>
                    ) : null}
                    {(bundle.score?.history.length ?? 0) > 1 ? (
                      <p className="dim text-cap mt-2">
                        History: {bundle.score!.history.slice(-6).map((h) => h.total).join(" → ")}
                      </p>
                    ) : null}
                  </>
                ) : <p className="hint">Lay the page out to score it.</p>}
                {bundle.layout?.warnings.length ? (
                  <p className="hint mt-2">Builder: {bundle.layout.warnings.join("; ")}</p>
                ) : null}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h3>Your verdict</h3>
                {lastVerdict ? <span className="dim text-cap">last: {lastVerdict.verdict}</span> : null}
              </div>
              <div className="panel-body stack gap-3">
                {waiting !== null ? (
                  <p className="hint">Working on it — the page comes back here laid out and scored.</p>
                ) : null}
                <div className="rowflex gap-2 flex-wrap">
                  {VERDICTS.map((v) => (
                    <button
                      key={v.v}
                      type="button"
                      title={v.v === "re-world" && locked ? "This section is locked on the section board" : v.title}
                      className={asking === v.v ? "btn btn-sm" : "btn btn-line btn-sm"}
                      disabled={busy !== null || waiting !== null || running || (v.v === "re-world" && locked) || (v.v !== "keep" && !bundle.render)}
                      onClick={() => (v.asks ? setAsking(asking === v.v ? null : v.v) : void send(v.v))}
                    >
                      {busy === v.v ? "…" : v.label}
                    </button>
                  ))}
                </div>
                {asking ? (
                  <div className="stack gap-2">
                    <span className="label">What went wrong?</span>
                    <div className="rowflex gap-1.5 flex-wrap">
                      {bundle.chips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className={picked.includes(chip) ? "chip is-on" : "chip"}
                          aria-pressed={picked.includes(chip)}
                          onClick={() => setPicked(picked.includes(chip) ? picked.filter((x) => x !== chip) : [...picked, chip])}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                    <input
                      className="input"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={asking === "tweak" ? "The one change — e.g. picture bigger, figure in ink" : "Anything to say (optional)"}
                    />
                    <div className="rowflex gap-2">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy !== null || (asking === "tweak" && !note.trim() && !picked.length)}
                        onClick={() => void send(asking)}
                      >
                        {asking === "re-world" ? "Choose another world" : asking === "tweak" ? "Make the change" : "Redesign the page"}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(null)}>Cancel</button>
                    </div>
                    {asking === "re-world" ? (
                      <p className="hint">A world belongs to the whole section: its other pages take it on their next layout.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
