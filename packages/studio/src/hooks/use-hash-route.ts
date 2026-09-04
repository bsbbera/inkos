import { useState, useEffect, useCallback } from "react";

export type HashRoute =
  | { page: "dashboard" }
  | { page: "chat" }
  | { page: "books" }
  | { page: "magazines" }
  | { page: "new" }
  | { page: "run"; runId?: string }
  | { page: "styleguide" }
  | { page: "book"; bookId: string }
  | { page: "book-settings"; bookId: string }
  | { page: "book-create" }
  | { page: "services" }
  | { page: "project-settings" }
  | { page: "service-detail"; serviceId: string }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" }
  | { page: "genres" }
  | { page: "style" }
  | { page: "translation" }
  | { page: "import"; tab?: "chapters" | "canon" | "fanfic" | "spinoff" | "imitation" }
  | { page: "radar" }
  | { page: "doctor" }
  | { page: "mcp" }
  | { page: "setup"; tab?: "machine" | "providers" | "agents" }
  | { page: "audit" }
  | { page: "publication"; issueId: string }
  | { page: "play"; projectId: string }
  | { page: "film"; projectId: string }
  | { page: "flow"; projectId: string }
  | { page: "film-author"; projectId: string }
  | { page: "film-studio"; projectId: string };

function parseHash(hash: string): HashRoute {
  const path = hash.replace(/^#\/?/, "");

  if (!path || path === "/") return { page: "dashboard" };
  if (path === "chat") return { page: "chat" };
  if (path === "config" || path === "services") return { page: "services" };
  if (path === "settings") return { page: "project-settings" };
  if (path === "mcp") return { page: "mcp" };
  if (path === "setup") return { page: "setup" };
  const setupMatch = path.match(/^setup\/(machine|providers|agents)$/);
  if (setupMatch) return { page: "setup", tab: setupMatch[1] as "machine" | "providers" | "agents" };
  if (path === "audit") return { page: "audit" };
  if (path === "books") return { page: "books" };
  if (path === "magazines") return { page: "magazines" };
  if (path === "new") return { page: "new" };
  if (path === "styleguide") return { page: "styleguide" };
  if (path === "run") return { page: "run" };
  if (path === "daemon") return { page: "daemon" };
  if (path === "logs") return { page: "logs" };
  if (path === "genres") return { page: "genres" };
  if (path === "style") return { page: "style" };
  if (path === "radar") return { page: "radar" };
  if (path === "doctor") return { page: "doctor" };

  const runMatch = path.match(/^run\/([^/]+)$/);
  if (runMatch) return { page: "run", runId: decodeURIComponent(runMatch[1]) };

  const publicationMatch = path.match(/^publication\/([^/]+)$/);
  if (publicationMatch) return { page: "publication", issueId: decodeURIComponent(publicationMatch[1]) };
  if (path === "import") return { page: "import" };
  if (path === "translation") return { page: "translation" };
  const importMatch = path.match(/^import\/(chapters|canon|fanfic|spinoff|imitation)$/);
  if (importMatch) return { page: "import", tab: importMatch[1] as "chapters" | "canon" | "fanfic" | "spinoff" | "imitation" };
  if (path === "book/new") return { page: "book-create" };

  const serviceMatch = path.match(/^services\/([^/]+)$/);
  if (serviceMatch) return { page: "service-detail", serviceId: decodeURIComponent(serviceMatch[1]) };

  const bookSettingsMatch = path.match(/^book\/([^/]+)\/settings$/);
  if (bookSettingsMatch) return { page: "book-settings", bookId: decodeURIComponent(bookSettingsMatch[1]) };

  const truthMatch = path.match(/^book\/([^/]+)\/truth$/);
  if (truthMatch) return { page: "truth", bookId: decodeURIComponent(truthMatch[1]) };

  const analyticsMatch = path.match(/^book\/([^/]+)\/analytics$/);
  if (analyticsMatch) return { page: "analytics", bookId: decodeURIComponent(analyticsMatch[1]) };

  const chapterMatch = path.match(/^book\/([^/]+)\/chapter\/(\d+)$/);
  if (chapterMatch) {
    return {
      page: "chapter",
      bookId: decodeURIComponent(chapterMatch[1]),
      chapterNumber: Number(chapterMatch[2]),
    };
  }

  const bookMatch = path.match(/^book\/([^/]+)$/);
  if (bookMatch) return { page: "book", bookId: decodeURIComponent(bookMatch[1]) };

  const playMatch = path.match(/^play\/([^/]+)$/);
  if (playMatch) return { page: "play", projectId: decodeURIComponent(playMatch[1]) };

  const filmMatch = path.match(/^film\/([^/]+)$/);
  if (filmMatch) return { page: "film", projectId: decodeURIComponent(filmMatch[1]) };

  const flowMatch = path.match(/^flow\/([^/]+)$/);
  if (flowMatch) return { page: "flow", projectId: decodeURIComponent(flowMatch[1]) };

  const filmAuthorMatch = path.match(/^film-author\/([^/]+)$/);
  if (filmAuthorMatch) return { page: "film-author", projectId: decodeURIComponent(filmAuthorMatch[1]) };

  const studioFilmMatch = path.match(/^studio\/film\/([^/]+)$/);
  if (studioFilmMatch) return { page: "film-studio", projectId: decodeURIComponent(studioFilmMatch[1]) };

  return { page: "dashboard" };
}

function routeToHash(route: HashRoute): string {
  switch (route.page) {
    case "dashboard": return "#/";
    case "chat": return "#/chat";
    case "books": return "#/books";
    case "magazines": return "#/magazines";
    case "new": return "#/new";
    case "styleguide": return "#/styleguide";
    case "run": return route.runId ? `#/run/${encodeURIComponent(route.runId)}` : "#/run";
    case "audit": return "#/audit";
    case "daemon": return "#/daemon";
    case "logs": return "#/logs";
    case "genres": return "#/genres";
    case "style": return "#/style";
    case "radar": return "#/radar";
    case "doctor": return "#/doctor";
    case "truth": return `#/book/${encodeURIComponent(route.bookId)}/truth`;
    case "analytics": return `#/book/${encodeURIComponent(route.bookId)}/analytics`;
    case "chapter": return `#/book/${encodeURIComponent(route.bookId)}/chapter/${route.chapterNumber}`;
    case "book": return `#/book/${encodeURIComponent(route.bookId)}`;
    case "book-settings": return `#/book/${encodeURIComponent(route.bookId)}/settings`;
    case "book-create": return "#/book/new";
    case "services": return "#/services";
    case "project-settings": return "#/settings";
    case "mcp": return "#/mcp";
    case "setup": return route.tab ? `#/setup/${route.tab}` : "#/setup";
    case "publication": return `#/publication/${encodeURIComponent(route.issueId)}`;
    case "translation": return "#/translation";
    case "import": return route.tab ? `#/import/${route.tab}` : "#/import";
    case "service-detail": return `#/services/${encodeURIComponent(route.serviceId)}`;
    case "play": return `#/play/${encodeURIComponent(route.projectId)}`;
    case "film": return `#/film/${encodeURIComponent(route.projectId)}`;
    case "flow": return `#/flow/${encodeURIComponent(route.projectId)}`;
    case "film-author": return `#/film-author/${encodeURIComponent(route.projectId)}`;
    case "film-studio": return `#/studio/film/${encodeURIComponent(route.projectId)}`;
    default: return "";
  }
}

export { parseHash, routeToHash }; // for testing

export function useHashRoute() {
  const [route, setRouteState] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRouteState(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setRoute = useCallback((newRoute: HashRoute) => {
    // 先同步 React state：无论目标页面是否写 URL，保证页面立刻切换。
    // 之前只在非 hash 页面才 setRouteState，hash 页面完全靠 hashchange 事件回调触发。
    // 但当 URL 没有实际变化时（比如从 services → logs → services，中间的 logs
    // 不写 URL，URL 一直停在 #/services），再次赋值同一个 hash 不会触发 hashchange，
    // React state 就永远停留在 logs，表现为"点不动"。
    setRouteState(newRoute);
    // Every route writes its hash. An allowlist used to decide which pages
    // were worth a URL, so the rest were unreachable by link, unrestorable on
    // reload, and invisible to anything that navigates by address - which is
    // every entry in the command palette.
    const hash = routeToHash(newRoute);
    if (hash && window.location.hash !== hash) {
      window.location.hash = hash;
    }
  }, []);

  const nav = {
    toServices: () => setRoute({ page: "services" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
  };

  return { route, setRoute, nav };
}
