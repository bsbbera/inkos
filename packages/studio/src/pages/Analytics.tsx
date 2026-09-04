/*
 * Analytics. Mock 36.
 *
 * Not a dashboard: one question, "where is the book actually stuck". The
 * stacked bar answers it before a number is read, and each state says what it
 * means rather than repeating its own name - "written, waiting for you to read
 * them" is the useful half of "ready-for-review".
 */
import { useApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import { Empty, Failed, Loading } from "../components/ui/states";

interface AnalyticsData {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly avgWordsPerChapter: number;
  readonly statusDistribution: Record<string, number>;
}

/**
 * Chapter statuses grouped into the four things a person cares about, with the
 * colour and the plain-language gloss for each. An unknown status keeps its own
 * name and lands in "working" rather than disappearing from the bar.
 */
const BANDS = [
  {
    id: "settled",
    name: "Settled",
    why: "audited, agreed with the truth files, done",
    color: "var(--ok)",
    dot: "dot dot-clean",
    statuses: ["approved", "published"],
  },
  {
    id: "review",
    name: "In review",
    why: "written, waiting for you to read them",
    color: "var(--warn)",
    dot: "dot dot-warn",
    statuses: ["ready-for-review"],
  },
  {
    id: "blocked",
    name: "Blocked",
    why: "the audit refused them, or the state no longer lines up",
    color: "var(--bad)",
    dot: "dot dot-bad",
    statuses: ["audit-failed", "rejected", "state-degraded"],
  },
  {
    id: "working",
    name: "In hand",
    why: "drafted or being worked on, not yet audited",
    color: "var(--line)",
    dot: "dot dot-never",
    statuses: [],
  },
] as const;

export function bandCounts(dist: Record<string, number>) {
  const counts = new Map<string, number>(BANDS.map((b) => [b.id, 0]));
  for (const [status, n] of Object.entries(dist)) {
    const band = BANDS.find((b) => (b.statuses as readonly string[]).includes(status));
    const id = band?.id ?? "working";
    counts.set(id, (counts.get(id) ?? 0) + n);
  }
  return BANDS.map((b) => ({ ...b, count: counts.get(b.id) ?? 0 }));
}

export function Analytics({
  bookId,
  t,
}: {
  readonly bookId: string;
  readonly t: TFunction;
}) {
  const { data, loading, error, refetch } = useApi<AnalyticsData>(`/books/${bookId}/analytics`);

  if (error) return <Failed what="Could not measure this book." detail={error} retry={() => refetch()} />;
  if (loading && !data) return <Loading what="Counting chapters…" rows={4} />;
  if (!data) return null;

  const bands = bandCounts(data.statusDistribution);
  const total = bands.reduce((n, b) => n + b.count, 0);

  return (
    <div className="stack-lg">
      <section className="crop" style={{ paddingBottom: 0 }}>
        <span className="disc stroke" style={{ width: 190, height: 190, left: -88, top: -92, opacity: 0.3 }} />
        <h2 className="h-page">Where the book actually is</h2>
      </section>

      <section className="cols" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <div className="panel">
          <div className="panel-body">
            <span className="label">{t("analytics.totalChapters")}</span>
            <div className="numeral tnum">{data.totalChapters}</div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body">
            <span className="label">{t("analytics.totalWords")}</span>
            <div className="numeral tnum">{data.totalWords.toLocaleString()}</div>
            <p className="dim" style={{ fontSize: 11 }}>
              about {Math.round(data.totalWords / 285).toLocaleString()} printed pages
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body">
            <span className="label">{t("analytics.avgWords")}</span>
            <div className="numeral tnum">{data.avgWordsPerChapter.toLocaleString()}</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="grow">
            <h3 className="h-panel">The shape of it</h3>
            <span className="dim" style={{ fontSize: 11 }}>Every chapter, by what state it is in</span>
          </span>
        </div>
        <div className="panel-body">
          {total === 0 ? (
            <Empty icon="book" title="Nothing is written yet.">
              Once chapters exist, this says how many are settled, how many want a read, and
              what is blocked.
            </Empty>
          ) : (
            <>
              <div
                className="rowflex"
                style={{ gap: 3, height: 22, alignItems: "stretch", borderRadius: 999, overflow: "hidden", marginBottom: 16 }}
              >
                {bands
                  .filter((b) => b.count > 0)
                  .map((b) => (
                    <span
                      key={b.id}
                      style={{ flex: b.count, background: b.color }}
                      title={`${b.count} ${b.name.toLowerCase()}`}
                    />
                  ))}
              </div>
              <div className="rows">
                {bands.map((b) => (
                  <div className="row" key={b.id}>
                    <span className={b.dot} />
                    <span className="grow">
                      <span className="name">{b.name}</span>
                      <span className="meta">{b.why}</span>
                    </span>
                    <span className="mono tnum">{b.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
