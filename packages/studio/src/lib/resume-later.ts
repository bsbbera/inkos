/*
 * "Resume at 4:30" - a run stopped by a usage limit, picked up when the limit
 * lifts, without anyone coming back to press the button.
 *
 * Held above every screen and kept in localStorage, so walking away from the
 * page or reloading does not lose it. The app has to be open at that time:
 * ponytail: client-side timer, move it to the server's job queue if runs
 * should resume with the window closed.
 */
import { useEffect, useSyncExternalStore } from "react";
import { toast, toastError } from "../components/ui/vermilion";

export interface ResumeLater {
  /** One per piece of work: scheduling it again replaces the old time. */
  readonly id: string;
  /** What resumes, for the toast: "Issue 4". */
  readonly label: string;
  readonly url: string;
  readonly body: unknown;
  /** Epoch ms. */
  readonly at: number;
}

const KEY = "quire.resumeLater";
const listeners = new Set<() => void>();

function read(): ResumeLater[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as ResumeLater[]; } catch { return []; }
}

let entries: ResumeLater[] = read();
let snapshot = JSON.stringify(entries);

function write(next: ResumeLater[]) {
  entries = next;
  snapshot = JSON.stringify(next);
  try { localStorage.setItem(KEY, snapshot); } catch { /* private mode: lives for this session */ }
  for (const l of listeners) l();
}

export function resumeLater(entry: ResumeLater) {
  write([...entries.filter((e) => e.id !== entry.id), entry]);
}

export function cancelResume(id: string) {
  write(entries.filter((e) => e.id !== id));
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** The scheduled time for this work, or undefined. */
export function useResumeAt(id: string): number | undefined {
  const snap = useSyncExternalStore(subscribe, () => snapshot, () => "[]");
  return (JSON.parse(snap) as ResumeLater[]).find((e) => e.id === id)?.at;
}

/** Fires what is due. Mounted once, in the shell. */
export function useResumeTimer() {
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const e of entries.filter((x) => x.at <= now)) {
        cancelResume(e.id);
        void fetch(e.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e.body) })
          .then(async (res) => {
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
            toast(`Resumed ${e.label}.`);
          })
          .catch((err) => toastError(err, `Could not resume ${e.label}.`));
      }
    };
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, []);
}

/** "4:30 PM" for today, "Tue 4:30 PM" otherwise. */
export function clockAt(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}
