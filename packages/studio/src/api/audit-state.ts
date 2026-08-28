/**
 * What has been done to each finished file, and whether anyone has signed it off.
 *
 * The audit screen could check a file, rewrite it, and put the rewrite back,
 * and remembered none of it. Open the project tomorrow and twenty-two files
 * look identical: no way to tell the eight you have already been through from
 * the fourteen you have not, and no way to mark one finished.
 *
 * One JSON file in the workspace rather than a row per file or a database:
 * this is a few dozen entries for a project someone is reading by hand, it is
 * written once per pass, and it should be readable — and repairable — by the
 * person whose workspace it lives in.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface FileAudit {
  /** When a check last ran, and what it came back with. */
  readonly checked?: string;
  readonly findings?: number;
  readonly warnings?: number;
  /** When a pass last rewrote the file in place. */
  readonly rewritten?: string;
  /** Signed off. While this is set, the file is not edited by accident. */
  readonly approved?: { readonly at: string; readonly by: string };
}

export interface AuditState {
  readonly files: Readonly<Record<string, FileAudit>>;
}

/**
 * A change to one file's record.
 *
 * `undefined` means "leave what is there" and `null` means "clear it" — the
 * distinction matters because a check that finds nothing must not wipe the
 * date a rewrite happened, while restoring the pre-rewrite text must.
 */
export type FileAuditPatch = {
  readonly [K in keyof FileAudit]?: FileAudit[K] | null;
};

const EMPTY: AuditState = { files: {} };

export function auditStatePath(root: string): string {
  return join(root, ".quire", "audit-state.json");
}

export async function readAuditState(root: string): Promise<AuditState> {
  try {
    const parsed = JSON.parse(await readFile(auditStatePath(root), "utf-8")) as AuditState;
    // A hand-edited file that has lost its shape should not take the screen
    // down with it; an empty record is the same as never having audited.
    return parsed && typeof parsed === "object" && parsed.files ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

/**
 * Fold one file's new facts into the record.
 *
 * Pure, and separate from the write, because the merge is the part with rules
 * in it: `undefined` means "leave what was there", which is how a check that
 * changed nothing keeps an earlier rewrite's date, and how approving a file
 * does not erase what the last check found.
 */
export function withFileAudit(
  state: AuditState,
  path: string,
  patch: FileAuditPatch,
): AuditState {
  const before = state.files[path] ?? {};
  const after: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // `null` is the only way to say "clear this", since undefined means "keep".
    if (value === null) delete after[key];
    else after[key] = value;
  }
  return { files: { ...state.files, [path]: after as FileAudit } };
}

export async function writeAuditState(root: string, state: AuditState): Promise<void> {
  const file = auditStatePath(root);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

/** Read, fold, write. The three call sites all want exactly this. */
export async function updateFileAudit(
  root: string,
  path: string,
  patch: FileAuditPatch,
): Promise<AuditState> {
  const next = withFileAudit(await readAuditState(root), path, patch);
  await writeAuditState(root, next);
  return next;
}

/** Whether a save to this file should be refused as an accident. */
export function isApproved(state: AuditState, path: string): boolean {
  return Boolean(state.files[path]?.approved);
}
