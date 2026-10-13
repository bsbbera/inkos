/*
 * The rail's information architecture, ported from analysis/mock/_rail.py.
 *
 * Three groups and a fourth that is honest about not being built yet. The
 * order is the mock's, and the `owns` lists are its OWNER map: a screen that
 * does not have a rail entry of its own still has to light one up, or the user
 * loses track of where they are the moment they open a chapter.
 */
import type { IconName } from "../ui/icon";
import type { HashRoute } from "../../hooks/use-hash-route";

export interface NavItem {
  readonly id: string;
  readonly icon: IconName;
  readonly label: string;
  readonly route: HashRoute;
  /** Pages that live under this item rather than owning a rail entry. */
  readonly owns?: readonly HashRoute["page"][];
  /** Drawn in the mockups, not built. Shown, dimmed, so the plan stays visible. */
  readonly speculative?: boolean;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
  {
    label: "Working",
    items: [
      { id: "home", icon: "home", label: "Home", route: { page: "dashboard" } },
      {
        id: "chat",
        icon: "chat",
        label: "Chat",
        route: { page: "chat" },
        /* "Start something" is its own button and lights itself; the rail
           marking Chat while the page said "Start something" read as lost. */
        owns: ["book-create", "film-author"],
      },
      {
        /* The bookshelf: everything made, grouped by kind. A finished work
           shows its cover; anything still in progress opens in Audit. */
        id: "library",
        icon: "book",
        label: "Library",
        route: { page: "library" },
        owns: [
          "book",
          "publication",
          "truth",
          "chapter",
          "book-settings",
          "analytics",
          "play",
          "film",
          "film-studio",
          "flow",
        ],
      },
      /* Where the work is done: files and pages, progress, findings and the
         manuscript itself. */
      { id: "audit", icon: "pulse", label: "Audit", route: { page: "audit" } },
      { id: "gallery", icon: "grid", label: "Gallery", route: { page: "gallery" } },
      /* What every issue shares: masthead, type, margins, rules, grids. */
      { id: "house", icon: "layers", label: "House", route: { page: "house" } },
      /* The brand new issues are held to, and its design system. */
      { id: "brand", icon: "drop", label: "Brand", route: { page: "brand" } },
    ],
  },
  {
    label: "System",
    items: [
      { id: "genres", icon: "layers", label: "Genres", route: { page: "genres" } },
      { id: "audit-packs", icon: "target", label: "Audit checks", route: { page: "audit-packs" } },
      {
        id: "setup",
        icon: "plug",
        label: "Settings",
        route: { page: "setup" },
        /* Machine, models, agents, project and MCP are one page with tabs:
           five rail entries for "how is this set up" was how a person lost
           the model picker. */
        owns: ["project-settings", "mcp"],
      },
      { id: "daemon", icon: "cpu", label: "Daemon", route: { page: "daemon" }, owns: ["run"] },
      { id: "logs", icon: "list", label: "Logs", route: { page: "logs" } },
    ],
  },
  {
    label: "Tools",
    items: [
      { id: "translation", icon: "type", label: "Translation", route: { page: "translation" } },
      { id: "style", icon: "drop", label: "Style", route: { page: "style" } },
      { id: "taste", icon: "heart", label: "Taste", route: { page: "taste" } },
      { id: "import", icon: "file", label: "Import", route: { page: "import" } },
      { id: "radar", icon: "chart", label: "Radar", route: { page: "radar" } },
      { id: "doctor", icon: "checkC", label: "Doctor", route: { page: "doctor" } },
      { id: "styleguide", icon: "grid", label: "Style guide", route: { page: "styleguide" } },
    ],
  },
];

/**
 * Which rail entry a route lights up. Falls back to the page id so a route
 * that owns its own entry needs no bookkeeping.
 */
export function activeNavId(route: HashRoute): string {
  for (const group of NAV) {
    for (const item of group.items) {
      if (item.route.page === route.page) return item.id;
      if (item.owns?.includes(route.page)) return item.id;
    }
  }
  return route.page;
}
