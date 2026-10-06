/*
 * Doctor. Mock 22.
 *
 * The count first - "6 / 8 passing" - then the checks as rows, each saying
 * what it looked at rather than only whether it liked what it found. A person
 * opens this because something is wrong, so nothing here may be a bare tick.
 */
import { PageHead } from "../components/ui/page-head";
import { useApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import { doctorViewState } from "./doctor-view-state";
import { Icon } from "../components/ui/icon";
import { Failed, Loading } from "../components/ui/states";

interface DoctorChecks {
  readonly quireJson: boolean;
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
    <div className="row items-start py-3.5">
      <span className={`${check.ok ? "st done" : "st"} mt-1`}>
        <i />
      </span>
      <span className="grow">
        <span className="name">{check.label}</span>
        <span className="meta">{check.detail}</span>
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
        { label: t("doctor.quireJson"), ok: data.quireJson, detail: "The project file, in this folder" },
        { label: t("doctor.projectEnv"), ok: data.projectEnv, detail: "Keys kept with this project" },
        { label: t("doctor.globalEnv"), ok: data.globalEnv, detail: "Keys kept for every project on this machine" },
        {
          label: t("doctor.booksDir"),
          ok: data.booksDir,
          detail: `${data.bookCount} ${data.bookCount === 1 ? "piece" : "pieces"} of work in this folder`,
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
    <div className="stack-lg">
      {/* Left-aligned like every other screen; it was the one centred column. */}
      <PageHead
        title="Let us see what you have"
        lede={checks.length === 0
          ? "Checking the workspace, the providers and the files Quire needs."
          : passing === checks.length
            ? "Everything Quire needs is in place."
            : `${checks.length - passing} of them want something from you. You can start writing before you fix either.`}
        actions={checks.length > 0 ? (
          <div className="text-right">
            <div className="rowflex gap-0.5 justify-end items-baseline">
              {/* All passing is good news, so it is green; the accent is for
                  what needs you. */}
              <span className={passing === checks.length ? "numeral numeral-ok text-d3" : "numeral text-d3"}>{passing}</span>
              <span className="numeral ghost text-h1">/{checks.length}</span>
            </div>
            <div className="label mt-1.5">passing</div>
          </div>
        ) : undefined}
      />

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
            <div className="panel-body pt-3.5 pb-3.5">
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
