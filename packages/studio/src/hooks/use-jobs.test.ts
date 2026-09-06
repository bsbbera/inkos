/**
 * The merge that keeps a running job on screen after you walk away from it.
 *
 * The failure this guards is the one nobody sees: the reducer silently drops
 * an event, the rail card empties, and the work carries on invisibly - which
 * is exactly the state this hook was written to end.
 */
import { describe, expect, it } from "vitest";
import { applyJobEvent, isLive, jobDetail, jobLabel, type Job } from "./use-jobs";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "job_1",
    ref: { type: "short", id: "the-lamp-room" },
    stage: "restyle",
    status: "running",
    queuedAt: "2026-09-06T10:00:00.000Z",
    ...over,
  };
}

describe("applyJobEvent", () => {
  it("adds a job it has not seen", () => {
    expect(applyJobEvent([], "job:queued", job({ status: "queued" }))).toHaveLength(1);
  });

  it("replaces a job in place rather than appending it twice", () => {
    const first = applyJobEvent([], "job:started", job());
    const next = applyJobEvent(first, "job:progress", job({ message: "2 of 14" }));
    expect(next).toHaveLength(1);
    expect(next[0]!.message).toBe("2 of 14");
  });

  it("keeps the queue's order, which is the order they will run in", () => {
    const one = applyJobEvent([], "job:started", job({ id: "job_1" }));
    const two = applyJobEvent(one, "job:queued", job({ id: "job_2", status: "queued" }));
    const back = applyJobEvent(two, "job:progress", job({ id: "job_1", message: "on" }));
    expect(back.map((j) => j.id)).toEqual(["job_1", "job_2"]);
  });

  it("ignores events that are not the queue's", () => {
    const before = [job()];
    expect(applyJobEvent(before, "audit:text", { path: "x" })).toBe(before);
  });

  it("ignores a payload that is not a job", () => {
    const before = [job()];
    expect(applyJobEvent(before, "job:progress", null)).toBe(before);
    expect(applyJobEvent(before, "job:progress", { message: "no id" })).toBe(before);
  });
});

describe("isLive", () => {
  it("counts queued and running, and nothing else", () => {
    expect(isLive(job({ status: "queued" }))).toBe(true);
    expect(isLive(job({ status: "running" }))).toBe(true);
    expect(isLive(job({ status: "done" }))).toBe(false);
    expect(isLive(job({ status: "failed" }))).toBe(false);
    expect(isLive(job({ status: "cancelled" }))).toBe(false);
  });
});

describe("jobLabel and jobDetail", () => {
  it("says what a stage is doing in words, not in its id", () => {
    expect(jobLabel(job())).toBe("Rewriting in the new voice");
  });

  it("shows an unknown stage rather than swallowing it", () => {
    expect(jobLabel(job({ stage: "confabulate" }))).toBe("confabulate");
  });

  it("says a queued job is waiting rather than pretending it is working", () => {
    expect(jobDetail(job({ status: "queued" }))).toBe("the-lamp-room · waiting its turn");
  });

  it("prefers the latest progress line, falling back to what is being worked on", () => {
    expect(jobDetail(job({ message: "3 of 14: rewriting 0003.md…" })))
      .toBe("3 of 14: rewriting 0003.md…");
    expect(jobDetail(job({ message: "   " }))).toBe("the-lamp-room");
  });
});
