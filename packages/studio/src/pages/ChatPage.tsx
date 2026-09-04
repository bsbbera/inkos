import { useCallback, useRef, useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { modelLabel, scopeToProvider, toFamilies } from "./model-picker-state";
import { modelVendor } from "./model-vendor";
import { fetchJson, postApi, putApi, useApi } from "../hooks/use-api";
import type { ChatAttachmentPayload } from "../store/chat/types";
import { chatSelectors, useChatStore } from "../store/chat";
import type { ChatSessionKind } from "../store/chat";
import { modelBar } from "./chat-model-label";
import { useServiceStore } from "../store/service";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "../components/ai-elements/reasoning";
import { ChatMessage } from "../components/chat/ChatMessage";
import { QuickActions } from "../components/chat/QuickActions";
import { ChatContextRail } from "../components/chat/ChatContextRail";
import { ChatArtifactsRail } from "../components/chat/ChatArtifactsRail";
import { sessionFiles } from "../components/chat/chat-session-files";
import { ToolExecutionSteps, type ProposedActionDetails } from "../components/chat/ToolExecutionSteps";
import {
  buildNarrativeForecastRecheckInstruction,
  buildNarrativeForecastSelectionInstruction,
} from "../components/chat/NarrativeForecastPreview";
import { ProjectArtifactDrawer } from "../components/chat/ProjectArtifactDrawer";
import { PlayHud } from "../components/chat/PlayHud";
import { PlayChoicePanel } from "../components/chat/PlayChoicePanel";
import { latestPlayChoiceSet } from "../components/chat/play-choices";
import {
  BotMessageSquare,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Check,
  FolderUp,
  X,
  Paperclip,
  Gamepad2,
  Palette,
  RotateCcw,
  Square,
  Sparkles,
  Cpu,
  Plus,
  Layers,
} from "lucide-react";
import {
  Message,
  MessageContent,
} from "../components/ai-elements/message";
import {
  type ChatPageModelPreference,
  filterModelGroups,
  getChatScrollBehavior,
  getBookCreateSessionId,
  getProjectChatSessionId,
  pickProjectChatSessionId,
  pickModelSelection,
  setBookCreateSessionId,
  setProjectChatSessionId,
  isChatScrollNearBottom,
  shouldShowPlayChoicePanel,
} from "./chat-page-state";
import {
  applySlashPick,
  matchSkills,
  serializeSkillFolder,
  selectedSkillIdsForSend,
  slashToken,
  toggleSelectedSkillIds,
  type StudioSkill,
} from "./skill-ui-state";

// -- Types --

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toServices: () => void;
  toAgents: () => void;
  toFilm: (projectId: string) => void;
  toFilmStudio: (projectId: string) => void;
}

export interface ChatPageProps {
  readonly activeBookId?: string;
  readonly mode?: "book" | "book-create" | "project-chat" | "interactive-film-authoring";
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

interface ServiceConfigPayload {
  readonly service?: string | null;
  readonly defaultModel?: string | null;
}

interface PlayImageSettings {
  readonly actors: boolean;
  readonly moments: boolean;
  readonly inventory: boolean;
}

interface PlayRunImagePayload {
  readonly imageSettings?: PlayImageSettings;
}

interface CoverConfigResponse {
  readonly service?: string | null;
  readonly configured?: boolean;
  readonly providers?: ReadonlyArray<{ readonly service: string; readonly connected?: boolean }>;
}

const MAX_CHAT_ATTACHMENTS = 8;
const MAX_CHAT_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".log",
  ".pdf",
].join(",");

// Same list without image/*, for models that cannot read images.
const CHAT_ATTACHMENT_ACCEPT_NO_IMAGES = CHAT_ATTACHMENT_ACCEPT
  .split(",")
  .filter((type) => type !== "image/*")
  .join(",");

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

