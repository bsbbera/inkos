/*
 * The daemon. Mock 33.
 *
 * One big reversible switch and a window onto what it is doing. The state is
 * a sentence, not a badge: "the daemon is running" tells you more than a green
 * dot, and the paragraph under it says what stopping would actually cost -
 * which is the only thing anyone hesitating over that button wants to know.
 */
import { PageHead } from "../components/ui/page-head";
import { useApi, postApi } from "../hooks/use-api";
import { useEffect, useState } from "react";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchDaemonStatus } from "../hooks/use-book-activity";
import { toast } from "../components/ui/vermilion";
import { Empty } from "../components/ui/states";
import { Orb } from "../components/ui/working";

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
      <PageHead
        title={<span className="rowflex gap-3">{running ? <Orb state="working" tone="ok" /> : <span className="live-dot" aria-hidden="true" />}{running ? "The daemon is running" : "The daemon is stopped"}</span>}
        lede={running
          ? "It picks up whatever the plan says is next and stops at anything that needs you. Stopping is safe and takes effect after the current chapter — everything already written stays on disk."
          : "Nothing is being written automatically. Start it and it works through the plan on its own, stopping at every gate that needs a person."}
        actions={
          <button type="button" className={running ? "btn btn-line" : "btn"} disabled={busy} onClick={() => void toggle()}>
            {busy
              ? running ? t("daemon.stopping") : t("daemon.starting")
              : running ? "Stop the daemon" : "Start the daemon"}
          </button>
        }
      />

      <section>
        <div className="panel panel-flush">
          <div className="panel-head">
            <h3 className="h-panel grow">What it has done</h3>
          </div>
          <div className="panel-body scroll-y max-h-125">
            {events.length === 0 ? (
              <Empty compact icon="cpu" title={running ? "Nothing yet. Each chapter it starts or finishes appears here." : "Each chapter it starts or finishes appears here while it runs."} />
            ) : (
              <div className="rows">
                {events.map((m, i) => {
                  const d = (m.data ?? {}) as Record<string, unknown>;
                  const text = String(d.message ?? d.title ?? d.bookId ?? JSON.stringify(d));
                  const bad = m.event.endsWith(":error");
                  return (
                    <div className="row py-2" key={`${m.seq}-${i}`}>
                      <span className={bad ? "pill pill-bad" : "pill"}>
                        {m.event.replace(/[:_-]+/g, " ")}
                      </span>
                      <span className="grow trunc text-body">{text}</span>
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
