/**
 * Updates, on a page instead of in a floating panel.
 *
 * The shell owns the Tauri calls — only it can check, download and restart —
 * but it no longer owns a panel to show them in. So it publishes its state and
 * takes three requests, and this renders them where the rest of the machine's
 * settings are. A separate window furniture for one row of text was the reason
 * the shell had a settings drawer at all.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";

interface UpdateState {
  readonly status: "idle" | "checking" | "current" | "available" | "installing" | "error" | "dev" | "unavailable";
  readonly message: string;
  readonly version: string;
  readonly available: boolean;
  readonly dev: boolean;
  readonly auto: boolean;
  readonly checkedAt: number;
}

const ask = (quire: string, extra?: Record<string, unknown>) =>
  window.parent?.postMessage({ quire, ...extra }, "*");

export function AppUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.quire !== "update:state") return;
      setState(e.data as UpdateState);
    };
    window.addEventListener("message", onMessage);
    // The shell may have published before this mounted, so ask once.
    ask("update:state");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const check = useCallback(() => ask("update:check"), []);

  // Outside the desktop shell there is nothing to update and nobody listening.
  if (!state) return null;

  const checked = state.checkedAt
    ? new Date(state.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section className="q-crop rounded-2xl border border-border/60 bg-card p-6 shadow-sm sm:p-7">
      <header className="relative flex items-start gap-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[1.5px] border-primary text-primary" aria-hidden>
          <ArrowDownToLine size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="q-title text-lg">Updates</h2>
          <p className="q-note mt-1.5">
            {state.version ? `Quire ${state.version}` : "Quire"}
            {checked ? ` · checked ${checked}` : ""}
          </p>
        </div>
      </header>

      <div className="relative mt-6 flex flex-wrap items-center gap-3">
        <p className={`text-sm grow ${state.status === "error" ? "text-destructive" : ""}`}>
          {state.message || "Not checked yet"}
        </p>

        {state.available ? (
          <button
            type="button"
            disabled={state.status === "installing"}
            onClick={() => ask("update:install")}
            className="q-btn q-btn-fill text-sm disabled:opacity-40"
          >
            Install and restart
          </button>
        ) : null}

        {!state.dev ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.auto}
              onChange={(e) => ask("update:auto", { value: e.target.checked })}
            />
            Automatic
          </label>
        ) : null}

        <button
          type="button"
          disabled={state.status === "checking" || state.status === "installing"}
          onClick={check}
          className="q-btn q-btn-line text-sm disabled:opacity-40"
        >
          {state.status === "checking" ? "Checking…" : "Check now"}
        </button>
      </div>
    </section>
  );
}
