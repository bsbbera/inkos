/*
 * One piece of work on a shelf: a lettered cover, the title, a line of
 * detail and where it stands. Books, Magazines and Home's "Back to work" each
 * drew their own, and Home's had no cover at all, so the same story looked
 * like two different things on two screens.
 */
import { vtName } from "../../lib/view-transition";

export function WorkTile({
  title,
  kind,
  detail,
  badge,
  onOpen,
  id,
  className,
}: {
  readonly title: string;
  /** What it is, written on its cover: "short", "storybook", "magazine". */
  readonly kind: string;
  readonly detail: string;
  readonly badge: { readonly label: string; readonly tone: string };
  readonly onOpen: () => void;
  /** Names the title for the view transition into the work's own screen. */
  readonly id: string;
  readonly className?: string;
}) {
  return (
    <button type="button" className={`tile tile-work${className ? ` ${className}` : ""}`} onClick={onOpen}>
      {/* A lettered cover until a work has art of its own: the kind on top,
          the first letter of the title in the reading face, past a leading
          "The", or every shelf is a row of Ts. */}
      <span className="cover" data-kind={kind} aria-hidden="true">
        <span className="cover-kind">{kind}</span>
        <span className="cover-letter">{title.trim().replace(/^(the|an?)\s+/i, "").charAt(0)}</span>
      </span>
      <h4 style={vtName(id)}>{title}</h4>
      <span className="who">{detail}</span>
      <span className="tile-foot">
        <span className={badge.tone}>{badge.label}</span>
      </span>
    </button>
  );
}
