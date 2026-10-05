/**
 * The person's own final, and learning from it (04 §6).
 *
 * Every creation gets a `my-final/` folder the pipeline never writes to: the
 * text they consider finished, the PDF they actually sent to print, anything
 * they dropped in. "Learn from final" reads it back against what the pipeline
 * made — sentence edits, how the voice moved, printed pages that differ from
 * the build — and files the answers where the taste engine reads: each edit an
 * event in `_taste/feedback.jsonl` with `source: "final"`, each voice shift a
 * proposal nobody has to accept, each dropped-in picture a kit draft. Nothing
 * is applied silently.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Hono } from "hono";
import {
  captureIntoKit, diffSentences, driftProposals, enqueueJob, kitIdOf, pageChanges, pdfPagesText,
  safeChildPath, styleDrift, workDirOf, type Drift,
} from "@actalk/quire-core";
import { MY_FINAL } from "./assets.js";
import { listAuditTargets } from "./audit.js";
import { isApproved, readAuditState } from "./audit-state.js";
import { appendFeedback, appendProposals } from "./taste.js";

export type FinalKind = "text" | "pdf" | "image" | "afdesign" | "other";

export interface FinalFile {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly modified: string;
  readonly kind: FinalKind;
}

export interface FinalSummary {
  readonly ingestedAt: string;
  readonly files: ReadonlyArray<{ readonly name: string; readonly sha256: string; readonly bytes: number }>;
  readonly text: {
    readonly source: "markdown" | "pdf" | "none";
    readonly edits: number; readonly removed: number; readonly added: number; readonly kept: number;
  };
  readonly drift: ReadonlyArray<Drift>;
  readonly pdf: { readonly pages: number; readonly builtPages: number | null; readonly changed: ReadonlyArray<number> } | null;
  readonly assets: { readonly entered: number; readonly kit: number };
  readonly afdesign: ReadonlyArray<string>;
  readonly proposals: ReadonlyArray<string>;
  readonly events: number;
  readonly notes: ReadonlyArray<string>;
}

const kindOf = (name: string): FinalKind =>
  /\.(md|txt)$/i.test(name) ? "text"
    : /\.pdf$/i.test(name) ? "pdf"
      : /\.(png|jpe?g|webp)$/i.test(name) ? "image"
        : /\.afdesign$/i.test(name) ? "afdesign" : "other";

const posix = (p: string) => p.replace(/\\/g, "/");
const finalDirOf = (type: string, id: string) => posix(join(workDirOf(type, id), MY_FINAL));

async function walk(root: string, dir: string, depth: number, out: FinalFile[]): Promise<void> {
  if (depth > 3) return;
  const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "final.json") continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) await walk(root, rel, depth + 1, out);
    else {
      const info = await stat(join(root, rel)).catch(() => null);
      if (info) out.push({ path: rel, name: e.name, bytes: info.size, modified: info.mtime.toISOString(), kind: kindOf(e.name) });
    }
  }
}

export async function listFinal(root: string, type: string, id: string): Promise<FinalFile[]> {
  const out: FinalFile[] = [];
  await walk(root, finalDirOf(type, id), 0, out);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readLastIngest(root: string, type: string, id: string): Promise<FinalSummary | null> {
  return await readFile(join(root, finalDirOf(type, id), "final.json"), "utf-8")
    .then((t) => JSON.parse(t) as FinalSummary).catch(() => null);
}

/** What the pipeline made: the signed-off pages when there are any, else every page. */
async function draftText(root: string, type: string, id: string): Promise<string> {
  const owned = (await listAuditTargets(root))
    .filter((t) => t.kind === type && t.project === id)
    .sort((a, b) => a.path.localeCompare(b.path));
  const state = await readAuditState(root);
  const signed = owned.filter((t) => isApproved(state, t.path));
  let out = "";
  for (const t of signed.length ? signed : owned) out += `${await readFile(join(root, t.path), "utf-8").catch(() => "")}\n\n`;
  return out;
}

