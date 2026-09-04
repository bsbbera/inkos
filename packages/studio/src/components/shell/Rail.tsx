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
import { NAV, activeNavId } from "./nav";

export interface RailRun {
  readonly what: string;
  readonly where: string;
  /** 0-1. Undefined when the stage cannot say, which is most of them. */
  readonly progress?: number;
}

/** The ring's circumference at r=19, so a fraction can be written as an offset. */
const RING = 2 * Math.PI * 19;

export function Rail({
  route,
  setRoute,
  tails,
  run,
}: {
  readonly route: HashRoute;
  readonly setRoute: (r: HashRoute) => void;
  /** Live counts by nav id. A zero is not drawn: an empty badge is noise. */
  readonly tails?: Readonly<Record<string, string | number | undefined>>;
  readonly run?: RailRun | null;
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
                    <em className="tail" style={{ fontStyle: "normal" }}>
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
          <svg className="ring ring-sm" viewBox="0 0 44 44" aria-hidden="true">
            <circle className="t" cx="22" cy="22" r="19" />
            <circle
              className="v"
              cx="22"
              cy="22"
              r="19"
              style={{
                strokeDasharray: RING,
                // An unknown fraction draws a quarter arc rather than a full
                // ring: a complete circle reads as finished, which is the one
                // thing a run in flight is not.
                strokeDashoffset: RING * (1 - (run.progress ?? 0.25)),
              }}
            />
          </svg>
          <span className="grow">
            <span className="what">{run.what}</span>
            <span className="where">{run.where}</span>
          </span>
        </button>
      ) : null}

      <p className="attrib dim" style={{ marginTop: 10, fontSize: 10, lineHeight: 1.35 }}>
        Workbench forked from <b style={{ fontWeight: 600 }}>InkOS Studio</b>, AGPL-3.0.
      </p>
    </div>
  );
}
