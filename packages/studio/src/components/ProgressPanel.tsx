import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useNewSSEMessages, type SSEMessage } from "../hooks/use-sse";
import { tr } from "../lib/app-language";

/**
 * The floating "something is running" card.
 *
 * A run here takes minutes, not moments — a de-AI pass on one chapter took 139
 * seconds. Without a clock the app is indistinguishable from a hang, which is
 * the single complaint this panel exists to answer.
 *
 * Audit and de-AI are deliberately not reported here. They were, because
 * nothing else reported them; the audit screen now carries its own live row
 * with the same clock plus a Stop button this panel could never offer, in the
 * column the person is already reading. Reporting both meant the same pass
 * announced twice, once in the page and once in a card over the corner of it.
 */

/** Only stages the server actually emits. */
const STAGES = ["draft", "audit", "revise"] as const;
type StageState = "idle" | "run" | "done" | "fail";

interface Run {
  readonly title: string;
  readonly stages: ReadonlyArray<string>;
}

function elapsed(since: number): string {
  const secs = Math.round((Date.now() - since) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

export function ProgressPanel({ sse }: { sse: { messages: ReadonlyArray<SSEMessage> } }) {
  const [run, setRun] = useState<Run | null>(null);
  const [stageState, setStageState] = useState<Record<string, StageState>>({});
  const [meta, setMeta] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-render once a second only while a clock is actually running.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const show = useCallback((title: string, stages: ReadonlyArray<string>) => {
    clearTimeout(hideTimer.current);
    setRun({ title, stages });
    setStageState({});
    setFailed(false);
    setHidden(false);
  }, []);

  const finish = useCallback((text: string, bad = false) => {
    setStartedAt((since) => {
      setMeta(since ? `${text} · took ${elapsed(since)}` : text);
      return 0;
    });
    setFailed(bad);
    // A failure is the thing a person most needs to read, and eight seconds is
    // not long enough to notice one that arrived while they were elsewhere.
    // Success clears itself; a failure waits to be dismissed.
    if (!bad) hideTimer.current = setTimeout(() => setHidden(true), 8000);
  }, []);

  const onMessage = useCallback((m: SSEMessage) => {
    const d = (m.data ?? {}) as Record<string, unknown>;
    const stage = STAGES.find((s) => m.event === `${s}:start` || m.event === `${s}:complete` || m.event === `${s}:error`);

    if (m.event === "write:start") {
      show(tr("写作章节", "Writing chapter"), STAGES);
      setMeta(tr("开始…", "starting…"));
      setStartedAt(Date.now());
      return;
    }
    if (m.event === "book:creating") return show(tr("创建书籍", "Creating book"), ["create", "foundation"]);
    if (m.event === "book:created") {
      setStageState((s) => ({ ...s, foundation: "done" }));
      return finish(tr("书籍就绪", "book ready"));
    }
    if (stage) {
      if (m.event.endsWith(":start")) {
        setHidden(false);
        return setStageState((s) => ({ ...s, [stage]: "run" }));
      }
      if (m.event.endsWith(":complete")) return setStageState((s) => ({ ...s, [stage]: "done" }));
      setStageState((s) => ({ ...s, [stage]: "fail" }));
      return finish(String(d.error ?? `${stage} failed`), true);
    }
    if (m.event === "write:complete") {
      setStageState(Object.fromEntries(STAGES.map((s) => [s, "done" as StageState])));
      return finish(`${tr("章节", "chapter")} ${d.chapterNumber ?? ""} · ${d.wordCount ?? "?"} ${tr("字", "words")}`);
    }
    if (m.event === "write:error") return finish(String(d.error ?? "write failed"), true);
    if (m.event === "book:error") return finish(String(d.error ?? "book failed"), true);
    // The engine reports streamed length as it goes — the only real progress
    // signal there is, since chapter length is not known up front.
    if (m.event === "llm:progress") {
      const chars = Number(d.chars ?? d.length ?? 0);
      return setMeta(`${chars.toLocaleString()} ${tr("字", "chars")}${d.seconds ? ` · ${d.seconds}s` : ""}`);
    }
    if (m.event === "log" && d.message) return setMeta(String(d.message).slice(0, 120));
  }, [finish, show]);

  useNewSSEMessages(sse.messages, onMessage);

  if (hidden || !run) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`q-crop q-dark fixed bottom-4 right-4 z-50 w-72 animate-[panelIn_var(--dur-med)_var(--ease-out-quart)_both] rounded-2xl border p-4 shadow-lg ${
        failed ? "border-destructive/60" : "border-transparent"
      }`}
    >
      {/* One disc, cropped by the card. Decoration, so it stays out of the
          accessibility tree and never sits under the text. */}
      <span className="q-disc q-disc-fill" aria-hidden="true"
            style={{ width: 96, height: 96, right: -34, top: -40, opacity: .22 }} />
      <div className="relative mb-3 flex items-center justify-between">
        <b className="text-[13px] font-semibold">{run.title}</b>
        <button
          onClick={() => setHidden(true)}
          aria-label={tr("隐藏", "Hide")}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
      <div className="relative mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {run.stages.map((s) => {
          const state = stageState[s] ?? "idle";
          return (
            <span key={s} className={`q-stage text-[12px] ${state === "done" ? "is-done" : state === "run" ? "is-now" : ""}`}>
              <i />
              {s}
            </span>
          );
        })}
      </div>
      <div className="q-dim relative text-[12px] tabular-nums">
        {startedAt ? `${meta} · ${elapsed(startedAt)}` : meta}
      </div>
    </div>
  );
}
