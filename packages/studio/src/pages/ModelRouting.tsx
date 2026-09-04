/**
 * Agent model routing.
 *
 * The block that answers "who uses what", and the deliberate other half of Model
 * config, which answers "what can this machine reach". Providers, keys and base
 * URLs are not here on purpose: having them in two places is how the service
 * list and the model picker last disagreed, and the fix was to give each screen
 * one question.
 *
 * Every agent has a row whether or not it is pinned. A table of overrides only
 * cannot tell you that the auditor is running your most expensive model, which
 * is the thing a person opens this page to find out.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { ModelCombo } from "./ModelCombo";
import { fetchJson, putApi } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import {
  jobRows,
  parsePinValue,
  pinValue,
  routeSummary,
  routingGroups,
  withJobPin,
  withPin,
  type ModelPin,
  type RoutingTable,
} from "./model-routing-state";

const TONE: Record<"default" | "pinned" | "dropped", string> = {
  default: "text-muted-foreground italic",
  pinned: "font-mono",
  dropped: "text-destructive",
};

export function ModelRouting({
  onOpenModelConfig,
  labels,
}: {
  readonly onOpenModelConfig: () => void;
  readonly labels: {
    readonly globalDefault: string;
    readonly noModel: string;
    readonly openModelConfig: string;
    readonly usesDefault: string;
  };
}) {
  const [table, setTable] = useState<RoutingTable | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perAgent, setPerAgent] = useState(false);

  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);

  const load = useCallback(async () => {
    try {
      setTable(await fetchJson<RoutingTable>("/project/model-routing"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    void fetchServices();
    void fetchBankModels();
  }, [load, fetchServices, fetchBankModels]);

  /** Only what is reachable. Offering a model that cannot answer is the bug. */
  const choices = useMemo(
    () => services
      .filter((s) => s.connected && (modelsByService[s.service]?.length ?? 0) > 0)
      .map((s) => ({
        service: s.service,
        label: s.label,
        models: modelsByService[s.service]!,
      })),
    [services, modelsByService],
  );

  /**
   * The global default is set here, not in the composer.
   *
   * It used to be set only by the chat picker, which made the model a property
   * of the conversation you happened to be in — pick one for chat and every
   * pipeline silently followed. Choosing it beside the agents that inherit it
   * is where the choice belongs, and it is the one screen a person is meant to
   * leave and forget.
   */
  const saveGlobal = useCallback(async (value: string) => {
    const pin = parsePinValue(value);
    if (!pin || typeof pin === "string" || !pin.service) return;
    const chosen = choices
      .find((group) => group.service === pin.service)?.models
      .find((entry) => entry.id === pin.model);
    setSaving(true);
    try {
      await putApi("/project/default-model", {
        defaultModel: pin.model,
        service: pin.service,
        // A locally served model's real window is only stated in the catalogue
        // just read; without it the client assumes a generic 128k.
        ...(chosen?.contextWindow && chosen.contextWindow > 0
          ? { contextWindow: chosen.contextWindow }
          : {}),
      });
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [choices, load]);

  const save = useCallback(async (overrides: Record<string, ModelPin>) => {
    setSaving(true);
    // Optimistic: the row must not snap back while the write is in flight, and
    // the reload below replaces this with the server's resolved table anyway.
    setTable((prev) => (prev ? { ...prev, overrides } : prev));
    try {
      await putApi("/project/model-routing", { overrides });
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setSaving(false);
    }
  }, [load]);

  const groups = routingGroups(table);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{labels.globalDefault}</div>
            <p className="mt-1 font-mono text-sm">
              {table?.global.model
                ? <>
                    {table.global.service
                      ? <span className="text-muted-foreground">{table.global.service} · </span>
                      : null}
                    {table.global.model}
                  </>
                : <span className="text-muted-foreground italic">{labels.noModel}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ModelCombo
              groups={choices}
              disabled={saving}
              emptyLabel={labels.noModel}
              display={table?.global.service && table.global.model
                ? `${table.global.service} · ${table.global.model}`
                : ""}
              value={table?.global.service && table.global.model
                ? pinValue({ service: table.global.service, model: table.global.model })
                : ""}
              onPick={(next) => { void saveGlobal(next); }}
            />
            <button
              type="button"
              onClick={onOpenModelConfig}
              className="rounded-lg border border-border/60 px-3 py-1.5 text-sm font-semibold"
            >
              {labels.openModelConfig}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Used by chat and by every agent below that has no pin of its own.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="space-y-1">
        <h3 className="q-label">By job</h3>
        <div className="rounded-xl border border-border/60 divide-y divide-border/40">
          {jobRows(table).map(({ job, value, summary }) => (
            <div key={job.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-45 grow">
                <div className="text-sm font-semibold">{job.label}</div>
                <div className="text-xs text-muted-foreground">{job.does}</div>
              </div>
              <div className={`text-xs ${TONE[summary.tone]}`}>{summary.text}</div>
              <ModelCombo
                groups={choices}
                disabled={saving}
                emptyLabel={labels.usesDefault}
                display={summary.tone === "pinned" ? summary.text : ""}
                value={value}
                onPick={(next) => {
                  void save(withJobPin(table?.overrides ?? {}, job, parsePinValue(next)));
                }}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPerAgent((v) => !v)}
          className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {perAgent
            ? "Hide the individual agents"
            : `Set individual agents instead (${table?.roster.length ?? 0})`}
        </button>
      </div>

      {perAgent ? groups.map((group) => (

        <section key={group.id} className="space-y-1">
          <h3 className="q-label">{group.label}</h3>
          <div className="rounded-xl border border-border/60 divide-y divide-border/40">
            {group.rows.map(({ role, route, value }) => {
              const summary = routeSummary(route);
              return (
                <div key={role.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-45 grow">
                    <div className="text-sm font-semibold">{role.label}</div>
                    <div className="text-xs text-muted-foreground">{role.does}</div>
                  </div>
                  <div className={`text-xs ${TONE[summary.tone]}`}>{summary.text}</div>
                  <ModelCombo
                    groups={choices}
                    disabled={saving}
                    emptyLabel={labels.usesDefault}
                    display={summary.tone === "pinned" ? summary.text : ""}
                    value={value}
                    onPick={(next) => {
                      void save(withPin(table?.overrides ?? {}, role.id, parsePinValue(next)));
                    }}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void load(); void fetchBankModels(); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm font-semibold"
        >
          <RefreshCw size={14} aria-hidden />
          Refresh
        </button>
        {table && Object.keys(table.overrides).length > 0 ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => { void save({}); }}
            className="rounded-lg border border-border/60 px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            Clear every pin
          </button>
        ) : null}
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Bot size={13} aria-hidden />
          {table ? `${Object.keys(table.overrides).length} pinned of ${table.roster.length}` : "…"}
        </span>
      </div>
    </div>
  );
}
