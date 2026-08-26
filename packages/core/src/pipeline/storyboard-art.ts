/**
 * The shots, actually drawn.
 *
 * A storyboard run writes image-prompts.md and an assets.json that already
 * models every shot — `status: "prompt_ready"`, an empty `variants` list, a
 * generated directory to put them in. Nothing ever filled it: the prompts were
 * written and then the only way to get a picture out of them was to leave
 * Quire. This is the pass that renders them, through the same shim the
 * publication art stage uses.
 *
 * Resumable by reading the manifest rather than by counting: a shot already
 * marked generated is skipped, so a run interrupted at shot nine resumes at
 * nine instead of redoing eight images. The manifest is saved after every shot
 * for the same reason — progress that only exists in memory is progress lost
 * when the window closes.
 *
 * Not gated on approval the way page art is, because a storyboard's frames are
 * the deliverable rather than an illustration of copy someone signed off. It
 * is still a confirmed action: nothing renders until the user asks for it.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { requireRenderer } from "../utils/renderer-preflight.js";
import { safeChildPath } from "../utils/path-safety.js";
import type { StoryboardAssetsManifest, StoryboardImageAsset } from "./script-storyboard-runner.js";

export interface StoryboardArtOptions {
  readonly projectRoot: string;
  /** Project-relative path of the run's assets.json. */
  readonly manifestPath: string;
  readonly shimUrl?: string;
  /** Render only these shot ids. Omit for every shot still outstanding. */
  readonly only?: ReadonlyArray<string>;
  /** Re-render shots that already have an image. */
  readonly redo?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly onProgress?: (message: string) => void;
  readonly signal?: AbortSignal;
}

export interface StoryboardArtResult {
  readonly rendered: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<{ readonly shotId: string; readonly error: string }>;
  readonly manifestPath: string;
}

/** The shots this call should draw, given what the manifest already holds. */
export function outstandingShots(
  manifest: StoryboardAssetsManifest,
  { only, redo }: { only?: ReadonlyArray<string>; redo?: boolean } = {},
): StoryboardImageAsset[] {
  const wanted = only && only.length > 0 ? new Set(only) : null;
  return manifest.assets.filter((asset) => {
    if (wanted && !wanted.has(asset.shotId)) return false;
    if (!asset.prompt.trim()) return false;
    // A failed shot is outstanding: the point of resuming is to finish it.
    return redo || asset.status === "prompt_ready" || asset.status === "failed";
  });
}

/**
 * Write the manifest without risking the one on disk.
 *
 * Saved after every shot, so a crash costs the image in flight and nothing
 * else. Rename over the target is atomic on NTFS and POSIX both, which a
 * partial write to the target itself would not be.
 */
async function save(absolutePath: string, manifest: StoryboardAssetsManifest): Promise<void> {
  const temp = `${absolutePath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(manifest, null, 2), "utf-8");
  await rename(temp, absolutePath);
}

export async function renderStoryboardShots(options: StoryboardArtOptions): Promise<StoryboardArtResult> {
  const { projectRoot, onProgress, signal } = options;
  const manifestAbs = safeChildPath(projectRoot, options.manifestPath);
  const manifest = JSON.parse(await readFile(manifestAbs, "utf-8")) as StoryboardAssetsManifest;
  if (manifest.kind !== "storyboard_assets") {
    throw new Error(`${options.manifestPath} is not a storyboard assets manifest`);
  }

  const todo = outstandingShots(manifest, options);
  const already = manifest.assets.length - todo.length;
  if (todo.length === 0) {
    return { rendered: [], skipped: manifest.assets.map((a) => a.shotId), failed: [], manifestPath: options.manifestPath };
  }

  // Before the first image, not after the first failure.
  const shim = await requireRenderer(options.shimUrl, "storyboard art");

  const rendered: string[] = [];
  const failed: Array<{ shotId: string; error: string }> = [];
  const assets = [...manifest.assets];

  for (const [index, asset] of todo.entries()) {
    signal?.throwIfAborted();
    onProgress?.(`Rendering ${asset.shotId} (${index + 1}/${todo.length})…`);

    const outRelative = join(manifest.generatedDir, `${asset.shotId}.png`);
    const outFile = safeChildPath(projectRoot, outRelative);
    await mkdir(dirname(outFile), { recursive: true });

    const body = await fetch(`${shim}/comfy/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: asset.prompt,
        width: options.width ?? 1536,
        height: options.height ?? 1024,
        outFile,
      }),
      signal,
    })
      .then(async (r) => await r.json().catch(() => ({})) as { ok?: boolean; error?: string })
      .catch((e: unknown) => ({ ok: false, error: String(e) }));

    const at = assets.findIndex((a) => a.shotId === asset.shotId);
    if (body.ok === false) {
      failed.push({ shotId: asset.shotId, error: body.error ?? "unknown reason" });
      assets[at] = { ...asset, status: "failed" };
    } else {
      rendered.push(asset.shotId);
      assets[at] = {
        ...asset,
        status: "generated",
        // Appended, not replaced: re-rendering a shot is how alternatives are
        // produced, and the earlier take is what they are chosen against.
        variants: [...asset.variants, {
          id: `${asset.shotId}-v${asset.variants.length + 1}`,
          path: toPosix(outRelative),
          status: "generated",
          provider: "comfy",
          createdAt: new Date().toISOString(),
        }],
      };
    }

    // After every shot: a run that dies at nineteen keeps eighteen.
    await save(manifestAbs, { ...manifest, assets });
  }

  onProgress?.(
    `${rendered.length} rendered, ${already} already had images`
    + `${failed.length ? `, ${failed.length} failed` : ""}.`,
  );
  return {
    rendered,
    skipped: manifest.assets.filter((a) => !todo.some((t) => t.shotId === a.shotId)).map((a) => a.shotId),
    failed,
    manifestPath: options.manifestPath,
  };
}

/** Manifest paths are read back on other platforms; keep them posix. */
const toPosix = (p: string) => p.split("\\").join("/");
