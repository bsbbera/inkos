import { useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { fetchJson } from "../hooks/use-api";
import { Icon } from "../components/ui/icon";
import { Orb } from "../components/ui/working";
import { Empty, Failed } from "../components/ui/states";
import { PageHead } from "../components/ui/page-head";
import { whenExact } from "../lib/when";

interface Recommendation {
  readonly confidence: number;
  readonly platform: string;
  readonly genre: string;
  readonly concept: string;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

interface RadarResult {
  readonly marketSummary: string;
  readonly recommendations: ReadonlyArray<Recommendation>;
}

interface RadarHistoryItem {
  readonly file: string;
  readonly timestamp: string;
  readonly summaryPreview: string;
  readonly result: RadarResult;
}

interface Nav { toDashboard: () => void }

/* The server keeps the first N characters of a summary, which ended history
   rows mid-word ("characterized b"). Back to the last whole word. */
function preview(text: string): string {
  const t = text.trim();
  if (/[.!?…]$/.test(t)) return t;
  const cut = t.replace(/\s+\S*$/, "");
  return `${cut || t}…`;
}

export function RadarView(_: { nav: Nav; theme: Theme; t: TFunction }) {
  const [result, setResult] = useState<RadarResult | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadonlyArray<RadarHistoryItem>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = async () => {
    try {
      const data = await fetchJson<{ items: ReadonlyArray<RadarHistoryItem> }>("/radar/history");
      setHistory(data.items ?? []);
    } catch {
      setHistory([]);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const handleScan = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    setShown(null);
    try {
      const data = await fetchJson<RadarResult>("/radar/scan", { method: "POST" });
      setResult(data);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  return (
    <div className="stack-lg">
      <PageHead
        title="What readers are picking up"
        lede="Your model reads the charts and says what is selling, and where something of yours could sit. A scan is a reading, not a forecast."
        actions={
          <button type="button" onClick={handleScan} disabled={loading} className="btn">
            {loading ? <Orb state="searching" /> : <Icon name="target" size={15} />}
            {loading ? "Reading the charts…" : "Scan now"}
          </button>
        }
      />

      {error ? <Failed what="The scan stopped." detail={error} /> : null}

      {result ? (
        <section className="stack fade-in">
          <div className="panel">
            <h3 className="label mb-3">The market</h3>
            <p className="text-body leading-relaxed whitespace-pre-wrap max-w-measure">{result.marketSummary}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger">
            {result.recommendations.map((rec, i) => (
              <div key={i} className="panel stack gap-3">
                <div className="spread">
                  <span className="label">{rec.platform} · {rec.genre}</span>
                  <span className={rec.confidence >= 0.7 ? "pill pill-ok" : rec.confidence >= 0.4 ? "pill pill-warn" : "pill"}>
                    {(rec.confidence * 100).toFixed(0)}% sure
                  </span>
                </div>
                <p className="text-body font-semibold">{rec.concept}</p>
                <p className="text-cap muted leading-relaxed">{rec.reasoning}</p>
                {rec.benchmarkTitles.length > 0 ? (
                  <div className="rowflex gap-2 flex-wrap">
                    {rec.benchmarkTitles.map((bt) => <span key={bt} className="pill">{bt}</span>)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="panel">
          <h3 className="label mb-3">Earlier scans</h3>
          <div className="stack gap-2 stagger">
            {history.slice(0, 10).map((item) => (
              <button
                key={item.file}
                type="button"
                onClick={() => { setResult(item.result); setShown(item.file); }}
                className="well w-full text-left"
                aria-pressed={shown === item.file}
              >
                <div className="text-cap dim tnum">{whenExact(item.timestamp)}</div>
                <div className="mt-1 line-clamp-2">{preview(item.summaryPreview || item.file)}</div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Only when there is nothing at all: under a history it contradicted it. */}
      {!result && !loading && !error && history.length === 0 ? (
        <Empty icon="chart" title="No scans yet.">
          A scan reads the current charts and suggests where a new work would land.
        </Empty>
      ) : null}
    </div>
  );
}
