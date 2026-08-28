import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A drag-resizable panel width, remembered across restarts.
 *
 * `side` names the edge the grip sits on. A panel gripped on its "end" edge —
 * the left sidebar — grows as the pointer moves right; one gripped on its
 * "start" edge — a right-hand inspector — grows as the pointer moves LEFT, so
 * its delta is inverted. Getting that backwards makes the panel run away from
 * the cursor, so the two cases are spelled out rather than shared.
 *
 * Pointer events rather than mouse: the same handler then covers a pen and a
 * touch drag, and setPointerCapture keeps the drag alive when the pointer
 * outruns the 4px grip, which a plain mousemove on the element does not.
 */
export function useResizable(opts: {
  key: string;
  initial: number;
  min: number;
  max: number;
  side: "start" | "end";
}) {
  const { key, initial, min, max, side } = opts;

  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);

  const [width, setWidth] = useState(() => {
    const saved = Number(globalThis.localStorage?.getItem(key));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved) : initial;
  });

  // Written on pointerup rather than on every move: a drag is ~200 events and
  // localStorage is synchronous.
  const persist = useRef(width);
  persist.current = width;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startW = persist.current;
    grip.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => {
      const delta = side === "start" ? startX - ev.clientX : ev.clientX - startX;
      setWidth(clamp(startW + delta));
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      globalThis.localStorage?.setItem(key, String(persist.current));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  }, [clamp, key, side]);

  /** Double-click the grip to go back to the designed width. */
  const onDoubleClick = useCallback(() => {
    setWidth(initial);
    globalThis.localStorage?.setItem(key, String(initial));
  }, [initial, key]);

  // A width saved on a wide monitor must not bury the content on a narrow one.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  return { width, gripProps: { onPointerDown, onDoubleClick } };
}
