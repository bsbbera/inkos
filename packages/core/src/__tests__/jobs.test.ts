import { afterEach, describe, expect, it } from "vitest";
import { cancel, enqueue, listJobs, resetJobs, setJobSink, type Job } from "../pipeline/jobs.js";

afterEach(() => {
  resetJobs();
});

const ref = { type: "book", id: "test" };

/** A job that finishes when the test says so. */
function gate(): { work: () => Promise<void>; release: () => void; started: Promise<void> } {
  let release = (): void => {};
  let began = (): void => {};
  const done = new Promise<void>((r) => { release = r; });
  const started = new Promise<void>((r) => { began = r; });
  return {
    started,
    release,
    work: async () => { began(); await done; },
  };
}

describe("the job queue", () => {
  it("runs one at a time, in the order they arrived", async () => {
    const order: string[] = [];
    const first = gate();
    enqueue({ ref, stage: "one", work: async () => { order.push("one"); await first.work(); } });
    enqueue({ ref, stage: "two", work: async () => { order.push("two"); } });

    await first.started;
    // The second is queued, not running: it must not have touched `order` yet.
    expect(order).toEqual(["one"]);
    expect(listJobs().map((j) => j.status)).toEqual(["running", "queued"]);

    first.release();
    await vi_flush();
    expect(order).toEqual(["one", "two"]);
    expect(listJobs().every((j) => j.status === "done")).toBe(true);
  });

  it("hands back the job already in flight rather than queuing the same stage twice", () => {
    const held = gate();
    const a = enqueue({ ref, stage: "content.write", work: held.work });
    const b = enqueue({ ref, stage: "content.write", work: held.work });
    expect(b.id).toBe(a.id);
    expect(listJobs()).toHaveLength(1);
    held.release();
  });

  it("tells apart the same stage of two different runs", () => {
    const held = gate();
    enqueue({ ref, stage: "content.write", work: held.work });
    enqueue({ ref: { type: "book", id: "other" }, stage: "content.write", work: held.work });
    expect(listJobs()).toHaveLength(2);
    held.release();
  });

  it("drops a queued job without ever starting it", async () => {
    const first = gate();
    let ranSecond = false;
    enqueue({ ref, stage: "one", work: first.work });
    const second = enqueue({ ref, stage: "two", work: async () => { ranSecond = true; } });

    await first.started;
    expect(cancel(second.id)).toBe(true);
    first.release();
    await vi_flush();

    expect(ranSecond).toBe(false);
    expect(listJobs().find((j) => j.id === second.id)?.status).toBe("cancelled");
  });

  it("raises the signal on a running job and marks it cancelled when it stops", async () => {
    const seen: AbortSignal[] = [];
    const started = new Promise<void>((resolve) => {
      enqueue({
        ref,
        stage: "design.generate",
        work: async ({ signal }) => {
          seen.push(signal);
          resolve();
          await new Promise<void>((done) => { signal.addEventListener("abort", () => done()); });
        },
      });
    });
    await started;

    const job = listJobs()[0] as Job;
    expect(job.status).toBe("running");
    expect(cancel(job.id)).toBe(true);
    await vi_flush();

    expect(seen[0]?.aborted).toBe(true);
    expect(listJobs()[0]?.status).toBe("cancelled");
  });

  it("records a throw as failed, with what it said", async () => {
    enqueue({ ref, stage: "build.export", work: async () => { throw new Error("no renderer"); } });
    await vi_flush();
    const job = listJobs()[0];
    expect(job?.status).toBe("failed");
    expect(job?.error).toBe("no renderer");
  });

  it("announces every step to the sink", async () => {
    const seen: string[] = [];
    setJobSink((event) => seen.push(event));
    enqueue({ ref, stage: "one", work: async ({ onProgress }) => { onProgress("halfway"); } });
    await vi_flush();
    expect(seen).toEqual(["job:queued", "job:started", "job:progress", "job:done"]);
  });

  it("keeps a queue that a listener throws inside", async () => {
    setJobSink(() => { throw new Error("the screen went away"); });
    let ran = false;
    enqueue({ ref, stage: "one", work: async () => { ran = true; } });
    await vi_flush();
    expect(ran).toBe(true);
    expect(listJobs()[0]?.status).toBe("done");
  });
});

/** Let every already-resolved promise in the chain settle. */
async function vi_flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}
