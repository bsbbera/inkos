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
  } = {},
): Crumb[] {
  const home: Crumb = { label: "Home", route: { page: "dashboard" } };
  const books: Crumb = { label: "Books", route: { page: "books" } };
  const magazines: Crumb = { label: "Magazine", route: { page: "magazines" } };

  const book = (id: string): Crumb => ({
    label: names.book?.(id) ?? id,
    route: { page: "book", bookId: id },
  });

  switch (route.page) {
    case "dashboard": return [{ label: "Home" }];
    case "run": return [home, { label: "Run" }];
    case "chat": return [home, { label: "Chat" }];
    case "new": return [home, { label: "Start something" }];
    case "book-create": return [home, { label: "New book" }];
    case "books": return [home, { label: "Books" }];
    case "magazines": return [home, { label: "Magazine" }];
    case "audit": return [home, { label: "Audit" }];
    case "styleguide": return [home, { label: "Style guide" }];

    case "book": return [books, { label: names.book?.(route.bookId) ?? route.bookId }];
    case "book-settings": return [book(route.bookId), { label: "Settings" }];
    case "truth": return [book(route.bookId), { label: "Truth files" }];
    case "analytics": return [book(route.bookId), { label: "Analytics" }];
    case "chapter": return [book(route.bookId), { label: `Chapter ${route.chapterNumber}` }];
    case "play": return [books, { label: "Play" }];
    case "film": return [books, { label: "Story graph" }];
    case "flow": return [books, { label: "Flow" }];
    case "film-studio": return [books, { label: "Film studio" }];
    case "film-author": return [home, { label: "Film" }];

    case "publication":
      return [magazines, { label: names.publication?.(route.issueId) ?? route.issueId }];

    case "services": return [home, { label: "Model config" }];
    case "service-detail": return [{ label: "Model config", route: { page: "services" } }, { label: route.serviceId }];
    case "project-settings": return [home, { label: "Project" }];
    case "daemon": return [home, { label: "Daemon" }];
    case "logs": return [home, { label: "Logs" }];
    case "genres": return [home, { label: "Genres" }];
    case "style": return [home, { label: "Style" }];
    case "translation": return [home, { label: "Translation" }];
    case "import": return [home, { label: "Import" }];
    case "radar": return [home, { label: "Radar" }];
    case "doctor": return [home, { label: "Doctor" }];
    case "mcp": return [home, { label: "MCP" }];
    case "setup": return [home, { label: "Setup" }];
  }
}
