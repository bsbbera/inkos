import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { doctorViewState } from "./doctor-view-state";
import { Stethoscope, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";

interface DoctorChecks {
  readonly inkosJson: boolean;
  readonly projectEnv: boolean;
  readonly globalEnv: boolean;
  readonly booksDir: boolean;
  readonly llmConnected: boolean;
  readonly bookCount: number;
}

interface Nav { toDashboard: () => void }

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
      {ok ? (
        <CheckCircle2 size={18} className="text-emerald-500 shrink-0" role="img" aria-label="passed" />
      ) : (
        <XCircle size={18} className="text-destructive shrink-0" role="img" aria-label="failed" />
      )}
      <span className="text-sm font-medium flex-1">{label}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </div>
  );
}

export function DoctorView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, error, loading, refetch } = useApi<DoctorChecks>("/doctor");
  const state = doctorViewState({ error, data });

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.doctor")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <Stethoscope size={28} className="text-primary" />
          {t("doctor.title")}
        </h1>
        <button
          onClick={() => refetch()}
          disabled={loading}
          className={`px-4 py-2 text-sm rounded-lg disabled:opacity-50 ${c.btnSecondary}`}
        >
          {loading ? t("doctor.checking") : t("doctor.recheck")}
        </button>
      </div>

      {/*
        * This page is the one a person opens *because* something is wrong, so
        * it has to survive its own subject failing. It used to render a
        * spinner whenever there was no data and never look at `error`, which
        * meant the check that says "the backend is unreachable" was displayed
        * as an endless spinner — indistinguishable from a slow probe, with no
        * way to tell that the answer had already come back and was a failure.
        */}
      {state === "error" ? (
        <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-3`} role="alert">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-destructive shrink-0" />
            <span className="text-sm font-medium flex-1">{t("doctor.unreachable")}</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("doctor.unreachableHint")}
          </p>
          <p className="text-xs font-mono text-muted-foreground break-all">{error}</p>
        </div>
      ) : state === "loading" || !data ? (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 size={24} className="animate-spin text-primary" />
          <span className="sr-only">{t("doctor.checking")}</span>
        </div>
      ) : (
        <div className={`border ${c.cardStatic} rounded-lg p-5`}>
          <CheckRow label={t("doctor.inkosJson")} ok={data.inkosJson} />
          <CheckRow label={t("doctor.projectEnv")} ok={data.projectEnv} />
          <CheckRow label={t("doctor.globalEnv")} ok={data.globalEnv} />
          <CheckRow label={t("doctor.booksDir")} ok={data.booksDir} detail={`${data.bookCount} book(s)`} />
          <CheckRow label={t("doctor.llmApi")} ok={data.llmConnected} detail={data.llmConnected ? t("doctor.connected") : t("doctor.failed")} />
        </div>
      )}

      {data && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          data.inkosJson && (data.projectEnv || data.globalEnv) && data.llmConnected
            ? "bg-emerald-500/10 text-emerald-600"
            : "bg-amber-500/10 text-amber-600"
        }`}>
          {data.inkosJson && (data.projectEnv || data.globalEnv) && data.llmConnected
            ? t("doctor.allPassed")
            : t("doctor.someFailed")
          }
        </div>
      )}
    </div>
  );
}
