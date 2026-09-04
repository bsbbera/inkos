import { useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Plus, Search, X } from "lucide-react";
import { GROUP_ORDER, getGroupDescription, getGroupLabel, getGroupShortLabel } from "../constants/service-groups";
import { tr } from "../lib/app-language";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import type { EndpointGroup, ServiceInfo } from "../store/service";
import { ServiceQuickLinks, getServiceQuickLinks } from "../components/ServiceQuickLinks";
import { ServiceConfigSourceCard } from "../components/ServiceConfigSourceCard";

interface Nav {
  toDashboard: () => void;
  toServiceDetail: (id: string) => void;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border/30 p-5 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="w-2 h-2 rounded-full bg-muted" />
      </div>
      <div className="h-3 w-16 bg-muted/60 rounded" />
    </div>
  );
}

function ServiceCard({ svc, onClick }: { svc: ServiceInfo; onClick: () => void }) {
  const quickLinks = getServiceQuickLinks(svc.service);
  return (
    <div
      className={[
        "q-crop group flex min-h-[92px] flex-col gap-2 rounded-xl border bg-card p-5 text-left",
        "transition-[transform,box-shadow,border-color] duration-[var(--dur-med)] ease-[var(--ease-out-quart)]",
        "hover:-translate-y-0.5 hover:shadow-md",
        svc.connected
          ? "border-border/60 hover:border-primary/45"
          : "border-border/40 hover:border-border",
      ].join(" ")}
    >
      {svc.connected && (
        <span
          className="q-disc q-disc-fill transition-transform duration-[var(--dur-med)] ease-[var(--ease-out-quart)] group-hover:scale-125"
          aria-hidden="true"
          style={{ width: 84, height: 84, right: -32, top: -36, opacity: .13 }}
        />
      )}
      <button onClick={onClick} className="relative flex flex-1 flex-col gap-2.5 text-left">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-sm font-semibold">{svc.label}</span>
          <span className="q-glyph !h-7 !w-7 shrink-0 !text-[11px]" aria-hidden="true">
            {svc.label.slice(0, 1).toUpperCase()}
          </span>
        </div>
        <span className={`q-pill ${svc.connected ? "q-pill-ok" : ""}`}>
          {svc.connected ? tr("已连接", "Connected") : tr("未配置", "Not configured")}
        </span>
      </button>
      {quickLinks.length > 0 && (
        <ServiceQuickLinks serviceId={svc.service} variant="card" className="pt-1" />
      )}
    </div>
  );
}

interface CoverProviderInfo {
  readonly service: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly connected: boolean;
  readonly needsKey?: boolean;
}

interface CoverConfigPayload {
  readonly service: string | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly providers: readonly CoverProviderInfo[];
}

