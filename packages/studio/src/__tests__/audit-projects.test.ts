/**
 * The audit screen's unit is a project, and a project is read off whatever run
 * state its production happens to keep. Two shapes exist and a third case —
 * work with no run state at all — must still list its files rather than vanish.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { listAuditProjects, readAuditProject } from "../api/audit.js";

let root: string;

/** Above the 400-byte floor `listAuditTargets` uses to skip stubs. */
const body = `# A page\n\n${"Words that carry the file past the stub floor. ".repeat(20)}`;

const write = async (rel: string, content: string) => {
  const path = join(root, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "quire-audit-"));

  await write("Magazine/issues/kolam/pages/01-cover.md", body);
  await write("Magazine/issues/kolam/pages/02-open.md", body);
  await write("Magazine/issues/kolam/publication.json", JSON.stringify({
    id: "kolam",
    type: "magazine",
    title: "The Hidden Mathematics of Kolam",
    subject: "kolam",
    thesis: "t",
    status: "audited",
    sections: [{ title: "one" }],
    pages: [{ n: 1, title: "Cover", body: "x" }, { n: 2, title: "Open", body: "y" }],
    audit: { at: "now", findings: [{ page: 3, severity: "warning", category: "ai-tell", description: "d", suggestion: "s" }] },
  }));

  await write("shorts/the-lamp-room/final/full.md", body);
  await write("shorts/the-lamp-room/status.json", JSON.stringify({
    version: 1,
    kind: "short-fiction",
    id: "the-lamp-room",
    status: "needs-review",
    stage: "complete",
    artifacts: [],
    observations: [{
      metric: "chapter-1-length",
      expected: { target: 700, min: 510, max: 890, unit: "en_words" },
      actual: { value: 683, unit: "en_words" },
      severity: "info",
      repairable: false,
    }],
    updatedAt: "now",
  }));

  // Written by something that never committed a snapshot.
  await write("storyboards/closing-time/storyboard.md", body);
});

describe("listAuditProjects", () => {
  it("groups files into the project that made them", async () => {
    const projects = await listAuditProjects(root);
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    expect(byId.kolam).toMatchObject({ kind: "publication", kindLabel: "Publication", files: 2 });
    expect(byId["the-lamp-room"]).toMatchObject({ kind: "short", files: 1 });
    expect(byId["closing-time"]).toMatchObject({ kind: "storyboard", files: 1 });
  });
});

describe("readAuditProject", () => {
  it("derives a publication's stages and findings from its issue", async () => {
    const detail = await readAuditProject(root, "publication", "kolam");
    expect(detail?.title).toBe("The Hidden Mathematics of Kolam");
    expect(detail?.stages.map((s) => s.stage)).toContain("fact-check");
    expect(detail?.findings[0]).toMatchObject({ page: 3, category: "ai-tell" });
    expect(detail?.items).toHaveLength(2);
  });

  // The build reads these two, and no other screen could set them for an issue
  // reached from here.
  it("carries a publication's approval gates", async () => {
    const detail = await readAuditProject(root, "publication", "kolam");
    expect(detail?.gates?.copy.approved).toBeNull();
    expect(detail?.gates?.design.canApprove).toBe(false);
    expect(detail?.gates?.build.blockers).toContain("the copy is not approved");
  });

  it("gives no gates to a production that is not signed off in halves", async () => {
    const detail = await readAuditProject(root, "short", "the-lamp-room");
    expect(detail?.gates).toBeUndefined();
  });

  it("reads every other production from its run snapshot", async () => {
    const detail = await readAuditProject(root, "short", "the-lamp-room");
    expect(detail?.stages).toEqual([{ stage: "complete", state: "needs-review", detail: "" }]);
    // `expected` and `actual` are `unknown` in the contract; say them anyway.
    expect(detail?.findings[0]?.description).toBe("expected 700 (510–890 en_words), got 683 en_words");
  });

  // Older work, or work a skill wrote outside a runner. Losing it off the
  // screen because no snapshot exists would hide files that are really there.
  it("still lists a project that kept no run state", async () => {
    const detail = await readAuditProject(root, "storyboard", "closing-time");
    expect(detail?.items).toHaveLength(1);
    expect(detail?.stages).toEqual([]);
    expect(detail?.subtitle).toContain("no run state");
  });

  it("returns nothing for a project that does not exist", async () => {
    expect(await readAuditProject(root, "short", "not-a-story")).toBeNull();
  });

  // A play world is live state, not a finished text.
  it("refuses a production that is not auditable", async () => {
    expect(await readAuditProject(root, "play", "anything")).toBeNull();
  });
});
