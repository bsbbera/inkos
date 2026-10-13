import { rename } from "node:fs/promises";

/**
 * Rename over the target, retrying while Windows holds it.
 *
 * NTFS refuses to replace a file another handle has open (a reader polling
 * the issue, a virus scan of the new file) with EPERM/EBUSY/EACCES, for a few
 * milliseconds. That ended an 8-page magazine at the end of research.
 * ponytail: fixed backoff, ~3s in all; a lock held longer still fails loudly.
 */
export async function replaceFile(temp: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) throw error;
      await new Promise((done) => setTimeout(done, 50 * 2 ** Math.min(attempt, 5)));
    }
  }
}
