/**
 * Is the renderer up, before a stage starts spending on it?
 *
 * ComfyUI installed-but-not-running surfaced as `art p1: fetch failed`, after
 * the research, the planning, the writing and the audit had already run. It is
 * the one failure the app can fix by itself, and it was being reported as if
 * page one were at fault. Ask the shim; start it if it is only asleep; say
 * plainly what is wrong if it is not.
 *
 * Shared by every pass that renders — the publication art stage and the
 * storyboard shots — because a second copy of this would be a second place for
 * the message to go stale.
 */

interface ComfyStatus {
  readonly up?: boolean;
  readonly installed?: boolean;
  readonly reason?: string;
}

/** How long to wait for a cold ComfyUI to come up. It loads models first. */
const START_TIMEOUT_MS = 200_000;

export async function requireRenderer(shimUrl: string | undefined, what = "image rendering"): Promise<string> {
  if (!shimUrl) throw new Error(`${what} needs Quire's shim, which is not reachable`);

  const ask = async (): Promise<ComfyStatus> =>
    await fetch(`${shimUrl}/comfy/status`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<ComfyStatus>)
      .catch(() => ({}));

  const first = await ask();
  if (first.up) return shimUrl;
  if (first.installed === false) {
    throw new Error(
      "ComfyUI is not installed, so there is nothing to render with. Install it from "
      + "Quire's setup panel and run this again — everything written so far is on disk "
      + "and will not be redone.",
    );
  }

  // Installed and idle is the ordinary state after a reboot, and starting it is
  // the entire fix. It is Quire's own process to start, so start it.
  await fetch(`${shimUrl}/comfy/start`, { method: "POST", signal: AbortSignal.timeout(START_TIMEOUT_MS) })
    .catch(() => undefined);
  const second = await ask();
  if (second.up) return shimUrl;

  throw new Error(
    `ComfyUI is installed but would not start${second.reason ? `: ${second.reason}` : ""}. `
    + "Nothing was rendered and nothing is lost — everything written so far is on disk. "
    + "Start ComfyUI, then run this again.",
  );
}

/**
 * Same idea for Affinity, which cannot be started on the user's behalf.
 *
 * Its scripting sandbox also has to be able to read the Desktop, or every image
 * placement fails silently once the build is already underway. Better to refuse
 * before staging assets than to produce a document with holes in it.
 */
export async function requireDesigner(shimUrl: string | undefined, what: string): Promise<string> {
  if (!shimUrl) throw new Error(`${what} needs Quire's shim, which is not reachable`);
  type Status = { up?: boolean; canRead?: boolean; reason?: string };
  const s: Status = await fetch(`${shimUrl}/affinity/status`, { signal: AbortSignal.timeout(40_000) })
    .then((r) => r.json() as Promise<Status>)
    .catch((e: unknown): Status => ({ up: false, reason: String(e) }));
  if (s.up && s.canRead !== false) return shimUrl;
  throw new Error(
    `${what} needs Affinity Publisher${s.reason ? `: ${s.reason}` : ", and it is not answering"}. `
    + "Everything written so far is on disk; start Affinity and run this again.",
  );
}
