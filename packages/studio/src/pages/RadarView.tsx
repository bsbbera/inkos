import { useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { fetchJson } from "../hooks/use-api";
import { TrendingUp, Loader2, Target, Clock } from "../components/ui/glyphs";

import { Spinner } from "../components/ui/working";
import { Failed } from "../components/ui/states";
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

export function RadarView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [result, setResult] = useState<RadarResult | null>(null);
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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="h-page flex items-center gap-3">
          <span className="icon-ring icon-ring-lg" aria-hidden="true"><TrendingUp size={19} /></span>
          {t("radar.title")}
        </h1>
        <button
          onClick={handleScan}
          disabled={loading}
          className="btn flex items-center gap-2"
        >
          {loading ? <Spinner /> : <Target size={14} />}
          {loading ? t("radar.scanning") : t("radar.scan")}
        </button>
      </div>

      {error && (
        <Failed what="The scan stopped." detail={error} />
      )}

      {result && (
        <div className="space-y-6">
          <div className="panel">
            <h3 className="label mb-3">{t("radar.summary")}</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{result.marketSummary}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.recommendations.map((rec, i) => (
              <div key={i} className="panel space-y-3">
                <div className="flex items-center justify-between">
                  <span className="label">
                    {rec.platform} · {rec.genre}
                  </span>
                  <span className={`pill ${
                    rec.confidence >= 0.7 ? "bg-success/10 text-success" :
                    rec.confidence >= 0.4 ? "bg-warning/10 text-warning" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {(rec.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm font-semibold">{rec.concept}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{rec.reasoning}</p>
                {rec.benchmarkTitles.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {rec.benchmarkTitles.map((bt) => (
                      <span key={bt} className="pill">{bt}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="panel space-y-3">
          <h3 className="label flex items-center gap-2">
            <Clock size={14} />
            {t("radar.history")}
          </h3>
          <div className="space-y-2">
            {history.slice(0, 10).map((item) => (
              <button
                key={item.file}
                onClick={() => setResult(item.result)}
                className="well w-full text-left"
              >
                <div className="font-medium text-foreground">{new Date(item.timestamp).toLocaleString()}</div>
                <div className="mt-1 line-clamp-2 text-muted-foreground">{item.summaryPreview || item.file}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="panel border-dashed text-center text-muted-foreground text-sm italic">
          {t("radar.emptyHint")}
        </div>
      )}
    </div>
  );
}
