import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PRODUCTIONS } from "@actalk/quire-core";
import { syncPublicationAudits } from "./audit.js";
import { readAuditState } from "./audit-state.js";
import { readFindings, settleFinding } from "./findings-store.js";

// The Audit screen read 0/16 while the run had findings on nine pages.
it("copies a magazine run's per-page findings into the store the Audit screen reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "pubsync-"));
  const out = PRODUCTIONS.find((p) => p.id === "publication")!.outDir;
  const pages = join(root, out, "issues", "ink", "pages");
  await mkdir(pages, { recursive: true });
  await writeFile(join(pages, "03-blue.md"), "# Blue\n\nThe blue lasted longer than the stone.\n", "utf-8");
  const finding = { page: 3, severity: "warning", category: "fact", description: "Unsourced.", suggestion: "Cite it.", quote: "lasted longer" };
  await writeFile(join(root, out, "issues", "ink", "publication.json"), JSON.stringify({
    id: "ink", pages: [],
    audit: { at: "t1", findings: [finding], rounds: 0, complete: false, reviewed: { "3": { hash: "h", findings: [finding] } } },
  }), "utf-8");

  await syncPublicationAudits(root);
  const path = `${out}/issues/ink/pages/03-blue.md`;
  const [f] = await readFindings(root);
  expect(f).toMatchObject({ path, quote: "lasted longer", severity: "warning" });
  expect(f!.start).toBeGreaterThan(0);
  expect((await readAuditState(root)).files[path]).toMatchObject({ checked: "t1", findings: 1 });

  // A finding someone dismissed stays dismissed when the run is synced again.
  await settleFinding(root, f!.id, "ignored");
  await syncPublicationAudits(root);
  expect((await readFindings(root))[0]!.state).toBe("ignored");
});
