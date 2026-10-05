import type { ActionSource, RequestedIntent } from "@actalk/quire-core";

const CONFIRMED_PRODUCTION_INTENTS: ReadonlySet<RequestedIntent> = new Set([
  "create_book",
  "write_next",
  "short_run",
  "play_start",
  "generate_cover",
  "fanfic_init",
  "continuation_import",
  "spinoff_create",
  "style_imitation",
  "script_create",
  "storyboard_create",
  "interactive_film_create",
  "translation_create",
  // A magazine issue is a long production run like the rest. Left out of this
  // set it ran as an ordinary chat round, which the app used to cancel the
  // moment another conversation was opened, so a confirmed magazine died a few
  // seconds in and wrote nothing. (storyboard_art is deliberately absent: the
  // confirmed executor has no branch for it, so it stays a chat-run tool.)
  "publication_create",
  "draft_structure",
  "connect_choice",
  "remove_node",
]);

/** Free text has no execution authority; only explicit UI/slash actions do. */
export function isConfirmedProductionAction(
  actionSource: ActionSource,
  requestedIntent: RequestedIntent | undefined,
): boolean {
  if (!requestedIntent || !CONFIRMED_PRODUCTION_INTENTS.has(requestedIntent)) return false;
  if (requestedIntent === "write_next") {
    return actionSource === "button" || actionSource === "slash" || actionSource === "quick-action";
  }
  return actionSource === "button" || actionSource === "slash";
}
