import { afterEach, describe, expect, it } from "vitest";
import { cancel, enqueue, listJobs, liveJobFor, resetJobs, setJobSink, track, type Job } from "../pipeline/jobs.js";

afterEach(() => resetJobs());

describe("work run outside the queue", () => {
  it("is listed while it runs and says what it is doing", () => {
    const events: string[] = [];
    setJobSink((event) => events.push(event));
    const handle = track({
      ref: { type: "publication", id: "photography-film" },
      stage: "research",
      controller: new AbortController(),
    });

    expect(liveJobFor({ type: "publication", id: "photography-film" })?.stage).toBe("research");
    handle.progress("Grain, Gelatin, and Silver · page 3, 3 of 50", "write");
    const live = liveJobFor({ type: "publication", id: "photography-film" });
    expect(live).toMatchObject({ status: "running", stage: "write" });
    expect(live?.message).toContain("page 3");

    handle.finish();
    expect(liveJobFor({ type: "publication", id: "photography-film" })).toBeNull();
    expect(events).toEqual(["job:started", "job:progress", "job:done"]);
  });

  it("does not take the queue's slot", async () => {
    // A fifty-page issue must not hold every render behind it.
    track({ ref: { type: "publication", id: "a" }, stage: "write", controller: new AbortController() });
    let ran = false;
    enqueue({ ref: { type: "book", id: "b" }, stage: "generate", work: async () => { ran = true; } });
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toBe(true);
  });

  it("is stopped through the controller its work already listens to", () => {
    const controller = new AbortController();
    const handle = track({ ref: { type: "task", id: "short" }, stage: "short_run", controller });
    expect(cancel(handle.job.id)).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    handle.finish(new Error("Stopped by you."));
    const job = listJobs().find((j: Job) => j.id === handle.job.id);
    expect(job?.status).toBe("cancelled");
  });

  it("keeps the reason when it fails, and ends once", () => {
    const handle = track({ ref: { type: "task", id: "x" }, stage: "script_create", controller: new AbortController() });
    handle.finish(new Error("model returned invalid JSON"));
    handle.finish();
    const job = listJobs().find((j) => j.id === handle.job.id);
    expect(job).toMatchObject({ status: "failed", error: "model returned invalid JSON" });
  });
});
