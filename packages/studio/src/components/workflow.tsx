/*
 * The workflow surface, in one vocabulary, for every kind of work.
 *
 * Two things came from two different screens and belong together:
 *
 *   The magazine's model. Stages derived from what is on disk, gates that name
 *   what is keeping them shut, and a terminal gate that says why the thing
 *   cannot ship. That model was locked inside PublicationDetail and books had
 *   none of it.
 *
 *   The audit's treatment. A problem is a place in the text, not a line in a
 *   list: the sentence marked in the prose it belongs to, the suggestion under
 *   it, and a verdict you can give without leaving the passage. The magazine
 *   screen listed findings as flat paragraphs of grey text - "p4: detected 7
 *   consecutive sentences" - with no way to see the sentence or act on it.
 *
 * Charcoal is reserved for the manuscript. A passage renders on charcoal
 * wherever it appears, because it is the text itself rather than a report
 * about the text.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "./ui/icon";

/* -------------------------------------------------------------- the shapes */

export type StageState = "done" | "partial" | "pending";

export interface WorkflowStage {
  readonly stage: string;
  readonly state: StageState | string;
  readonly detail: string;
}

export interface Approval {
  readonly at: string;
  readonly by: string;
}

export interface WorkflowGate {
  readonly name: string;
  readonly label: string;
  readonly approved: Approval | null;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly canApprove: boolean;
}

export interface Workflow {
  readonly kind: string;
  readonly stages: readonly WorkflowStage[];
  readonly gates: readonly WorkflowGate[];
  readonly done: { readonly can: boolean; readonly blockers: readonly string[] };
  readonly running: boolean;
  readonly lastError: { readonly at?: string; readonly stage?: string; readonly message: string } | null;
}

/* ------------------------------------------------------------------ 0. bar */

/**
 * The whole workflow in one row, above the work rather than instead of it.
 *
 * The first attempt at this was four stacked panels - a red banner, two gate
 * cards, a stage table and an action strip - about 470px of chrome pushing the
 * actual audit columns off the bottom of the screen. Status is something you
 * glance at; only acting on a gate needs room. So the row carries the glance
 * and the drawer carries the acting, and the drawer starts shut.
 *
 * The state on the right is a button, not a label, because it is the thing a
 * person reaches for when the answer is "held": it names the first blocker and
 * opens onto the rest.
 */
function shortDetail(detail: string): string {
  /* "22 files, 40,931 words" -> "22 files". The bar has room for the number
     that changes, and the full sentence is on the row's title. */
  return detail.split(",")[0]!.trim();
}

