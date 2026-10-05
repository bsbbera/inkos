/*
 * The rail.
 *
 * Column one, and the answer to "where am I". It replaced a 260px sidebar that
 * carried expandable trees of every book, publication and film in the project:
 * that made navigation compete with the work for width, and it meant the two
 * screens that carry their own tree - audit and chat - had three panels of
 * navigation before any prose.
 *
 * The run card at the bottom answers the other standing question, "what is the
 * machine doing", without the user opening anything.
 */
import type { HashRoute } from "../../hooks/use-hash-route";
import { Icon } from "../ui/icon";
import { Ring } from "../ui/working";
import { NAV, activeNavId } from "./nav";
import { useEffect, useState } from "react";

/** "4m", "1h 12m": how long the run has been going. Ticks twice a minute. */
function Elapsed({ since }: { readonly since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const m = Math.max(0, Math.floor((now - since) / 60_000));
  return <span className="tnum">{m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`}</span>;
}

export interface RailRun {
  readonly what: string;
  readonly where: string;
  /** 0-1. Undefined when the stage cannot say, which is most of them. */
  readonly progress?: number;
  /**
   * How many more are waiting behind this one.
   *
   * The queue is serial, so a card showing the running stage alone was honest
   * about the present and silent about the next twenty minutes. A number is
   * enough here; the run screen is one click away and lists them.
   */
  readonly more?: number;
  /**
   * Everything else running at the same time, each with what it is working on.
   *
   * A number said that more was happening and not what. Runs started from chat
   * and from an issue page go side by side with the queue, so "+1" could be a
   * whole magazine; it is named here instead.
   */
  readonly others?: ReadonlyArray<{ readonly what: string; readonly where: string }>;
  /** Epoch ms the running stage began, so the card can say how long. */
  readonly startedAt?: number;
}

/** The ring's circumference at r=19, so a fraction can be written as an offset. */

export function Rail({
  route,
  setRoute,
  tails,
  run,
  onOpenPalette,
}: {
  readonly route: HashRoute;
  readonly setRoute: (r: HashRoute) => void;
  /** Live counts by nav id. A zero is not drawn: an empty badge is noise. */
  readonly tails?: Readonly<Record<string, string | number | undefined>>;
  readonly run?: RailRun | null;
  readonly onOpenPalette?: () => void;
}) {
  const active = activeNavId(route);

  return (
    <div className="rail">
      <div
        className="wordmark"
        role="link"
        tabIndex={0}
        onClick={() => setRoute({ page: "dashboard" })}
        onKeyDown={(e) => {
          if (e.key === "Enter") setRoute({ page: "dashboard" });
        }}
      >
        <Icon name="quire" size={24} />
        <b>Quire</b>
      </div>

      <button type="button" className="railnew" onClick={() => setRoute({ page: "new" })}>
        <Icon name="plus" size={16} />
        <span>Start something</span>
      </button>

      {/* The palette was only announced in the topbar, which the chat screens
          do not draw - so on the screen people spend most time in, nothing
          said it existed. */}
      {onOpenPalette ? (
        <button type="button" className="nav railfind" onClick={onOpenPalette}>
          <Icon name="search" size={16} />
          <span>Search</span>
          <span className="kbd">Ctrl K</span>
        </button>
      ) : null}

      <div className="rail-scroll">
        {NAV.map((group) => (
          <div key={group.label}>
            <div className="rail-label">
              <span>{group.label}</span>
            </div>
            {group.items.map((item) => {
              const tail = tails?.[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  className={item.speculative ? "nav speculative" : "nav"}
                  aria-current={item.id === active ? "page" : undefined}
                  onClick={() => setRoute(item.route)}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {tail === undefined || tail === 0 || tail === "" ? null : (
                    <em className="tail not-italic">
                      {tail}
                    </em>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {run ? (
        <button type="button" className="railrun" onClick={() => setRoute({ page: "run" })}>
          <Ring value={run.progress} size="sm" />
          <span className="grow">
            <span className="what">{run.what}</span>
            <span className="where">
              {run.where}
              {run.startedAt ? <> · <Elapsed since={run.startedAt} /></> : null}
            </span>
          </span>
          {run.more && run.more > 0 && !run.others?.length ? (
            <em className="tail not-italic">+{run.more}</em>
          ) : null}
        </button>
      ) : null}
      {run?.others?.map((o, i) => (
        <button
          key={`${o.what}-${o.where}-${i}`}
          type="button"
          className="railrun railrun-more"
          onClick={() => setRoute({ page: "run" })}
        >
          <span className="grow">
            <span className="what">{o.what}</span>
            <span className="where">{o.where}</span>
          </span>
        </button>
      ))}

      <p className="attrib dim mt-2.5 text-micro leading-snug">
        Workbench forked from <b className="font-semibold">InkOS Studio</b>, AGPL-3.0.
      </p>
    </div>
  );
}