function CoverConfigCard() {
  const [providers, setProviders] = useState<readonly CoverProviderInfo[]>([]);
  const [service, setService] = useState("kkaiapi");
  const [model, setModel] = useState("gpt-image-2");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState("");

  const selected = providers.find((provider) => provider.service === service);
  // A provider that renders on this machine has no endpoint to point at and no
  // key to hold; showing both fields anyway reads as "unfinished setup".
  const needsKey = selected?.needsKey !== false;

  useEffect(() => {
    let cancelled = false;
    void fetchJson<CoverConfigPayload>("/cover/config")
      .then((payload) => {
        if (cancelled) return;
        setProviders(payload.providers);
        const nextService = payload.service ?? payload.providers[0]?.service ?? "kkaiapi";
        const provider = payload.providers.find((item) => item.service === nextService) ?? payload.providers[0];
        setService(nextService);
        setModel(payload.model ?? provider?.defaultModel ?? "gpt-image-2");
        setBaseUrl(payload.baseUrl ?? "");
        setStatus("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : tr("读取封面配置失败", "Failed to load cover config"));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    void fetchJson<{ apiKey?: string }>(`/cover/secret/${encodeURIComponent(service)}`)
      .then((payload) => {
        if (cancelled) return;
        setApiKey(payload.apiKey ?? "");
      })
      .catch(() => {
        if (!cancelled) setApiKey("");
      });
    return () => { cancelled = true; };
  }, [service]);

  const handleServiceChange = (nextService: string) => {
    const provider = providers.find((item) => item.service === nextService);
    setService(nextService);
    setModel(provider?.defaultModel ?? "gpt-image-2");
    setBaseUrl("");
    setStatus("idle");
    setMessage("");
  };

  const handleSave = async () => {
    const provider = selected;
    if (!provider) return;
    setStatus("saving");
    setMessage("");
    try {
      if (provider.needsKey !== false) {
        await fetchJson(`/cover/secret/${encodeURIComponent(provider.service)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });
      }
      await fetchJson("/cover/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: provider.service,
          model,
          ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        }),
      });
      setStatus("saved");
      setMessage(tr("封面配置已保存", "Cover config saved"));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : tr("保存封面配置失败", "Failed to save cover config"));
    }
  };

  if (providers.length === 0 && status !== "error") return null;

  return (
    <section className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">{tr("封面生成", "Cover generation")}</h2>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {tr(
              "只配置封面通道和模型；封面尺寸由短篇封面提示词和内部默认处理。",
              "Only configures the cover provider and model; cover size is handled by the short-story cover prompt and internal defaults.",
            )}
          </p>
        </div>
        {selected?.connected && (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
            {needsKey ? tr("已有密钥", "Key saved") : tr("本机渲染", "Runs on this machine")}
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground/70">{tr("服务", "Service")}</span>
          <select
            value={service}
            onChange={(event) => handleServiceChange(event.target.value)}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
          >
            {providers.map((provider) => (
              <option key={provider.service} value={provider.service}>{provider.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground/70">{tr("封面模型", "Cover model")}</span>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
          >
            {(selected?.models ?? [model]).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>

      {needsKey && (
      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground/70">Base URL</span>
        <input
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={selected?.baseUrl ?? "https://example.com/v1"}
          className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
        />
        <span className="block text-[11px] leading-5 text-muted-foreground/55">
          {tr(
            "留空使用该服务的默认地址；自定义地址会作为封面生成 API 根路径。",
            "Leave blank to use the provider default; a custom value becomes the cover generation API root.",
          )}
        </span>
      </label>
      )}

      {needsKey ? (
      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground/70">API Key</span>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-..."
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey((value) => !value)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>
      ) : (
        <p className="text-[11px] leading-5 text-muted-foreground/55">
          {tr(
            "图像在本机的 ComfyUI 中生成：无需密钥，离线可用。工作流与硬件设置在 Quire 的设置面板中。",
            "Images render locally in ComfyUI: no key, works offline. The workflow and hardware settings live in Quire's settings panel.",
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          disabled={status === "saving" || !selected}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {status === "saving" && <Loader2 size={12} className="animate-spin" />}
          {tr("保存封面配置", "Save cover config")}
        </button>
        {message && (
          <span className={`text-xs ${status === "error" ? "text-destructive" : "text-success"}`}>
            {message}
          </span>
        )}
      </div>
    </section>
  );
}

export function ServiceListPage({ nav }: { nav: Nav }) {
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const [query, setQuery] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<Set<EndpointGroup>>(new Set());
  const [onlyConnected, setOnlyConnected] = useState(false);

  const bankServices = useMemo(
    () => services.filter((s) => !s.service.startsWith("custom")),
    [services],
  );
  const customServices = useMemo(
    () => services.filter((s) => s.service.startsWith("custom")),
    [services],
  );

  const groupCounts = useMemo(() => {
    const counts = {} as Record<EndpointGroup, number>;
    for (const group of GROUP_ORDER) {
      counts[group] = bankServices.filter((s) => s.group === group).length;
    }
    return counts;
  }, [bankServices]);

  const connectedCount = useMemo(
    () => services.filter((s) => s.connected).length,
    [services],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bankServices.filter((svc) => {
      if (onlyConnected && !svc.connected) return false;
      if (selectedGroups.size > 0 && (!svc.group || !selectedGroups.has(svc.group))) return false;
      if (q && !svc.label.toLowerCase().includes(q) && !svc.service.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [bankServices, onlyConnected, query, selectedGroups]);

  const filteredCustom = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (selectedGroups.size > 0) return [];
    return customServices.filter((svc) => {
      if (onlyConnected && !svc.connected) return false;
      if (q && !svc.label.toLowerCase().includes(q) && !svc.service.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [customServices, onlyConnected, query, selectedGroups]);

  const byGroup = useMemo(() => {
    const map = {} as Record<EndpointGroup, ServiceInfo[]>;
    for (const group of GROUP_ORDER) map[group] = [];
    for (const svc of filtered) {
      if (svc.group) map[svc.group].push(svc);
    }
    return map;
  }, [filtered]);

  const toggleGroup = (group: EndpointGroup) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const canCreateCustom = selectedGroups.size === 0 && query.trim() === "" && !onlyConnected;
  const showCustomSection = !loading && selectedGroups.size === 0 && (filteredCustom.length > 0 || canCreateCustom);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="q-head">
        <p className="q-label">{tr("模型", "Models")}</p>
        <h1 className="mt-3">{tr("服务商管理", "Providers")}</h1>
      </header>

      <ServiceConfigSourceCard onChange={() => { void refreshServices(); }} />

      <CoverConfigCard />

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr("搜索服务商", "Search providers")}
          className="w-full py-2 pl-9 pr-9 text-sm"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            aria-label={tr("清空搜索", "Clear search")}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedGroups(new Set())}
          className={[
            "q-pill cursor-pointer transition-colors duration-[var(--dur-fast)]",
            selectedGroups.size === 0
              ? "q-pill-fill"
              : "hover:border-primary/40 hover:text-primary",
          ].join(" ")}
        >
          {tr("全部", "All")} {bankServices.length}
        </button>
        {GROUP_ORDER.map((group) => {
          const selected = selectedGroups.has(group);
          return (
            <button
              key={group}
              onClick={() => toggleGroup(group)}
              className={[
                "q-pill cursor-pointer transition-colors duration-[var(--dur-fast)]",
                selected
                  ? "q-pill-fill"
                  : "hover:border-primary/40 hover:text-primary",
              ].join(" ")}
            >
              {selected && <Check size={12} />}
              {getGroupShortLabel(group)} {groupCounts[group]}
            </button>
          );
        })}
        {selectedGroups.size > 0 && (
          <button
            onClick={() => setSelectedGroups(new Set())}
            className="inline-flex items-center rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {tr("清除筛选", "Clear filters")}
          </button>
        )}
      </div>

      <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={onlyConnected}
          onChange={(event) => setOnlyConnected(event.target.checked)}
        />
        <span>{tr("只看已连接", "Connected only")} ({connectedCount})</span>
      </label>

      <div className="h-px bg-border/30" />

      {loading && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {!loading && GROUP_ORDER.map((group) => {
        const list = byGroup[group];
        if (!list || list.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <div className="space-y-1">
              <h2 className="q-label">
                {getGroupLabel(group)}
              </h2>
              {getGroupDescription(group) && (
                <p className="text-xs text-muted-foreground/60">
                  {getGroupDescription(group)}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {list.map((svc) => (
                <ServiceCard
                  key={svc.service}
                  svc={svc}
                  onClick={() => nav.toServiceDetail(svc.service)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {showCustomSection && (
        <section className="space-y-3">
          <h2 className="q-label">
            {tr("自定义服务", "Custom services")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {filteredCustom.map((svc) => (
              <ServiceCard
                key={svc.service}
                svc={svc}
                onClick={() => nav.toServiceDetail(svc.service)}
              />
            ))}
            {canCreateCustom && (
              <button
                onClick={() => nav.toServiceDetail("custom")}
                className="group flex min-h-[92px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border/60 p-5 text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:border-primary/50 hover:text-primary"
              >
                <span className="q-glyph !h-9 !w-9 group-hover:!border-primary group-hover:!bg-primary group-hover:!text-primary-foreground">
                  <Plus size={16} />
                </span>
                <span className="text-xs">{tr("自定义服务", "Custom service")}</span>
              </button>
            )}
          </div>
        </section>
      )}

      {!loading && filtered.length === 0 && filteredCustom.length === 0 && !canCreateCustom && (
        <div className="q-crop rounded-2xl border border-border/60 bg-card p-10 text-center">
          <span className="q-disc q-disc-dots text-primary" aria-hidden="true"
                style={{ width: 96, height: 96, left: -30, bottom: -36, opacity: .4 }} />
          <p className="relative text-sm text-muted-foreground">
            {tr("没有匹配的服务商", "No matching providers")}
          </p>
        </div>
      )}
    </div>
  );
}
