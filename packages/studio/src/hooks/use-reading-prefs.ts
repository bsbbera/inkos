/*
 * How this person likes to read.
 *
 * Size, measure and leading belong to the reader, not to the book: they follow
 * you into every chapter and every issue, so they live in this browser rather
 * than in any project's config. Three CSS variables, read by `.read` and
 * `.read-field` in vermilion.css - no component has to know the numbers.
 */
import { useCallback, useEffect, useState } from "react";

export interface ReadingPrefs {
  /** Font size in px. The type lock's three reading sizes. */
  readonly size: number;
  /** Measure, in ch. */
  readonly measure: number;
  /** Leading, as a percentage: 172 means line-height 1.72. */
  readonly leading: number;
}

export const READING_SIZES = [15, 16.5, 19] as const;

export const DEFAULT_READING_PREFS: ReadingPrefs = { size: 16.5, measure: 64, leading: 172 };

const KEY = "quire:reading";

/** Clamped on the way in: a hand-edited value must not make the app unreadable. */
export function parseReadingPrefs(raw: string | null): ReadingPrefs {
  if (!raw) return DEFAULT_READING_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<ReadingPrefs>;
    const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
      typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
    return {
      size: clamp(v.size, 13, 24, DEFAULT_READING_PREFS.size),
      measure: clamp(v.measure, 46, 86, DEFAULT_READING_PREFS.measure),
      leading: clamp(v.leading, 140, 210, DEFAULT_READING_PREFS.leading),
    };
  } catch {
    return DEFAULT_READING_PREFS;
  }
}

/** The three variables `.read` consumes. */
export function readingVars(p: ReadingPrefs): Record<string, string> {
  return {
    "--rs": `${p.size}px`,
    "--rm": `${p.measure}ch`,
    "--rl": String(p.leading / 100),
  };
}

export function useReadingPrefs() {
  const [prefs, setPrefs] = useState<ReadingPrefs>(() => {
    try {
      return parseReadingPrefs(window.localStorage.getItem(KEY));
    } catch {
      return DEFAULT_READING_PREFS;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // A browser refusing storage is not a reason to stop reading.
    }
  }, [prefs]);

  const set = useCallback(<K extends keyof ReadingPrefs>(key: K, value: ReadingPrefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  }, []);

  return { prefs, set, vars: readingVars(prefs) };
}
