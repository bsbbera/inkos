/*
 * The topbar.
 *
 * Crumbs on the left so the page says where it is, and on the right the only
 * two facts that are true on every screen: which model is answering, and how
 * many gates are waiting on a human. The waiting pill is the one element in
 * the chrome allowed to be loud.
 */
import type { ReactNode } from "react";
import type { HashRoute } from "../../hooks/use-hash-route";
import { Icon } from "../ui/icon";

export interface Crumb {
  readonly label: string;
  readonly route?: HashRoute;
}

export function Topbar({
  crumbs,
  setRoute,
  model,
  waiting,
  onOpenPalette,
  railOpen,
  onToggleRail,
  children,
}: {
  readonly crumbs: readonly Crumb[];
  readonly setRoute: (r: HashRoute) => void;
  /** e.g. "claude · sonnet-4.6". Absent while the shim has not answered. */
  readonly model?: string | null;
  readonly waiting?: number;
  readonly onOpenPalette?: () => void;
  readonly railOpen?: boolean;
  /** Absent on screens that have no rail to shut. */
  readonly onToggleRail?: () => void;
  /** Screen-specific controls, placed between the crumbs and the pills. */
  readonly children?: ReactNode;
}) {
  const last = crumbs.length - 1;
  return (
    <div className="topbar">
      {onToggleRail ? (
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          aria-expanded={railOpen ?? true}
          aria-label={railOpen ? "Close the rail" : "Open the rail"}
          title={railOpen ? "Close the rail" : "Open the rail"}
          onClick={onToggleRail}
        >
          <Icon name="list" size={15} />
        </button>
      ) : null}

      <div className="crumbs grow">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} style={{ display: "contents" }}>
            {i > 0 ? <span className="sep">/</span> : null}
            {i === last || !c.route ? (
              <h1>{c.label}</h1>
            ) : (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (c.route) setRoute(c.route);
                }}
              >
                {c.label}
              </a>
            )}
          </span>
        ))}
      </div>

      {children}

      {model ? <span className="pill mono">{model}</span> : null}

      {/* Drawn even at zero, quietly. A pill that vanishes when the queue
          empties takes the only proof that the queue was ever looked at. */}
      <button
        type="button"
        className={waiting ? "gatepill" : "gatepill quiet"}
        onClick={() => setRoute({ page: "dashboard" })}
      >
        <span className="n tnum">{waiting ?? 0}</span>
        {waiting ? "waiting on you" : "nothing waiting"}
      </button>

      {onOpenPalette ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onOpenPalette}>
          <Icon name="search" size={15} />
          <span className="kbd">Ctrl K</span>
        </button>
      ) : null}
    </div>
  );
}
