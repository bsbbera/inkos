/*
 * API keys, kept on this machine and nowhere else.
 *
 * They used to sit in `<workspace>/.quire/secrets.json`: inside the work, so a
 * workspace copied, synced or put under git took the keys with it, and a
 * second workspace on the same machine had to be given every key again. Keys
 * belong to the machine, like the CLIs and their logins, so they live in
 * `~/.quire/secrets.json`. A workspace file found on load is moved there once.
 *
 * `projectRoot` stays in the signature: it is where an old file is found, and
 * under test it is the whole store, so a test run never touches the real home.
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { GLOBAL_CONFIG_DIR } from "../utils/llm-env.js";

export interface SecretsFile {
  services: Record<string, { apiKey: string }>;
}

const SECRETS_FILE = "secrets.json";

const LEGACY_SERVICE_ID_REMAP: Record<string, string> = {
  siliconflow: "siliconcloud",
};

const workspaceDir = (projectRoot: string) => join(projectRoot, ".quire");

/** Where keys live. ponytail: the VITEST check keeps tests in their temp root. */
export function secretsDir(projectRoot: string): string {
  return process.env.VITEST ? workspaceDir(projectRoot) : GLOBAL_CONFIG_DIR;
}

function migrateLegacyServiceIds(secrets: SecretsFile): { data: SecretsFile; changed: boolean } {
  let changed = false;
  for (const [oldId, newId] of Object.entries(LEGACY_SERVICE_ID_REMAP)) {
    if (secrets.services[oldId] && !secrets.services[newId]) {
      secrets.services[newId] = secrets.services[oldId];
      delete secrets.services[oldId];
      changed = true;
    }
  }
  return { data: secrets, changed };
}

async function readSecretsAt(dir: string): Promise<SecretsFile | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, SECRETS_FILE), "utf-8")) as SecretsFile;
    return parsed && typeof parsed === "object" && parsed.services ? parsed : { services: {} };
  } catch {
    return null;
  }
}

async function writeSecretsAt(dir: string, secrets: SecretsFile): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SECRETS_FILE), JSON.stringify(secrets, null, 2), "utf-8");
}

export async function loadSecrets(projectRoot: string): Promise<SecretsFile> {
  const dir = secretsDir(projectRoot);
  let data = (await readSecretsAt(dir)) ?? { services: {} };
  let changed = false;

  // A workspace that still holds keys: move them to the machine. A key already
  // on the machine wins - it is the newer one - and the old file goes either
  // way, so the keys stop travelling with the work.
  if (dir !== workspaceDir(projectRoot)) {
    const old = await readSecretsAt(workspaceDir(projectRoot));
    if (old) {
      for (const [id, entry] of Object.entries(old.services)) {
        if (entry?.apiKey && !data.services[id]?.apiKey) { data.services[id] = entry; changed = true; }
      }
      await writeSecretsAt(dir, data);
      await rm(join(workspaceDir(projectRoot), SECRETS_FILE), { force: true });
      changed = false;
    }
  }

  const migrated = migrateLegacyServiceIds(data);
  data = migrated.data;
  if (changed || migrated.changed) await writeSecretsAt(dir, data);
  return data;
}

export async function saveSecrets(projectRoot: string, secrets: SecretsFile): Promise<void> {
  await writeSecretsAt(secretsDir(projectRoot), secrets);
}

export async function getServiceApiKey(
  projectRoot: string,
  service: string,
): Promise<string | null> {
  // 1. the machine's key store
  const secrets = await loadSecrets(projectRoot);
  const entry = secrets.services[service];
  if (entry?.apiKey) return entry.apiKey;

  // 2. Environment variable: MOONSHOT_API_KEY, DEEPSEEK_API_KEY, etc.
  const envKey = `${service.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
  if (process.env[envKey]) return process.env[envKey]!;

  return null;
}
