import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, HardDriveDownload, Image as ImageIcon, PlugZap, RefreshCw } from "lucide-react";
import {
  shimAsset,
  shimDelete,
  shimGet,
  shimPost,
  shimPut,
  type ComfyStatus,
  type ComfyWorkflow,
  type ShimStatus,
} from "../lib/shim";

/**
 * Setup: the machine's own settings, which used to live in the launcher's
 * drawer — a second app in an iframe over this one, with its own stylesheet,
 * its own theme and its own copy of the palette. Everything here reads the
 * same shim endpoints the drawer read; the difference is that it is one app now.
 */

const gb = (n: number) => (n / 1e9).toFixed(1) + " GB";

function Section({
  icon,
  title,
  note,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly note: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="q-crop rounded-2xl border border-border/60 bg-card p-6 shadow-sm sm:p-7">
      <span className="q-disc q-disc-fill" aria-hidden="true"
            style={{ width: 170, height: 170, right: -70, top: -76, opacity: .1 }} />
      <header className="relative flex items-start gap-3.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[1.5px] border-primary text-primary"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="q-title text-lg">{title}</h2>
          <p className="q-note mt-1.5">{note}</p>
        </div>
      </header>
      <div className="relative mt-6">{children}</div>
    </section>
  );
}

function Providers() {
  const [status, setStatus] = useState<ShimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (fresh?: boolean) => {
    setBusy(true);
    try {
      setStatus(await shimGet<ShimStatus>(`/status${fresh ? "?fresh=1" : ""}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section
      icon={<PlugZap size={18} />}
      title="Providers"
      note="Detected from the CLIs installed on this machine. Models are chosen per project, in the workbench."
    >
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !status ? (
        <p className="text-sm text-muted-foreground">Scanning…</p>
      ) : status.agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No provider CLIs found. Install one (Claude Code, Codex, Gemini) and re-scan.
        </p>
      ) : (
        <ul className="divide-y divide-border/50 border-y border-border/50">
          {status.agents.map((a) => (
            <li key={a.id} className="q-row group flex items-center gap-3.5 py-3">
              <span className="q-glyph overflow-hidden !p-0">
                <img
                  src={shimAsset(a.id)}
                  alt=""
                  className="h-4 w-4"
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{a.id}</div>
                <div className="truncate text-xs text-muted-foreground" title={a.version}>
                  {a.version}
                </div>
              </div>
              <span className="q-numeral shrink-0 text-2xl">{a.models}</span>
              <span className="q-label shrink-0">models</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={busy}
          className="q-btn q-btn-line text-sm"
        >
          <RefreshCw size={15} className={busy ? "animate-spin" : undefined} />
          Re-scan
        </button>
        {status ? (
          <p className="text-xs text-muted-foreground">
            shim :{status.port} · {status.total} models
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function Images() {
  const [status, setStatus] = useState<ComfyStatus | null>(null);
  const [workflows, setWorkflows] = useState<ReadonlyArray<ComfyWorkflow>>([]);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await shimGet<ComfyStatus>("/comfy/status");
      setStatus(s);
      setError(null);
      if (s.installed) {
        const w = await shimGet<{ workflows: ReadonlyArray<ComfyWorkflow> }>("/comfy/workflows");
        setWorkflows(w.workflows);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only while an install is actually running. The drawer polled forever.
  const installing = !!status?.install && !status.install.done;
  useEffect(() => {
    if (!installing) return;
    const id = setInterval(() => void load(), 1500);
    return () => clearInterval(id);
  }, [installing, load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const install = status?.install;
  const frac = install?.total ? install.got / install.total : 0;

  return (
    <Section
      icon={<ImageIcon size={18} />}
      title="Images"
      note="ComfyUI is the one dependency Quire installs for you. It belongs to the machine, not to a book."
    >
      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className={`q-pill ${status?.up ? "q-pill-fill" : status?.installed ? "" : "q-pill-bad"}`}>
          {status?.up ? "running" : status?.installed ? "installed" : "not installed"}
        </span>
        {status ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Cpu size={13} />
            {status.device}
          </span>
        ) : null}
        {status?.dir ? (
          <span className="truncate text-xs text-muted-foreground" title={status.dir}>
            {status.dir}
          </span>
        ) : null}
      </div>

      {installing && install ? (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full origin-left bg-primary transition-transform duration-[var(--dur-med)] ease-[var(--ease-out-quart)]"
              style={{ transform: `scaleX(${frac.toFixed(3)})` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {install.total
              ? `${install.step} · ${gb(install.got)} of ${gb(install.total)} · ${Math.round(frac * 100)}%`
              : `${install.step}…`}
          </p>
        </div>
      ) : install?.error ? (
        <p className="mt-3 text-sm text-destructive">Install failed: {install.error}</p>
      ) : null}

      {status?.installed ? (
        <div className="mt-5">
          <label htmlFor="comfy-workflow" className="q-label">
            Workflow
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              id="comfy-workflow"
              value={status.workflow?.id ?? ""}
              onChange={(e) => void act(() => shimPut(`/comfy/workflows/${e.target.value}`))}
              className="min-w-56 text-sm"
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                  {w.builtin ? " (built in)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="q-btn q-btn-line text-sm"
            >
              Add…
            </button>
            {status.workflow && !status.workflow.builtin ? (
              <button
                type="button"
                onClick={() => void act(() => shimDelete(`/comfy/workflows/${status.workflow!.id}`))}
                className="q-btn q-btn-line !text-destructive !border-destructive/40 hover:!bg-destructive/10 text-sm"
              >
                Delete
              </button>
            ) : null}
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                // The shim validates and stores the workflow document itself.
                await act(() => shimPost("/comfy/workflows", JSON.parse(text)));
                e.target.value = "";
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {!status?.installed && !installing ? (
          <button
            type="button"
            onClick={() => void act(() => shimPost("/comfy/install"))}
            className="q-btn text-sm"
          >
            <HardDriveDownload size={15} />
            Install ComfyUI
          </button>
        ) : null}
        {status?.installed && !status.up ? (
          <button
            type="button"
            onClick={() => void act(() => shimPost("/comfy/start"))}
            className="q-btn text-sm"
          >
            Start
          </button>
        ) : null}
        {status?.up ? (
          <button
            type="button"
            onClick={() => void act(() => shimPost("/comfy/benchmark"))}
            className="q-btn q-btn-line text-sm"
          >
            Benchmark
          </button>
        ) : null}
      </div>
    </Section>
  );
}

export function SetupPage() {
  return (
    <div className="space-y-6">
      <header className="q-head">
        <p className="q-label">This machine</p>
        <h1 className="mt-3">Setup</h1>
        <p>What this machine can do. Project and model choices live with the project.</p>
      </header>
      <Providers />
      <Images />
    </div>
  );
}
