import type { ReactNode } from "react";
import { Failed } from "./states";
import { Icon } from "./icon";
import { isStop, plainError } from "../../lib/error-copy";
import { cancelResume, clockAt, resumeLater, useResumeAt } from "../../lib/resume-later";

/** Why a pipeline run stopped, and the action that continues it. */
export function RunError({
  stage,
  message,
  at,
  later,
  stopped,
  children,
}: {
  readonly stage?: string | null;
  readonly message: string;
  /** When it stopped (ISO). A usage limit's "resets in 2h" counts from here. */
  readonly at?: string;
  /** How to resume this run unattended, once the limit lifts. */
  readonly later?: { readonly id: string; readonly label: string; readonly url: string; readonly body: unknown };
  /** The person pressed Stop. Not a fault, so not drawn as one. */
  readonly stopped?: boolean;
  readonly children?: ReactNode;
}) {
  const plain = plainError(message);
  const where = [stage, plain.where].filter(Boolean).join(", ");
  const scheduled = useResumeAt(later?.id ?? "");
  if (isStop({ message, stopped })) {
    return (
      <div className="notice rowflex gap-3" role="status">
        <Icon name="stop" size={15} />
        <span className="grow">
          You stopped this{where ? ` at ${where}` : ""}. What was done is kept; pick it up when you are ready.
        </span>
        {children}
      </div>
    );
  }
  const due = plain.resetMs ? (Date.parse(at ?? "") || Date.now()) + plain.resetMs + 60_000 : undefined;
  return (
    <Failed what={`Stopped${where ? ` at ${where}` : ""}`} detail={message}>
      {children}
      {later && scheduled ? (
        <span className="rowflex gap-2">
          <span className="pill"><Icon name="clock" size={12} /> Resumes at {clockAt(scheduled)}</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => cancelResume(later.id)}>Cancel</button>
        </span>
      ) : later && due && due > Date.now() ? (
        <button type="button" className="btn btn-line btn-sm" onClick={() => resumeLater({ ...later, at: due })}>
          <Icon name="clock" size={14} />
          Resume at {clockAt(due)}
        </button>
      ) : due ? (
        // "It resets in 2h30m" was true when it stopped; say what is true now.
        <span className="hint is-good">The limit lifted at {clockAt(due)}.</span>
      ) : null}
    </Failed>
  );
}
