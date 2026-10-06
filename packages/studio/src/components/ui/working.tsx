/*
 * Working states and progress (analysis/02, revision 2026-10-05, rule 4).
 *
 * Each thing that can be happening while you wait has one shape, the same on
 * every screen. The shapes are thought-orbs (`thinking-orbs`, MIT, canvas):
 *
 *   searching   a globe swept by a scan line   - looking across many places
 *   planning    an outline finding its shape   - deciding what comes next
 *   thinking    a sash of bands                - composing; nothing decided yet
 *   checking    bands scrambling into place    - an audit, a fact-check
 *   connecting  a constellation wiring itself  - reaching a model or a server
 *   building    three strands plaiting         - pages being laid out
 *   generating  orbiting particles, or a ring with its fraction when the
 *               fraction is known              - making something you will see
 *   writing     a caret                        - text is arriving (not an orb:
 *               the words themselves are the movement)
 *
 * Every shape carries a word beside it unless it sits inside a sentence that
 * already says what is happening, so a still shape under reduced motion never
 * reads as a hung app. Never in or beside the reading column (PRODUCT.md).
 */
import { useEffect, useRef, useState } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";

const RING = 2 * Math.PI * 19;

export type WorkingKind =
  | "searching" | "planning" | "thinking" | "writing" | "generating"
  | "checking" | "connecting" | "building";

const ORB_OF: Record<Exclude<WorkingKind, "writing">, OrbState> = {
  searching: "searching",
  planning: "shaping",
  thinking: "composing",
  generating: "working",
  checking: "solving",
  connecting: "connecting",
  building: "weaving",
};

/** The orb for a pipeline stage, as an id (`content.write`) or a label (`content · write`). */
export function orbForStage(stage: string | undefined): OrbState {
  const s = (stage ?? "").trim().split(/[.·\s]+/).pop() ?? "";
  if (s === "research") return "searching";
  if (s === "plan" || s === "artplan") return "shaping";
  if (s === "write") return "composing";
  if (s === "factcheck" || s === "audit" || s === "destyle" || s === "review") return "solving";
  if (s === "layout" || s === "export") return "weaving";
  return "working";
}

/**
 * One orb. The colour comes from a token read off the element, so it follows
 * the theme and the ui-guard's no-hex rule holds. It stops drawing while it
 * is off screen or the window is hidden: each orb is its own animation loop.
 */
export function Orb({
  state = "working",
  size = 20,
  tone = "accent",
  className,
}: {
  readonly state?: OrbState;
  readonly size?: 20 | 32 | 64;
  /** accent = the thing you are watching; ok = healthy and running; quiet = background. */
  readonly tone?: "accent" | "ok" | "quiet";
  readonly className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [color, setColor] = useState<string | undefined>(undefined);
  const [dark, setDark] = useState(false);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      if (tone !== "quiet") {
        const v = getComputedStyle(el).getPropertyValue(tone === "ok" ? "--ok" : "--vermilion").trim();
        setColor(v || undefined);
      }
      setDark(Boolean(el.closest(".on-char, .dark")));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    let onScreen = true;
    const sync = () => setShown(onScreen && !document.hidden);
    const io = new IntersectionObserver(([e]) => { onScreen = Boolean(e?.isIntersecting); sync(); });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", read);
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [tone]);

  return (
    <span ref={ref} className={`orb orb-${size}${className ? ` ${className}` : ""}`} aria-hidden="true">
      <ThinkingOrb
        state={state}
        size={size}
        theme={dark ? "dark" : "auto"}
        paused={!shown}
        // The 20px orb sits beside 13px type on paper, where the stock dots
        // fade to almost nothing; a heavier dot keeps it legible at text size.
        dotSize={size === 20 ? 1.35 : size === 32 ? 1.15 : 1}
        {...(color ? { color } : {})}
      />
    </span>
  );
}

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
  if (kind === "writing") return <span className="caret" aria-hidden="true" />;
  if (kind === "generating" && value !== undefined) return <Ring value={value} size="sm" orb="working" />;
  return <Orb state={ORB_OF[kind]} />;
}

/** Something is happening and nothing more can be said: the working orb. */
export function Spinner({ className }: { readonly className?: string }) {
  return <Orb state="working" {...(className ? { className } : {})} />;
}

/**
 * Progress as an arc. An unknown fraction draws a quarter rather than a full
 * ring: a complete circle reads as finished, which is the one thing a run in
 * flight is not.
 */
export function Ring({
  value,
  size,
  orb,
  className,
}: {
  /** 0..1, or undefined when the fraction is not known. */
  readonly value?: number;
  readonly size?: "sm" | "lg";
  /** An orb drawn inside the ring: what is happening, inside how far along it is. */
  readonly orb?: OrbState;
  readonly className?: string;
}) {
  const v = Math.max(0, Math.min(1, value ?? 0.25));
  const arc = (
    <svg className={`arc${size ? ` arc-${size}` : ""}${orb || !className ? "" : ` ${className}`}`} viewBox="0 0 44 44" aria-hidden="true">
      <circle className="t" cx="22" cy="22" r="19" />
      <circle className="v" cx="22" cy="22" r="19" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - v) }} />
    </svg>
  );
  if (!orb) return arc;
  return (
    <span className={`orbring${className ? ` ${className}` : ""}`}>
      {arc}
      <Orb state={orb} size={size === "lg" ? 32 : 20} />
    </span>
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
