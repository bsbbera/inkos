/*
 * Everything being worked on now, of every kind, with its stages - and what
 * finished in the last few hours.
 *
 * Read from one endpoint (`GET /now`) rather than rebuilt from events: the
 * event buffer starts empty on every load, so a screen opened mid-run used to
 * know nothing about it. Events only say when to ask again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SSEMessage } from "./use-sse";
import type { LiveRun } from "../components/stage-rail";

export function useLiveRuns(messages: ReadonlyArray<SSEMessage>): {
  readonly runs: ReadonlyArray<LiveRun>;
  readonly recent: ReadonlyArray<LiveRun>;
  readonly stop: (jobId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
} {
  const [runs, setRuns] = useState<ReadonlyArray<LiveRun>>([]);
  const [recent, setRecent] = useState<ReadonlyArray<LiveRun>>([]);
  const seen = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/now");
      if (!res.ok) return;
      const body = await res.json() as { live?: LiveRun[]; recent?: LiveRun[] };
      setRuns(body.live ?? []);
      setRecent(body.recent ?? []);
    } catch { /* offline for a moment: the next event or tick asks again */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A job or a work moving is the cue to ask again.
  const last = messages[messages.length - 1];
  useEffect(() => {
    if (!last || last.seq === seen.current) return;
    seen.current = last.seq;
    if (/^(job|publication|book|audit):/.test(last.event)) void load();
  }, [last, load]);

  // While something runs, its counts change without an event: page 3 of 8.
  useEffect(() => {
    if (runs.length === 0) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [runs.length, load]);

  const stop = useCallback(async (jobId: string) => {
    await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }).catch(() => undefined);
    await load();
  }, [load]);

  return { runs, recent, stop, refresh: load };
}
