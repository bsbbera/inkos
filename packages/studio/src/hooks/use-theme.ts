import { useCallback, useEffect, useState } from "react";

/** What the surface actually renders as. */
export type Theme = "light" | "dark";

/**
 * What the user chose. Three states, not two: the default follows the OS, and
 * the toggle has to be able to reach both explicit ends from there. The old
 * hook had two states and picked between them by the clock, so an OS set to
 * dark got a light app until 18:00 and there was no way to say otherwise.
 */
export type ThemeMode = "system" | "light" | "dark";

const MODE_STORAGE_KEY = "quire:studio:theme";
/** What the two-state hook wrote. Read once so an upgrade keeps the choice. */
const LEGACY_STORAGE_KEY = "inkos:studio:theme";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredMode(s: Pick<StorageLike, "getItem"> | null | undefined): ThemeMode {
  const stored = s?.getItem(MODE_STORAGE_KEY);
  if (stored === "system" || stored === "light" || stored === "dark") return stored;
  const legacy = s?.getItem(LEGACY_STORAGE_KEY);
  if (legacy === "light" || legacy === "dark") return legacy;
  return "system";
}

export function resolveTheme(input: {
  readonly mode: ThemeMode;
  readonly systemPrefersDark: boolean;
}): Theme {
  if (input.mode === "system") return input.systemPrefersDark ? "dark" : "light";
  return input.mode;
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode(storage()));
  const [osDark, setOsDark] = useState<boolean>(systemPrefersDark);

  // Only matters while the mode is "system", but the listener is cheap and
  // unsubscribing on every mode change is a way to miss the change that
  // happens while the user is on an explicit setting and then goes back.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme = resolveTheme({ mode, systemPrefersDark: osDark });

  /*
   * Stamp both. `data-theme` is what vermilion.css reads, and it is deliberately
   * absent for "system" so the stylesheet's own prefers-color-scheme block can
   * answer. The `.dark` class is what Tailwind's dark variant reads, and it
   * tracks the resolved theme - so the utilities and the design system can
   * never disagree about which theme is on screen.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    root.classList.toggle("theme-dark", theme === "dark");
  }, [mode, theme]);

  /*
   * Tell the shell.
   *
   * Studio runs in a cross-origin iframe inside desktop/ui, so the two cannot
   * share this storage key or read each other's DOM. Without a message the
   * shell keeps its own separate theme and its own separate toggle, which is
   * how the settings drawer ended up dark over a light workbench.
   *
   * Studio owns the preference; the shell only follows. Sent on mount as well
   * as on change, so a shell that loaded first still catches up. The resolved
   * theme is what goes over, not the mode: the shell only has to paint.
   */
  useEffect(() => {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ type: "quire:theme", theme }, "*");
    } catch {
      // A shell that will not accept the message is not a reason to fail here.
    }
  }, [theme]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      storage()?.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures and keep the in-memory preference for this session.
    }
    setModeState(next);
  }, []);

  return { theme, mode, setMode };
}
