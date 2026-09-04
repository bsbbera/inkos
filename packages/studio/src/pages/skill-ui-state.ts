export interface StudioSkill {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly body?: string;
  readonly source?: string;
  readonly editable?: boolean;
  readonly path?: string;
}

export interface SkillImportFilePayload {
  readonly path: string;
  readonly dataUrl: string;
}

const MAX_SKILL_IMPORT_FILES = 128;
const MAX_SKILL_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_IMPORT_TOTAL_BYTES = 8 * 1024 * 1024;

export function normalizeSkillId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) return "";
  return /^[a-z]/.test(id) ? id : `skill-${id}`;
}

export function toggleSelectedSkillIds(selected: ReadonlyArray<string>, skillId: string): string[] {
  const id = normalizeSkillId(skillId);
  if (!id) return [...selected];
  if (selected.includes(id)) return selected.filter((item) => item !== id);
  return [...selected, id];
}

export function selectedSkillIdsForSend(selected: ReadonlyArray<string>): string[] | undefined {
  const ids = Array.from(new Set(selected.map(normalizeSkillId).filter(Boolean)));
  return ids.length > 0 ? ids : undefined;
}

export async function serializeSkillFolder(files: FileList | ReadonlyArray<File>): Promise<SkillImportFilePayload[]> {
  const selectedFiles = Array.from(files);
  if (selectedFiles.length > MAX_SKILL_IMPORT_FILES) {
    throw new Error(`A skill may contain at most ${MAX_SKILL_IMPORT_FILES} files.`);
  }
  let totalBytes = 0;
  for (const file of selectedFiles) {
    if (file.size > MAX_SKILL_IMPORT_FILE_BYTES) {
      throw new Error(`${file.name} exceeds ${MAX_SKILL_IMPORT_FILE_BYTES} bytes.`);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_SKILL_IMPORT_TOTAL_BYTES) {
      throw new Error(`Skill folder exceeds ${MAX_SKILL_IMPORT_TOTAL_BYTES} bytes.`);
    }
  }
  const out: SkillImportFilePayload[] = [];
  for (const file of selectedFiles) {
    const path = (file as File & { readonly webkitRelativePath?: string }).webkitRelativePath || file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    out.push({
      path,
      dataUrl: `data:${file.type || "application/octet-stream"};base64,${bytesToBase64(bytes)}`,
    });
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * The `/` in the composer, as a place rather than a keystroke.
 *
 * Attaching a skill meant leaving the sentence, opening a panel, finding the
 * name in a list and coming back — for something a person already knows the
 * name of while they are typing. Every other tool in this class lets you say
 * it inline, and this composer had no handling for `/` at all.
 *
 * Returns the token being typed, or null when the caret is not inside one.
 * Deliberately anchored to the start of a line: a path written mid-sentence
 * (`shorts/the-second-law/final/full.md` — the thing this app prints most)
 * must never open a skill menu.
 */
export interface SlashToken {
  /** What has been typed after the slash, lowercased. May be empty. */
  readonly query: string;
  /** Where the `/` sits, so a pick can replace the token exactly. */
  readonly start: number;
  readonly end: number;
}

export function slashToken(value: string, caret: number): SlashToken | null {
  if (caret < 0 || caret > value.length) return null;
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const before = value.slice(lineStart, caret);
  // One slash, at the head of the line, and no whitespace since — so the
  // token ends at the caret and a second word closes the menu.
  const m = /^\/([A-Za-z0-9-]*)$/.exec(before);
  if (!m) return null;
  return { query: m[1]!.toLowerCase(), start: lineStart, end: caret };
}

/** Skills whose id or name contains the query, best (prefix) matches first. */
export function matchSkills<T extends { readonly id: string; readonly name: string }>(
  skills: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  if (!query) return skills;
  const hit = (s: T) => `${s.id} ${s.name}`.toLowerCase();
  const starts = skills.filter((s) => s.id.toLowerCase().startsWith(query));
  const rest = skills.filter((s) => !starts.includes(s) && hit(s).includes(query));
  return [...starts, ...rest];
}

/** The composer text with the `/token` replaced — the skill is a chip, not prose. */
export function applySlashPick(value: string, token: SlashToken): string {
  return value.slice(0, token.start) + value.slice(token.end);
}
