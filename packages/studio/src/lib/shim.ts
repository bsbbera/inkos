/**
 * The shim: Quire's second local server. It owns everything about the machine
 * rather than the book — the installed CLI providers, ComfyUI, integrations.
 *
 * Studio and the shim are separate origins, so this is a plain cross-origin
 * fetch rather than use-api's same-origin `/api/v1`. The shim already answers
 * with `access-control-allow-origin: *`, so no proxy is involved.
 *
 * The two servers are paired one port apart in both stages — dev 4568/8788,
 * prod 4567/8787 — so Studio's own port names the shim's.
 */
const SHIM = `http://127.0.0.1:${8787 + (Number(location.port || 4567) - 4567)}`;

export const shimAsset = (id: string): string => `${SHIM}/assets/${id}`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${SHIM}${path}`, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || `${path} failed (${r.status})`);
  return body as T;
}

export const shimGet = <T,>(path: string): Promise<T> => call<T>(path);

export const shimPost = <T,>(path: string, body?: unknown): Promise<T> =>
  call<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const shimPut = <T,>(path: string): Promise<T> => call<T>(path, { method: "PUT" });

export const shimDelete = <T,>(path: string): Promise<T> => call<T>(path, { method: "DELETE" });

export interface ShimAgent {
  readonly id: string;
  readonly bin: string;
  readonly version: string;
  readonly models: number;
}

export interface ShimStatus {
  readonly ok: boolean;
  readonly port: number;
  readonly lang: string;
  readonly agents: ReadonlyArray<ShimAgent>;
  readonly total: number;
}

export interface ComfyInstall {
  readonly step: string;
  readonly got: number;
  readonly total: number;
  readonly done: boolean;
  readonly error?: string;
}

export interface ComfyStatus {
  readonly up: boolean;
  readonly url: string;
  readonly dir: string | null;
  readonly installed: boolean;
  readonly install: ComfyInstall | null;
  readonly device: string;
  readonly workflow: { readonly id: string; readonly label: string; readonly builtin: boolean } | null;
  readonly benchmark: { readonly seconds?: number } | null;
  readonly firstRun: boolean;
}

export interface ComfyWorkflow {
  readonly id: string;
  readonly label: string;
  readonly builtin: boolean;
}
