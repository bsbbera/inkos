/**
 * Finds publication definitions: the ones Quire ships, and the ones the user
 * wrote.
 *
 * Modelled on how skills are discovered, and for the same reason — a new
 * publication type should be a file you drop in a folder, not a release. A
 * definition in the workspace wins over a builtin of the same id, so a user
 * can adjust the magazine's own law without forking anything.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PublicationDefinition, PublicationDefinitionSource } from "./types.js";
import { validateDefinition } from "./types.js";

export interface PublicationDiagnostic {
  readonly path: string;
  readonly message: string;
}

export interface PublicationRegistry {
  readonly definitions: ReadonlyArray<PublicationDefinitionSource>;
  /** Files that looked like definitions but could not be used. */
  readonly diagnostics: ReadonlyArray<PublicationDiagnostic>;
}

/**
 * Definitions ship as data, not compiled output, so they live beside skills/
 * and genres/ at the package root rather than under src/. Resolving two levels
 * up from this file lands on the package root from both src/ and dist/.
 */
const builtinDir = () => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "publications");

/** Where a user's own definitions live, inside their workspace. */
export const userDefinitionsDir = (projectRoot: string) =>
  join(projectRoot, "publications");

async function loadDir(
  dir: string,
  source: "builtin" | "user",
): Promise<{ found: PublicationDefinitionSource[]; diagnostics: PublicationDiagnostic[] }> {
  const found: PublicationDefinitionSource[] = [];
  const diagnostics: PublicationDiagnostic[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // A missing user directory is the normal case, not a problem to report.
    return { found, diagnostics };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const path = join(dir, entry);
    try {
      const parsed = JSON.parse(await readFile(path, "utf-8")) as unknown;
      const problems = validateDefinition(parsed);
      if (problems.length > 0) {
        diagnostics.push({ path, message: problems.join("; ") });
        continue;
      }
      found.push({ definition: parsed as PublicationDefinition, source, path });
    } catch (error) {
      // One unparseable file must not cost the user every other type.
      diagnostics.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { found, diagnostics };
}

export async function loadPublicationRegistry(projectRoot: string): Promise<PublicationRegistry> {
  const builtin = await loadDir(builtinDir(), "builtin");
  const user = await loadDir(userDefinitionsDir(projectRoot), "user");

  // User definitions are applied second so that an id defined in both places
  // resolves to the user's copy.
  const byId = new Map<string, PublicationDefinitionSource>();
  for (const item of [...builtin.found, ...user.found]) {
    byId.set(item.definition.id, item);
  }

  return {
    definitions: [...byId.values()].sort((a, b) => a.definition.label.localeCompare(b.definition.label)),
    diagnostics: [...builtin.diagnostics, ...user.diagnostics],
  };
}

export async function findPublicationDefinition(
  projectRoot: string,
  id: string,
): Promise<PublicationDefinition | undefined> {
  const registry = await loadPublicationRegistry(projectRoot);
  return registry.definitions.find((item) => item.definition.id === id)?.definition;
}
