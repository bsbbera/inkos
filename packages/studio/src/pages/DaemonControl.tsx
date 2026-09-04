/*
 * The daemon. Mock 33.
 *
 * One big reversible switch and a window onto what it is doing. The state is
 * a sentence, not a badge: "the daemon is running" tells you more than a green
 * dot, and the paragraph under it says what stopping would actually cost -
 * which is the only thing anyone hesitating over that button wants to know.
 */
import { useApi, postApi } from "../hooks/use-api";
import { useEffect, useState } from "react";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import { toast } from "../components/ui/vermilion";
import { Empty } from "../components/ui/states";

export function DaemonControl({
  t,
  sse,
}: {
  readonly t: TFunction;
  readonly sse: { readonly messages: ReadonlyArray<SSEMessage> };
}) {
  const { data, refetch } = useApi<{ running: boolean }>("/daemon");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!shouldRefetchDaemonStatus(recent)) return;
    void refetch();
  }, [refetch, sse.messages]);

  const events = sse.messages
    .filter((m) => m.event.startsWith("daemon:") || m.event === "log")
    .slice(-40);

  const running = data?.running ?? false;

  const toggle = async () => {
    setBusy(true);
    try {
      await postApi(running ? "/daemon/stop" : "/daemon/start");
      toast(running ? "Stopping after the current chapter." : "The daemon is picking up work.");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not take.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <section className="panel crop" style={{ overflow: "hidden" }}>
        <span className="disc fill" style={{ width: 230, height: 230, right: -70, top: -96, opacity: 0.1 }} />
        <span className="disc stroke" style={{ width: 150, height: 150, right: 34, top: 22, opacity: 0.28 }} />
        <div className="rowflex" style={{ alignItems: "center", gap: 20, flexWrap: "wrap", position: "relative" }}>
          <span className="grow" style={{ minWidth: 250 }}>
            <h2 className="h-page" style={{ margin: 0 }}>
              {running ? "The daemon is running" : "The daemon is stopped"}
            </h2>
            <p className="muted" style={{ fontSize: 14, marginTop: 9, maxWidth: "52ch" }}>
              {running
                ? "It picks up whatever the plan says is next and stops at anything that needs you. Stopping is safe and takes effect after the current chapter — everything already written stays on disk."
                : "Nothing is being written automatically. Start it and it works through the plan on its own, stopping at every gate that needs a person."}
            </p>
          </span>
          <button
            type="button"
            className={running ? "btn btn-line" : "btn"}
            style={{ padding: "13px 22px", fontSize: 17.5 }}
            disabled={busy}
            onClick={() => void toggle()}
          >
            {busy
              ? running ? t("daemon.stopping") : t("daemon.starting")
              : running ? "Stop the daemon" : "Start the daemon"}
          </button>
        </div>
      </section>

      <section>
        <div className="panel panel-flush">
          <div className="panel-head">
            <h3 className="h-panel grow">{t("daemon.eventLog")}</h3>
            <span className={running ? "pill pill-ok" : "pill"}>
              {running ? t("daemon.running") : t("daemon.stopped")}
            </span>
          </div>
          <div className="panel-body scroll-y" style={{ maxHeight: 500 }}>
            {events.length === 0 ? (
              <Empty icon="cpu" title={running ? "Nothing has happened yet." : "The daemon is off."}>
                {running ? t("daemon.waitingEvents") : t("daemon.startHint")}
              </Empty>
            ) : (
              <div className="rows">
                {events.map((m, i) => {
                  const d = (m.data ?? {}) as Record<string, unknown>;
                  const text = String(d.message ?? d.title ?? d.bookId ?? JSON.stringify(d));
                  const bad = m.event.endsWith(":error");
                  return (
                    <div className="row" key={`${m.seq}-${i}`} style={{ padding: "8px 4px" }}>
                      <span className={bad ? "pill pill-bad mono" : "pill mono"} style={{ fontSize: 11 }}>
                        {m.event}
                      </span>
                      <span className="grow trunc mono" style={{ fontSize: 11 }}>{text}</span>
                      <span className="meta tnum">
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
