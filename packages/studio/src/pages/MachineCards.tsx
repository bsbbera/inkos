/*
 * Machine settings that are not model connections: the picture engines and
 * the reader's own sources. They lived on the old Services page, which
 * Connections replaced; they belong to the machine, so they sit on its tab.
 */
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "../components/ui/glyphs";
import { tr } from "../lib/app-language";
import { fetchJson } from "../hooks/use-api";
import { Spinner } from "../components/ui/working";
import { ErrorLine } from "../components/ui/states";

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

export function CoverConfigCard() {
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
    <section className="panel space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="h-panel">{tr("封面生成", "Cover generation")}</h2>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {tr(
              "只配置封面通道和模型；封面尺寸由短篇封面提示词和内部默认处理。",
              "Only configures the cover provider and model; cover size is handled by the short-story cover prompt and internal defaults.",
            )}
          </p>
        </div>
        {selected?.connected && (
          <span className="pill text-success">
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
            className="input w-full"
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
            className="input w-full"
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
          className="input w-full font-mono"
        />
        <span className="block text-small leading-5 text-muted-foreground/55">
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
            className="input w-full pr-10 font-mono"
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
        <p className="text-small leading-5 text-muted-foreground/55">
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
          className="btn btn-sm inline-flex items-center gap-1.5"
        >
          {status === "saving" && <Spinner />}
          {tr("保存封面配置", "Save cover config")}
        </button>
        {message && (
          <span className={`hint ${status === "error" ? "is-bad" : "is-good"}`}>
            {message}
          </span>
        )}
      </div>
    </section>
  );
}

interface EnginesPayload {
  readonly engines: ReadonlyArray<{ readonly id: string; readonly label: string; readonly surfaces: ReadonlyArray<string> }>;
  readonly prefs: { readonly plan?: string; readonly bySurface?: Record<string, string> };
  readonly canva: {
    readonly connected: boolean; readonly plan: string; readonly used: number; readonly limit: number;
    readonly exhausted: boolean; readonly lastError: string | null; readonly note: string;
  };
}

/** The surfaces a person actually chooses between; the rest follow the default. */
const ENGINE_SURFACES = ["illustration", "typographic", "photo"] as const;

/**
 * Which engine draws, and what happens when the paid one runs out.
 *
 * The fallback is the part worth stating plainly on screen: a hosted engine
 * that stops mid-book would otherwise look like a broken pipeline rather than
 * a spent allowance (23 §8).
 */
/**
 * What you have read, as a research source (13 §Sources): a notes folder
 * (an Obsidian vault works) and a Zotero library. The count comes back with
 * the save, so a wrong folder or tag reads as zero here rather than as an
 * issue that quietly ignored your notes.
 */
export function PersonalSourcesCard() {
  const [dir, setDir] = useState("");
  const [tag, setTag] = useState("");
  const [since, setSince] = useState("");
  const [zotero, setZotero] = useState(false);
  const [state, setState] = useState<{ items: number; bySource?: { markdown: number; zotero: number } } | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    void fetch("/api/v1/sources/personal").then((r) => r.json()).then((out: {
      config?: { markdown?: Array<{ dir: string; tag?: string; since?: string }>; zotero?: unknown };
      items?: number; bySource?: { markdown: number; zotero: number };
    }) => {
      const first = out.config?.markdown?.[0];
      setDir(first?.dir ?? "");
      setTag(first?.tag ?? "");
      setSince(first?.since ?? "");
      setZotero(Boolean(out.config?.zotero));
      setState({ items: out.items ?? 0, ...(out.bySource ? { bySource: out.bySource } : {}) });
    }).catch(() => undefined);
  }, []);

  const save = async () => {
    setNote("");
    const res = await fetch("/api/v1/sources/personal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        markdown: dir.trim() ? [{ dir: dir.trim(), ...(tag.trim() ? { tag: tag.trim() } : {}), ...(since ? { since } : {}) }] : [],
        zotero: zotero ? {} : null,
      }),
    });
    const out = await res.json().catch(() => ({})) as { items?: number; config?: { markdown?: unknown[] } };
    if (dir.trim() && !out.config?.markdown?.length) setNote("The folder must be a full path, like C:\\Users\\you\\Notes.");
    setState({ items: out.items ?? 0 });
  };

  return (
    <div className="panel mt-4">
      <h3 className="h-panel">Your reading</h3>
      <p className="hint mt-1">
        Magazine research reads these before the web, so an issue can be made from what you read.
        Nothing leaves this machine except as text to your own model.
      </p>
      <div className="rowflex flex-wrap gap-2 mt-3">
        <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Notes folder (full path)" aria-label="Notes folder" className="min-w-70" />
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Only notes tagged…" aria-label="Tag" />
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label="Since" />
        <label className="rowflex gap-1.5">
          <input type="checkbox" checked={zotero} onChange={(e) => setZotero(e.target.checked)} /> Zotero library
        </label>
        <button type="button" className="btn btn-sm" onClick={() => void save()}>Save</button>
      </div>
      {state ? (
        <p className="hint mt-2">
          {state.items} item{state.items === 1 ? "" : "s"} found
          {state.bySource ? ` (${state.bySource.markdown} notes, ${state.bySource.zotero} from Zotero)` : ""}.
        </p>
      ) : null}
      {note ? <p className="hint mt-1">{note}</p> : null}
    </div>
  );
}

