/*
 * The Vermilion primitives, as React.
 *
 * The mockups drive these by delegation from mock.js because a static page has
 * no state to hold. Here they hold their own, but the markup and the class
 * names are the mock's exactly - a screen ports by carrying its JSX across,
 * and nothing below knows what screen it is on.
 */
import { useEffect, useSyncExternalStore } from "react";
import { Icon, type IconName } from "./icon";
import { plainError } from "../../lib/error-copy";

/** One pressed button per group. The seg is a choice, not a filter. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  className,
  compact = false,
}: {
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    /** Shown instead of the word when the toggle is compact. */
    readonly icon?: IconName;
  }[];
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly className?: string;
  /**
   * Glyph instead of word, with the word as the tooltip.
   *
   * For a header that is already carrying a title, a count and two other
   * controls. List/Tiles and Read/Edit are both pairs whose glyphs are
   * unambiguous, and the row reads as a row rather than a sentence of buttons.
   */
  readonly compact?: boolean;
}) {
  return (
    <div className={`seg${compact ? " seg-compact" : ""}${className ? ` ${className}` : ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-label={compact && o.icon ? o.label : undefined}
          title={compact && o.icon ? o.label : undefined}
          onClick={() => onChange(o.value)}
        >
          {compact && o.icon ? <Icon name={o.icon} size={15} /> : o.label}
        </button>
      ))}
    </div>
  );
}

/** One selected tab. The dot carries stage state where a tab has one. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  readonly items: readonly {
    readonly value: T;
    readonly label: string;
    readonly dot?: boolean;
    /** The stage behind this tab has finished, so its dot is filled. */
    readonly done?: boolean;
  }[];
  readonly value: T;
  readonly onChange: (next: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          className={`tab${it.done ? " done" : ""}`}
          aria-selected={it.value === value}
          onClick={() => onChange(it.value)}
        >
          {it.dot ? <i /> : null}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/*
 * Toasts.
 *
 * A module-level store rather than a context provider: this is fired from
 * event handlers, effects and non-React code, and threading a provider through
 * all of that buys nothing. One host renders it.
 */
interface ToastItem { readonly seq: number; readonly text: string; readonly bad: boolean; readonly out?: boolean }
let toasts: readonly ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();

function emitToast() {
  for (const l of toastListeners) l();
}

function setToasts(next: readonly ToastItem[]) {
  toasts = next;
  emitToast();
}

/*
 * Toasts stack, newest at the bottom, three at most. One slot used to mean a
 * second toast wiped the first: "Saved." followed by a failure 200ms later
 * left only the failure, and two failures left only the last one.
 */
export function toast(text: string, tone?: "bad") {
  const seq = ++toastSeq;
  const bad = tone === "bad";
  setToasts([...toasts.filter((t) => !t.out).slice(-2), { seq, text, bad }]);
  setTimeout(() => {
    // Out first, so it can fade, then gone.
    setToasts(toasts.map((t) => (t.seq === seq ? { ...t, out: true } : t)));
    setTimeout(() => setToasts(toasts.filter((t) => t.seq !== seq)), 240);
  }, bad ? 6000 : 2800);
}

/** An action failed. Said in words, held longer than a confirmation. */
export function toastError(e: unknown, what = "That did not work.") {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  toast(raw ? `${what} ${plainError(raw).text}` : what, "bad");
}

function subscribeToast(cb: () => void) {
  toastListeners.add(cb);
  return () => {
    toastListeners.delete(cb);
  };
}

export function ToastHost() {
  const list = useSyncExternalStore(subscribeToast, () => toasts, () => toasts);
  /* Announced politely: it is the only confirmation a keyboard user gets that
     an accept landed, and it must not interrupt the reading they are in. */
  return (
    <div className="toasts">
      {list.map((t) => (
        <div
          key={t.seq}
          className={`toast on${t.bad ? " bad" : ""}${t.out ? " out" : ""}`}
          role="status"
          aria-live={t.bad ? "assertive" : "polite"}
        >
          <Icon name={t.bad ? "alert" : "check"} size={15} className="tick" />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/*
 * j / k move, a accepts, i ignores. Every queue in the app answers to the same
 * four keys - audit findings, taste proposals, review verdicts - so the muscle
 * memory is worth exactly one implementation.
 */
/* How many screens have bound j/k to a queue of their own. While any has, the
   shell's list keys stand aside, or one key press would move two things. */
let queueOwners = 0;

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (/^(input|textarea|select)$/i.test(e.tagName) || e.isContentEditable);
};

/* What j/k walk on a screen with no queue of its own: list rows, tiles, the
   chapter table, and anything marked data-keynav. */
const LIST_ITEMS = ".main :is(.rows > .row, .tiles > .tile, td > button.title, [data-keynav])";

/**
 * j / k move focus through the list on screen and Enter opens what has it
 * (a button already answers Enter). Esc closes the panel that is open, by
 * pressing its own close button - anything marked data-esc. Mounted once, in
 * the shell.
 */
export function useListKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "Escape") {
        // A dialog owns Escape while it is open.
        if (document.querySelector("dialog[open], [role=dialog]")) return;
        const close = [...document.querySelectorAll<HTMLElement>("[data-esc]")].filter((b) => b.offsetParent !== null).pop();
        if (close) { e.preventDefault(); close.click(); }
        return;
      }
      if ((e.key !== "j" && e.key !== "k") || queueOwners > 0) return;
      const items = [...document.querySelectorAll<HTMLElement>(LIST_ITEMS)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
      const next = items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (e.key === "j" ? 1 : -1)))]!;
      if (!next.hasAttribute("tabindex") && !/^(button|a)$/i.test(next.tagName)) next.tabIndex = -1;
      next.focus();
      next.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function useQueueKeys(handlers: {
  readonly onNext?: () => void;
  readonly onPrev?: () => void;
  readonly onAccept?: () => void;
  readonly onIgnore?: () => void;
  readonly enabled?: boolean;
}) {
  const { onNext, onPrev, onAccept, onIgnore, enabled = true } = handlers;
  useEffect(() => {
    if (!enabled) return;
    queueOwners += 1;
    return () => { queueOwners -= 1; };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      // Typing "a" into a search box must not accept a finding.
      if (el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable)) return;
      const run = { j: onNext, k: onPrev, a: onAccept, i: onIgnore }[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onNext, onPrev, onAccept, onIgnore]);
}
