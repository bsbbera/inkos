import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { ProjectSettings } from "./ProjectSettings";
import { McpPage } from "./McpPage";
import { Bot, Cpu, HardDriveDownload, Image as ImageIcon, PlugZap, RefreshCw } from "../components/ui/glyphs";
import { ModelRouting } from "./ModelRouting";
import { AppUpdates } from "./AppUpdates";
import { SearchFallback } from "./SearchFallback";
import { WorkspaceFolder } from "./WorkspaceFolder";
import { Connections } from "./Connections";
import { CoverConfigCard, PersonalSourcesCard, PictureEngineCard } from "./MachineCards";
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

import { Spinner, Working } from "../components/ui/working";
import { Failed } from "../components/ui/states";
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
    <section className="panel crop">
      <header className="relative flex items-start gap-3.5">
        <span
          className="icon-ring"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="h-panel">{title}</h2>
          <p className="note mt-1.5">{note}</p>
        </div>
      </header>
      <div className="relative mt-6">{children}</div>
    </section>
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
      {error ? <div className="mb-4"><Failed what="That did not work." detail={error} /></div> : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className={`pill ${status?.up ? "pill-fill" : status?.installed ? "" : "pill-bad"}`}>
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
              className="h-full origin-left bg-primary transition-transform duration-(--med)"
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
        <div className="mt-3"><Failed what="Install failed." detail={install.error} /></div>
      ) : null}

      {status?.installed ? (
        <div className="mt-5">
          <label htmlFor="comfy-workflow" className="label">
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
              className="btn btn-line text-sm"
            >
              Add…
            </button>
            {status.workflow && !status.workflow.builtin ? (
              <button
                type="button"
                onClick={() => void act(() => shimDelete(`/comfy/workflows/${status.workflow!.id}`))}
                className="btn btn-bad btn-sm"
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
            className="btn text-sm"
          >
            <HardDriveDownload size={15} />
            Install ComfyUI
          </button>
        ) : null}
        {status?.installed && !status.up ? (
          <button
            type="button"
            onClick={() => void act(() => shimPost("/comfy/start"))}
            className="btn text-sm"
          >
            Start
          </button>
        ) : null}
        {status?.up ? (
          <button
            type="button"
            onClick={() => void act(() => shimPost("/comfy/benchmark"))}
            className="btn btn-line text-sm"
          >
            Benchmark
          </button>
        ) : null}
      </div>
    </Section>
  );
}

const TABS = [
  { id: "machine", label: "Machine", note: "What this computer can do: CLIs, images, hardware." },
  { id: "providers", label: "Connections", note: "Every way this machine reaches a model: an API key, an installed CLI, a local server." },
  { id: "agents", label: "Agents", note: "Which model answers for which agent. Set once." },
  { id: "project", label: "Project", note: "This project: appearance, language, notifications, skills and prompts." },
  { id: "mcp", label: "MCP", note: "Tool servers found on this machine, offered to every model." },
] as const;

/* Two tabs keep the address they had as pages, so old links still land. */
const TAB_HASH: Partial<Record<string, string>> = { project: "#/settings", mcp: "#/mcp" };

type SetupTab = (typeof TABS)[number]["id"];

/**
 * One page for the machine, its models and its agents.
 *
 * These were three screens — Setup, Model config, and a card buried in Project
 * settings — and the provider list was drawn on two of them from two different
 * scans. Splitting a single question ("what is this thing running on?") across
 * three rail entries is how a person loses the model picker entirely.
 */
export function SetupPage({
  nav,
  tab,
  theme,
  t,
}: {
  readonly nav: ComponentProps<typeof ProjectSettings>["nav"] & ComponentProps<typeof McpPage>["nav"] & {
    readonly toDashboard: () => void;
  };
  readonly tab?: SetupTab;
  readonly theme: ComponentProps<typeof ProjectSettings>["theme"];
  readonly t: ComponentProps<typeof ProjectSettings>["t"];
}) {
  const [active, setActive] = useState<SetupTab>(tab ?? "machine");
  useEffect(() => { if (tab) setActive(tab); }, [tab]);
  const current = TABS.find((entry) => entry.id === active) ?? TABS[0];

  return (
    <div className="space-y-6">
      <header className="head">
        <p className="label">How this is set up</p>
        <h1 className="h-page mt-3">Settings</h1>
        <p>{current.note}</p>
      </header>

      <div role="tablist" aria-label="Settings sections" className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={entry.id === active}
            onClick={() => { setActive(entry.id); window.location.hash = TAB_HASH[entry.id] ?? `#/setup/${entry.id}`; }}
            className="tab"
          >
            {entry.label}
          </button>
        ))}
      </div>

      {active === "machine" ? (
        <>
          <WorkspaceFolder />
          <Images />
          <PictureEngineCard />
          <CoverConfigCard />
          <PersonalSourcesCard />
          <AppUpdates />
        </>
      ) : null}
      {active === "providers" ? (
        <>
          <Connections />
          <SearchFallback />
        </>
      ) : null}
      {active === "agents" ? (
        <Section
          icon={<Bot size={18} />}
          title="Agent models"
          note="A pin here beats the default. An unreachable pin falls back to it."
        >
          <ModelRouting
            onOpenModelConfig={() => { setActive("providers"); window.location.hash = "#/setup/providers"; }}
            labels={{
              globalDefault: "Default model",
              noModel: "No model selected yet",
              openModelConfig: "Providers",
              usesDefault: "uses the default",
            }}
          />
        </Section>
      ) : null}
      {active === "project" ? <ProjectSettings nav={nav} theme={theme} t={t} embedded /> : null}
      {active === "mcp" ? <McpPage nav={nav} theme={theme} t={t} embedded /> : null}
      {/* The licence credit. It sat under the sidebar on every screen; it is
          owed, not news, so it lives with the rest of how this is set up. */}
      <p className="hint text-center">
        Quire's workbench is forked from <b className="font-semibold">InkOS Studio</b>, AGPL-3.0.
      </p>
    </div>
  );
}