async function serializeChatAttachments(files: ReadonlyArray<File>): Promise<ChatAttachmentPayload[]> {
  return Promise.all(files.map(async (file) => ({
    id: `${file.name}-${file.size}-${file.lastModified}`,
    filename: file.name,
    mediaType: file.type || "application/octet-stream",
    size: file.size,
    dataUrl: await fileToDataUrl(file),
  })));
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

interface SkillsResponse {
  readonly skills: ReadonlyArray<StudioSkill>;
  readonly diagnostics?: ReadonlyArray<{ readonly path?: string; readonly message?: string }>;
}

type ScrollFrameId = number | ReturnType<typeof setTimeout>;

function requestScrollFrame(callback: () => void): ScrollFrameId {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(callback, 16);
}

function cancelScrollFrame(id: ScrollFrameId): void {
  if (typeof id === "number" && typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(id);
    return;
  }
  globalThis.clearTimeout(id);
}

function SkillPickerPanel({
  isZh,
  skills,
  diagnostics,
  selectedSkillIds,
  loading,
  error,
  saving,
  createError,
  onToggleSkill,
  onImport,
}: {
  readonly isZh: boolean;
  readonly skills: ReadonlyArray<StudioSkill>;
  readonly diagnostics?: ReadonlyArray<{ readonly path?: string; readonly message?: string }>;
  readonly selectedSkillIds: ReadonlyArray<string>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly saving: boolean;
  readonly createError: string | null;
  readonly onToggleSkill: (skillId: string) => void;
  readonly onImport: (files: FileList) => void;
}) {
  const selected = new Set(selectedSkillIds);
  const folderInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="absolute bottom-[calc(100%+10px)] left-0 z-40 w-full overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-2xl backdrop-blur">
      <div className="border-b border-border/40 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-bold">{isZh ? "选择 Agent Skill" : "Select Agent Skills"}</div>
            <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
              {isZh
                ? "Agent 会按当前意图自主调用；点选 Skill 可强制它随下一条消息启用。"
                : "The agent can choose a skill from your intent; selecting one forces it for the next message."}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              <FolderUp size={13} />
              {isZh ? "导入" : "Import"}
            </button>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                if (event.currentTarget.files?.length) onImport(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
      </div>
      <div className="max-h-[380px] overflow-y-auto p-3">
        {createError ? <div className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{createError}</div> : null}
        {diagnostics?.length ? (
          <div className="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            <div className="font-semibold">{isZh ? "部分外部 Skill 未加载" : "Some external skills were not loaded"}</div>
            {diagnostics.slice(0, 4).map((item, index) => (
              <div key={`${item.path ?? "skill"}-${index}`} className="mt-1 break-all">
                {item.path ? `${item.path}: ` : ""}{item.message ?? (isZh ? "格式无效" : "Invalid format")}
              </div>
            ))}
          </div>
        ) : null}
        {loading ? (
          <div className="px-2 py-6 text-center text-[14px] text-muted-foreground">{isZh ? "加载 Skill..." : "Loading skills..."}</div>
        ) : error ? (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-[14px] text-destructive">{error}</div>
        ) : skills.length === 0 ? (
          <div className="px-2 py-6 text-center text-[14px] text-muted-foreground">{isZh ? "还没有可用 Skill。" : "No skills available yet."}</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {skills.map((skill) => {
              const checked = selected.has(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => onToggleSkill(skill.id)}
                  className={`rounded-xl border p-3 text-left transition-all ${checked ? "border-primary/60 bg-primary/10" : "border-border/50 bg-secondary/20 hover:border-primary/30 hover:bg-secondary/35"}`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"}`}>
                      <Check size={13} strokeWidth={3} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-[14px] font-semibold">{skill.name}</div>
                        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {skill.source ?? "skill"}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">@{skill.id}</div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{skill.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

// -- Component --

/**
 * Words written so far, for the label on a streaming turn.
 *
 * CJK has no spaces, so splitting on whitespace would report one word for a
 * whole chapter. Characters are the unit a Chinese reader counts in anyway.
 */
function wordsSoFar(text: string): number {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  if (cjk > 0) return cjk;
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function ChatPage({ activeBookId, mode = activeBookId ? "book" : "book-create", nav, theme, t, sse: _sse }: ChatPageProps) {
  // -- Store selectors --
  const messages = useChatStore(chatSelectors.activeMessages);
  const activeSession = useChatStore(chatSelectors.activeSession);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const input = useChatStore((s) => s.input);
  const loading = useChatStore(chatSelectors.isActiveSessionStreaming);
  const chatStreaming = useChatStore(chatSelectors.isActiveSessionChatStreaming);
  const lastFailedSend = useChatStore(chatSelectors.activeSessionLastFailedSend);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedService = useChatStore((s) => s.selectedService);
  // -- Store actions --
  const setInput = useChatStore((s) => s.setInput);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryLastSend = useChatStore((s) => s.retryLastSend);
  const abortSession = useChatStore((s) => s.abortSession);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const loadSessionList = useChatStore((s) => s.loadSessionList);
  const createSession = useChatStore((s) => s.createSession);
  const createDraftSession = useChatStore((s) => s.createDraftSession);
  const markProposalResolved = useChatStore((s) => s.markProposalResolved);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const activateSession = useChatStore((s) => s.activateSession);
  const setSessionPlayMode = useChatStore((s) => s.setSessionPlayMode);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<ScrollFrameId | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoScrollPinnedRef = useRef(true);

  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";
  const hasBook = Boolean(activeBookId);
  const currentSessionKind: ChatSessionKind = activeSession?.sessionKind
    ?? (mode === "interactive-film-authoring" ? "interactive-film-authoring"
      : mode === "book-create" ? "book-create"
      : activeBookId ? "book" : "chat");
  const playMode = activeSession?.playMode;

  // The count on the Artifacts button is the same derivation the rail shows,
  // so the number and the column can never disagree.
  // The file the current turn is writing into, when a tool in it named one.
  const streamTarget = useMemo(() => {
    const last = messages[messages.length - 1];
    return sessionFiles(last ? [last] : []).find((f) => f.busy)?.name ?? null;
  }, [messages]);

  const artifactCount = useMemo(() => sessionFiles(activeSession?.messages).length, [activeSession?.messages]);
  // A play session must pick its playstyle (点着玩 / 自由玩) before chatting.
  const needsPlayModeChoice = currentSessionKind === "play" && !playMode;
  // Even in 点着玩 the world is shaped by free typing first; the choice panel
  // only replaces the input once play has actually started (a play tool
  // produced choices).
  const playChoiceSet = useMemo(
    () => (currentSessionKind === "play" && playMode === "guided" ? latestPlayChoiceSet(messages) : null),
    [currentSessionKind, playMode, messages],
  );
  const [consumedPlayChoiceKey, setConsumedPlayChoiceKey] = useState<string | null>(null);
  const playChoices = playChoiceSet?.choices ?? [];
  const showChoicePanel = shouldShowPlayChoicePanel({
    playMode,
    choiceSetKey: playChoiceSet?.key ?? null,
    consumedChoiceKey: consumedPlayChoiceKey,
    choiceCount: playChoices.length,
  });
  // World panel (holdings / state / relations) defaults collapsed; the scene
  // image and choices live in the chat center now, opened on demand.
  const [worldPanelOpen, setWorldPanelOpen] = useState(false);
  const [playImageError, setPlayImageError] = useState<string | null>(null);
  const [playImageMenuOpen, setPlayImageMenuOpen] = useState(false);
  const [playImageSettings, setPlayImageSettings] = useState<PlayImageSettings>({ actors: false, moments: false, inventory: false });
  const [playImageCoverReady, setPlayImageCoverReady] = useState(false);
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  /* Where the caret is, which `input` alone does not say — a `/` is only a
     menu when you are standing in it. Escape closes the menu without closing
     the token, so the slash can be typed as a literal. */
  const [caret, setCaret] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillCreateError, setSkillCreateError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const { data: skillsData, loading: skillsLoading, error: skillsError, refetch: refetchSkills } = useApi<SkillsResponse>("/skills");
  const worldPanelInsetClass = currentSessionKind === "play" && worldPanelOpen ? "lg:pr-[380px]" : "";
  const availableSkills = skillsData?.skills ?? [];
  /* `/` in the composer opens the skills it could mean. Anchored to the head
     of a line by `slashToken`, so the paths this app prints constantly —
     `shorts/the-second-law/final/full.md` — never trigger it. */
  const slash = slashDismissed ? null : slashToken(input, caret);
  const slashSkills = slash ? matchSkills(availableSkills, slash.query) : [];
  const slashOpen = slash !== null && Boolean(activeSessionId) && slashSkills.length > 0;
  const selectedSkills = useMemo(
    () => selectedSkillIds
      .map((id) => availableSkills.find((skill) => skill.id === id))
      .filter((skill): skill is StudioSkill => Boolean(skill)),
    [availableSkills, selectedSkillIds],
  );

  // Derived: is the assistant currently streaming/thinking/executing tools?
  const isStreaming = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return last.thinkingStreaming === true
      || !last.content
      || (last.toolExecutions?.some(t => t.status === "running" || t.status === "processing") ?? false);
  }, [messages]);

  // -- Model picker: read raw state, derive with useMemo (stable refs) --
  const services = useServiceStore((s) => s.services);
  const servicesLoading = useServiceStore((s) => s.servicesLoading);
  const bankModelsLoading = useServiceStore((s) => s.bankModelsLoading);
  const customModelsLoading = useServiceStore((s) => s.customModelsLoading);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);
  const [configuredModelSelection, setConfiguredModelSelection] = useState<ChatPageModelPreference | null>(null);
  const [serviceConfigLoaded, setServiceConfigLoaded] = useState(false);

  useEffect(() => { void fetchServices(); }, [fetchServices]);
  useEffect(() => {
    void fetchBankModels();
    void fetchCustomModels();
  }, [fetchBankModels, fetchCustomModels]);
  useEffect(() => {
    let cancelled = false;

    void fetchJson<ServiceConfigPayload>("/services/config")
      .then((payload) => {
        if (cancelled) return;
        setConfiguredModelSelection({
          service: payload.service ?? null,
          model: payload.defaultModel ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setConfiguredModelSelection(null);
      })
      .finally(() => {
        if (!cancelled) setServiceConfigLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const modelPickerStatus = useMemo(() => {
    if (servicesLoading || services.length === 0) return "loading" as const;
    const connected = services.filter((s) => s.connected);
    if (connected.length === 0) return "no-models" as const;
    if (bankModelsLoading) return "loading" as const;
    if (connected.some((s) => (modelsByService[s.service]?.length ?? 0) > 0)) return "ready" as const;
    const hasConnectedBank = connected.some((s) => !s.service.startsWith("custom"));
    const hasConnectedCustom = connected.some((s) => s.service.startsWith("custom"));
    if (!hasConnectedBank && hasConnectedCustom && customModelsLoading) return "loading" as const;
    return "no-models" as const;
  }, [services, servicesLoading, bankModelsLoading, customModelsLoading, modelsByService]);

  const groupedModels = useMemo(() => {
    return services
      .filter((s) => s.connected && (modelsByService[s.service]?.length ?? 0) > 0)
      .map((s) => ({ service: s.service, label: s.label, models: modelsByService[s.service]! }));
  }, [services, modelsByService]);

  /**
   * Which model each agent resolved to, so the bar can name the one running.
   * Read once: pins change on the setup page, not mid-conversation.
   */
  const [routes, setRoutes] = useState<Record<string, { service?: string; model: string }>>({});
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetchJson<{
      routes: Record<string, { service?: string; model: string }>;
      roster: ReadonlyArray<{ id: string; label: string }>;
    }>("/project/model-routing")
      .then((table) => {
        if (cancelled) return;
        setRoutes(table.routes ?? {});
        setRoleLabels(Object.fromEntries((table.roster ?? []).map((r) => [r.id, r.label])));
      })
      .catch(() => { /* the bar falls back to the default model's name */ });
    return () => { cancelled = true; };
  }, []);

  const selectedModelLabel = useMemo(() => {
    if (!selectedModel) return isZh ? "选择模型" : "Select model";
    const group = groupedModels.find((item) => item.service === selectedService);
    const model = group?.models.find((item) => item.id === selectedModel);
    const modelLabel = model?.name ?? selectedModel;
    return group ? `${group.label} · ${modelLabel}` : modelLabel;
  }, [groupedModels, selectedModel, selectedService, isZh]);

  // Planning, writing and auditing can each run on a different model. The bar
  // names whichever is answering right now, and the default between turns.
  const runningBar = useMemo(() => {
    const last = messages[messages.length - 1];
    return modelBar({
      ...(last?.toolExecutions ? { tools: last.toolExecutions } : {}),
      routes,
      roleLabels,
      fallback: selectedModelLabel,
    });
  }, [messages, routes, roleLabels, selectedModelLabel]);

  // Same CLI, same interface, different model: devin serves both glm-5-2,
  // which cannot read images, and kimi, which can. Sending an image to the
  // first one fails somewhere deep in the CLI with an unhelpful message, so
  // the composer refuses it up front.
  //
  // Only an explicit false blocks. A live /models probe cannot report
  // capabilities at all, so most models arrive with none and must keep
  // working exactly as before.
  const modelRejectsImages = useMemo(() => {
    const group = groupedModels.find((item) => item.service === selectedService);
    const model = group?.models.find((item) => item.id === selectedModel);
    return model?.capabilities?.imageInput === false;
  }, [groupedModels, selectedModel, selectedService]);

  /**
   * Choosing a model here chooses it for the whole app.
   *
   * The picker used to set store state only, so the choice lived in this tab
   * and died with it, while every pipeline — audit, de-AI, a publication run,
   * a chapter — went on using whatever was last saved on the service page.
   * One app, one model: the choice is written to the project config, which is
   * where all of them read it from.
   */
  /** Set when the project could not be told which model was picked. */
  const [modelSaveError, setModelSaveError] = useState<string | null>(null);

  const chooseModel = useCallback((model: string, service: string) => {
    setSelectedModel(model, service);
    setConfiguredModelSelection({ service, model });
    // Sent with the choice: for a model served from this machine the catalogue
    // just read is the only place its real context window is stated, and the
    // engine would otherwise assume a generic 128k for it.
    const chosen = groupedModels
      .find((group) => group.service === service)?.models
      .find((entry) => entry.id === model);
    const contextWindow = chosen?.contextWindow && chosen.contextWindow > 0 ? chosen.contextWindow : undefined;
    /* Said out loud when it fails. The chat sends its model with each turn, so
       this conversation is fine either way — but every pipeline reads
       llm.defaultModel, and a save that failed silently left production running
       a model the composer had stopped showing. That is not a difference anyone
       can see until a run fails on a model they thought they had changed. */
    void putApi("/project/default-model", { defaultModel: model, service, contextWindow })
      .then(() => setModelSaveError(null))
      .catch((error: unknown) => {
        setModelSaveError(error instanceof Error ? error.message : String(error));
      });
  }, [setSelectedModel, groupedModels]);

  // Auto-select from saved service config first, then fall back to the first available model.
  useEffect(() => {
    if (!serviceConfigLoaded) return;
    const nextSelection = pickModelSelection(
      groupedModels,
      selectedModel,
      selectedService,
      configuredModelSelection,
    );
    if (nextSelection) {
      setSelectedModel(nextSelection.model, nextSelection.service);
    }
  }, [configuredModelSelection, groupedModels, selectedModel, selectedService, serviceConfigLoaded, setSelectedModel]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Auto-scroll only while the reader is already near the bottom. Streaming
  // updates use instant scroll to avoid piling up smooth-scroll animations.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    if (!autoScrollPinnedRef.current) return undefined;

    if (scrollFrameRef.current !== null) {
      cancelScrollFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestScrollFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: getChatScrollBehavior(loading || isStreaming),
      });
      scrollFrameRef.current = null;
    });

    return () => {
      if (scrollFrameRef.current !== null) {
        cancelScrollFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [messages, loading, isStreaming]);

  useEffect(() => {
    autoScrollPinnedRef.current = true;
  }, [activeSessionId]);

  // Entering a book loads its latest session; book-create mode persists its orphan session in localStorage.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!activeBookId && mode === "project-chat") {
        const state = useChatStore.getState();
        const currentSession = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
        if (currentSession?.bookId === null && currentSession.isDraft) {
          return;
        }
      }

      if (activeBookId) {
        await loadSessionList(activeBookId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const currentSession = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
        if (currentSession?.bookId === activeBookId) {
          await loadSessionDetail(currentSession.sessionId);
          return;
        }
        const ids = state.sessionIdsByBook[activeBookId] ?? [];
        if (ids.length > 0) {
          activateSession(ids[0]);
          await loadSessionDetail(ids[0]);
          return;
        }

        await createSession(activeBookId, mode === "interactive-film-authoring" ? "interactive-film-authoring" : "book");
        return;
      }

      const existingId = mode === "project-chat"
        ? getProjectChatSessionId()
        : getBookCreateSessionId();
      if (existingId) {
        await loadSessionDetail(existingId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const session = state.sessions[existingId];
        if (session && session.bookId === null && (mode !== "project-chat" || session.messages.length > 0)) {
          activateSession(existingId);
          return;
        }
      }

      if (mode === "project-chat") {
        const projectSessions = await loadSessionList(null);
        if (cancelled) return;

        const reusableSessionId = pickProjectChatSessionId(projectSessions);
        if (reusableSessionId) {
          activateSession(reusableSessionId);
          await loadSessionDetail(reusableSessionId);
          if (!cancelled) setProjectChatSessionId(reusableSessionId);
          return;
        }
      }

      // Draft, not createSession: opening this panel must not persist an
      // empty session file to disk. sendMessage's first call is what
      // upgrades a draft to a real, saved session.
      const newSessionId = createDraftSession(null, mode === "book-create" ? "book-create" : "chat");
      if (!cancelled) {
        if (mode === "project-chat") {
          setProjectChatSessionId(newSessionId);
        } else {
          setBookCreateSessionId(newSessionId);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBookId, activateSession, createSession, createDraftSession, loadSessionDetail, loadSessionList, mode]);

  const addAttachedFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const accepted: File[] = [];
    const rejected: string[] = [];
    const blockedByModel: string[] = [];
    for (const file of incoming) {
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        rejected.push(`${file.name} > ${formatFileSize(MAX_CHAT_ATTACHMENT_BYTES)}`);
        continue;
      }
      if (modelRejectsImages && file.type.startsWith("image/")) {
        blockedByModel.push(file.name);
        continue;
      }
      accepted.push(file);
    }
    setAttachedFiles((prev) => [...prev, ...accepted].slice(0, MAX_CHAT_ATTACHMENTS));
    const problems: string[] = [];
    if (rejected.length > 0) {
      problems.push(isZh
        ? `以下文件过大，未添加：${rejected.join("、")}`
        : `Some files were too large: ${rejected.join(", ")}`);
    }
    if (blockedByModel.length > 0) {
      problems.push(isZh
        ? `当前模型不支持图片输入，未添加：${blockedByModel.join("、")}`
        : `${selectedModel ?? "This model"} cannot read images, so these were not attached: ${blockedByModel.join(", ")}`);
    }
    setAttachmentError(problems.length > 0 ? problems.join(" ") : null);
  };

  const onSend = async (text: string) => {
    if (!activeSessionId) return;
    const hasPendingMessage = Boolean(text.trim()) || attachedFiles.length > 0;
    if (!hasPendingMessage) {
      if (chatStreaming || loading) await abortSession(activeSessionId);
      return;
    }
    const requestedSkills = selectedSkillIdsForSend(selectedSkillIds);
    autoScrollPinnedRef.current = true;
    const attachments = await serializeChatAttachments(attachedFiles);
    if (chatStreaming) {
      // Steering by a new user message cancels the current serial workflow.
      await abortSession(activeSessionId);
    }
    await sendMessage(activeSessionId, text, {
      activeBookId,
      sessionKind: currentSessionKind,
      actionSource: "free-text",
      requestedSkills,
      attachments,
    });
    setAttachedFiles([]);
    setAttachmentError(null);
    if (requestedSkills?.length) {
      setSelectedSkillIds([]);
      setSkillPanelOpen(false);
    }
  };

  const importProjectSkill = async (files: FileList) => {
    setSkillSaving(true);
    setSkillCreateError(null);
    try {
      const serialized = await serializeSkillFolder(files);
      const response = await postApi<{ skill: StudioSkill }>("/skills/import", { files: serialized });
      await refetchSkills();
      setSelectedSkillIds((prev) => prev.includes(response.skill.id) ? prev : [...prev, response.skill.id]);
    } catch (error) {
      setSkillCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillSaving(false);
    }
  };

  const handleQuickAction = (command: string, requestedIntent?: "write_next") => {
    if (!activeSessionId) return;
    autoScrollPinnedRef.current = true;
    void sendMessage(activeSessionId, command, {
      activeBookId,
      sessionKind: currentSessionKind,
      actionSource: "quick-action",
      requestedIntent,
    });
  };

  const handleProposedAction = async (details: ProposedActionDetails) => {
    // Lock the proposal card so the production action can't be re-fired.
    markProposalResolved(details.execId, "confirmed");
    const targetPlayMode = details.targetSessionKind === "play"
      ? details.actionPayload?.playStart?.mode ?? activeSession?.playMode ?? (details.action === "play_start" ? "open" : undefined)
      : undefined;
    if (details.sameSession && activeSessionId) {
      autoScrollPinnedRef.current = true;
      await sendMessage(activeSessionId, details.instruction ?? "", {
        activeBookId,
        sessionKind: details.targetSessionKind,
        playMode: targetPlayMode,
        actionSource: "button",
        requestedIntent: details.action,
        actionPayload: details.actionPayload,
        requestedSkills: details.requestedSkills,
      });
      return;
    }
    const targetSessionId = await createSession(null, details.targetSessionKind, targetPlayMode);
    autoScrollPinnedRef.current = true;
    await sendMessage(targetSessionId, details.instruction ?? "", {
      sessionKind: details.targetSessionKind,
      playMode: targetPlayMode,
      actionSource: "button",
      requestedIntent: details.action,
      actionPayload: details.actionPayload,
      requestedSkills: details.requestedSkills,
    });
  };

  const handleRejectProposedAction = async (details: ProposedActionDetails) => {
    markProposalResolved(details.execId, "rejected");
    if (!activeSessionId) return;
    autoScrollPinnedRef.current = true;
    const rejectionText = isZh
      ? `取消这次操作：${details.title ?? details.instruction}`
      : `Cancel this action: ${details.title ?? details.instruction}`;
    await sendMessage(activeSessionId, rejectionText, {
      activeBookId,
      sessionKind: currentSessionKind,
      actionSource: "button",
    });
  };

  const handleSelectNarrativeBranch = async (forecastId: string, branchId: string) => {
    if (!activeSessionId || !activeBookId) return;
    autoScrollPinnedRef.current = true;
    await sendMessage(
      activeSessionId,
      buildNarrativeForecastSelectionInstruction(forecastId, branchId, isZh ? "zh" : "en"),
      {
        activeBookId,
        sessionKind: "book",
        actionSource: "button",
      },
    );
  };

  const handleRecheckNarrativeForecast = async (forecastId: string) => {
    if (!activeSessionId || !activeBookId) return;
    autoScrollPinnedRef.current = true;
    await sendMessage(
      activeSessionId,
      buildNarrativeForecastRecheckInstruction(forecastId, isZh ? "zh" : "en"),
      {
        activeBookId,
        sessionKind: "book",
        actionSource: "button",
      },
    );
  };

  useEffect(() => { setPlayImageError(null); }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || currentSessionKind !== "play") return;
    let cancelled = false;
    void fetchJson<PlayRunImagePayload>(`/play/runs/${encodeURIComponent(activeSessionId)}/main`)
      .then((payload) => {
        if (!cancelled && payload.imageSettings) setPlayImageSettings(payload.imageSettings);
      })
      .catch(() => {
        // No persisted play world yet.
      });
    void fetchJson<CoverConfigResponse>("/cover/config")
      .then((cfg) => {
        if (cancelled) return;
        const selected = cfg.service ?? null;
        setPlayImageCoverReady(
          cfg.configured ?? (!!selected && (cfg.providers ?? []).some((p) => p.service === selected && p.connected)),
        );
      })
      .catch(() => {
        if (!cancelled) setPlayImageCoverReady(false);
      });
    return () => { cancelled = true; };
  }, [activeSessionId, currentSessionKind]);

  const togglePlayImageSetting = async (key: keyof PlayImageSettings) => {
    if (!activeSessionId || currentSessionKind !== "play" || !playImageCoverReady) return;
    const next = { ...playImageSettings, [key]: !playImageSettings[key] };
    setPlayImageSettings(next);
    setPlayImageError(null);
    try {
      await fetchJson(`/play/runs/${encodeURIComponent(activeSessionId)}/main/image-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch (error) {
      setPlayImageSettings(playImageSettings);
      setPlayImageError(error instanceof Error ? error.message : String(error));
    }
  };

  const emptyGuidance = (() => {
    if (currentSessionKind === "short") {
      return isZh
        ? "说一个短篇方向、标题灵感、人物压力或核心冲突，我会走 Quire Short 生成正文、简介和封面。"
        : "Describe a short-fiction direction, title hook, pressure, or core conflict to run Quire Short.";
    }
    if (currentSessionKind === "play") {
      return isZh
        ? "说一个可玩的世界、角色处境或开场动作，我会启动互动世界；之后你可以自由行动或点建议动作。"
        : "Describe a playable world, character situation, or opening action to start an interactive world.";
    }
    return isZh
      ? "\u544A\u8BC9\u6211\u4F60\u60F3\u5199\u4EC0\u4E48\u2014\u2014\u9898\u6750\u3001\u4E16\u754C\u89C2\u3001\u4E3B\u89D2\u3001\u6838\u5FC3\u51B2\u7A81"
      : "Tell me what you want to write \u2014 genre, world, protagonist, core conflict";
  })();

  return (
    /* The conversation, as the mockup draws it: what it is about on the left,
       what it made on the right, and between them a `.convo` column holding a
       putty topbar over a charcoal card. Charcoal is not a theme here — putty
       is the app, charcoal is the manuscript, and chat is manuscript.

       The rails live here rather than beside this page in the router, because
       the Artifacts count and its column are one thing and were two. */
    <>
      <ChatContextRail
        {...(activeBookId ? { bookId: activeBookId } : {})}
        onReference={(text) => setInput(input ? `${input} ${text}` : text)}
      />
      <div className="convo">
      {/* What this conversation has made, and a way to start a clean one. The
          model in use lives in the app topbar above; saying it twice on one
          screen is how it ended up disagreeing with itself. */}
      <div className="topbar shrink-0">
        <div className="crumbs grow">
          {activeBookId ? (
            <>
              <a href={`#/book/${activeBookId}`}>{activeBookId}</a>
              <span className="sep">/</span>
            </>
          ) : null}
          <h1>{isZh ? "对话" : "Chat"}</h1>
        </div>
        <span className="pill mono">{runningBar.text}</span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setArtifactsOpen((open) => !open)}>
          <Layers size={15} aria-hidden="true" />
          {isZh ? "产出" : "Artifacts"}
          <span className="pill" style={{ marginLeft: 4, fontSize: 11 }}>{artifactCount}</span>
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => { void createSession(activeBookId ?? null, currentSessionKind); }}
        >
          <Plus size={15} aria-hidden="true" />
          {isZh ? "新会话" : "New session"}
        </button>
      </div>

      <div className="dark crop">
        <span
          className="disc dots dots-light"
          style={{ width: 260, height: 260, right: -120, top: -130 }}
          aria-hidden="true"
        />
      {/* Message scroll area */}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const target = event.currentTarget;
          autoScrollPinnedRef.current = isChatScrollNearBottom({
            scrollTop: target.scrollTop,
            clientHeight: target.clientHeight,
            scrollHeight: target.scrollHeight,
          });
        }}
        className={`chat-message-scroll flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges] px-[clamp(16px,3vw,32px)] pt-6 pb-2 transition-[padding] duration-200 ${worldPanelInsetClass}`}
      >
        {needsPlayModeChoice ? (
          <div className="flex h-full items-center justify-center px-4 select-none">
            <div className="q-crop w-full max-w-lg rounded-3xl border border-border/60 bg-card p-8 shadow-md">
              <span className="q-disc q-disc-fill" aria-hidden="true"
                    style={{ width: 210, height: 210, right: -78, top: -84, opacity: .13 }} />
              <span className="q-disc q-disc-dots text-primary" aria-hidden="true"
                    style={{ width: 92, height: 92, left: -28, bottom: -34, opacity: .45 }} />

              <div className="relative">
                <p className="q-label flex items-center gap-2">
                  <Gamepad2 size={13} aria-hidden="true" />
                  {isZh ? "玩法" : "Playstyle"}
                </p>
                <h2 className="q-title mt-3 text-2xl">
                  {isZh ? "选个玩法" : "Pick how you want to play"}
                </h2>
                <p className="q-note mt-2">
                  {isZh ? "选个玩法，进去再聊你想玩的世界。" : "Then describe the world you want, in chat."}
                </p>

                {/* Two rows rather than two tiles: they are a choice between
                    two things, not a grid of many, and a row can carry the
                    glyph that fills in under the cursor. */}
                <div className="mt-6 grid gap-1">
                  {([
                    { mode: "guided" as const, glyph: "A", title: isZh ? "点着玩" : "Choices", note: isZh ? "GM 给选项，点着推进" : "Pick from offered actions" },
                    { mode: "open" as const, glyph: "B", title: isZh ? "自由玩" : "Free", note: isZh ? "自己打字，想干嘛干嘛" : "Type anything you want" },
                  ]).map((opt) => (
                    <button
                      key={opt.mode}
                      type="button"
                      onClick={() => { if (activeSessionId) setSessionPlayMode(activeSessionId, opt.mode); }}
                      className="q-row group flex w-full items-center gap-3.5 rounded-xl border border-transparent px-3 py-3 text-left transition-colors duration-[var(--dur-fast)] hover:border-border/60 hover:bg-secondary/40"
                    >
                      <span className="q-glyph" aria-hidden="true">{opt.glyph}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold text-foreground">{opt.title}</span>
                        <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">{opt.note}</span>
                      </span>
                      <ChevronRight size={16} className="q-row-act shrink-0 text-primary" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : messages.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center px-4 select-none">
            <div className="q-crop w-full max-w-md rounded-3xl border border-border/60 bg-card px-8 py-10 text-center shadow-md">
              <span className="q-disc q-disc-stroke" aria-hidden="true"
                    style={{ width: 220, height: 220, left: "50%", top: -150, marginLeft: -110, opacity: .35 }} />
              <span className="q-disc q-disc-fill" aria-hidden="true"
                    style={{ width: 120, height: 120, right: -46, bottom: -52, opacity: .12 }} />
              <div className="relative">
                <span
                  className="mx-auto grid h-12 w-12 place-items-center rounded-full border-[1.5px] border-primary text-primary"
                  aria-hidden="true"
                >
                  <BotMessageSquare size={20} />
                </span>
                <p className="mt-5 text-[14px] leading-7 text-muted-foreground">{emptyGuidance}</p>
              </div>
            </div>
          </div>
        ) : (
          /* `.thread`, the mock's own grid, at its own measure. This was a
             stack of Tailwind utilities that happened to look similar and drifted
             from the system the rest of the app renders with. */
          <div className="thread" style={{ maxWidth: 820, margin: "0 auto" }}>
            {messages.map((msg, i) => (
              <div key={`${msg.timestamp}-${i}`}>
                {msg.role === "user" ? (
                  /* User message */
                  <ChatMessage
                    role="user"
                    content={msg.content}
                    timestamp={msg.timestamp}
                    {...(msg.chips ? { chips: msg.chips } : {})}
                  />
                ) : msg.parts && msg.parts.length > 0 ? (
                  /* Assistant message — parts-based rendering (chronological) */
                  /* Merge consecutive utility tool parts into one group */
                  <>
                    {(() => {
                      type RenderItem =
                        | { kind: "thinking"; pi: number; part: Extract<typeof msg.parts[0], { type: "thinking" }> }
                        | { kind: "text"; pi: number; part: Extract<typeof msg.parts[0], { type: "text" }> }
                        | { kind: "tools"; parts: Array<Extract<typeof msg.parts[0], { type: "tool" }>>; startIdx: number };

                      const items: RenderItem[] = [];
                      for (let pi = 0; pi < msg.parts!.length; pi++) {
                        const part = msg.parts![pi];
                        if (part.type === "thinking") {
                          items.push({ kind: "thinking", pi, part });
                        } else if (part.type === "text") {
                          items.push({ kind: "text", pi, part });
                        } else if (part.type === "tool") {
                          // Merge consecutive tool parts into one group
                          const last = items[items.length - 1];
                          if (last?.kind === "tools") {
                            last.parts.push(part);
                          } else {
                            items.push({ kind: "tools", parts: [part], startIdx: pi });
                          }
                        }
                      }

                      return items.map((item) => {
                        if (item.kind === "thinking") {
                          return (
                            <div key={`t-${item.pi}`} className="mb-2">
                              <Reasoning defaultOpen={false} isStreaming={item.part.streaming}>
                                <ReasoningTrigger />
                                <ReasoningContent>{item.part.content}</ReasoningContent>
                              </Reasoning>
                            </div>
                          );
                        }
                        if (item.kind === "tools") {
                          // Same turn shell as anything else Quire says, because
                          // what it read is part of the answer, not chrome
                          // beside it. The label says which part.
                          return (
                            <div key={`x-${item.startIdx}`} className="msg">
                              <span className="who-av model" aria-hidden="true">Q</span>
                              <div className="body">
                                <div className="tag">{isZh ? "先读了" : "Reading first"}</div>
                                <ToolExecutionSteps
                                  executions={item.parts.map(p => p.execution)}
                                  onProposedAction={handleProposedAction}
                                  onRejectProposedAction={handleRejectProposedAction}
                                  onOpenFilmStudio={nav.toFilmStudio}
                                  onSelectNarrativeBranch={handleSelectNarrativeBranch}
                                  onRecheckNarrativeForecast={handleRecheckNarrativeForecast}
                                />
                              </div>
                            </div>
                          );
                        }
                        if (item.kind === "text" && item.part.content) {
                          const streamingThis = chatStreaming && i === messages.length - 1;
                          return (
                            <ChatMessage
                              key={`c-${item.pi}`}
                              role="assistant"
                              content={item.part.content}
                              timestamp={msg.timestamp}
                              // While it writes, the label counts. The mock says
                              // "380 words so far" because a length is the one
                              // thing a reader cannot judge mid-stream.
                              {...(streamingThis
                                ? {
                                    tag: `${isZh ? "写作中" : "Writing"} · ${wordsSoFar(item.part.content)} ${isZh ? "字" : "words so far"}`,
                                    streaming: true,
                                    footer: (
                                      <>
                                        <button
                                          type="button"
                                          className="btn btn-line btn-sm"
                                          onClick={() => { if (activeSessionId) void abortSession(activeSessionId); }}
                                        >
                                          {isZh ? "停止" : "Stop"}
                                        </button>
                                        <span className="dim" style={{ fontSize: 11 }}>
                                          {isZh ? "正在写入" : "Streaming into"}{" "}
                                          <span className="mono">{streamTarget ?? (isZh ? "本次会话" : "this session")}</span>
                                        </span>
                                      </>
                                    ),
                                  }
                                : {})}
                            />
                          );
                        }
                        return null;
                      });
                    })()}
                  </>
                ) : (
                  /* Assistant message — fallback (no parts, e.g. error messages) */
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    timestamp={msg.timestamp}
                  />
                )}
              </div>
            ))}

            {/* Loading indicator — only when loading and no streaming activity */}
            {loading && !isStreaming && (
              <Message from="assistant">
                <MessageContent>
                  <span className="flex items-center gap-2.5 text-[14px] text-muted-foreground">
                    <span className="q-thinking" aria-hidden="true"><i /><i /><i /></span>
                    {isZh ? "思考中" : "Thinking"}
                  </span>
                </MessageContent>
              </Message>
            )}

          </div>
        )}
      </div>

      {/* Quick actions (only when a book is active) */}
      {!showChoicePanel && (
        <div className={`shrink-0 px-[clamp(16px,3vw,32px)] transition-[padding] duration-200 ${worldPanelInsetClass}`}>
          <div style={{ maxWidth: 820, margin: "0 auto" }} className="w-full">
            <QuickActions
              onAction={handleQuickAction}
              disabled={loading || !activeSessionId}
              isZh={isZh}
            />
          </div>
        </div>
      )}

      {/* Play choices are shortcuts, not a replacement for free actions. Scene
          images render inside their corresponding chat result card so the
          visual history scrolls with the conversation. */}
      {currentSessionKind === "play" && !needsPlayModeChoice && showChoicePanel && (
        <div className={`shrink-0 transition-[padding] duration-200 ${worldPanelInsetClass}`}>
          <PlayChoicePanel
            choices={playChoices}
            disabled={loading || !activeSessionId}
            isZh={isZh}
            onChoose={(action) => {
              if (!activeSessionId || !playChoiceSet) return;
              setConsumedPlayChoiceKey(playChoiceSet.key);
              autoScrollPinnedRef.current = true;
              void sendMessage(activeSessionId, action, { activeBookId, sessionKind: "play", actionSource: "button" });
            }}
          />
        </div>
      )}
      {/* 重试上一条失败的聊天消息（issue #335）：只针对聊天轮失败；
          后台生产任务的失败由任务卡自己展示，不在这里出现。 */}
      {lastFailedSend && !chatStreaming && activeSessionId ? (
        <div className={`shrink-0 px-[clamp(16px,3vw,32px)] transition-[padding] duration-200 ${worldPanelInsetClass}`}>
          <div style={{ maxWidth: 820, margin: "0 auto" }} className="w-full pb-2">
            <button
              type="button"
              onClick={() => {
                autoScrollPinnedRef.current = true;
                void retryLastSend(activeSessionId);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-secondary/30 px-3 py-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <RotateCcw size={14} />
              {isZh ? "重试上一条消息" : "Retry last message"}
            </button>
          </div>
        </div>
      ) : null}
      {needsPlayModeChoice ? null : (
      <div className={`composer shrink-0 transition-[padding] duration-200 ${worldPanelInsetClass}`}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {modelSaveError ? (
            <div role="status" className="fail" style={{ marginBottom: 10, fontSize: 12 }}>
              {isZh
                ? `没能把模型选择写进项目配置，生产任务仍会用上一个模型：${modelSaveError}`
                : `Could not save that model to the project, so runs will still use the previous one: ${modelSaveError}`}
            </div>
          ) : null}
          <div className="flex items-start gap-2">
            <div className="box relative flex-1">
              {skillPanelOpen || slashOpen ? (
                <SkillPickerPanel
                  isZh={isZh}
                  skills={slashOpen ? slashSkills : availableSkills}
                  diagnostics={skillsData?.diagnostics}
                  selectedSkillIds={selectedSkillIds}
                  loading={skillsLoading}
                  error={skillsError}
                  saving={skillSaving}
                  createError={skillCreateError}
                  onToggleSkill={(skillId) => {
                    setSelectedSkillIds((prev) => toggleSelectedSkillIds(prev, skillId));
                    // The skill becomes a chip, so the `/audit` that summoned
                    // it must not also be sent as prose.
                    if (slash) {
                      setInput(applySlashPick(input, slash));
                      setCaret(slash.start);
                      textareaRef.current?.focus();
                    }
                  }}
                  onImport={(files) => void importProjectSkill(files)}
                />
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={modelRejectsImages ? CHAT_ATTACHMENT_ACCEPT_NO_IMAGES : CHAT_ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  if (event.currentTarget.files) addAttachedFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              {selectedSkills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 border-b border-border/20 px-3 py-2">
                  {selectedSkills.map((skill) => (
                    <span
                      key={skill.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
                    >
                      {skill.name}
                      <button
                        type="button"
                        onClick={() => setSelectedSkillIds((prev) => prev.filter((id) => id !== skill.id))}
                        className="rounded-full p-0.5 hover:bg-primary/20"
                        aria-label={isZh ? `移除 ${skill.name}` : `Remove ${skill.name}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              {attachedFiles.length > 0 || attachmentError ? (
                <div className="border-b border-border/20 px-3 py-2">
                  {attachedFiles.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {attachedFiles.map((file) => (
                        <span
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border/50 bg-secondary/60 px-2.5 py-1 text-[11px] text-muted-foreground"
                          title={`${file.name} · ${file.type || "application/octet-stream"} · ${formatFileSize(file.size)}`}
                        >
                          <Paperclip size={12} />
                          <span className="truncate">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => setAttachedFiles((prev) => prev.filter((item) => item !== file))}
                            className="rounded-full p-0.5 hover:bg-muted"
                            aria-label={isZh ? `移除 ${file.name}` : `Remove ${file.name}`}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {attachmentError ? (
                    <div className="mt-1 text-[11px] leading-5 text-destructive">{attachmentError}</div>
                  ) : null}
                </div>
              ) : null}
              {/*
                The mock's composer: what you are writing on one line, and the
                controls under it. This was a single row — a plus, a clip, the
                field and an arrow — so the model in use, the skills attached and
                the send key had nowhere to be said, and two of the three ended
                up somewhere else on the screen.
              */}
              <div className="flex flex-col gap-2 px-3 py-2">
                <div className="flex items-start gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setCaret(e.target.selectionStart ?? e.target.value.length);
                    setSlashDismissed(false);
                  }}
                  onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                  onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                  onKeyDown={(e) => {
                    // Escape leaves the slash on the line and takes the menu
                    // away, so `/` can still be typed as a character.
                    if (e.key === "Escape" && slashOpen) { e.preventDefault(); setSlashDismissed(true); return; }
                    /* Enter picks the top match while the menu is up. Sending
                       "/aud" as a message is never what the keystroke meant. */
                    if (e.key === "Enter" && !e.shiftKey && slashOpen && slash) {
                      e.preventDefault();
                      const pick = slashSkills[0];
                      if (pick) {
                        setSelectedSkillIds((prev) => toggleSelectedSkillIds(prev, pick.id));
                        setInput(applySlashPick(input, slash));
                        setCaret(slash.start);
                      }
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onSend(input); }
                  }}
                  placeholder={isZh
                    ? "让它写一场戏、改一稿、核对一处事实。用下面的按钮附上章节或技能。"
                    : "Ask for a scene, a revision, a fact check. Attach a chapter or a skill with the buttons below."}
                  disabled={!activeSessionId}
                  rows={1}
                  className="flex-1 bg-transparent outline-none! border-none! ring-0! shadow-none focus:outline-none! focus:ring-0! focus:border-none! resize-none disabled:opacity-50 max-h-[200px] overflow-y-auto"
                  style={{ fontSize: 14, lineHeight: 1.55, minHeight: 46 }}
                />
                {/*
                  * Stop is its own control, and it stays put.
                  *
                  * It used to be the send button wearing a different icon,
                  * shown only while the composer was empty — so typing the
                  * next thought during a generation that runs for minutes
                  * removed the only way to interrupt it, which is exactly when
                  * a person reaches for it.
                  */}
                {(loading || chatStreaming) && activeSessionId ? (
                  <button
                    type="button"
                    onClick={() => void abortSession(activeSessionId)}
                    aria-label={isZh ? "停止当前回复" : "Stop generating"}
                    title={isZh ? "停止当前回复" : "Stop generating"}
                    className="w-8 h-8 rounded-full bg-secondary text-foreground border border-border/60 flex items-center justify-center shrink-0 hover:-translate-y-px hover:border-primary/50 hover:text-primary active:translate-y-0 active:scale-[0.985] transition-[transform,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out-quart)]"
                  >
                    <Square size={13} fill="currentColor" />
                  </button>
                ) : null}
                </div>
                <div className="tools">
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!activeSessionId}
                >
                  <Paperclip size={15} aria-hidden="true" />
                  {isZh ? "附件" : "Attach"}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => setSkillPanelOpen((value) => !value)}
                  disabled={loading || !activeSessionId}
                >
                  <Sparkles size={15} aria-hidden="true" />
                  {isZh ? "技能" : "Skills"}
                  {selectedSkillIds.length > 0 ? (
                    <span className="pill" style={{ marginLeft: 4, fontSize: 11 }}>{selectedSkillIds.length}</span>
                  ) : null}
                </button>
                {modelPickerStatus === "loading" ? (
                  <span className="dim animate-pulse" style={{ fontSize: 11 }}>{isZh ? "加载模型..." : "Loading models..."}</span>
                ) : modelPickerStatus === "ready" ? (
                  /*
                   * Which model is answering, not which model to pick.
                   *
                   * Choosing here chose for the whole app — every pipeline, every
                   * agent — from inside one conversation, which is why the model
                   * a book was written with kept changing without anyone deciding
                   * it should. The choice lives on the routing page now, made once
                   * beside the agents that inherit it. This says what is running.
                   */
                  <button
                    type="button"
                    onClick={() => nav.toAgents()}
                    title={isZh ? "在“模型与设置 → 智能体”中更改" : "Change in Models & setup → Agents"}
                    className="btn btn-quiet btn-sm"
                  >
                    <Cpu size={15} aria-hidden="true" />
                    <span className="mono trunc" style={{ fontSize: 11, maxWidth: 260 }}>
                      {runningBar.text}
                    </span>
                    {runningBar.agent ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
                    ) : null}
                  </button>
                ) : (
                  <button
                    onClick={() => nav.toServices()}
                    className="btn btn-quiet btn-sm"
                  >
                    {isZh ? "配置模型 →" : "Set up models →"}
                  </button>
                )}
                {currentSessionKind === "play" && (
                  <button
                    type="button"
                    onClick={() => setWorldPanelOpen((v) => !v)}
                    className="btn btn-quiet btn-sm"
                    title={isZh ? "查看世界：持有 / 状态 / 关系" : "View world: holdings / state / relations"}
                  >
                    <Gamepad2 size={18} />
                    {isZh ? "查看世界" : "View World"}
                  </button>
                )}
                <span className="grow" />
                {/* Send ends the row, where the mock puts it: the last thing
                    under the sentence you just wrote. */}
                <button
                  type="button"
                  onClick={() => void onSend(input)}
                  disabled={(!input.trim() && attachedFiles.length === 0) || !activeSessionId}
                  aria-label={isZh ? "发送" : "Send message"}
                  title={isZh ? "发送" : "Send message"}
                  className="btn btn-sm"
                >
                  <ArrowUp size={15} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </div>
              </div>
            </div>
            {currentSessionKind === "play" ? (
              <div className="composer-aside relative mt-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPlayImageMenuOpen((value) => !value)}
                  disabled={loading || !activeSessionId}
                  title={isZh ? "自动配图" : "Auto illustration"}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-secondary/40 shadow-sm transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary active:translate-y-0 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-30 ${playImageMenuOpen || playImageSettings.actors || playImageSettings.moments || playImageSettings.inventory ? "text-primary" : "text-muted-foreground"}`}
                  aria-label={isZh ? "自动配图" : "Auto illustration"}
                >
                  <Palette size={17} />
                </button>
                {playImageMenuOpen ? (
                  <div className="absolute bottom-12 right-0 z-30 w-44 rounded-xl border border-border/50 bg-card/95 p-2 shadow-xl backdrop-blur">
                    <div className="mb-1.5 px-1 text-[12px] leading-5 font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {isZh ? "自动配图" : "Auto illustration"}
                    </div>
                    {(["actors", "moments", "inventory"] as const).map((key) => (
                      <label
                        key={key}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] leading-6 ${playImageCoverReady ? "cursor-pointer text-foreground hover:bg-secondary/50" : "cursor-not-allowed text-muted-foreground/40"}`}
                        title={playImageCoverReady ? undefined : (isZh ? "先在「模型配置」里配好生图 API 才能开启" : "Configure an image API in Model Settings first")}
                      >
                        <input
                          type="checkbox"
                          disabled={!playImageCoverReady}
                          checked={playImageCoverReady && playImageSettings[key]}
                          onChange={() => void togglePlayImageSetting(key)}
                          className="h-4 w-4 accent-primary"
                        />
                        {key === "actors"
                          ? (isZh ? "为角色配图" : "Characters")
                          : key === "moments"
                            ? (isZh ? "为时刻配图" : "Moments")
                            : (isZh ? "为背包配图" : "Inventory")}
                      </label>
                    ))}
                    {!playImageCoverReady ? (
                      <p className="mt-1 px-1 text-[12px] leading-5 text-muted-foreground/50">
                        {isZh ? "未检测到生图 API。" : "No image API configured."}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {playImageError ? (
            <p className="mt-2 text-right text-[13px] leading-5 text-destructive/80">
              {isZh ? `配图失败：${playImageError}` : `Image failed: ${playImageError}`}
            </p>
          ) : null}
        </div>
      </div>
      )}

      {currentSessionKind === "play" && activeSessionId && (
        <PlayHud
          sessionId={activeSessionId}
          isStreaming={loading}
          isZh={isZh}
          open={worldPanelOpen}
          onClose={() => setWorldPanelOpen(false)}
          imageSettings={playImageSettings}
          sessionTitle={activeSession?.title ?? null}
        />
      )}
      </div>
      <ProjectArtifactDrawer />
      </div>
      {artifactsOpen ? <ChatArtifactsRail {...(activeBookId ? { bookId: activeBookId } : {})} /> : null}
    </>
  );
}

/**
 * Whose model this is, at a glance.
 *
 * A monogram rather than a logo: Quire ships no brand assets and will not
 * borrow another application's. An unknown model gets an empty box of the same
 * size, because a list where some rows are indented and some are not is harder
 * to scan than one with a gap in it.
 */
function VendorMark({ modelId }: { modelId: string }) {
  const vendor = modelVendor(modelId);
  if (!vendor) return <span className="h-5 w-5 shrink-0" aria-hidden="true" />;
  return (
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded text-[9px] font-bold leading-none tracking-tight"
      style={{ background: vendor.bg, color: vendor.fg }}
      title={vendor.label}
      aria-label={vendor.label}
    >
      {vendor.initials}
    </span>
  );
}

function ModelPickerContent({
  groupedModels,
  selectedModel,
  selectedService,
  onSelect,
  onManage,
  isZh,
}: {
  groupedModels: ReadonlyArray<{ service: string; label: string; models: ReadonlyArray<{ id: string; name?: string; contextWindow?: number }> }>;
  selectedModel: string | null;
  selectedService: string | null;
  onSelect: (model: string, service: string) => void;
  onManage: () => void;
  isZh: boolean;
}) {
  const [search, setSearch] = useState("");
  // Which provider's list is on screen. Starts on whatever is selected, and is
  // the only thing the strip below changes — picking a provider must not send
  // a request, only decide what you are choosing between.
  const [viewService, setViewService] = useState<string | null>(selectedService);
  const filtered = useMemo(() => filterModelGroups(groupedModels, search), [groupedModels, search]);
  // Searching looks across every provider, because a search is a question about
  // models, not about CLIs. Browsing shows one.
  const scoped = useMemo(
    () => scopeToProvider(filtered, search.trim() ? null : viewService),
    [filtered, viewService, search],
  );
  const shown = search.trim() ? filtered : (scoped.current ? [scoped.current] : []);

  return (
    <DropdownMenuContent side="top" align="start" className="w-[26rem] max-h-[28rem] flex flex-col">
      <div className="px-2 py-1.5 border-b border-border/30">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isZh ? "搜索模型…" : "Search models…"}
          aria-label={isZh ? "搜索模型" : "Search models"}
          className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/40"
          onClick={(e) => e.stopPropagation()}
          // Typing must not reach the menu, or every letter jumps the
          // selection to whatever item starts with it. Arrows, Enter and
          // Escape are the menu's own and used to be swallowed here too,
          // which left the search box a dead end you could only leave with
          // the mouse.
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(e.key)) {
              e.stopPropagation();
            }
          }}
        />
      </div>
      {/* The provider strip. One CLI is running your prompts; the others'
          models are not candidates you are weighing, they are a scroll you are
          paying for. Hidden when there is only one provider to choose. */}
      {!search.trim() && scoped.providers.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto px-2 py-1.5 border-b border-border/30">
          {scoped.providers.map((p) => {
            const active = scoped.current?.service === p.service;
            return (
              <button
                key={p.service}
                type="button"
                onClick={(e) => { e.preventDefault(); setViewService(p.service); }}
                aria-pressed={active}
                className={`shrink-0 px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="overflow-y-auto flex-1">
        {shown.map((group) => (
          <div key={group.service}>
            {/* The header only earns its place when the list is mixed, which is
                now only while searching. */}
            {search.trim() ? (
              <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {group.label}
              </div>
            ) : null}
            {toFamilies(group.models).flatMap((family) =>
              // Flat: one row per model you can actually pick. The variant grid
              // meant reading a name, then decoding chips beside it; a list you
              // scan beats a matrix you solve.
              family.variants.map((v) => {
                const isSelected = selectedModel === v.id && selectedService === group.service;
                const context = v.contextWindow;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onSelect(v.id, group.service)}
                    aria-pressed={isSelected}
                    title={v.id}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors ${
                      isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <VendorMark modelId={v.id} />
                      <span className="text-[14px] truncate">
                        {modelLabel(v, family.base)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {context ? (
                        <span className="text-[11px] text-muted-foreground">
                          {Math.round(context / 1000)}k
                        </span>
                      ) : null}
                      {isSelected ? <Check size={13} /> : null}
                    </span>
                  </button>
                );
              }),
            )}
          </div>
        ))}
        {shown.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground/50 text-center italic">
            {isZh ? "无匹配模型" : "No model matches that"}
          </div>
        )}
      </div>
      <div className="border-t border-border/30">
        <DropdownMenuItem onClick={onManage} className="text-primary">
          {isZh ? "管理服务商" : "Manage providers"}
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  );
}
