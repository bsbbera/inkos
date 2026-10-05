/**
 * One feedback gesture on every artefact, and the one stream it lands in
 * (04 §7, 18 §1).
 *
 * Every card — a chapter, a picture, a world, a kit, a gate — carries the same
 * four verdicts: keep, redo, tweak, reject. A negative one asks "what went
 * wrong?" as chips specific to the surface, so the taste engine can count
 * causes instead of parsing prose. Each verdict is appended to
 * `_taste/feedback.jsonl`, the workspace's single record of what the person
 * thought, and it also *does* what it says: keeping a picture chooses it,
 * rejecting it trashes it, redo redraws it with the causes as the note, and a
 * redo on a page files a finding the rewrite pass can act on.
 */
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Hono } from "hono";
import {
  addRule, auditProposals, buildDistillPrompt, causeProposals, cloneTaste, distillGroups, enqueueJob,
  exportTastePack,
  importTastePack, noteTrial, parseDistill, readRules, retireRule, type TasteEvent,
} from "@actalk/quire-core";

export const SURFACES = ["content", "design", "image", "build"] as const;
export type FeedbackSurface = typeof SURFACES[number];
export const VERDICTS = ["keep", "redo", "tweak", "reject", "re-world"] as const;
export type FeedbackVerdict = typeof VERDICTS[number];

export const CAUSES: Readonly<Record<FeedbackSurface, ReadonlyArray<string>>> = {
  content: ["too long", "unclear", "dull", "wrong tone", "factual", "off-setting", "other"],
  image: ["doesn't match text", "wrong style", "too busy", "realism", "bad crop", "character off", "other"],
  design: ["too busy", "dull", "wrong colour", "type too small", "image doesn't fit", "generic", "other"],
  build: ["text overflow", "fonts", "bleed/safe", "colour off", "other"],
};

/** What a cause asks of the next drawing, so a chip is a change and not a comment. */
export const IMAGE_CAUSE_HINT: Readonly<Record<string, string>> = {
  "doesn't match text": "show the scene exactly as the text describes it",
  "wrong style": "stay strictly in the world's technique and palette",
  "too busy": "simpler, fewer elements, more empty space",
  realism: "flatter and plainly illustrated, nothing photographic",
  "bad crop": "the whole subject in frame, nothing cut off",
  "character off": "draw the character exactly as their sheet describes",
};

export type FeedbackSource = "gate" | "gallery" | "audit" | "page" | "final" | "design";

export interface FeedbackEvent {
  readonly id: string;
  readonly at: string;
  readonly ref: { readonly type: string; readonly id: string; readonly unit?: number };
  readonly surface: FeedbackSurface;
  readonly verdict: FeedbackVerdict;
  readonly cause?: ReadonlyArray<string>;
  readonly note?: string;
  /** The file it is about, workspace-relative, when it is about one. */
  readonly target?: string;
  readonly source: FeedbackSource;
  readonly scope?: Readonly<Record<string, string>>;
  readonly diff?: unknown;
  /** What the app did about it. */
  readonly acted?: string;
}

export type FeedbackInput = Omit<FeedbackEvent, "id" | "at"> & { readonly at?: string };

const tasteDir = (root: string) => join(root, "_taste");

export async function appendFeedback(root: string, input: FeedbackInput): Promise<FeedbackEvent> {
  const { at, ...rest } = input;
  const event: FeedbackEvent = {
    id: `fb_${Date.now().toString(36)}${randomUUID().slice(0, 6)}`,
    at: at ?? new Date().toISOString(),
    ...rest,
  };
  await mkdir(tasteDir(root), { recursive: true });
  await appendFile(join(tasteDir(root), "feedback.jsonl"), `${JSON.stringify(event)}\n`, "utf-8");
  // Every verdict also counts against the rules still on trial in its scope (18 §5).
  await noteTrial(root, event as TasteEvent).catch(() => undefined);
  return event;
}

async function readLines<T>(file: string): Promise<T[]> {
  const text = await readFile(file, "utf-8").catch(() => "");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // A hand-edited line that lost its shape costs that line, not the stream.
    try { out.push(JSON.parse(line) as T); } catch { /* skip */ }
  }
  return out;
}

