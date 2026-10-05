import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft, Plus, Trash2, X } from "../components/ui/glyphs";
import { ServiceQuickLinks } from "../components/ServiceQuickLinks";
import { tr } from "../lib/app-language";
import {
  deleteServiceConfig,
  matchServiceConfigEntryForDetail,
  mergeServiceDetailModels,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo as ModelInfo,
  type ServiceDetailVerifiedProbe as VerifiedProbe,
} from "./service-detail-state";
import { ask } from "../components/ConfirmDialog";

import { Spinner } from "../components/ui/working";
import { ErrorLine } from "../components/ui/states";
interface Nav {
  toServices: () => void;
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6" aria-busy="true">
      <div className="skel h-4 w-16" />
      <div className="skel h-7 w-40" />
      <div className="space-y-2"><div className="skel h-3 w-16" /><div className="skel h-10 w-full" /></div>
      <div className="skel h-9 w-24" />
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
  const persistedCustomName = serviceId.startsWith("custom:") ? decodeURIComponent(serviceId.slice("custom:".length)) : "";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [apiFormat, setApiFormat] = useState<"chat" | "responses">("chat");
  const [stream, setStream] = useState(true);
  const [detectedModel, setDetectedModel] = useState<string>("");
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);
  const [verifiedProbe, setVerifiedProbe] = useState<VerifiedProbe | null>(null);
  const [configuredModels, setConfiguredModels] = useState<ModelInfo[]>([]);
  const [modelIdInput, setModelIdInput] = useState("");

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (!matched) return;
        if (isCustom) {
          setCustomName(String(matched.name ?? persistedCustomName));
          setBaseUrl(String(matched.baseUrl ?? ""));
        }
        if (typeof matched.temperature === "number") setTemperature(String(matched.temperature));
        if (matched.apiFormat === "chat" || matched.apiFormat === "responses") setApiFormat(matched.apiFormat);
        if (typeof matched.stream === "boolean") setStream(matched.stream);
        if (Array.isArray(matched.models)) {
          setConfiguredModels(mergeServiceDetailModels(matched.models.filter((model): model is string => typeof model === "string")));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId]);

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const label = isCustom ? (customName || persistedCustomName || tr("自定义服务", "Custom service")) : (svc?.label ?? serviceId);
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);

  useEffect(() => {
    let cancelled = false;
    void rehydrateServiceConnectionStatus({
      effectiveServiceId,
      shouldVerify: Boolean(svc?.connected),
      isCustom,
      baseUrl,
      apiFormat,
      stream,
    })
      .then((result) => {
        if (cancelled) return;
        setApiKey(result.apiKey);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStatus(result.status);
        if (result.status.state === "connected") {
          setStoreModels(effectiveServiceId, result.status.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "idle" });
      });
    return () => { cancelled = true; };
  }, [
    apiFormat,
    baseUrl,
    effectiveServiceId,
    isCustom,
    setStoreModels,
    stream,
    svc?.connected,
  ]);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = Boolean(svc?.connected);
  const apiKeyOptional = Boolean(svc?.apiKeyOptional);
  const models = mergeServiceDetailModels(
    configuredModels,
    status.state === "connected" ? status.models : undefined,
    storeModels,
  );
  const hasModelCatalog = models.length > 0 || status.state === "connected";
  const isBusy = status.state === "testing" || status.state === "saving";

  // -- Handlers --
  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey && !isCustom && !apiKeyOptional) {
      setStatus({ state: "error", message: tr("请先输入 API Key", "Enter an API key first") });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first") });
      return;
    }
    setApiKey(trimmedKey);
    setStatus({ state: "testing" });
    try {
      const result = await probeServiceForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat,
        stream,
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (result.ok) {
        const models = result.models ?? [];
        const verifiedApiFormat = result.detected?.apiFormat ?? apiFormat;
        const verifiedStream = typeof result.detected?.stream === "boolean" ? result.detected.stream : stream;
        const verifiedBaseUrl = isCustom ? (result.detected?.baseUrl ?? baseUrl.trim()) : "";
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (isCustom && result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        setDetectedModel(result.selectedModel ?? "");
        setDetectedConfig(result.detected ?? null);
        setVerifiedProbe({
          apiKey: trimmedKey,
          baseUrl: verifiedBaseUrl,
          apiFormat: verifiedApiFormat,
          stream: verifiedStream,
          models,
          selectedModel: result.selectedModel,
          detected: result.detected,
        });
        const mergedModels = mergeServiceDetailModels(configuredModels, models);
        setConfiguredModels(mergedModels);
        setStatus({ state: "connected", models: mergedModels });
        setStoreModels(effectiveServiceId, mergedModels); // Write to global store
      } else {
        setVerifiedProbe(null);
        setStatus({ state: "error", message: result.error ?? tr("连接失败", "Connection failed") });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setVerifiedProbe(null);
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("连接失败", "Connection failed") });
    }
  };

  const handleDelete = async () => {
    if (!(await ask({ title: tr(`删除“${label}”？`, `Delete ${label}?`), message: tr("配置和密钥都会删除。", "Its config and key are both removed."), confirmLabel: tr("删除", "Delete"), danger: true }))) return;
    setStatus({ state: "saving" });
    try {
      await deleteServiceConfig(effectiveServiceId);
      clearStoreModels(effectiveServiceId);
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("删除失败", "Delete failed") });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first") });
      return;
    }
    setStatus({ state: "saving" });
    try {
      const result = await saveServiceConfig({
        effectiveServiceId,
        serviceId,
        isCustom,
        apiKeyOptional,
        resolvedCustomName,
        apiKey: trimmedKey,
        baseUrl,
        apiFormat,
        stream,
        temperature,
        detectedModel,
        configuredModels,
        verifiedProbe,
      });
      if (result.status.state === "connected") {
        if (result.detectedConfig?.apiFormat) setApiFormat(result.detectedConfig.apiFormat);
        if (typeof result.detectedConfig?.stream === "boolean") setStream(result.detectedConfig.stream);
        if (isCustom && result.detectedConfig?.baseUrl) setBaseUrl(result.detectedConfig.baseUrl);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStoreModels(effectiveServiceId, result.status.models);
        setStatus(result.status);
      } else {
        setStatus(result.status);
        if (result.status.state === "error") return;
      }
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("保存失败", "Save failed") });
    }
  };

  const handleAddModel = () => {
    const next = mergeServiceDetailModels(configuredModels, [modelIdInput]);
    if (next.length === configuredModels.length) return;
    setConfiguredModels(next);
    setStoreModels(effectiveServiceId, next);
    if (status.state === "connected") setStatus({ state: "connected", models: next });
    setModelIdInput("");
  };

  const handleRemoveModel = (modelId: string) => {
    const next = models.filter((model) => model.id.toLowerCase() !== modelId.toLowerCase());
    setConfiguredModels(next);
    setStoreModels(effectiveServiceId, next);
    if (status.state === "connected") setStatus({ state: "connected", models: next });
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={nav.toServices}
        className="btn btn-line inline-flex items-center gap-2"
      >
        <ArrowLeft size={14} />
        {tr("返回服务商管理", "Back to providers")}
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="h-page">{label}</h1>
        {isConnected && (
          <span className="pill text-success">
            {tr("已连接", "Connected")}
          </span>
        )}
      </div>
      <ServiceQuickLinks serviceId={serviceId} />

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label={tr("服务名称", "Service name")}>
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder={tr("例如：本地 Ollama", "e.g. local Ollama")} className="input w-full" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="input w-full font-mono" />
            </Field>
          </div>
        )}

        {/* API Key */}
        <Field label={apiKeyOptional ? tr("API Key（可选）", "API key (optional)") : "API Key"}>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder={apiKeyOptional ? tr("本地服务可留空", "Optional for local service") : "sk-..."}
              className="input w-full pr-10 font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="btn btn-line btn-sm flex items-center gap-1.5">
            {status.state === "testing" && <Spinner />}
            {tr("测试连接", "Test connection")}
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="btn btn-sm flex items-center gap-1.5">
            {status.state === "saving" && <Spinner />}
            {tr("保存", "Save")}
          </button>
          {(isConnected || isCustom) && (
            <button onClick={handleDelete} disabled={isBusy}
              className="btn btn-bad btn-sm flex items-center gap-1.5">
              <Trash2 size={12} />
              {tr("删除配置", "Delete config")}
            </button>
          )}
          {/* Status feedback */}
          {status.state === "connected" && (
            <span className="text-xs text-success">
              {tr(`连接成功，${models.length} 个模型`, `Connected, ${models.length} models`)}
              {detectedModel
                ? tr(
                    `，已自动匹配 ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "responses" ? "Responses" : "Chat"} / ${detectedConfig.stream ? "流式" : "非流式"}` : ""}`,
                    `, auto-matched ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "responses" ? "Responses" : "Chat"} / ${detectedConfig.stream ? "streaming" : "non-streaming"}` : ""}`,
                  )
                : ""}
            </span>
          )}
          {status.state === "error" && (
            <ErrorLine>{status.message}</ErrorLine>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-success">{tr("已保存", "Saved")}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={tr("协议类型", "Protocol")}>
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as "chat" | "responses")}
              className="input w-full"
            >
              <option value="chat">Chat / Completions</option>
              <option value="responses">Responses</option>
            </select>
          </Field>

          <Field label={tr("流式响应", "Streaming")}>
            <label className="input flex h-10 items-center gap-2">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? tr("开启", "On") : tr("关闭", "Off")}</span>
            </label>
          </Field>
        </div>

        {/* Models */}
        <div className="space-y-2">
          <p className="label">
            {tr(`模型目录（${models.length}）`, `Model catalog (${models.length})`)}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelIdInput}
              onChange={(event) => setModelIdInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddModel();
                }
              }}
              placeholder={tr("输入模型 ID，例如 gemini-3.1-pro", "Enter a model ID, e.g. gemini-3.1-pro")}
              className="input min-w-0 flex-1 font-mono"
            />
            <button
              type="button"
              onClick={handleAddModel}
              disabled={!modelIdInput.trim()}
              className="btn btn-line btn-sm inline-flex items-center gap-1.5"
            >
              <Plus size={13} />
              {tr("添加", "Add")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground/60">
            {tr("测试连接发现的模型和手动添加的模型都会在保存后持久化；内置目录只作为兜底。", "Discovered and manually added models are persisted on save; the built-in catalog is only a fallback.")}
          </p>
          {hasModelCatalog && (
          <div className="space-y-2">
            {models.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {models.map((m) => (
                  <span key={m.id} className="pill inline-flex items-center gap-1">
                    {m.name ?? m.id}
                    <button
                      type="button"
                      onClick={() => handleRemoveModel(m.id)}
                      aria-label={tr(`移除模型 ${m.id}`, `Remove model ${m.id}`)}
                      className="rounded-sm opacity-60 hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">{tr("点击“测试连接”查看可用模型", "Click “Test connection” to list available models")}</p>
            )}
          </div>
          )}
        </div>

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            {tr("高级参数", "Advanced")}
          </summary>
          <div className="space-y-4 pt-2">
            <Field label="temperature">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
                  min="0" max="2" step="0.05" className="input w-auto py-1.5 px-2.5 text-small w-16 text-right font-mono" />
              </div>
            </Field>
          </div>
        </details>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