export function PictureEngineCard() {
  const [payload, setPayload] = useState<EnginesPayload | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");

  const load = () => fetchJson<EnginesPayload>("/engines")
    .then((next) => { setPayload(next); setStatus("idle"); })
    .catch(() => { setStatus("error"); });

  useEffect(() => { void load(); }, []);

  if (!payload) return null;
  const { canva, prefs } = payload;

  const save = async (patch: Record<string, unknown>) => {
    setStatus("saving");
    try {
      await fetchJson("/engines", { method: "POST", body: JSON.stringify(patch) });
      await load();
      setMessage(tr("已保存", "Saved"));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : tr("保存失败", "Save failed"));
    }
  };

  const saveToken = async () => {
    setStatus("saving");
    try {
      await fetchJson("/services/canva/secret", { method: "PUT", body: JSON.stringify({ apiKey: token.trim() }) });
      setToken("");
      await load();
      setMessage(tr("Canva 令牌已保存", "Canva token saved"));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : tr("保存失败", "Save failed"));
    }
  };

  return (
    <section className="panel space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="h-panel">{tr("配图引擎", "Picture engine")}</h2>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {tr(
              "ComfyUI 在本机渲染，没有用量上限。Canva 额度用完时，同一个任务会自动转回 ComfyUI。",
              "ComfyUI renders on this machine with no limit. When Canva's allowance runs out, the same job falls back to ComfyUI on its own.",
            )}
          </p>
        </div>
        <span className={`pill ${canva.connected ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
          {canva.connected ? tr("Canva 已连接", "Canva connected") : tr("Canva 未连接", "Canva not connected")}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {ENGINE_SURFACES.map((surface) => (
          <label key={surface} className="space-y-1.5">
            <span className="block text-xs font-medium text-muted-foreground/70 capitalize">{surface}</span>
            <select
              value={prefs?.bySurface?.[surface] ?? "comfy"}
              onChange={(event) => void save({ bySurface: { ...(prefs?.bySurface ?? {}), [surface]: event.target.value } })}
              className="input w-full"
            >
              <option value="comfy">{tr("ComfyUI（本机）", "ComfyUI (this machine)")}</option>
              <option value="canva">{tr("先用 Canva，用完转 ComfyUI", "Canva first, ComfyUI when it runs out")}</option>
            </select>
          </label>
        ))}
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground/70">{tr("Canva 套餐", "Canva plan")}</span>
          <select
            value={canva.plan}
            onChange={(event) => void save({ plan: event.target.value })}
            className="input w-full"
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="business">Business</option>
          </select>
        </label>
      </div>

      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-muted-foreground/70">{tr("Canva 访问令牌", "Canva access token")}</span>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={canva.connected ? "••••••••" : "eyJ..."}
            className="input w-full pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowToken((value) => !value)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
          >
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>

      <div className="well">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-muted-foreground/70">{tr("本月 Canva AI 用量", "Canva AI this month")}</span>
          <span className={`text-small tnum ${canva.exhausted ? "hint is-bad" : ""}`}>
            {canva.used} / ~{canva.limit}
          </span>
        </div>
        <p className="mt-1 text-small leading-5 text-muted-foreground/55">{canva.note}</p>
        {canva.lastError && (
          <ErrorLine className="mt-1">{canva.lastError}</ErrorLine>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void saveToken()}
          disabled={status === "saving" || !token.trim()}
          className="btn btn-sm inline-flex items-center gap-1.5"
        >
          {status === "saving" && <Spinner />}
          {tr("保存令牌", "Save token")}
        </button>
        {message && <span className={`hint ${status === "error" ? "is-bad" : "is-good"}`}>{message}</span>}
      </div>
    </section>
  );
}