export async function readFeedback(root: string): Promise<FeedbackEvent[]> {
  return await readLines<FeedbackEvent>(join(tasteDir(root), "feedback.jsonl"));
}

/** A rule the taste engine thinks it has seen. Nothing is applied until someone accepts it. */
export interface Proposal {
  readonly id: string;
  readonly at: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly text: string;
  readonly kind: "number" | "sentence";
  readonly evidence: ReadonlyArray<string>;
  readonly source: "final" | "distill" | "pack";
  readonly state: "pending" | "accepted" | "ignored";
}

export async function readProposals(root: string): Promise<Proposal[]> {
  return await readLines<Proposal>(join(tasteDir(root), "proposals.jsonl"));
}

export async function appendProposals(
  root: string,
  input: ReadonlyArray<Omit<Proposal, "id" | "at" | "state">>,
): Promise<Proposal[]> {
  if (input.length === 0) return [];
  const at = new Date().toISOString();
  const made = input.map((p, i) => ({ ...p, id: `tp_${Date.now().toString(36)}${i}`, at, state: "pending" as const }));
  await mkdir(tasteDir(root), { recursive: true });
  await appendFile(join(tasteDir(root), "proposals.jsonl"), made.map((p) => `${JSON.stringify(p)}\n`).join(""), "utf-8");
  return made;
}

