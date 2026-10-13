import { join } from "node:path";

/*
 * core/src/utils/config-dir.ts, for the server. Kept here rather than imported
 * from the core barrel because the server's tests replace that barrel whole.
 * One rule: the app's own settings folder when the launcher names one
 * (QUIRE_CONFIG_DIR), else the project, as before.
 */
const own = (): string => process.env.QUIRE_CONFIG_DIR?.trim() || "";
export const configDir = (root: string): string => own() || root;
export const configFile = (root: string): string => join(configDir(root), "quire.json");
export const stateDir = (root: string): string => own() || join(root, ".quire");