export function WorkflowBar({
  workflow, label = "finish", actions, children,
}: {
  readonly workflow: Workflow;
  /** Completes "Ready to …" and "cannot … yet". */
  readonly label?: string;
  /** Buttons to sit at the end of the row itself. */
  readonly actions?: React.ReactNode;
  /** The drawer: gates, and anything else that needs room to act. */
  readonly children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const held = !workflow.done.can;
  const [first, ...rest] = workflow.done.blockers;

  return (
    <div className={`wfbar-wrap${open ? " is-open" : ""}`}>
      <div className="wfbar">
        {workflow.stages.map((s) => (
          <span
            key={s.stage}
            className={`st ${s.state === "done" ? "done" : s.state === "partial" ? "now" : ""}`}
            title={`${s.stage} — ${s.state}: ${s.detail}`}
          >
            <i />
            {s.stage}
            {s.detail ? <em className="wf-d">{shortDetail(s.detail)}</em> : null}
          </span>
        ))}

        <span className="grow" />

        {children ? (
          <button
            type="button"
            className={`wf-state ${held ? "is-held" : "is-ok"}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name={held ? "alert" : "check"} size={13} />
            <span className="wf-say">{held ? first ?? `cannot ${label} yet` : `Ready to ${label}`}</span>
            {rest.length > 0 ? <span className="wf-more">+{rest.length}</span> : null}
            <Icon name={open ? "up" : "down"} size={12} />
          </button>
        ) : (
          <span className={`wf-state ${held ? "is-held" : "is-ok"}`}>
            <Icon name={held ? "alert" : "check"} size={13} />
            <span className="wf-say">{held ? first ?? `cannot ${label} yet` : `Ready to ${label}`}</span>
          </span>
        )}

        {actions}
      </div>

      {open && children ? <div className="wf-drop">{children}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- 2. gates */

/**
 * One decision a person has to make, and what is standing in its way.
 *
 * Blockers and warnings look different because they mean different things. A
 * blocker is red and disables the button. A warning is quiet and does not:
 * signing off an unfinished issue is a real thing an editor does on purpose.
 */
export function GateCard({
  gate, busy, onApprove, onRevoke,
}: {
  readonly gate: WorkflowGate;
  readonly busy?: boolean;
  readonly onApprove?: () => void;
  readonly onRevoke?: () => void;
}) {
  const open = !gate.approved && gate.canApprove;
  return (
    <div className={`gate ${gate.approved ? "is-done" : open ? "is-open" : ""}`} style={{ alignItems: "flex-start", flexDirection: "column" }}>
      <div className="rowflex" style={{ gap: 10, width: "100%" }}>
        <span className="what grow">{gate.label}</span>
        {gate.approved ? (
          <span className="pill pill-ok">
            <Icon name="check" size={12} />
            {" "}approved {new Date(gate.approved.at).toLocaleDateString()}
          </span>
        ) : (
          <span className="pill">not approved</span>
        )}
      </div>

      {gate.blockers.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", width: "100%" }}>
          {gate.blockers.map((b) => (
            <li
              key={b}
              className="rowflex"
              style={{ gap: 7, alignItems: "flex-start", fontSize: 12, color: "var(--bad)", marginTop: 5 }}
            >
              <span className="sev sev-bad" style={{ marginTop: 6 }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {gate.warnings.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", width: "100%" }}>
          {gate.warnings.map((w) => (
            <li
              key={w}
              className="rowflex"
              style={{ gap: 7, alignItems: "flex-start", fontSize: 12, color: "var(--ink-3)", marginTop: 5 }}
            >
              <span className="sev sev-warn" style={{ marginTop: 6 }} />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {onApprove || onRevoke ? (
        <div className="rowflex" style={{ gap: 8, marginTop: 4 }}>
          {gate.approved ? (
            <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={onRevoke}>
              <Icon name="x" size={14} />Revoke
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || !gate.canApprove}
              onClick={onApprove}
              title={gate.canApprove ? undefined : "Clear what is listed above first."}
            >
              <Icon name="check" size={14} />
              {busy ? "Saving…" : `Approve ${gate.label.toLowerCase()}`}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- 3. the text */

export type Severity = "blocking" | "warning" | "note";

export const SEV_CLASS: Record<string, string> = {
  blocking: "sev sev-bad",
  warning: "sev sev-warn",
  note: "sev sev-info",
};

/**
 * The passage, with the sentence the check is about marked in it.
 *
 * `markStart < 0` is a real and common state - a finding about a section as a
 * whole, or one whose words have been rewritten since the check ran - and it
 * renders as the plain paragraph rather than as a mark in the wrong place. A
 * highlight over words the checker never read is worse than no highlight.
 */
export function MarkedPassage({
  text, markStart, markEnd, size = "16px",
}: {
  readonly text: string;
  readonly markStart: number;
  readonly markEnd: number;
  readonly size?: string;
}) {
  const located = markStart >= 0 && markEnd > markStart && markEnd <= text.length;
  return (
    <div
      className="read"
      style={{ color: "var(--on-char)", "--rs": size, "--rm": "58ch" } as React.CSSProperties}
    >
      <p>
        {located ? (
          <>
            {text.slice(0, markStart)}
            <mark aria-current="true">{text.slice(markStart, markEnd)}</mark>
            {text.slice(markEnd)}
          </>
        ) : text}
      </p>
    </div>
  );
}

/**
 * What to do about it: the exact replacement if the check proposed one, the
 * advice in words if it did not.
 *
 * A proposed fix is shown in the green of something that would be added, so
 * the difference between "here is the new sentence" and "here is what to think
 * about" is visible before either is read.
 */
export function Suggestion({
  fix, suggestion,
}: {
  readonly fix?: string;
  readonly suggestion?: string;
}) {
  if (fix) {
    return (
      <>
        <div className="label">The fix it proposes</div>
        <div
          className="read"
          style={{ color: "var(--on-char-2)", "--rs": "16px", "--rm": "58ch", marginTop: 8 } as React.CSSProperties}
        >
          <p>
            …{" "}
            <span style={{
              color: "var(--on-char)",
              background: "color-mix(in oklab, var(--ok) 30%, transparent)",
              borderRadius: 2,
              padding: ".06em .12em",
            }}>{fix}</span>{" "}
            …
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="label">What it suggests</div>
      <p className="muted" style={{ fontSize: 14, marginTop: 8, maxWidth: "56ch" }}>
        {suggestion || "Nothing specific — this one is a note to read with."}
      </p>
    </>
  );
}

/* ------------------------------------------------------ 4. resizable columns */

/**
 * Columns you can drag, because the right split depends on the work.
 *
 * A file tree of twenty-two long chapter names and a file tree of four shorts
 * do not want the same width, and neither does a passage of dense prose next
 * to one of dialogue. The layout was fixed at whatever suited the mock.
 *
 * Widths are pixels for every column but the last, which takes what is left -
 * so the passage grows when you shrink the queue rather than leaving a gap.
 * Kept per browser, because it is a preference about this screen on this
 * monitor and means nothing on another.
 */
/**
 * One seam moved, expressed as shares of the row.
 *
 * The arithmetic is in pixels, because that is what a pointer moves in and
 * what `min` is expressed in; only the answer is a ratio. The pair either side
 * of the seam trade width between themselves and everything beyond them is
 * untouched, so dragging the first seam does not shove the third column.
 *
 * Returns null when there is no room to move without crushing a column.
 */
export function seamDrag(
  from: readonly number[],
  index: number,
  dx: number,
  min: number,
): number[] | null {
  const a = from[index];
  const b = from[index + 1];
  if (a === undefined || b === undefined) return null;
  const room = a + b;
  if (room < min * 2) return null;
  const want = Math.max(min, Math.min(room - min, a + dx));
  const next = [...from];
  next[index] = want;
  next[index + 1] = room - want;
  const total = next.reduce((n, w) => n + w, 0);
  if (total <= 0) return null;
  /* Scaled so the shares sum to the column count: equal is 1,1,1 whatever the
     window was when the drag happened. */
  return next.map((w) => (w / total) * next.length);
}

export function useColumns(key: string, count: number, min = 220) {
  /*
   * Shares, not pixels.
   *
   * This kept the dragged widths in pixels, which is a number that means
   * something on exactly one window size. Drag the seams on a laptop, open the
   * same screen on a 30in monitor, and the first two columns are still the
   * laptop's 471px and 400px while the third swallows every pixel of the extra
   * width — the layout the user saw, and the reason "it is not equal" survived
   * a stylesheet that says the columns are equal. Pixels cannot be responsive.
   *
   * So a drag is stored as fractions that sum to `count`: equal is `1,1,1`, and
   * whatever ratio you drag holds its proportions at any width. `null` still
   * means "whatever the stylesheet says", which is how the columns start equal
   * without this hook having to know what equal is.
   */
  const [shares, setShares] = useState<number[] | null>(() => {
    try {
      /* `cols2`, because the old key holds pixels and there is no honest way to
         read one as the other: the width it was measured against is gone. */
      localStorage.removeItem(`quire.cols.${key}`);
      const saved: unknown = JSON.parse(localStorage.getItem(`quire.cols2.${key}`) ?? "null");
      /* Only a saved value of the right shape wins; a stale one from a screen
         that has since gained a column would lay the page out wrongly. */
      return Array.isArray(saved) && saved.length === count
        && saved.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
        ? saved as number[]
        : null;
    } catch {
      return null;
    }
  });

  const dragging = useRef<{ index: number; x: number; from: number[] } | null>(null);

  const onGrip = useCallback((index: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    grip.setPointerCapture?.(event.pointerId);
    /*
     * Start from the widths that are on screen, measured, rather than from a
     * remembered guess. That is what lets the default be a plain `1fr 1fr 1fr`
     * in CSS: the first drag picks up exactly where the layout already was,
     * instead of snapping the columns to numbers this file made up.
     */
    const cols = Array.from(grip.parentElement?.children ?? [])
      .filter((el) => !el.classList.contains("grip"))
      .map((el) => el.getBoundingClientRect().width);
    dragging.current = { index, x: event.clientX, from: cols };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag) return;
      const next = seamDrag(drag.from, drag.index, event.clientX - drag.x, min);
      if (next) setShares(next);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = null;
      setShares((s) => {
        try {
          if (s) localStorage.setItem(`quire.cols2.${key}`, JSON.stringify(s));
        } catch { /* private mode */ }
        return s;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [key, min]);

  /* Every column is a share of what there is, with a grip between each pair.
     `minmax(0, …)` on all of them, because a bare `1.2fr` is `minmax(auto,
     1.2fr)` and an unbreakable filename would push a column past its share. */
  const template = shares
    ? shares.map((s) => `minmax(0, ${s.toFixed(4)}fr)`).join(" 6px ")
    : undefined;

  const reset = useCallback(() => {
    setShares(null);
    try { localStorage.removeItem(`quire.cols2.${key}`); } catch { /* private mode */ }
  }, [key]);

  return { template, onGrip, reset, shares };
}

/**
 * The handle itself. Wide enough to hit, thin enough not to be furniture.
 *
 * Double-click puts the columns back to equal. Without it a drag is one-way:
 * the widths outlive the session in `localStorage`, and the only way back to
 * the layout the stylesheet describes is to drag two seams by eye.
 */
export function Grip({
  onPointerDown, onReset,
}: {
  readonly onPointerDown: (e: React.PointerEvent) => void;
  readonly onReset?: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="grip"
      title={onReset ? "Drag to resize · double-click for equal columns" : undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    />
  );
}

/* ----------------------------------------------------------- 5. read aloud */

/**
 * Hear the sentence instead of reading it again.
 *
 * Prose that scans badly on the page is obvious the moment it is spoken, which
 * is why writers read drafts out loud. The browser already does this; nothing
 * is installed and nothing is sent anywhere - `speechSynthesis` runs on the
 * device.
 *
 * Guarded rather than assumed: the API is missing in some embeddings, and a
 * button that throws is worse than one that never appears.
 */
/**
 * The speeds offered, and where the choice lives.
 *
 * One rate for the whole app, not one per button. A screen can show a dozen
 * read-aloud buttons - a magazine issue has one per page - and a speed set on
 * one of them that the next one ignores is not a setting, it is a surprise.
 * So the choice sits outside React in a module the buttons subscribe to, and
 * is remembered across sessions: a person who reads at 1.5x reads at 1.5x
 * tomorrow too.
 */
export const SPEECH_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const RATE_KEY = "quire.readAloud.rate";
const rateListeners = new Set<() => void>();

function readStoredRate(): number {
  if (typeof localStorage === "undefined") return 1;
  const raw = Number(localStorage.getItem(RATE_KEY));
  return SPEECH_RATES.includes(raw as (typeof SPEECH_RATES)[number]) ? raw : 1;
}

let currentRate = readStoredRate();

function subscribeRate(fn: () => void): () => void {
  rateListeners.add(fn);
  return () => { rateListeners.delete(fn); };
}

function setStoredRate(rate: number): void {
  currentRate = rate;
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* A browser with storage refused still gets the speed for this session. */
  }
  for (const fn of rateListeners) fn();
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const ownRef = useRef<SpeechSynthesisUtterance | null>(null);
  /* What is being read, kept so a speed change can restart it. The Web Speech
     API fixes rate at the moment an utterance starts and offers no way to
     change it mid-sentence, so "faster" means saying the same thing again. */
  const textRef = useRef("");
  const rate = useSyncExternalStore(subscribeRate, () => currentRate, () => 1);

  const supported = typeof window !== "undefined"
    && typeof window.speechSynthesis !== "undefined";

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    ownRef.current = null;
    textRef.current = "";
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback((text: string) => {
    if (!supported || !text.trim()) return;
    /* Whatever is being said now is replaced, not queued behind. Two passages
       read over each other is the one outcome nobody wants. */
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    /* Read at whatever speed the person set. The old fixed 0.95 is gone: it
       was a reasonable default nobody could argue with, which is exactly the
       problem - some prose wants to be crawled over and some wants skimming. */
    utterance.rate = currentRate;
    utterance.onend = () => { ownRef.current = null; setSpeaking(false); };
    utterance.onerror = () => { ownRef.current = null; setSpeaking(false); };
    ownRef.current = utterance;
    textRef.current = text;
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }, [supported]);

  /**
   * Change the speed, and apply it to what is being said right now.
   *
   * Setting a speed that only takes effect on the next passage is the thing
   * that makes a speed control feel broken - you press 2x, nothing happens,
   * you press it again. So a change while speaking restarts the same text.
   */
  const setRate = useCallback((next: number) => {
    setStoredRate(next);
    if (speaking && textRef.current) speak(textRef.current);
  }, [speaking, speak]);

  /* Leaving the screen must stop the voice. Without this it keeps reading a
     paragraph that is no longer on screen, with no control left to stop it. */
  useEffect(() => stop, [stop]);

  return { supported, speaking, speak, stop, rate, setRate };
}

/**
 * The speed picker, shaped like the one everybody already knows.
 *
 * A native select rather than a menu of our own: it is one element, it is
 * reachable from the keyboard, it opens the platform's own list on a phone,
 * and a popover written by hand would have to earn all three back.
 */
export function SpeechRate({ dark = false }: { readonly dark?: boolean }) {
  const { supported, rate, setRate } = useSpeech();
  if (!supported) return null;
  return (
    <select
      className={`btn btn-sm ${dark ? "btn-quiet" : "btn-line"}`}
      style={{ paddingRight: 6, fontVariantNumeric: "tabular-nums" }}
      value={rate}
      aria-label="Reading speed"
      title="Reading speed"
      onChange={(e) => setRate(Number(e.target.value))}
    >
      {SPEECH_RATES.map((r) => (
        <option key={r} value={r}>{r}x</option>
      ))}
    </select>
  );
}

/**
 * The button for it, with the speed beside it.
 *
 * Absent rather than broken where the browser has no voice. The speed sits
 * next to the button rather than behind a menu somewhere else, because it is
 * only ever wanted at the moment something is being read - and it is the same
 * speed everywhere, so setting it here sets it for every passage on screen.
 */
export function ReadAloud({
  text, label = "Read it aloud", dark = false, iconOnly = false, rateControl = true,
}: {
  readonly text: string;
  readonly label?: string;
  readonly dark?: boolean;
  /** For a row that is already full: the glyph carries it, the label is the tooltip. */
  readonly iconOnly?: boolean;
  /** Off for a row that shows many of these; one speed picker is enough. */
  readonly rateControl?: boolean;
}) {
  const { supported, speaking, speak, stop } = useSpeech();
  if (!supported || !text.trim()) return null;
  const title = speaking ? "Stop reading" : label;
  return (
    <span className="rowflex" style={{ gap: 5, flex: "none" }}>
      <button
        type="button"
        className={`btn btn-sm ${dark ? "btn-quiet" : "btn-line"}`}
        onClick={() => (speaking ? stop() : speak(text))}
        aria-pressed={speaking}
        aria-label={iconOnly ? title : undefined}
        title={iconOnly ? title : undefined}
      >
        <Icon name={speaking ? "mute" : "speak"} size={15} />
        {iconOnly ? null : speaking ? "Stop" : label}
      </button>
      {rateControl ? <SpeechRate dark={dark} /> : null}
    </span>
  );
}
