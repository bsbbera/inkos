/*
 * Items that arrive or leave while the list is on screen.
 *
 * The first render is not an arrival: this is a tool opened forty times a day,
 * and a list that slides in on every load is choreography nobody asked for.
 * After that, a new item is marked "arrive" and a removed one stays drawn for
 * one beat marked "leave", so a chapter that is added or deleted is seen to
 * happen instead of the list simply being different.
 */
import { useEffect, useRef, useState } from "react";

export type Motion = "arrive" | "leave" | undefined;

/** --med, the length of the leave animation in motion.css. */
const LEAVE_MS = 300;

export function useArrivals<T>(items: readonly T[], key: (item: T) => string): ReadonlyArray<{ item: T; motion: Motion }> {
  const seen = useRef<Set<string> | null>(null);
  const last = useRef<readonly T[]>(items);
  const [leaving, setLeaving] = useState<ReadonlyArray<{ item: T; index: number }>>([]);

  // The first list that has anything in it is the baseline - a fetch landing
  // is the page loading, not ten chapters arriving.
  if (seen.current === null && items.length > 0) seen.current = new Set(items.map(key));

  useEffect(() => {
    const now = new Set(items.map(key));
    const gone = last.current.flatMap((item, index) => (now.has(key(item)) ? [] : [{ item, index }]));
    last.current = items;
    if (gone.length === 0) return;
    setLeaving((was) => [...was, ...gone]);
    // Not cleared on re-run: a refetch inside the beat would strand the row.
    setTimeout(() => setLeaving((was) => was.filter((l) => !gone.some((g) => g.item === l.item))), LEAVE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const out: Array<{ item: T; motion: Motion }> = items.map((item) => {
    const k = key(item);
    const fresh = seen.current !== null && !seen.current.has(k);
    return { item, motion: fresh ? "arrive" : undefined };
  });
  // Back where it was, so the gap closes in place.
  for (const l of leaving) {
    if (!items.some((i) => key(i) === key(l.item))) out.splice(Math.min(l.index, out.length), 0, { item: l.item, motion: "leave" });
  }
  return out;
}
