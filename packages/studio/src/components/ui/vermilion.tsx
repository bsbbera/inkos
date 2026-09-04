/*
 * The Vermilion primitives, as React.
 *
 * The mockups drive these by delegation from mock.js because a static page has
 * no state to hold. Here they hold their own, but the markup and the class
 * names are the mock's exactly - a screen ports by carrying its JSX across,
 * and nothing below knows what screen it is on.
 */
import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "./icon";

/** One pressed button per group. The seg is a choice, not a filter. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly className?: string;
}) {
  return (
    <div className={className ? `seg ${className}` : "seg"}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
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
let toastText: string | null = null;
let toastSeq = 0;
const toastListeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function emitToast() {
  for (const l of toastListeners) l();
}

export function toast(text: string) {
  toastText = text;
  toastSeq += 1;
  emitToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastText = null;
    emitToast();
  }, 2800);
}

function subscribeToast(cb: () => void) {
  toastListeners.add(cb);
  return () => {
    toastListeners.delete(cb);
  };
}

/* The sequence is part of the snapshot so the same text fired twice still
   re-runs the entry transition instead of sitting there silently. */
const toastSnapshot = () => (toastText === null ? "" : `${toastSeq} ${toastText}`);

export function ToastHost() {
  const snap = useSyncExternalStore(subscribeToast, toastSnapshot, () => "");
  const text = snap ? snap.slice(snap.indexOf(" ") + 1) : "";
  /* Announced politely: it is the only confirmation a keyboard user gets that
     an accept landed, and it must not interrupt the reading they are in. */
  return (
    <div className={snap ? "toast on" : "toast"} role="status" aria-live="polite">
      <Icon name="check" size={15} className="tick" />
      <span>{text}</span>
    </div>
  );
}

/*
 * j / k move, a accepts, i ignores. Every queue in the app answers to the same
 * four keys - audit findings, taste proposals, review verdicts - so the muscle
 * memory is worth exactly one implementation.
 */
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
