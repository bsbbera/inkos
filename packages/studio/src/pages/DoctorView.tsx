/*
 * Doctor. Mock 22.
 *
 * The count first - "6 / 8 passing" - then the checks as rows, each saying
 * what it looked at rather than only whether it liked what it found. A person
 * opens this because something is wrong, so nothing here may be a bare tick.
 */
import { useApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import { doctorViewState } from "./doctor-view-state";
import { Icon } from "../components/ui/icon";
import { Failed, Loading } from "../components/ui/states";

interface DoctorChecks {
  readonly inkosJson: boolean;
  readonly projectEnv: boolean;
  readonly globalEnv: boolean;
  readonly booksDir: boolean;
  readonly llmConnected: boolean;
  readonly bookCount: number;
}

interface Check {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

function Row({ check }: { readonly check: Check }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", padding: "14px 4px" }}>
      <span className={check.ok ? "st done" : "st"} style={{ marginTop: 3 }}>
        <i />
      </span>
      <span className="grow">
        <span className="name">{check.label}</span>
        <span className="meta mono" style={{ fontSize: 11 }}>{check.detail}</span>
      </span>
      <span className={check.ok ? "pill pill-ok" : "pill pill-warn"}>{check.ok ? "ok" : "wants you"}</span>
    </div>
  );
}

export function DoctorView({ t }: { readonly t: TFunction }) {
  const { data, error, loading, refetch } = useApi<DoctorChecks>("/doctor");
  const state = doctorViewState({ error, data });

  const checks: Check[] = data
    ? [
        { label: t("doctor.inkosJson"), ok: data.inkosJson, detail: "inkos.json in the workspace root" },
        { label: t("doctor.projectEnv"), ok: data.projectEnv, detail: "project .env" },
        { label: t("doctor.globalEnv"), ok: data.globalEnv, detail: "global .env" },
        {
          label: t("doctor.booksDir"),
          ok: data.booksDir,
          detail: `books/ · ${data.bookCount} ${data.bookCount === 1 ? "book" : "books"}`,
        },
        {
          label: t("doctor.llmApi"),
          ok: data.llmConnected,
          detail: data.llmConnected ? t("doctor.connected") : t("doctor.failed"),
        },
      ]
    : [];

  const passing = checks.filter((c) => c.ok).length;

  return (
    <div className="wrap-read stack-lg">
      <section className="crop" style={{ paddingBottom: 0 }}>
        <span className="disc fill" style={{ width: 210, height: 210, right: -104, top: -112, opacity: 0.13 }} />
        <span className="disc stroke" style={{ width: 104, height: 104, right: -34, top: -30, opacity: 0.4 }} />
        <div className="spread" style={{ alignItems: "flex-end" }}>
          <div>
            <h2 className="h-page">Let us see what you have</h2>
            <p className="muted" style={{ fontSize: 14, marginTop: 10, maxWidth: "52ch" }}>
              {checks.length === 0
                ? "Checking the workspace, the providers and the files Quire needs."
                : passing === checks.length
                  ? t("doctor.allPassed")
                  : `${checks.length - passing} of them want something from you. You can start writing before you fix either.`}
            </p>
          </div>
          {checks.length > 0 ? (
            <div style={{ textAlign: "right" }}>
              <div className="rowflex" style={{ gap: 2, justifyContent: "flex-end", alignItems: "baseline" }}>
                <span className="numeral" style={{ fontSize: 68 }}>{passing}</span>
                <span className="numeral ghost" style={{ fontSize: 34 }}>/{checks.length}</span>
              </div>
              <div className="label" style={{ marginTop: 6 }}>passing</div>
            </div>
          ) : null}
        </div>
      </section>

      {/*
        * This page is the one a person opens *because* something is wrong, so
        * it has to survive its own subject failing. It used to render a
        * spinner whenever there was no data and never look at `error`, which
        * meant the check that says "the backend is unreachable" was displayed
        * as an endless spinner — indistinguishable from a slow probe.
        */}
      {state === "error" ? (
        <Failed
          what={t("doctor.unreachable")}
          detail={error}
          kept={t("doctor.unreachableHint")}
          retry={() => refetch()}
        />
      ) : state === "loading" || !data ? (
        <Loading what={t("doctor.checking")} rows={5} />
      ) : (
        <>
          <section className="panel panel-flush">
            <div className="panel-body" style={{ paddingTop: 14, paddingBottom: 14 }}>
              <div className="rows">
                {checks.map((c) => (
                  <Row key={c.label} check={c} />
                ))}
              </div>
            </div>
          </section>

          <div className="rowflex">
            <button type="button" className="btn btn-line btn-sm" disabled={loading} onClick={() => refetch()}>
              <Icon name="redo" size={14} />
              {loading ? t("doctor.checking") : t("doctor.recheck")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
