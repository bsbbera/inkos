/**
 * The search fallback, on the page that holds every other key.
 *
 * Not a provider you choose between: the model you already picked is asked
 * first, and most of them browse. This is what answers when the one you pinned
 * cannot — so it belongs beside the model connections, not on a settings page
 * of its own with a provider dropdown implying a choice nobody makes.
 */
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { putApi, useApi } from "../hooks/use-api";

interface Draft {
  readonly enabled: boolean;
  readonly provider: "tavily" | "brave" | "custom";
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiKeyEnv: string;
}

const EMPTY: Draft = {
  enabled: false, provider: "tavily", baseUrl: "", apiKey: "", apiKeyEnv: "TAVILY_API_KEY",
};

const field = "w-full rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs";

export function SearchFallback() {
  const { data, refetch } = useApi<{ researchSearch: Partial<Draft> }>("/project/research-search");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const raw = data.researchSearch ?? {};
    setDraft({
      enabled: Boolean(raw.enabled),
      provider: raw.provider === "brave" ? "brave" : raw.provider === "custom" ? "custom" : "tavily",
      baseUrl: raw.baseUrl ?? "",
      apiKey: raw.apiKey ?? "",
      apiKeyEnv: raw.apiKeyEnv ?? "TAVILY_API_KEY",
    });
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await putApi("/project/research-search", {
        researchSearch: {
          enabled: draft.enabled,
          provider: draft.provider,
          ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
          ...(draft.apiKeyEnv.trim() ? { apiKeyEnv: draft.apiKeyEnv.trim() } : {}),
        },
      });
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="q-crop rounded-2xl border border-border/60 bg-card p-6 shadow-sm sm:p-7">
      <header className="relative flex items-start gap-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[1.5px] border-primary text-primary" aria-hidden>
          <Search size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="q-title text-lg">Search fallback</h2>
          <p className="q-note mt-1.5">
            Agents search with their own model first — every CLI browses. This answers
            for a model that cannot, and for nothing else.
          </p>
        </div>
      </header>

      <div className="relative mt-6 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((p) => ({ ...p, enabled: e.target.checked }))}
          />
          Use a search API when the model cannot search
        </label>

        {draft.enabled ? (
          <div className="grid gap-2 md:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Provider</span>
              <select
                value={draft.provider}
                onChange={(e) => setDraft((p) => ({ ...p, provider: e.target.value as Draft["provider"] }))}
                className={field}
              >
                <option value="tavily">Tavily</option>
                <option value="brave">Brave</option>
                <option value="custom">Custom / Tavily-compatible</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>API key env var</span>
              <input
                value={draft.apiKeyEnv}
                onChange={(e) => setDraft((p) => ({ ...p, apiKeyEnv: e.target.value }))}
                placeholder="TAVILY_API_KEY"
                className={`${field} font-mono`}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">
              <span>Base URL (optional, for a compatible endpoint)</span>
              <input
                value={draft.baseUrl}
                onChange={(e) => setDraft((p) => ({ ...p, baseUrl: e.target.value }))}
                placeholder="https://api.tavily.com/search"
                className={`${field} font-mono`}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">
              <span>API key (optional; blank reads the env var)</span>
              <input
                value={draft.apiKey}
                onChange={(e) => setDraft((p) => ({ ...p, apiKey: e.target.value }))}
                type="password"
                placeholder="Paste a key, or use the env var only"
                className={`${field} font-mono`}
              />
            </label>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => { void save(); }}
          disabled={saving}
          className="q-btn q-btn-line text-sm disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
