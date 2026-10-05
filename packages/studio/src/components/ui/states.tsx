/*
 * The four states every screen has. Mock 25.
 *
 * Empty, loading, failed, finished. They were being written from scratch on
 * each page, so the same condition looked different in four places and some
 * pages simply rendered nothing - a blank panel that could equally mean "still
 * fetching", "nothing here" or "the request died".
 *
 * Two rules the mock sets and these keep:
 *   Empty says what goes here, not that there is nothing.
 *   Failure states what stopped, what survived, and the way forward.
 *   "Error occurred" is banned, and so is a dead end.
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import { Spinner } from "./working";
import { plainError } from "../../lib/error-copy";

export function Empty({
  icon,
  title,
  children,
  action,
  compact,
}: {
  readonly icon?: IconName;
  /** What goes here - never "No data". */
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  /** One line, for a sidebar, a menu or a column too narrow for the full card. */
  readonly compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="empty-sm">
        {icon ? <Icon name={icon} size={15} /> : null}
        <span className="grow">{title}{children ? <> {children}</> : null}</span>
        {action}
      </div>
    );
  }
  return (
    <div className="empty crop">
      <span className="disc stroke w-47.5 h-47.5 -right-21 -top-23 opacity-32" aria-hidden="true"
 />
      <div className="relative">
        {icon ? <Icon name={icon} size={22} /> : null}
        <h3 style={{ marginTop: icon ? 12 : 0 }}>{title}</h3>
        {children ? <p>{children}</p> : null}
        {action ? <div className="rowflex mt-4.5">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * Shaped like what replaces it, so the wait says what is coming rather than
 * only that something is happening.
 */
export function Loading({
  what,
  rows = 3,
}: {
  readonly what: string;
  readonly rows?: number;
}) {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="rowflex gap-2.5 mb-3.5">
        <Spinner />
        <span className="dim text-cap">{what}</span>
      </div>
      <div className="stack gap-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <div className="rowflex gap-2.5 flex-nowrap" key={i}>
            <span className="skel w-1.75 h-1.75 rounded-full" />
            <span className="grow">
              <span className="skel skel-line block" style={{ width: `${72 - i * 7}%` }} />
              <span className="skel skel-line block h-2 mt-1.5"
                    style={{ width: `${44 - i * 5}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Failed({
  what,
  detail,
  kept,
  retry,
  children,
}: {
  /** What stopped, in the product's words. */
  readonly what: string;
  /** The machine's words. Read into a sentence; the raw text folds under Details. */
  readonly detail?: string | null;
  /** What survived. The reassurance is the point. */
  readonly kept?: string;
  readonly retry?: () => void;
  /** The way forward, when it is more than "Try again". */
  readonly children?: ReactNode;
}) {
  const plain = detail ? plainError(detail) : null;
  return (
    <div className="fail" role="alert">
      <Icon name="alert" size={16} />
      <div className="grow">
        <b>{what}</b>
        {plain ? <p>{plain.text}</p> : null}
        {plain?.rewritten ? (
          <details className="raw">
            <summary>Details</summary>
            <pre>{detail}</pre>
          </details>
        ) : null}
        {kept ? <p className="kept mt-1">{kept}</p> : null}
        {retry || children || plain?.fix === "models" ? (
          <div className="rowflex mt-2.5">
            {retry ? (
              <button type="button" className="btn btn-line btn-sm" onClick={retry}>
                <Icon name="redo" size={14} />
                Try again
              </button>
            ) : null}
            {children}
            {/* The copy names where the fix lives; this goes there. */}
            {plain?.fix === "models" ? (
              <a className="btn btn-line btn-sm" href="#/setup/providers">
                <Icon name="sliders" size={14} />
                Open model settings
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A line of text that says something went wrong, under the control it is about. */
export function ErrorLine({ children, className }: { readonly children: string; readonly className?: string }) {
  return <p className={`hint is-bad${className ? ` ${className}` : ""}`} role="alert">{plainError(children).text}</p>;
}

/**
 * One helper for the shape every fetching screen has, so no page has to
 * remember the order: failure first, then loading, then empty, then content.
 * Failure outranks loading because a retry that is still spinning would
 * otherwise hide the reason it failed the first time.
 */
export function Fetched<T>({
  data,
  loading,
  error,
  retry,
  what,
  empty,
  children,
}: {
  readonly data: T | null | undefined;
  readonly loading: boolean;
  readonly error?: string | null;
  readonly retry?: () => void;
  /** Named in the loading and failure copy: "the log", "your truth files". */
  readonly what: string;
  readonly empty?: ReactNode;
  readonly children: (data: T) => ReactNode;
}) {
  if (error) return <Failed what={`Could not load ${what}.`} detail={error} retry={retry} />;
  if (!data) return loading ? <Loading what={`Reading ${what}…`} /> : (empty ?? null);
  if (Array.isArray(data) && data.length === 0 && empty) return <>{empty}</>;
  return <>{children(data)}</>;
}
