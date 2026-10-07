/*
 * Which connections the app offers, and of which kind: an API reached with a
 * key, a CLI installed on this machine, or a server running locally.
 *
 * Data, not code (providers.json at the package root). Adding a connection the
 * endpoint registry already knows is one line there, or one line in
 * ~/.quire/providers.json without a rebuild. The forty-odd endpoint files stay
 * behind this list: they say how to reach a vendor, this says which ones are
 * put in front of a person.
 *
 * A cli entry also carries what the shim needs to run it (protocol, bins,
 * acpArgs, fallback). The shim reads the same file, so a CLI that speaks ACP is
 * added by one entry and no code, on either side (20 §6 step 1).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_CONFIG_DIR } from "../utils/llm-env.js";

export type ConnectionKind = "api" | "cli" | "local";
export type CliProtocol = "acp" | "plain" | "claude-json" | "codex-json";

export interface CatalogueEntry {
  readonly id: string;
  readonly kind: ConnectionKind;
  readonly label: string;
  /** cli only: how the shim talks to it. */
  readonly protocol?: CliProtocol;
  /** cli only: where the binary may be, first found wins. */
  readonly bins?: ReadonlyArray<string>;
  /** acp only: arguments that start the CLI in ACP mode. */
  readonly acpArgs?: ReadonlyArray<string>;
  /** cli only: model ids offered while the live list is unavailable. */
  readonly fallback?: ReadonlyArray<string>;
}

const KINDS = new Set<ConnectionKind>(["api", "cli", "local"]);

function readEntries(path: string): CatalogueEntry[] {
  try {
    const body = JSON.parse(readFileSync(path, "utf-8")) as { providers?: unknown };
    return (Array.isArray(body.providers) ? body.providers : []).filter(
      (p): p is CatalogueEntry => !!p && typeof p.id === "string" && KINDS.has(p.kind) && typeof p.label === "string",
    );
  } catch {
    return [];
  }
}

/**
 * The shipped list, then the machine's own entries over it by id.
 *
 * Field by field, so a local entry that only renames a CLI keeps the shipped
 * bins and protocol. Sync because the endpoint registry is built at import.
 */
// ponytail: tests never read the real home; pass `home` to exercise the file.
export function readProviderCatalogue(home: string | null = process.env.VITEST ? null : GLOBAL_CONFIG_DIR): CatalogueEntry[] {
  const shipped = readEntries(fileURLToPath(new URL("../../providers.json", import.meta.url)));
  const local = home ? readEntries(join(home, "providers.json")) : [];
  const byId = new Map(shipped.map((p) => [p.id, p]));
  for (const p of local) byId.set(p.id, { ...byId.get(p.id), ...p });
  return [...byId.values()];
}

export async function loadProviderCatalogue(home?: string | null): Promise<CatalogueEntry[]> {
  return readProviderCatalogue(home);
}
