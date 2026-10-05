/*
 * A number that is seen to change. On first paint it is just the number; when
 * the value moves, the new one rolls up into place, so "412 words" becoming
 * "1,906 words" mid-run is noticed instead of silently different.
 */
import { useRef } from "react";

export function Num({ value, format }: { readonly value: number; readonly format?: (n: number) => string }) {
  const first = useRef(value);
  const text = format ? format(value) : value.toLocaleString();
  const moved = value !== first.current;
  // Keyed on the value, so each change remounts the span and replays the roll.
  return <span key={moved ? value : "first"} className={moved ? "num-roll tnum" : "tnum"}>{text}</span>;
}
