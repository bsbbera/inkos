export interface ChatPageModelInfo {
  readonly id: string;
  readonly name?: string;
}

export interface ChatPageModelGroup {
  readonly service: string;
  readonly label: string;
  readonly models: ReadonlyArray<ChatPageModelInfo>;
}

export interface ChatPageModelPreference {
  readonly model?: string | null;
  readonly service?: string | null;
}

export interface ChatPageSessionSummary {
  readonly sessionId: string;
  readonly sessionKind?: string;
  readonly messageCount: number;
}

const BOOK_CREATE_SESSION_KEY = "inkos.book-create.session-id";
const PROJECT_CHAT_SESSION_KEY = "inkos.project-chat.session-id";

export function getBookCreateSessionId(): string | null {
  return globalThis.localStorage?.getItem(BOOK_CREATE_SESSION_KEY) ?? null;
}

export function setBookCreateSessionId(sessionId: string): void {
  globalThis.localStorage?.setItem(BOOK_CREATE_SESSION_KEY, sessionId);
}

export function clearBookCreateSessionId(): void {
  globalThis.localStorage?.removeItem(BOOK_CREATE_SESSION_KEY);
}

export function getProjectChatSessionId(): string | null {
  return globalThis.localStorage?.getItem(PROJECT_CHAT_SESSION_KEY) ?? null;
}

export function clearProjectChatSessionId(): void {
  globalThis.localStorage?.removeItem(PROJECT_CHAT_SESSION_KEY);
}

export function setProjectChatSessionId(sessionId: string): void {
  globalThis.localStorage?.setItem(PROJECT_CHAT_SESSION_KEY, sessionId);
}

export function filterModelGroups(
  groupedModels: ReadonlyArray<ChatPageModelGroup>,
  search: string,
): ReadonlyArray<ChatPageModelGroup> {
  const query = search.trim().toLowerCase();
  if (!query) return groupedModels;

  return groupedModels
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        (model.name ?? model.id).toLowerCase().includes(query)
        || group.label.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.models.length > 0);
}

/**
 * Which model this tab should be on, or null when it is already right.
 *
 * The project config wins. `chooseModel` writes every chat pick straight to
 * `/project/default-model`, and every pipeline - audit, de-AI, a chapter, a
 * short - reads its model from there, so that file is the one place the choice
 * lives. This used to keep whatever the tab last remembered whenever that
 * model still existed, which meant a model set on the setup page left the chat
 * bar naming the old one while the runs used the new one: two models in use at
 * once and no way to tell from either screen which was which.
 *
 * The remembered selection is now only a fallback, for a project that has not
 * recorded a choice yet.
 */
export function pickModelSelection(
  groupedModels: ReadonlyArray<ChatPageModelGroup>,
  selectedModel: string | null,
  selectedService: string | null,
  preference?: ChatPageModelPreference | null,
): { model: string; service: string } | null {
  /** Null when the tab is on this pair already, so nothing re-renders. */
  const settle = (model: string, service: string) =>
    selectedModel === model && selectedService === service ? null : { model, service };

  const preferredService = preference?.service?.trim();
  const preferredModel = preference?.model?.trim();

  if (preferredService) {
    const preferredGroup = groupedModels.find((group) => group.service === preferredService);
    const exactModel = preferredModel
      ? preferredGroup?.models.find((model) => model.id === preferredModel)
      : undefined;
    if (preferredGroup && exactModel) return settle(exactModel.id, preferredGroup.service);
    // The service is still the answer even when the exact model has rotted off
    // its catalogue - a stale pin should not drop the whole choice.
    const firstPreferredModel = preferredGroup?.models[0];
    if (preferredGroup && firstPreferredModel) {
      return settle(firstPreferredModel.id, preferredGroup.service);
    }
  }

  if (preferredModel) {
    for (const group of groupedModels) {
      const exactModel = group.models.find((model) => model.id === preferredModel);
      if (exactModel) return settle(exactModel.id, group.service);
    }
  }

  const selectedStillAvailable = selectedModel && selectedService
    ? groupedModels.some((group) =>
        group.service === selectedService
        && group.models.some((model) => model.id === selectedModel),
      )
    : false;
  if (selectedStillAvailable) return null;

  const firstGroup = groupedModels.find((group) => group.models.length > 0);
  const firstModel = firstGroup?.models[0];
  if (!firstGroup || !firstModel) return null;
  return settle(firstModel.id, firstGroup.service);
}

export function pickProjectChatSessionId(
  sessions: ReadonlyArray<ChatPageSessionSummary>,
): string | null {
  const projectSurfaceSessions = sessions.filter((session) =>
    !session.sessionKind
    || session.sessionKind === "chat"
    || session.sessionKind === "short"
    || session.sessionKind === "play"
    || session.sessionKind === "script"
    || session.sessionKind === "storyboard"
    || session.sessionKind === "interactive-film"
  );
  return projectSurfaceSessions.find((session) => session.messageCount > 0)?.sessionId
    ?? projectSurfaceSessions[0]?.sessionId
    ?? null;
}

export function shouldShowPlayChoicePanel(input: {
  readonly playMode?: string | null;
  readonly choiceSetKey?: string | null;
  readonly consumedChoiceKey?: string | null;
  readonly choiceCount: number;
}): boolean {
  if (input.playMode !== "guided") return false;
  if (!input.choiceSetKey) return false;
  if (input.choiceCount <= 0) return false;
  return input.choiceSetKey !== input.consumedChoiceKey;
}

export function isChatScrollNearBottom(input: {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly thresholdPx?: number;
}): boolean {
  const threshold = input.thresholdPx ?? 96;
  const distanceFromBottom = input.scrollHeight - input.scrollTop - input.clientHeight;
  return distanceFromBottom <= threshold;
}

export function getChatScrollBehavior(isStreaming: boolean): "auto" | "smooth" {
  return isStreaming ? "auto" : "smooth";
}
