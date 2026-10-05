/*
 * Page changes through the browser's View Transitions: the old screen
 * cross-fades into the new one, and an element named the same on both (a
 * tile's title, the page's title) moves between them instead of vanishing.
 * No library; a browser without the API, or a person who asked for less
 * motion, simply gets the new screen.
 */
import { flushSync } from "react-dom";

type Doc = Document & { startViewTransition?: (cb: () => void) => unknown };

export function withViewTransition(update: () => void) {
  const doc = document as Doc;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || still) { update(); return; }
  doc.startViewTransition(() => flushSync(update));
}

/** The shared name for one piece of work, on its tile and on its page. */
export function vtName(id: string): { readonly viewTransitionName: string } {
  return { viewTransitionName: `w-${id.replace(/[^\w-]/g, "-")}` };
}
