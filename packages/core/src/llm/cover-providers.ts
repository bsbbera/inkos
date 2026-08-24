export type CoverProviderId = "kkaiapi" | "openai" | "google" | "comfy";

export interface CoverProviderPreset {
  readonly service: CoverProviderId;
  readonly label: string;
  readonly baseUrl: string;
  readonly api: "responses" | "images" | "gemini" | "comfy";
  readonly defaultModel: string;
  readonly models: readonly string[];
  /**
   * Whether the provider needs an API key at all. The hosted three do; the
   * local one renders on this machine, and demanding a key for it meant the
   * only provider that works offline was the only one you could not turn on.
   */
  readonly needsKey?: boolean;
}

export const COVER_PROVIDER_PRESETS: readonly CoverProviderPreset[] = [
  {
    service: "comfy",
    label: "ComfyUI (this machine)",
    // Quire's shim, which owns the ComfyUI install, the selected workflow and
    // the device tier benchmarked for this hardware.
    baseUrl: `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`,
    api: "comfy",
    defaultModel: "workflow",
    models: ["workflow"],
    needsKey: false,
  },
  {
    service: "kkaiapi",
    label: "kkaiapi",
    baseUrl: "https://api.kkaiapi.com/v1",
    api: "images",
    defaultModel: "gpt-image-2",
    models: ["gpt-image-2"],
  },
  {
    service: "openai",
    label: "OpenAI Images",
    baseUrl: "https://api.openai.com/v1",
    api: "images",
    defaultModel: "gpt-image-2",
    models: ["gpt-image-2"],
  },
  {
    service: "google",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "gemini",
    defaultModel: "gemini-3.1-flash-image-preview",
    models: ["gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"],
  },
];

export function resolveCoverProviderPreset(service: string | undefined): CoverProviderPreset | undefined {
  return COVER_PROVIDER_PRESETS.find((provider) => provider.service === service);
}

export function normalizeCoverBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    return trimmed.replace(/\/+$/u, "");
  } catch {
    return undefined;
  }
}

export function coverSecretKey(service: string): string {
  return `cover:${service}`;
}
