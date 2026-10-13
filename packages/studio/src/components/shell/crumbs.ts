/*
 * What the topbar says you are looking at.
 *
 * One table, so a screen cannot disagree with the rail about where it lives.
 * The trail is short on purpose - at most parent / here - because a crumb
 * chain deeper than two on a two-level app is decoration.
 */
import type { HashRoute } from "../../hooks/use-hash-route";
import type { Crumb } from "./Topbar";

export function crumbsFor(
  route: HashRoute,
  names: {
    /** Titles for ids, so a crumb reads "The Lamp Room" and not "bk_7f21". */
    readonly book?: (id: string) => string | undefined;
    readonly publication?: (id: string) => string | undefined;
    /** Any work's title, for kinds that are neither. */
    readonly work?: (kind: string, id: string) => string | undefined;
  } = {},
): Crumb[] {
  const home: Crumb = { label: "Home", route: { page: "dashboard" } };
  const library: Crumb = { label: "Library", route: { page: "library" } };
  const titleOf = (kind: string, id: string) =>
    /* `||`, not `??`: an issue has an empty title until its plan names it. */
    (kind === "book" ? names.book?.(id) : kind === "publication" ? names.publication?.(id) : undefined)
    || names.work?.(kind, id) || id;
  const audit: Crumb = { label: "Audit", route: { page: "audit" } };
  /* A work's crumb opens it in Audit, where a work is worked. */
  const work = (kind: string, id: string): Crumb => ({
    label: titleOf(kind, id),
    route: { page: "audit", kind, id },
  });

  const book = (id: string): Crumb => ({ label: titleOf("book", id), route: { page: "book", bookId: id } });

  switch (route.page) {
    case "dashboard": return [{ label: "Home" }];
    case "house": return [home, { label: "House" }];
    case "brand": return [home, { label: "Brand" }];
    case "run": return [home, { label: "Run" }];
    case "chat": return [home, { label: "Chat" }];
    case "new": return [home, { label: "Start something" }];
    case "book-create": return [home, { label: "New book" }];
    case "library": return [home, { label: "Library" }];
    case "audit": return route.kind && route.id
      ? [audit, { label: titleOf(route.kind, route.id) }]
      : [home, { label: "Audit" }];
    case "publication": return [library, { label: titleOf("publication", route.issueId) }];
    case "gallery": return [home, { label: "Gallery" }];
    case "taste": return [home, { label: "Taste" }];
    case "styleguide": return [home, { label: "Style guide" }];
    case "audit-packs": return [home, { label: "Audit checks" }];

    case "book": return [library, { label: titleOf("book", route.bookId) }];
    case "book-settings": return [book(route.bookId), { label: "Settings" }];
    case "truth": return [book(route.bookId), { label: "Truth files" }];
    case "analytics": return [book(route.bookId), { label: "Analytics" }];
    case "chapter": return [book(route.bookId), { label: `Chapter ${route.chapterNumber}` }];
    case "play": return [work("play", route.projectId), { label: "Play" }];
    case "film": return [work("interactive-film", route.projectId), { label: "Story graph" }];
    case "flow": return [work("interactive-film", route.projectId), { label: "Flow" }];
    case "film-studio": return [work("interactive-film", route.projectId), { label: "Film studio" }];
    case "film-author": return [home, { label: "Film" }];


    // One screen with tabs, so one crumb: the tab bar says which part.
    case "project-settings": return [home, { label: "Settings" }];
    case "daemon": return [home, { label: "Daemon" }];
    case "logs": return [home, { label: "Logs" }];
    case "genres": return [home, { label: "Genres" }];
    case "style": return [home, { label: "Style" }];
    case "translation": return [home, { label: "Translation" }];
    case "import": return [home, { label: "Import" }];
    case "radar": return [home, { label: "Radar" }];
    case "doctor": return [home, { label: "Doctor" }];
    case "mcp": return [home, { label: "Settings" }];
    case "setup": return [home, { label: "Settings" }];
  }
}
