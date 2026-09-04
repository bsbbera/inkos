import { fetchWithProxy } from "../../utils/proxy-fetch.js";

/**
 * 通用 OpenAI 兼容 /models 探针。
 * 任何失败（网络错、超时、非 JSON、非 2xx）一律返回空数组，不抛异常。
 */

export interface ProbedModel {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  /** Only when the endpoint declared it; absent means unknown, never false. */
  readonly imageInput?: boolean;
}

export async function probeModelsFromUpstream(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 10_000,
): Promise<ReadonlyArray<ProbedModel>> {
  if (!baseUrl) return [];
  try {
    const modelsUrl = baseUrl.replace(/\/$/, "") + "/models";
    const res = await fetchWithProxy(modelsUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{ id: unknown; name?: unknown; supports_images?: unknown }>;
    };
    if (!Array.isArray(json.data)) return [];
    return json.data
      .filter((m): m is { id: string; name?: string; supports_images?: boolean } =>
        typeof m.id === "string" && m.id.length > 0)
      // `name: m.id` was hardcoded here, which overwrote the display name an
      // endpoint had sent with the slug. Quire's shim relays what a CLI says
      // its models are called — devin calls `glm-5-2` "GLM-5.2 High" — and the
      // picker then had to reconstruct that from the id, which cannot be done:
      // no rule turns `glm-5-2` into `GLM-5.2 High`. Standard OpenAI /models
      // carries no `name`, so the id remains the fallback.
      .map((m) => ({
        id: m.id,
        name: typeof m.name === "string" && m.name ? m.name : m.id,
        contextWindow: 0,
        ...(typeof m.supports_images === "boolean" ? { imageInput: m.supports_images } : {}),
      }));
  } catch {
    return [];
  }
}
