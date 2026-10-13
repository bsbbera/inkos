import { join } from "node:path";

/*
 * Where this app keeps its settings.
 *
 * The workspace is the work - issues, books, research - and dev and prod
 * share it. Settings are each app's own: models and routing (quire.json),
 * keys, chat sessions, tasks, the log. They used to live in the workspace,
 * so the two apps shared one set, and a run one of them started was called
 * interrupted the moment the other booted. The launcher names the folder in
 * QUIRE_CONFIG_DIR; without it (the CLI on a project) settings stay in the
 * project, as they always have.
 */
const own = (): string => process.env.QUIRE_CONFIG_DIR?.trim() || "";

/** The folder holding quire.json and .env. */
export const configDir = (root: string): string => own() || root;

/** quire.json: models, routing, research search, budget. */
export const configFile = (root: string): string => join(configDir(root), "quire.json");

/** The app's own state: sessions, tasks, secrets, the log. */
export const stateDir = (root: string): string => own() || join(root, ".quire");
