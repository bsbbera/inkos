/*
 * Working states and progress (analysis/02, revision 2026-10-05, rule 4).
 *
 * Four things can be happening while you wait, and each has one shape that is
 * the same on every screen:
 *
 *   searching   a sweep along a track     - looking across many places
 *   planning    steps filling in order    - deciding what comes next
 *   thinking    three dots                - composing; nothing decided yet
 *   writing     a caret                   - text is arriving
 *   generating  a ring with its fraction, or a spinning arc when the
 *               fraction is unknown       - making something you will see
 *
 * Every shape carries a word beside it unless it sits inside a sentence that
 * already says what is happening, so a still shape under reduced motion never
 * reads as a hung app. The movement itself is motion.css.
 */
const RING = 2 * Math.PI * 19;

export type WorkingKind = "searching" | "planning" | "thinking" | "writing" | "generating";

export function Working({
  kind,
  label,
  value,
  className,
}: {
  readonly kind: WorkingKind;
  /** What is happening, in the product's words: "Searching the web…". */
  readonly label?: string;
  /** For generating: the fraction done, 0..1, when it is known. */
  readonly value?: number;
  readonly className?: string;
}) {
  return (
    <span className={`ws${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <Shape kind={kind} value={value} />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

function Shape({ kind, value }: { readonly kind: WorkingKind; readonly value?: number }) {
  switch (kind) {
    case "searching":
      return <span className="ws-search" aria-hidden="true" />;
    case "planning":
      return <span className="ws-plan" aria-hidden="true"><i /><i /><i /><i /></span>;
    case "thinking":
      return <span className="thinking" aria-hidden="true"><i /><i /><i /></span>;
    case "writing":
      return <span className="caret" aria-hidden="true" />;
    case "generating":
      return value === undefined ? <Spinner /> : <Ring value={value} size="sm" />;
  }
}

/** The indeterminate arc. Sized by the text it sits in. */
export function Spinner({ className }: { readonly className?: string }) {
  return (
    <svg className={`spin${className ? ` ${className}` : ""}`} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5" />
    </svg>
  );
}

/**
 * Progress as an arc. An unknown fraction draws a quarter rather than a full
 * ring: a complete circle reads as finished, which is the one thing a run in
 * flight is not.
 */
export function Ring({
  value,
  size,
  className,
}: {
  /** 0..1, or undefined when the fraction is not known. */
  readonly value?: number;
  readonly size?: "sm" | "lg";
  readonly className?: string;
}) {
  const v = Math.max(0, Math.min(1, value ?? 0.25));
  return (
    <svg className={`arc${size ? ` arc-${size}` : ""}${className ? ` ${className}` : ""}`} viewBox="0 0 44 44" aria-hidden="true">
      <circle className="t" cx="22" cy="22" r="19" />
      <circle className="v" cx="22" cy="22" r="19" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - v) }} />
    </svg>
  );
}

/** Progress as a bar, for a row too short to hold a ring. */
export function Bar({ value, className }: { readonly value: number; readonly className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className={`bar${className ? ` ${className}` : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <i style={{ transform: `scaleX(${v})` }} />
    </span>
  );
}