export async function settleProposal(root: string, id: string, state: "accepted" | "ignored", text?: string): Promise<Proposal | null> {
  const all = await readProposals(root);
  const hit = all.find((p) => p.id === id);
  if (!hit) return null;
  const next = { ...hit, state, ...(text?.trim() ? { text: text.trim() } : {}) };
  await writeFile(join(tasteDir(root), "proposals.jsonl"),
    all.map((p) => `${JSON.stringify(p.id === id ? next : p)}\n`).join(""), "utf-8");
  return next;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** A verdict as the screen sent it, held to the table, or the reason it is not. */
export function checkVerdict(body: Record<string, unknown>): {
  readonly surface: FeedbackSurface;
  readonly verdict: FeedbackVerdict;
  readonly cause: ReadonlyArray<string>;
} | string {
  const surface = text(body.surface) as FeedbackSurface;
  const verdict = text(body.verdict) as FeedbackVerdict;
  if (!SURFACES.includes(surface)) return `surface must be one of ${SURFACES.join(", ")}`;
  if (!VERDICTS.includes(verdict)) return `verdict must be one of ${VERDICTS.join(", ")}`;
  const cause = (Array.isArray(body.cause) ? body.cause : []).map(String);
  const unknown = cause.filter((c) => !CAUSES[surface].includes(c));
  if (unknown.length) return `not a cause for ${surface}: ${unknown.join(", ")} — one of ${CAUSES[surface].join(", ")}`;
  return { surface, verdict, cause };
}

export interface TasteRouteDeps {
  readonly root: string;
  readonly broadcast: (event: string, data: unknown) => void;
  readonly image: {
    readonly approve: (type: string, id: string, path: string) => Promise<unknown>;
    readonly trash: (type: string, id: string, path: string) => Promise<unknown>;
    readonly redesign: (type: string, id: string, path: string, note: string) => Promise<unknown>;
    /** Keep the stream's id in the recipe beside the picture (18 §5: no double truth). */
    readonly remember: (path: string, entry: Record<string, unknown>) => Promise<void>;
  };
  readonly noteFinding: (path: string, note: string, cause: ReadonlyArray<string>) => Promise<unknown>;
  /**
   * Stop reporting a finding category for one work — what accepting an audit
   * proposal does (19 §5.3). Absent means such a proposal only becomes a rule.
   */
  readonly silence?: (type: string, id: string, category: string) => Promise<unknown>;
  /** A model, for the part of distillation counting cannot do. Absent: counting only. */
  readonly ask?: (signal?: AbortSignal) => Promise<(prompt: string, tag: string) => Promise<Record<string, unknown>>>;
}

export function registerTasteRoutes(app: Hono, deps: TasteRouteDeps): void {
  const { root, broadcast } = deps;

  app.get("/api/v1/feedback/causes", (c) => c.json({ surfaces: SURFACES, verdicts: VERDICTS, causes: CAUSES }));

  app.get("/api/v1/feedback", async (c) => {
    const type = c.req.query("type");
    const id = c.req.query("id");
    const target = c.req.query("target");
    const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 1000);
    const events = (await readFeedback(root))
      .filter((e) => (!type || e.ref.type === type) && (!id || e.ref.id === id) && (!target || e.target === target))
      .reverse()
      .slice(0, limit);
    return c.json({ events });
  });

  /**
   * Say what you think, and have it acted on.
   *
   * The event is written first: it is what the person said, and it stands even
   * when the action it asks for cannot happen (a picture already gone, a
   * renderer that is off). The answer says which.
   */
  app.post("/api/v1/feedback", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const checked = checkVerdict(body);
    if (typeof checked === "string") return c.json({ error: checked }, 400);
    const refRaw = (body.ref ?? {}) as Record<string, unknown>;
    const type = text(refRaw.type);
    const id = text(refRaw.id);
    if (!type || !id) return c.json({ error: "ref.type and ref.id are required" }, 400);
    const unit = typeof refRaw.unit === "number" ? refRaw.unit : undefined;
    const target = text(body.target).trim();
    const note = text(body.note).trim();
    const { surface, verdict, cause } = checked;

    const picture = surface === "image" && !!target;
    const page = surface === "content" && !!target && (verdict === "redo" || verdict === "tweak") && !!(note || cause.length);
    const acted = picture
      ? verdict === "keep" ? "chosen" : verdict === "reject" ? "trashed" : verdict === "re-world" ? "noted" : "redrawing"
      : page ? "filed as a finding" : "noted";

    const event = await appendFeedback(root, {
      ref: { type, id, ...(unit !== undefined ? { unit } : {}) },
      surface, verdict,
      ...(cause.length ? { cause } : {}),
      ...(note ? { note } : {}),
      ...(target ? { target } : {}),
      source: (text(body.source) || (picture ? "gallery" : "page")) as FeedbackSource,
      ...(body.scope && typeof body.scope === "object" ? { scope: body.scope as Record<string, string> } : {}),
      acted,
    });
    broadcast("feedback:new", event);

    try {
      let result: unknown = null;
      if (picture) {
        await deps.image.remember(target, { id: event.id, at: event.at, verdict, ...(cause.length ? { cause } : {}) });
        if (verdict === "keep") result = await deps.image.approve(type, id, target);
        else if (verdict === "reject") result = await deps.image.trash(type, id, target);
        else if (verdict === "redo" || verdict === "tweak") {
          const hints = cause.map((k) => IMAGE_CAUSE_HINT[k]).filter(Boolean);
          result = await deps.image.redesign(type, id, target, [note, ...hints].filter(Boolean).join("; "));
        }
      } else if (page) {
        result = await deps.noteFinding(target, note, cause);
        broadcast("findings:changed", { path: target });
      }
      return c.json({ ok: true, event, result });
    } catch (error) {
      return c.json({
        ok: false, event,
        error: `Your verdict is kept, but it could not be acted on: ${error instanceof Error ? error.message : String(error)}`,
      }, 409);
    }
  });

  app.get("/api/v1/taste/proposals", async (c) => {
    const state = c.req.query("state");
    const all = await readProposals(root);
    return c.json({ proposals: all.filter((p) => !state || p.state === state).reverse() });
  });

  app.post("/api/v1/taste/proposals/:id/:verb", async (c) => {
    const verb = c.req.param("verb");
    if (verb !== "accept" && verb !== "ignore") return c.json({ error: "accept or ignore" }, 400);
    const body = await c.req.json().catch(() => ({})) as { text?: string };
    const out = await settleProposal(root, c.req.param("id"), verb === "accept" ? "accepted" : "ignored", body.text);
    if (!out) return c.json({ error: "no such proposal" }, 404);
    // Accepting is what makes it apply: the rule goes into the next unit's prompt.
    const rule = out.state === "accepted"
      ? await addRule(root, { text: out.text, kind: out.kind, scope: out.scope, evidence: out.evidence, source: out.source })
      : null;
    /*
     * An audit proposal is not a prompt line — it is a check to stop running,
     * so accepting it has to reach the pack as well (19 §5.3). Scoped to the
     * one work whose verdicts asked for it; another book keeps the check.
     */
    let silenced: string | null = null;
    if (out.state === "accepted" && out.scope.audit && out.scope.work) {
      const [type, ...rest] = out.scope.work.split("/");
      silenced = await deps.silence?.(type ?? "", rest.join("/"), out.scope.audit)
        .then(() => out.scope.audit!)
        .catch(() => null) ?? null;
    }
    broadcast("taste:changed", { id: out.id });
    return c.json({ ok: true, proposal: out, rule, ...(silenced ? { silenced } : {}) });
  });

  app.get("/api/v1/taste/rules", async (c) => c.json({ rules: (await readRules(root)).reverse() }));

  app.post("/api/v1/taste/rules/:id/retire", async (c) => {
    const out = await retireRule(root, c.req.param("id"));
    if (!out) return c.json({ error: "no such rule" }, 404);
    broadcast("taste:changed", { id: out.id });
    return c.json({ ok: true, rule: out });
  });

  /**
   * Distill (18 §2): counted causes first, then — when a model is wired —
   * notes and diffs. A job, because the model half can take minutes.
   */
  app.post("/api/v1/taste/distill", async (c) => {
    const job = enqueueJob({
      ref: { type: "taste", id: "workspace" },
      stage: "taste-distill",
      work: async ({ signal, onProgress }) => {
        const events = await readFeedback(root) as unknown as TasteEvent[];
        const known = [...await readRules(root), ...await readProposals(root)];
        const counted = causeProposals(events, known);
        const made = await appendProposals(root, counted);
        onProgress(`${made.length} rule${made.length === 1 ? "" : "s"} from counted causes`);
        // Checks this person keeps waving away — the audit's own scope (19 §5.2).
        const quiet = await appendProposals(root, auditProposals(events, [...known, ...counted]));
        if (quiet.length) {
          onProgress(`${quiet.length} check${quiet.length === 1 ? "" : "s"} you keep leaving alone`);
        }
        if (!deps.ask) return;
        const ask = await deps.ask(signal);
        const existing = known.map((k) => k.text);
        let more = 0;
        for (const group of distillGroups(events)) {
          signal.throwIfAborted();
          const out = await ask(buildDistillPrompt(group, existing), "taste-distill").catch(() => ({}));
          const found = parseDistill(out, group, existing);
          more += (await appendProposals(root, found)).length;
          existing.push(...found.map((f) => f.text));
        }
        onProgress(`${more} more from your notes`);
        broadcast("taste:changed", {});
      },
    });
    return c.json({ job });
  });

  app.post("/api/v1/taste/pack/export", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      id?: string; styles?: string[]; works?: Array<{ type?: string; id?: string }>; rules?: boolean; author?: string; license?: string;
    };
    try {
      const out = await exportTastePack(root, {
        id: String(body.id ?? ""),
        styles: Array.isArray(body.styles) ? body.styles.map(String) : [],
        works: (Array.isArray(body.works) ? body.works : [])
          .filter((w) => w?.type && w?.id).map((w) => ({ type: String(w.type), id: String(w.id) })),
        rules: body.rules !== false,
        ...(body.author ? { author: String(body.author) } : {}),
        ...(body.license ? { license: String(body.license) } : {}),
      });
      return c.json(out);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/v1/taste/pack/import", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { path?: string };
    const path = String(body.path ?? "").trim();
    if (!path || !isAbsolute(path) || !/\.zip$/i.test(path)) return c.json({ error: "give the full path to a .zip Taste Pack" }, 400);
    try {
      const out = await importTastePack(root, await readFile(path));
      // Someone else's rules are suggestions until accepted (18 §7).
      const proposals = await appendProposals(root, out.rules.map((r) => ({ ...r, evidence: [], source: "pack" as const })));
      broadcast("taste:changed", {});
      return c.json({ manifest: out.manifest, styles: out.styles, worlds: out.worlds, kits: out.kits, proposals: proposals.length });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/api/v1/taste/clone", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { from?: { type?: string; id?: string }; to?: { type?: string; id?: string } };
    const from = body.from?.type && body.from.id ? { type: String(body.from.type), id: String(body.from.id) } : null;
    const to = body.to?.type && body.to.id ? { type: String(body.to.type), id: String(body.to.id) } : null;
    if (!from || !to) return c.json({ error: "from and to are both { type, id }" }, 400);
    try {
      return c.json(await cloneTaste(root, from, to));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}
