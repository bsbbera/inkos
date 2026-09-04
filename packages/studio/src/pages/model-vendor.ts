/**
 * Which lab built the model, read off its id.
 *
 * A CLI is not a lab. Devin serves Anthropic's models, OpenAI's, Zhipu's and
 * Moonshot's from one list, and the picker showed all of them as undifferentiated
 * rows of text — so choosing between `claude-opus-5-high` and `glm-5-2-max`
 * meant knowing from memory which company each name belongs to. The provider
 * strip above the list answers "which CLI", which is the question already
 * settled by the time someone is reading model names.
 *
 * The id says who made it. `claude-*` is Anthropic's whatever route it arrived
 * by; `gpt-*` is OpenAI's. That holds across every CLI and every aggregator,
 * because these are product names, not routing details.
 *
 * A mark here is a monogram in the lab's own colour, not its logo. Quire ships
 * no brand assets and does not borrow another application's — a wordmark is
 * the lab's to license, an initial in a coloured square is not a claim to be
 * them. If real marks are wanted later, only `VENDORS` has to change.
 */

export interface ModelVendor {
  readonly id: string;
  readonly label: string;
  /** One or two characters. Longer stops being a mark and becomes a label. */
  readonly initials: string;
  /** Foreground and background, both themes, as CSS colours. */
  readonly fg: string;
  readonly bg: string;
}

/**
 * Matched against the model id in order, first hit wins.
 *
 * Order matters where names overlap: `gpt-oss` is OpenAI's open release and
 * matches `gpt` correctly, but `codex` must be listed before any `code`
 * pattern a future entry might add.
 */
const VENDORS: ReadonlyArray<{ readonly test: RegExp; readonly vendor: ModelVendor }> = [
  { test: /^claude|^opus|^sonnet|^haiku/, vendor: { id: "anthropic", label: "Anthropic", initials: "A", fg: "#ffffff", bg: "#c96442" } },
  { test: /^gpt|^codex|^o[134]\b|^chatgpt/, vendor: { id: "openai", label: "OpenAI", initials: "AI", fg: "#ffffff", bg: "#10a37f" } },
  { test: /^gemini|^gemma/, vendor: { id: "google", label: "Google", initials: "G", fg: "#ffffff", bg: "#4285f4" } },
  { test: /^glm|^chatglm|^z1-/, vendor: { id: "zhipu", label: "Zhipu", initials: "Z", fg: "#ffffff", bg: "#3859ff" } },
  { test: /^kimi|^moonshot/, vendor: { id: "moonshot", label: "Moonshot", initials: "K", fg: "#ffffff", bg: "#16161a" } },
  { test: /^deepseek/, vendor: { id: "deepseek", label: "DeepSeek", initials: "DS", fg: "#ffffff", bg: "#4d6bfe" } },
  { test: /^qwen|^qwq/, vendor: { id: "qwen", label: "Qwen", initials: "Q", fg: "#ffffff", bg: "#615ced" } },
  { test: /^grok/, vendor: { id: "xai", label: "xAI", initials: "X", fg: "#ffffff", bg: "#1a1a1a" } },
  { test: /^llama/, vendor: { id: "meta", label: "Meta", initials: "L", fg: "#ffffff", bg: "#0866ff" } },
  { test: /^mistral|^mixtral|^codestral|^magistral/, vendor: { id: "mistral", label: "Mistral", initials: "M", fg: "#ffffff", bg: "#fa500f" } },
  { test: /^minimax|^abab/, vendor: { id: "minimax", label: "MiniMax", initials: "MM", fg: "#ffffff", bg: "#f23f5d" } },
  { test: /^doubao|^seed/, vendor: { id: "volcengine", label: "Doubao", initials: "D", fg: "#ffffff", bg: "#1664ff" } },
  { test: /^ernie|^wenxin/, vendor: { id: "wenxin", label: "ERNIE", initials: "E", fg: "#ffffff", bg: "#2932e1" } },
  { test: /^hunyuan/, vendor: { id: "hunyuan", label: "Hunyuan", initials: "H", fg: "#ffffff", bg: "#0052d9" } },
  { test: /^step-/, vendor: { id: "stepfun", label: "StepFun", initials: "S", fg: "#ffffff", bg: "#005aff" } },
  { test: /^swe/, vendor: { id: "cognition", label: "Cognition", initials: "SW", fg: "#ffffff", bg: "#0b6bcb" } },
  { test: /^phi/, vendor: { id: "microsoft", label: "Microsoft", initials: "P", fg: "#ffffff", bg: "#0078d4" } },
  { test: /^command|^cohere/, vendor: { id: "cohere", label: "Cohere", initials: "C", fg: "#ffffff", bg: "#39594d" } },
];

/**
 * The lab behind a model id, or null when nothing recognisable is there.
 *
 * Null is a real answer and the caller must render it as one — a locally
 * pulled `my-finetune:latest` belongs to nobody in this table, and inventing a
 * mark for it would be worse than leaving the row bare.
 */
export function modelVendor(modelId: string): ModelVendor | null {
  // Ids arrive prefixed by the service that served them (`devin/glm-5-2`), and
  // the prefix is the route, not the maker — which is the whole distinction
  // this file exists to draw.
  const slug = modelId.slice(modelId.indexOf("/") + 1).trim().toLowerCase();
  if (!slug) return null;
  for (const { test, vendor } of VENDORS) {
    if (test.test(slug)) return vendor;
  }
  return null;
}
