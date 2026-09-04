import { describe, expect, it } from "vitest";
import {
  parsePinValue,
  pinValue,
  jobRows,
  routeSummary,
  routingGroups,
  withJobPin,
  withPin,
  type RoutingTable,
} from "./model-routing-state";

const table: RoutingTable = {
  roster: [
    { id: "writer", label: "writer", does: "drafts chapters", group: "book" },
    { id: "architect", label: "architect", does: "plans the foundation", group: "book" },
    { id: "destyler", label: "de-AI styler", does: "rewrites machine prose", group: "checks" },
  ],
  groups: { book: "Books", checks: "Checks" },
  global: { service: "claudeCli", model: "claude/opus" },
  overrides: { writer: { service: "deepseek", model: "deepseek-chat" } },
  routes: {
    writer: { service: "deepseek", model: "deepseek-chat", source: "pin" },
    architect: { service: "claudeCli", model: "claude/opus", source: "global" },
    destyler: {
      service: "claudeCli", model: "claude/opus", source: "global",
      droppedPin: { service: "devinCli", model: "devin/opus", reason: "unreachable" },
    },
  },
};

describe("the rows", () => {
  it("keeps the roster's order and its grouping", () => {
    const groups = routingGroups(table);
    expect(groups.map((g) => g.label)).toEqual(["Books", "Checks"]);
    expect(groups[0]?.rows.map((r) => r.role.id)).toEqual(["writer", "architect"]);
  });

  it("gives an unpinned agent a row too", () => {
    // The whole reason the page exists: you cannot re-pin what is not listed.
    const architect = routingGroups(table)[0]?.rows[1];
    expect(architect?.role.id).toBe("architect");
    expect(architect?.value).toBe("");
  });

  it("is empty before the table loads, rather than throwing", () => {
    expect(routingGroups(null)).toEqual([]);
  });
});

describe("what a row says", () => {
  it("says so plainly when nothing is pinned", () => {
    expect(routeSummary(table.routes.architect!)).toEqual({
      text: "uses the default", tone: "default",
    });
  });

  it("names the service and model when one is", () => {
    expect(routeSummary(table.routes.writer!)).toEqual({
      text: "deepseek · deepseek-chat", tone: "pinned",
    });
  });

  it("says a pin was dropped rather than showing the fallback as a choice", () => {
    expect(routeSummary(table.routes.destyler!)).toEqual({
      text: "devinCli · devin/opus is not reachable — using the default",
      tone: "dropped",
    });
  });
});

describe("the control's value", () => {
  it("round-trips a service pin", () => {
    const pin = { service: "deepseek", model: "deepseek-chat" };
    expect(parsePinValue(pinValue(pin))).toEqual(pin);
  });

  it("round-trips a bare model, whose id contains a slash", () => {
    // "claude/sonnet" is a model id, not service/model — which is why the
    // separator is "::" and not "/".
    expect(parsePinValue(pinValue("claude/sonnet"))).toBe("claude/sonnet");
  });

  it("reads the empty value as no pin", () => {
    expect(pinValue(undefined)).toBe("");
    expect(parsePinValue("")).toBeNull();
  });
});

describe("editing", () => {
  it("removes the key when a row goes back to the default", () => {
    const next = withPin(table.overrides, "writer", null);
    expect(next).toEqual({});
    expect("writer" in next).toBe(false);
  });

  it("does not disturb the other rows", () => {
    const next = withPin(table.overrides, "auditor", "claude/haiku");
    expect(next.writer).toEqual({ service: "deepseek", model: "deepseek-chat" });
    expect(next.auditor).toBe("claude/haiku");
  });
});

const job = {
  id: "writer", label: "Writer", does: "writes prose",
  members: ["writer", "architect"],
};

describe("jobs, not agents", () => {
  const withJobs = { ...table, jobs: [job] };

  it("is pinned only when every agent in it agrees", () => {
    const rows = jobRows({ ...withJobs, overrides: {
      writer: "claude/sonnet", architect: "claude/sonnet",
    } });
    expect(rows[0]?.value).toBe("::claude/sonnet");
  });

  it("says so when the agents were pinned separately, instead of picking one", () => {
    // Displaying one member's pin would overwrite the other on the next save.
    const rows = jobRows({ ...withJobs, overrides: { writer: "claude/sonnet" } });
    expect(rows[0]).toMatchObject({ value: "", summary: { text: "set per agent" } });
  });

  it("writes one choice to every agent that does the job", () => {
    const next = withJobPin({}, job, "claude/haiku");
    expect(next).toEqual({ writer: "claude/haiku", architect: "claude/haiku" });
  });

  it("clears every member when the job goes back to the default", () => {
    const next = withJobPin({ writer: "x", architect: "x", auditor: "keep" }, job, null);
    expect(next).toEqual({ auditor: "keep" });
  });

  it("has no rows when the server did not send jobs", () => {
    expect(jobRows(table)).toEqual([]);
  });
});
