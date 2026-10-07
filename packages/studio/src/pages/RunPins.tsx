/**
 * This production's own model pins, over the project's.
 *
 * Same jobs and same pickers as Model routing, but the choice is kept on this
 * production's run (PUT .../model-overrides) and read by its next unit of work.
 * A job left on "uses the default" follows the project's pins, then its preset.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelCombo } from "./ModelCombo";
import { fetchJson, putApi } from "../hooks/use-api";
import { stoppedAnswering } from "../store/service/types";
import { useServiceStore } from "../store/service";
import {
  jobRows,
  parsePinValue,
  pinnedCount,
  withJobPin,
  type ModelPin,
  type RoutingTable,
} from "./model-routing-state";

export function RunPins({ type, id }: { readonly type: string; readonly id: string }) {
  const [table, setTable] = useState<RoutingTable | null>(null);
  const [pins, setPins] = useState<Record<string, ModelPin>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);

  const base = `/productions/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
  useEffect(() => {
    void fetchServices();
    void fetchBankModels();
    void Promise.all([
      fetchJson<RoutingTable>("/project/model-routing"),
      fetchJson<{ state?: { modelOverrides?: Record<string, ModelPin> } | null }>(`${base}/pipeline`),
    ]).then(([t, p]) => {
      setTable(t);
      setPins(p.state?.modelOverrides ?? {});
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [base, fetchServices, fetchBankModels]);

  const choices = useMemo(
    () => services
      .filter((s) => s.connected && (modelsByService[s.service]?.length ?? 0) > 0)
      .map((s) => ({ service: s.service, label: s.label, models: modelsByService[s.service]! })),
    [services, modelsByService],
  );
  const down = useMemo(() => stoppedAnswering(services), [services]);

  const save = useCallback(async (overrides: Record<string, ModelPin>) => {
    setPins(overrides);
    setSaving(true);
    try {
      await putApi(`${base}/model-overrides`, { overrides });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [base]);

  // jobRows reads pins from the table; show this production's, not the project's.
  const rows = jobRows(table ? { ...table, overrides: pins } : null);
  if (!rows.length) return null;

  return (
    <details className="mb-4 relative">
      <summary className="label cursor-pointer">
        Models for this production{pinnedCount(pins) ? ` · ${pinnedCount(pins)} pinned` : ""}
      </summary>
      <div className="well p-0 divide-y divide-(--line) mt-2">
        {rows.map(({ job, value }) => (
          <div key={job.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <div className="min-w-45 grow text-sm">{job.label}</div>
            <ModelCombo
              groups={choices}
              down={down}
              disabled={saving}
              emptyLabel="Uses the project's choice"
              display=""
              value={value}
              onPick={(next) => { void save(withJobPin(pins, job, parsePinValue(next))); }}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1">Applies from this production's next unit of work.</p>
      {error ? <p className="text-xs text-destructive mt-1">{error}</p> : null}
    </details>
  );
}
