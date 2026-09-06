/*
 * What the machine is doing, held above the screens rather than inside one.
 *
 * The queue on the server has always been able to answer this - `GET /jobs`
 * lists every stage in flight, and each one announces itself over the event
 * stream. Nothing above a single page ever asked. So a restyle started on the
 * Style screen was tracked by a `setInterval` inside that screen's component:
 * walk to Audit and the interval was torn down with the component, the status
 * line went with it, and the only remaining way to learn that fourteen
 * chapters were being rewritten was to walk back and find the page had
 * forgotten too. The work carried on regardless, invisible.
 *
 * Two sources, because neither is enough alone. The event stream carries every
 * change but starts empty on every load, so a reload during a twenty-minute
 * stage would show nothing until it happened to say something. The list
 * answers "what is running right now" but only at the moment it is asked. Seed
 * from the list, then follow the stream.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson, postApi } from "./use-api";
import type { SSEMessage } from "./use-sse";
import { useNewSSEMessages } from "./use-sse";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  readonly id: string;
  readonly ref: { readonly type: string; readonly id: string };
  readonly stage: string;
  readonly status: JobStatus;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly message?: string;
  readonly error?: string;
}

/** A job that has not finished. The only kind worth a place on the chrome. */
export function isLive(job: Job): boolean {
  return job.status === "queued" || job.status === "running";
}

/**
 * Fold one `job:*` event into the list.
 *
 * Pure and exported so the merge can be tested without a server: every event
 * carries the whole job, so this is an upsert keyed on id, and the ordering is
 * the queue's own - oldest first, which is the order they will run in.
 */
export function applyJobEvent(
  jobs: ReadonlyArray<Job>,
  event: string,
  data: unknown,
): ReadonlyArray<Job> {
  if (!event.startsWith("job:")) return jobs;
  const job = data as Job | null;
  if (!job || typeof job.id !== "string") return jobs;
  const at = jobs.findIndex((j) => j.id === job.id);
  if (at < 0) return [...jobs, job];
  const next = [...jobs];
  next[at] = job;
  return next;
}

/**
 * How a stage names itself to somebody who did not start it.
 *
 * The server's stage ids are written for the server: `restyle`, `artplan`,
 * `export`. On the chrome they sit next to the name of the work, so they are
 * read as a sentence and have to be one.
 */
const STAGE_LABELS: Readonly<Record<string, string>> = {
  restyle: "Rewriting in the new voice",
  audit: "Reading for faults",
  write: "Writing",
  plan: "Planning",
  destyle: "Taking the AI out",
  artplan: "Planning the art",
  generate: "Generating art",
  review: "Reviewing",
  layout: "Laying out",
  export: "Exporting",
  build: "Building",
};

export function jobLabel(job: Job): string {
  return STAGE_LABELS[job.stage] ?? job.stage;
}

/** The line under the label: what it is working on, and how far in. */
export function jobDetail(job: Job): string {
  if (job.status === "queued") return `${job.ref.id} · waiting its turn`;
  return job.message?.trim() || job.ref.id;
}

export interface JobsView {
  /** Every job this session knows about, oldest first. */
  readonly jobs: ReadonlyArray<Job>;
  /** Queued and running only. */
  readonly live: ReadonlyArray<Job>;
  readonly cancel: (id: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export function useJobs(messages: ReadonlyArray<SSEMessage>): JobsView {
  const [jobs, setJobs] = useState<ReadonlyArray<Job>>([]);

  const refresh = useCallback(async () => {
    const data = await fetchJson<{ jobs: ReadonlyArray<Job> }>("/jobs").catch(() => null);
    if (!data) return;
    /*
     * The list wins over what the stream has built up, but only for jobs the
     * list knows about: it is the server's own account, and it is complete.
     * Anything the stream saw and the list has since pruned is dropped with
     * it, which is the right answer - a job the server has forgotten is not
     * running.
     */
    setJobs(data.jobs);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useNewSSEMessages(messages, useCallback((m: SSEMessage) => {
    setJobs((was) => applyJobEvent(was, m.event, m.data));
  }, []));

  const cancel = useCallback(async (id: string) => {
    await postApi(`/jobs/${id}/cancel`, {}).catch(() => null);
    await refresh();
  }, [refresh]);

  const live = useMemo(() => jobs.filter(isLive), [jobs]);

  return { jobs, live, cancel, refresh };
}
