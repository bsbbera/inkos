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

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  readonly icon?: IconName;
  /** What goes here - never "No data". */
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="empty crop">
      <span className="disc stroke" aria-hidden="true"
            style={{ width: 190, height: 190, right: -84, top: -92, opacity: 0.32 }} />
      <div style={{ position: "relative" }}>
        {icon ? <Icon name={icon} size={22} /> : null}
        <h3 style={{ marginTop: icon ? 12 : 0 }}>{title}</h3>
        {children ? <p>{children}</p> : null}
        {action ? <div className="rowflex" style={{ marginTop: 18 }}>{action}</div> : null}
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
      <div className="rowflex" style={{ gap: 9, marginBottom: 14 }}>
        <span className="spin" />
        <span className="dim" style={{ fontSize: 11 }}>{what}</span>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div className="rowflex" key={i} style={{ gap: 9, flexWrap: "nowrap" }}>
            <span className="skel" style={{ width: 7, height: 7, borderRadius: "50%" }} />
            <span className="grow">
              <span className="skel skel-line" style={{ display: "block", width: `${72 - i * 7}%` }} />
              <span className="skel skel-line"
                    style={{ display: "block", width: `${44 - i * 5}%`, height: 8, marginTop: 6 }} />
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
}: {
  /** What stopped, in the product's words. */
  readonly what: string;
  /** The machine's words. Shown, never swallowed. */
  readonly detail?: string | null;
  /** What survived. The reassurance is the point. */
  readonly kept?: string;
  readonly retry?: () => void;
}) {
  return (
    <div className="fail" role="alert">
      <Icon name="alert" size={16} />
      <div className="grow">
        <b>{what}</b>
        {detail ? <p className="mono" style={{ fontSize: 11 }}>{detail}</p> : null}
        {kept ? <p className="kept" style={{ marginTop: 4 }}>{kept}</p> : null}
        {retry ? (
          <button type="button" className="btn btn-line btn-sm" style={{ marginTop: 10 }} onClick={retry}>
            <Icon name="redo" size={14} />
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
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
