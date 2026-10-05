/**
 * One thing at a time, and a way to stop it.
 *
 * Stages were started detached: `void runStage(...)` and nothing else. That is
 * fine until two of them overlap — approving two gates in the same minute put
 * two renders on one GPU — and it is not fine at all when a stage takes twenty
 * minutes and the person who started it changes their mind. There was nothing
 * holding the promise, so there was nothing to cancel, and nothing that could
 * even name what was running.
 *
 * So: a queue that holds them. It is in memory on purpose. A job is a stage in
 * flight, and nothing is in flight across a restart — `markInterrupted` already
 * tells the truth about runs the last shutdown caught mid-stage, and persisting
 * a queue would only add a second, staler account of the same fact.
 *
 * Serial by design. Everything a stage does on this machine competes for the
 * same scarce thing: one Comfy, one Affinity, one model budget. A pool would
 * make the queue longer to read and the renders no faster.
 */

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobRef {
  readonly type: string;
  readonly id: string;
}

export interface Job {
  readonly id: string;
  readonly ref: JobRef;
  /** What this job is doing, in the stage's own words. */
  readonly stage: string;
  readonly status: JobStatus;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** The last thing the work said about itself. */
  readonly message?: string;
  readonly error?: string;
  /**
   * The unit in hand, for a stage that walks units.
   *
   * A stage is one job; a job used to say only "content.write", so the rail
   * could not tell page 3 of 50 from page 49, and stopping meant stopping the
   * whole stage. This is what `cancelUnit` aims at.
   */
  readonly unit?: number;
}

/** What a job actually does. It is handed the signal, not asked to poll a flag. */
export type JobWork = (input: {
  readonly signal: AbortSignal;
  readonly onProgress: (message: string) => void;
}) => Promise<unknown>;

type JobSink = (event: string, job: Job) => void;

interface Entry {
  job: Job;
  readonly work: JobWork;
  readonly controller: AbortController;
}

const entries = new Map<string, Entry>();
const waiting: string[] = [];
let running: string | null = null;
let counter = 0;
let sink: JobSink | null = null;

/**
 * Where job news goes. The Studio sets this to its broadcaster at boot; a test
 * sets it to a spy, and the engine itself knows nothing about SSE.
 */
export function setJobSink(fn: JobSink | null): void {
  sink = fn;
}

function announce(event: string, job: Job): void {
  try {
    sink?.(event, job);
  } catch {
    /* A listener that throws must not take the queue down with it. */
  }
}

function patch(id: string, next: Partial<Job>): Job | null {
  const entry = entries.get(id);
  if (!entry) return null;
  entry.job = { ...entry.job, ...next };
  return entry.job;
}

/** Say which unit a running stage is on, so the rail and a per-unit stop can see it. */
export function setJobUnit(id: string, unit: number): void {
  const job = patch(id, { unit });
  if (job) announce("job:progress", job);
}

/** Every job this process knows about, newest last. */
export function listJobs(): ReadonlyArray<Job> {
  return [...entries.values()].map((e) => e.job);
}

export function jobById(id: string): Job | null {
  return entries.get(id)?.job ?? null;
}

/**
 * Queue a stage, unless the same stage of the same run is already in hand.
 *
 * The de-duplication is not an optimisation. `startStage` chains itself after
 * every advance and the approve route calls it too, so the same stage arrives
 * here twice in the ordinary case; without this, approving a gate would run
 * the next stage twice over the same units.
 */
export function enqueue(input: {
  readonly ref: JobRef;
  readonly stage: string;
  readonly work: JobWork;
}): Job {
  const existing = [...entries.values()].find((e) =>
    (e.job.status === "queued" || e.job.status === "running")
    && e.job.ref.type === input.ref.type
    && e.job.ref.id === input.ref.id
    && e.job.stage === input.stage);
  if (existing) return existing.job;

  counter += 1;
  const id = `job_${counter}`;
  const job: Job = {
    id,
    ref: input.ref,
    stage: input.stage,
    status: "queued",
    queuedAt: new Date().toISOString(),
  };
  entries.set(id, { job, work: input.work, controller: new AbortController() });
  waiting.push(id);
  announce("job:queued", job);
  void pump();
  return job;
}

/**
 * Account for work that runs outside the queue.
 *
 * A magazine resumed from its page and a production confirmed in chat both
 * run in parallel with the queue, each holding its own controller. Neither
 * was listed here, so the rail said nothing while a fifty-page issue was
 * being written. This lists them without serialising them: the queue's
 * one-at-a-time rule is for renders, and changing when these start is a
 * different decision from saying that they have.
 *
 * Cancelling one aborts the controller the work already listens to.
 */
