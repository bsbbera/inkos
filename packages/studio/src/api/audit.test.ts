import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listAuditTargets } from "./audit.js";

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "audit-targets-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body);
  }
  return root;
}

const prose = "x".repeat(2000);

describe("listAuditTargets", () => {
  // The whole point: work written before the checks existed is still work.
  it("finds finished work across every production", async () => {
    const root = await workspace({
      "shorts/lamp-room/final/full.md": prose,
      "books/tide/final/book.md": prose,
      "Magazine/issues/kolam/pages/01-opening.md": prose,
      "storyboards/closing-time/storyboard.md": prose,
    });
    const paths = (await listAuditTargets(root)).map((t) => t.path);
    expect(paths).toContain("shorts/lamp-room/final/full.md");
    expect(paths).toContain("books/tide/final/book.md");
    expect(paths).toContain("Magazine/issues/kolam/pages/01-opening.md");
    expect(paths).toContain("storyboards/closing-time/storyboard.md");
  });

  it("labels each by the production that wrote it", async () => {
    const root = await workspace({ "shorts/lamp-room/final/full.md": prose });
    expect((await listAuditTargets(root))[0]?.kind).toBe("short");
  });

  // Offering to audit a story bible would be offering nonsense.
  it("leaves rules and truth files out", async () => {
    const root = await workspace({
      "books/tide/story_bible.md": prose,
      "books/tide/book_rules.md": prose,
      "books/tide/current_focus.md": prose,
      "books/tide/final/book.md": prose,
    });
    const paths = (await listAuditTargets(root)).map((t) => t.path);
    expect(paths).toEqual(["books/tide/final/book.md"]);
  });

  // Auditing the audit's own backup would be circular.
  it("leaves the audit's own backups out", async () => {
    const root = await workspace({
      "shorts/lamp-room/final/full.md": prose,
      "shorts/lamp-room/final/full.pre-audit.md": prose,
    });
    expect((await listAuditTargets(root)).map((t) => t.path))
      .toEqual(["shorts/lamp-room/final/full.md"]);
  });

  it("skips stubs too short to judge", async () => {
    const root = await workspace({ "shorts/x/final/full.md": "# Title\n" });
    expect(await listAuditTargets(root)).toHaveLength(0);
  });

  it("is empty rather than broken on a workspace with nothing in it", async () => {
    expect(await listAuditTargets(await workspace({}))).toEqual([]);
  });
});
