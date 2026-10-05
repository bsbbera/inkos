/*
 * Which connections the app offers, and of which kind: an API reached with a
 * key, a CLI installed on this machine, or a server running locally.
 *
 * Data, not code (providers.json at the package root). Adding a connection the
 * endpoint registry already knows is one line there, or one line in
 * ~/.quire/providers.json without a rebuild. The forty-odd endpoint files stay
 * behind this list: they say how to reach a vendor, this says which ones are
 * put in front of a person.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_CONFIG_DIR } from "../utils/llm-env.js";

export type ConnectionKind = "api" | "cli" | "local";

export interface CatalogueEntry {
  readonly id: string;
  readonly kind: ConnectionKind;
  readonly label: string;
}

const KINDS = new Set<ConnectionKind>(["api", "cli", "local"]);

async function readEntries(path: string): Promise<CatalogueEntry[]> {
  try {
    const body = JSON.parse(await readFile(path, "utf-8")) as { providers?: unknown };
    return (Array.isArray(body.providers) ? body.providers : []).filter(
      (p): p is CatalogueEntry => !!p && typeof p.id === "string" && KINDS.has(p.kind) && typeof p.label === "string",
    );
  } catch {
    return [];
  }
}

/** The shipped list, then the machine's own entries over it by id. */
export async function loadProviderCatalogue(home = GLOBAL_CONFIG_DIR): Promise<CatalogueEntry[]> {
  const shipped = await readEntries(fileURLToPath(new URL("../../providers.json", import.meta.url)));
  const local = await readEntries(join(home, "providers.json"));
  const byId = new Map(shipped.map((p) => [p.id, p]));
  for (const p of local) byId.set(p.id, p);
  return [...byId.values()];
}
