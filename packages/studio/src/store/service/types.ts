export type EndpointGroup =
  | "overseas"
  | "china"
  | "aggregator"
  | "local"
  | "codingPlan"
  | "cli";

export interface ServiceInfo {
  readonly service: string;
  readonly label: string;
  readonly group?: EndpointGroup;
  /** Passed its connection test: the only kind whose models are offered. */
  readonly connected: boolean;
  readonly apiKeyOptional?: boolean;
  readonly kind?: "api" | "cli" | "local";
  /** The last test, or null when there was nothing to test (an API with no key). */
  readonly check?: { readonly ok: boolean; readonly at: string; readonly models: number; readonly error?: string; readonly lastOk?: string } | null;
}

/** Connections that worked once and do not answer now, with the reason. Shown greyed, never dropped. */
export function stoppedAnswering(services: ReadonlyArray<ServiceInfo>): ReadonlyArray<{ readonly label: string; readonly reason: string }> {
  return services
    .filter((s) => s.check && !s.check.ok && s.check.lastOk)
    .map((s) => ({ label: s.label, reason: s.check!.error ?? "Did not answer." }));
}

export interface ModelInfo {
  readonly id: string;
  readonly name?: string;
  readonly maxOutput?: number;
  readonly contextWindow?: number;
  /**
   * Only present for models the provider bank knows; a live /models probe has
   * no field for it. Absent means unknown, so callers must gate on an explicit
   * false rather than on falsiness.
   */
  readonly capabilities?: {
    readonly text?: boolean;
    readonly imageInput?: boolean;
    readonly imageOutput?: boolean;
    readonly tools?: boolean;
    readonly reasoning?: boolean;
  };
}

export type ModelPickerStatus = "loading" | "no-models" | "ready";

export interface ModelGroup {
  readonly service: string;
  readonly label: string;
  readonly models: ReadonlyArray<ModelInfo>;
}

export interface ServiceStore {
  services: ReadonlyArray<ServiceInfo>;
  servicesLoading: boolean;

  modelsByService: Record<string, ReadonlyArray<ModelInfo>>;
  bankModelsLoading: boolean;
  customModelsLoading: boolean;
  liveModelsLoading: Record<string, boolean>;

  fetchServices: () => Promise<void>;
  refreshServices: () => Promise<void>;
  fetchBankModels: () => Promise<void>;
  fetchCustomModels: () => Promise<void>;
  fetchLiveModels: (service: string) => Promise<void>;

  setLiveModels: (service: string, models: ReadonlyArray<ModelInfo>) => void;
  clearModels: (service: string) => void;

  getModelPickerStatus: () => ModelPickerStatus;
  getGroupedModels: () => ReadonlyArray<ModelGroup>;
}
