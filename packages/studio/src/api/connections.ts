/*
 * What "connected" means: a connection that passed a test.
 *
 * It used to mean three different things - an API with a key saved (never
 * tried), a CLI that was installed (signed in or not), a local server that
 * answered once. Now there is one rule for all three: a test made a real call
 * and the provider listed at least one model. The result is kept with its time,
 * on this machine beside the keys, and only a passing result puts a
 * connection's models in front of anyone.
 *
 * A result goes stale and is re-tested (OK_TTL / FAIL_TTL). A connection that
 * stops answering keeps its row with the reason - it is never silently gone.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { secretsDir } from "@actalk/quire-core";

export interface ConnectionCheck {
  readonly ok: boolean;
  /** ISO time of the test. */
  readonly at: string;
  /** How many models the provider listed. */
  readonly models: number;
  /** Why it failed, in words. Absent when ok. */
  readonly error?: string;
  /**
   * When it last passed, kept on a failure. It separates "stopped answering"
   * (worth showing, greyed, wherever models are picked) from "never set up"
   * (an Ollama that was never installed is not news in every picker).
   */
  readonly lastOk?: string;
}

/** A pass is trusted for five minutes, a failure for one: a server just started should not wait long. */
export const OK_TTL = 5 * 60_000;
export const FAIL_TTL = 60_000;

const file = (root: string) => join(secretsDir(root), "connections.json");

export async function readChecks(root: string): Promise<Record<string, ConnectionCheck>> {
  try {
    const body = JSON.parse(await readFile(file(root), "utf-8")) as { checks?: Record<string, ConnectionCheck> };
    return body.checks ?? {};
  } catch {
    return {};
  }
}

// One write at a time: two tests finishing together must not drop each other's result.
let chain: Promise<unknown> = Promise.resolve();

export function writeCheck(root: string, id: string, check: ConnectionCheck | null): Promise<void> {
  const next = chain.then(async () => {
    const checks = await readChecks(root);
    if (check) checks[id] = check; else delete checks[id];
    await mkdir(secretsDir(root), { recursive: true });
    await writeFile(file(root), JSON.stringify({ checks }, null, 2), "utf-8");
  });
  chain = next.catch(() => undefined);
  return next;
}

export function isStale(check: ConnectionCheck | undefined, now = Date.now()): boolean {
  if (!check) return true;
  return now - Date.parse(check.at) > (check.ok ? OK_TTL : FAIL_TTL);
}
