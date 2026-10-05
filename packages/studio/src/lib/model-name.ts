import { prettyModelName } from "../pages/model-picker-state";

const SERVICE_NAMES: Record<string, string> = {
  openai: "OpenAI", openrouter: "OpenRouter", deepseek: "DeepSeek", lmstudio: "LM Studio",
};

/** "antigravityCli" -> "Antigravity", "openai" -> "OpenAI", "custom:Work" -> "Work". */
export function serviceName(id: string): string {
  const short = id.replace(/^custom:/, "").replace(/Cli$/, "");
  return SERVICE_NAMES[short] ?? short.charAt(0).toUpperCase() + short.slice(1);
}

/**
 * A model as a person says it: "Gemini 3.8 Flash High · Antigravity". The raw
 * `antigravityCli · antigravity/gemini-3.8-flash-high` is for a tooltip.
 */
export function modelName(service: string | null | undefined, model: string): string {
  const name = prettyModelName(model);
  return service ? `${name} · ${serviceName(service)}` : name;
}
