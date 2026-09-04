import { useEffect, useRef, useCallback, useState } from "react";

export interface SSEMessage {
  readonly event: string;
  readonly data: unknown;
  readonly timestamp: number;
  /** Monotonic sequence for cursor-based consumers; survives ring-buffer trimming. */
  readonly seq: number;
}

export const STUDIO_SSE_EVENTS = [
  // The orchestrator's own events. A name missing from this list is dropped
  // silently by the client, so adding one here is part of emitting it.
  "pipeline:stage",
  "book:creating",
  "book:created",
  "book:deleted",
  "book:error",
  "write:start",
  "write:complete",
  "write:error",
  "draft:start",
  "draft:complete",
  "draft:error",
  "daemon:chapter",
  "daemon:started",
  "daemon:stopped",
  "daemon:error",
  "agent:start",
  "agent:complete",
  "agent:error",
  "session:title",
  "audit:start",
  "audit:complete",
  "audit:error",
  // The audit routes have always broadcast these three and no client ever
  // listened, because a listener only receives events named in this list.
  "audit:run",
  "audit:progress",
  "audit:text",
  "audit:state",
  "audit:section",
  // A finding was settled, or a run put new ones on record. The queue beside
  // the passage is a live list and this is what keeps two windows on the same
  // book from disagreeing about what is still open.
  "findings:changed",
  // Same story for the publication routes: art, render and build all broadcast
  // their start/done/error and no client heard any of it, so every one of those
  // buttons looked like it had done nothing at all.
  "publication:run",
  "publication:issue",
  "publication:event",
  "revise:start",
  "revise:complete",
  "revise:error",
  "rewrite:start",
  "rewrite:complete",
  "rewrite:error",
  "style:start",
  "style:complete",
  "style:error",
  "import:start",
  "import:complete",
  "import:error",
  "fanfic:start",
  "fanfic:complete",
  "fanfic:error",
  "fanfic:refresh:start",
  "fanfic:refresh:complete",
  "fanfic:refresh:error",
  "draft:delta",
  "radar:start",
  "radar:complete",
  "radar:error",
  "log",
  "llm:progress",
  "ping",
] as const;

export function collectNewSSEMessages(
  messages: ReadonlyArray<SSEMessage>,
  cursor: number | null,
): { readonly fresh: ReadonlyArray<SSEMessage>; readonly nextCursor: number | null } {
  if (messages.length === 0) return { fresh: [], nextCursor: cursor };
  const latest = messages[messages.length - 1]!.seq;
  if (cursor === null) return { fresh: [], nextCursor: latest };
  if (latest <= cursor) return { fresh: [], nextCursor: cursor };
  return { fresh: messages.filter((message) => message.seq > cursor), nextCursor: latest };
}

export function useNewSSEMessages(
  messages: ReadonlyArray<SSEMessage>,
  handler: (message: SSEMessage) => void,
): void {
  const cursorRef = useRef<number | null>(null);

  useEffect(() => {
    const { fresh, nextCursor } = collectNewSSEMessages(messages, cursorRef.current);
    cursorRef.current = nextCursor;
    for (const message of fresh) {
      handler(message);
    }
  }, [handler, messages]);
}

export function useSSE(url = "/api/v1/events") {
  const [messages, setMessages] = useState<ReadonlyArray<SSEMessage>>([]);
  const [connected, setConnected] = useState(false);
  /**
   * Whether the stream has ever been open.
   *
   * `connected` is false for the first moment of every load, so a banner keyed
   * on it alone would announce a lost connection to everyone who just opened
   * the app. Only a stream that was open and then dropped is worth telling
   * somebody about.
   */
  const [everConnected, setEverConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => { setConnected(true); setEverConnected(true); };
    es.onerror = () => setConnected(false);

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = e.data ? JSON.parse(e.data) : null;
        // Compute outside the state updater: React StrictMode may invoke
        // updaters twice to verify purity.
        seqRef.current += 1;
        const message: SSEMessage = { event: e.type, data, timestamp: Date.now(), seq: seqRef.current };
        setMessages((prev) => [...prev.slice(-99), message]);
      } catch {
        // ignore parse errors
      }
    };

    for (const event of STUDIO_SSE_EVENTS) {
      es.addEventListener(event, handleEvent);
    }

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url]);

  const clear = useCallback(() => setMessages([]), []);

  /**
   * `lost` is the state no screen had: the server going away mid-run left the
   * UI showing "Thinking…" forever, indistinguishable from a slow model. The
   * browser retries an EventSource on its own, so this clears itself when the
   * server comes back.
   */
  return { messages, connected, lost: everConnected && !connected, clear };
}