export function track(input: {
  readonly ref: JobRef;
  readonly stage: string;
  readonly controller: AbortController;
}): {
  readonly job: Job;
  readonly progress: (message: string, stage?: string) => void;
  readonly finish: (error?: unknown) => void;
} {
  counter += 1;
  const id = `job_${counter}`;
  const now = new Date().toISOString();
  const job: Job = {
    id,
    ref: input.ref,
    stage: input.stage,
    status: "running",
    queuedAt: now,
    startedAt: now,
  };
  // Never queued, so the pump never runs it; `work` is only here to fit Entry.
  entries.set(id, { job, work: async () => undefined, controller: input.controller });
  announce("job:started", job);

  let ended = false;
  return {
    job,
    progress: (message, stage) => {
      if (ended) return;
      const next = patch(id, { message, ...(stage ? { stage } : {}) });
      if (next) announce("job:progress", next);
    },
    finish: (error) => {
      if (ended) return;
      ended = true;
      const aborted = input.controller.signal.aborted;
      const endedAt = new Date().toISOString();
      const next = aborted
        ? patch(id, { status: "cancelled", endedAt })
        : error === undefined
          ? patch(id, { status: "done", endedAt })
          : patch(id, {
            status: "failed",
            endedAt,
            error: error instanceof Error ? error.message : String(error),
          });
      if (next) announce(`job:${next.status}`, next);
    },
  };
}

/** The live job for one piece of work, if anything is running for it. */
export function liveJobFor(ref: JobRef): Job | null {
  for (const entry of entries.values()) {
    const j = entry.job;
    if ((j.status === "queued" || j.status === "running")
      && j.ref.type === ref.type && j.ref.id === ref.id) return j;
  }
  return null;
}
/**
 * Stop a job. A queued one never starts; a running one is told to stop and is
 * marked cancelled the moment it does.
 *
 * The work decides how fast that is. `runStage` checks between units, and a
 * render in flight is aborted at the socket — a unit that has already begun may
 * still finish, which is the honest behaviour: half a rendered image is worse
 * than one more image.
 */
export function cancel(id: string): boolean {
  const entry = entries.get(id);
  if (!entry) return false;
  if (entry.job.status === "queued") {
    const at = waiting.indexOf(id);
    if (at >= 0) waiting.splice(at, 1);
    const job = patch(id, { status: "cancelled", endedAt: new Date().toISOString() });
    if (job) announce("job:cancelled", job);
    return true;
  }
  if (entry.job.status === "running") {
    entry.controller.abort();
    return true;
  }
  return false;
}

/**
 * Stop every live job the test picks. What a withdrawn approval uses: the
 * stages it had unblocked are no longer wanted, and leaving them to finish
 * would draw pictures for text someone just took back (14 §2.1 d).
 */
export function cancelWhere(test: (job: Job) => boolean): ReadonlyArray<string> {
  const hit = [...entries.values()]
    .filter((e) => (e.job.status === "queued" || e.job.status === "running") && test(e.job))
    .map((e) => e.job.id);
  for (const id of hit) cancel(id);
  return hit;
}

/** Stages that a gate stands in front of: withdrawing it makes them premature. */
export function isDownstreamOf(gate: string, stage: string): boolean {
  const order = ["content", "design", "build"];
  const at = order.indexOf(gate);
  const macro = order.indexOf(stage.split(".")[0] ?? "");
  const behindGate = stage.startsWith("gate:") ? order.indexOf(stage.slice(5)) > at : false;
  return at >= 0 && (macro > at || behindGate);
}

async function pump(): Promise<void> {
  if (running) return;
  const id = waiting.shift();
  if (!id) return;
  const entry = entries.get(id);
  if (!entry) return await pump();

  running = id;
  const started = patch(id, { status: "running", startedAt: new Date().toISOString() });
  if (started) announce("job:started", started);

  try {
    await entry.work({
      signal: entry.controller.signal,
      onProgress: (message) => {
        const job = patch(id, { message });
        if (job) announce("job:progress", job);
      },
    });
    const done = entry.controller.signal.aborted
      ? patch(id, { status: "cancelled", endedAt: new Date().toISOString() })
      : patch(id, { status: "done", endedAt: new Date().toISOString() });
    if (done) announce(done.status === "cancelled" ? "job:cancelled" : "job:done", done);
  } catch (error) {
    const aborted = entry.controller.signal.aborted;
    const job = patch(id, {
      status: aborted ? "cancelled" : "failed",
      endedAt: new Date().toISOString(),
      ...(aborted ? {} : { error: error instanceof Error ? error.message : String(error) }),
    });
    if (job) announce(aborted ? "job:cancelled" : "job:failed", job);
  } finally {
    running = null;
    void pump();
  }
}

/**
 * Forget finished jobs, keeping the most recent few.
 *
 * A long session would otherwise grow one entry per stage forever. Only
 * finished ones go: a queue that dropped work it had not done would be a
 * different and much worse bug.
 */
export function pruneJobs(keep = 50): number {
  const finished = [...entries.values()]
    .filter((e) => e.job.status !== "queued" && e.job.status !== "running");
  const drop = finished.slice(0, Math.max(0, finished.length - keep));
  for (const entry of drop) entries.delete(entry.job.id);
  return drop.length;
}

/** Test seam: drop everything and start clean. Never called by the server. */
export function resetJobs(): void {
  entries.clear();
  waiting.length = 0;
  running = null;
  counter = 0;
  sink = null;
}