/** The newest PDF the build wrote, if any. */
async function builtPdf(root: string, type: string, id: string): Promise<string | null> {
  const dir = join(root, workDirOf(type, id), "build");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /\.pdf$/i.test(n));
  let best: { file: string; at: number } | null = null;
  for (const n of names) {
    const info = await stat(join(dir, n)).catch(() => null);
    if (info && (!best || info.mtimeMs > best.at)) best = { file: join(dir, n), at: info.mtimeMs };
  }
  return best?.file ?? null;
}

export async function ingestFinal(
  root: string, type: string, id: string, onProgress: (m: string) => void = () => {},
): Promise<FinalSummary> {
  const files = await listFinal(root, type, id);
  if (files.length === 0) throw new Error(`${finalDirOf(type, id)}/ is empty — put your finished text, PDF or pictures there first`);
  const ref = { type, id };
  const notes: string[] = [];
  const eventIds: string[] = [];
  const work = `${type}/${id}`;
  const hashed = [];
  for (const f of files) {
    const bytes = await readFile(join(root, f.path));
    hashed.push({ name: f.path.slice(finalDirOf(type, id).length + 1), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: f.bytes });
  }

  /* ---- text: the final's words against the pipeline's ---- */
  onProgress("Reading your final text against the drafts…");
  let finalText = "";
  for (const f of files.filter((x) => x.kind === "text")) finalText += `${await readFile(join(root, f.path), "utf-8")}\n\n`;
  let source: FinalSummary["text"]["source"] = finalText.trim() ? "markdown" : "none";

  /* ---- pdf: per page, against the build ---- */
  let pdf: FinalSummary["pdf"] = null;
  const pdfs = files.filter((x) => x.kind === "pdf");
  if (pdfs.length) {
    onProgress("Reading your PDF…");
    const pages = await pdfPagesText(new Uint8Array(await readFile(join(root, pdfs[0]!.path)))).catch((e: unknown) => {
      notes.push(`could not read ${pdfs[0]!.name}: ${e instanceof Error ? e.message : String(e)}`);
      return [] as string[];
    });
    if (!finalText.trim() && pages.length) {
      finalText = pages.join("\n\n");
      source = "pdf";
    }
    const built = await builtPdf(root, type, id);
    const builtPages = built ? await pdfPagesText(new Uint8Array(await readFile(built))).catch(() => null) : null;
    const changed = builtPages ? pageChanges(builtPages, pages).map((p) => p.page) : [];
    pdf = { pages: pages.length, builtPages: builtPages?.length ?? null, changed };
    if (!built) notes.push("no built PDF to compare pages against");
    for (const page of changed.slice(0, 60)) {
      const e = await appendFeedback(root, {
        ref: { ...ref, unit: page }, surface: "design", verdict: "tweak", source: "final",
        note: `page ${page} of your PDF differs from the build`, scope: { work },
      });
      eventIds.push(e.id);
    }
  }

  const diff = finalText.trim() ? diffSentences(await draftText(root, type, id), finalText) : null;
  if (diff) {
    for (const edit of diff.edits.slice(0, 150)) {
      eventIds.push((await appendFeedback(root, {
        ref, surface: "content", verdict: "tweak", source: "final", diff: edit, scope: { work },
      })).id);
    }
    for (const before of diff.removed.slice(0, 50)) {
      eventIds.push((await appendFeedback(root, {
        ref, surface: "content", verdict: "reject", source: "final", diff: { before, after: "" }, scope: { work },
      })).id);
    }
    for (const after of diff.added.slice(0, 50)) {
      eventIds.push((await appendFeedback(root, {
        ref, surface: "content", verdict: "tweak", source: "final", diff: { before: "", after }, scope: { work },
      })).id);
    }
  }
  const drift = finalText.trim() ? styleDrift(await draftText(root, type, id), finalText) : [];
  const proposals = await appendProposals(root, driftProposals(drift).map((p) => ({
    ...p, scope: { work }, source: "final" as const, evidence: eventIds.slice(0, 20),
  })));

  /* ---- pictures they dropped in: gallery (by the file route) and kit drafts ---- */
  let kit = 0;
  for (const f of files.filter((x) => x.kind === "image")) {
    const asset = await captureIntoKit(root, kitIdOf(type, id), { file: f.path, kind: "picture", origin: "final", state: "draft" })
      .catch(() => null);
    if (asset) kit += 1;
  }
  const afdesign = files.filter((x) => x.kind === "afdesign").map((f) => f.name);
  if (afdesign.length) notes.push("an .afdesign is listed but not read back yet — that needs Affinity open (07 §1b)");

  const summary: FinalSummary = {
    ingestedAt: new Date().toISOString(),
    files: hashed,
    text: {
      source,
      edits: diff?.edits.length ?? 0, removed: diff?.removed.length ?? 0,
      added: diff?.added.length ?? 0, kept: diff?.kept ?? 0,
    },
    drift,
    pdf,
    assets: { entered: files.filter((x) => x.kind === "image").length, kit },
    afdesign,
    proposals: proposals.map((p) => p.id),
    events: eventIds.length,
    notes,
  };
  await writeFile(join(root, finalDirOf(type, id), "final.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  return summary;
}

/** `data:<mime>;base64,<bytes>` → bytes. */
export function bytesOfDataUrl(dataUrl: string): Buffer {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("the upload is not a data URL");
  return m[2] ? Buffer.from(m[3]!, "base64") : Buffer.from(decodeURIComponent(m[3]!), "utf-8");
}

export const safeName = (name: string): string =>
  basename(name).replace(/[^\p{L}\p{N}._\- ()]+/gu, "-").slice(0, 120) || "file";

const MAX_UPLOAD = 120 * 1024 * 1024;

export function registerFinalRoutes(app: Hono, deps: {
  readonly root: string;
  readonly broadcast: (event: string, data: unknown) => void;
}): void {
  const { root, broadcast } = deps;

  app.get("/api/v1/final", async (c) => {
    const type = c.req.query("type") ?? "";
    const id = c.req.query("id") ?? "";
    if (!type || !id) return c.json({ error: "type and id are required" }, 400);
    try {
      return c.json({ dir: finalDirOf(type, id), files: await listFinal(root, type, id), last: await readLastIngest(root, type, id) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  /** Put a file into `my-final/`. Pictures go to `my-final/assets/`. */
  app.post("/api/v1/final/upload", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { type?: string; id?: string; filename?: string; dataUrl?: string };
    if (!body.type || !body.id || !body.dataUrl) return c.json({ error: "type, id and dataUrl are required" }, 400);
    try {
      const bytes = bytesOfDataUrl(body.dataUrl);
      if (bytes.byteLength > MAX_UPLOAD) return c.json({ error: "that file is larger than 120 MB" }, 413);
      const name = safeName(body.filename ?? "upload");
      const rel = `${finalDirOf(body.type, body.id)}${kindOf(name) === "image" ? "/assets" : ""}/${name}`;
      const file = safeChildPath(root, rel);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, bytes);
      broadcast("final:changed", { type: body.type, id: body.id });
      return c.json({ ok: true, path: rel, bytes: bytes.byteLength });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  /** Learn from final: a job, because a long book's diff and a PDF read take a while. */
  app.post("/api/v1/final/learn", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { type?: string; id?: string };
    if (!body.type || !body.id) return c.json({ error: "type and id are required" }, 400);
    const { type, id } = body;
    if ((await listFinal(root, type, id)).length === 0) {
      return c.json({ error: `${finalDirOf(type, id)}/ is empty — put your finished text, PDF or pictures there first` }, 409);
    }
    const job = enqueueJob({
      ref: { type, id },
      stage: "taste.ingestFinal",
      work: async ({ onProgress }) => {
        const summary = await ingestFinal(root, type, id, onProgress);
        broadcast("final:learned", { type, id, summary });
        broadcast("assets:changed", { type, id });
        onProgress(`${summary.text.edits} edits, ${summary.proposals.length} proposals, ${summary.assets.kit} kit drafts`);
      },
    });
    return c.json({ ok: true, job });
  });
}
