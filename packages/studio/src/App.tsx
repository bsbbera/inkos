import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useHashRoute } from "./hooks/use-hash-route";
import type { HashRoute } from "./hooks/use-hash-route";
import { Dashboard } from "./pages/Dashboard";
import { ChatPage } from "./pages/ChatPage";
import { BookDetail } from "./pages/BookDetail";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
import { ServiceListPage } from "./pages/ServiceListPage";
import { ServiceDetailPage } from "./pages/ServiceDetailPage";
import { ProjectSettings } from "./pages/ProjectSettings";
import { TruthFiles } from "./pages/TruthFiles";
import { DaemonControl } from "./pages/DaemonControl";
import { LogViewer } from "./pages/LogViewer";
import { GenreManager } from "./pages/GenreManager";
import { StyleManager } from "./pages/StyleManager";
import { TranslationManager } from "./pages/TranslationManager";
import { ImportManager } from "./pages/ImportManager";
import { RadarView } from "./pages/RadarView";
import { DoctorView } from "./pages/DoctorView";
import { McpPage } from "./pages/McpPage";
import { SetupPage } from "./pages/SetupPage";
import { AuditPage } from "./pages/AuditPage";
import { PublicationDetail } from "./pages/PublicationDetail";
import { StoryPlayer } from "./pages/StoryPlayer";
import { StoryGraphTree } from "./pages/StoryGraphTree";
import { ProductionsPage } from "./pages/ProductionsPage";
import { StartPage } from "./pages/StartPage";
import { RunPage } from "./pages/RunPage";
import { StyleGuide } from "./pages/StyleGuide";
const FlowView = lazy(() => import("./pages/FlowView"));
const FilmWizard = lazy(() => import("./pages/FilmWizard"));
import { LanguageSelector } from "./pages/LanguageSelector";
import { BookSidebar, BookSidebarToggle } from "./components/chat/BookSidebar";
import { useSSE } from "./hooks/use-sse";
import { useSessionEvents } from "./hooks/use-session-events";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { setAppLanguage, tr } from "./lib/app-language";
import { postApi, useApi } from "./hooks/use-api";
import { Shell, type ShellVariant } from "./components/shell/Shell";
import { crumbsFor } from "./components/shell/crumbs";
import { useShellData, deriveActiveRun } from "./hooks/use-shell-data";

export type { HashRoute as Route } from "./hooks/use-hash-route";

export function deriveActiveBookId(route: HashRoute): string | undefined {
  if ("bookId" in route) return route.bookId;
  return undefined;
}

export function isBookCreateChatRoute(route: HashRoute): boolean {
  return route.page === "book-create";
}

export function deriveStartupGate(input: {
  readonly ready: boolean;
  readonly projectError: string | null;
}): "ready" | "loading" | "error" {
  if (input.ready) return "ready";
  return input.projectError ? "error" : "loading";
}

/**
 * How much of the main column the screen wants.
 *
 * Conversation and audit carry their own columns and their own scrolling; a
 * padded, scrolling stage under them produces two scrollbars and a page that
 * cannot reach its own footer.
 */
export function shellVariantFor(route: HashRoute): ShellVariant {
  switch (route.page) {
    // A conversation is three columns — what it is about, the
    // conversation, what it made — and vermilion.css already draws that
    // grid as `.main.chat`. Chat asked for "flush" instead, a plain flex
    // row, so the grid never reached the element and every column sized
    // itself to its contents.
    case "chat":
    case "book":
    // Starting a book is the same component in a different mode, and it was
    // the one route left in "flush" — a plain flex row, where the three-column
    // grid never reaches the element and every column sizes itself to its
    // contents. Same screen, different shape, for no reason anyone could see.
    case "book-create":
      return "chat";
    case "film-author":
    case "audit":
    case "film-studio":
    case "flow":
      return "flush";
    default:
      return "stage";
  }
}

export function App() {
  const { route, setRoute } = useHashRoute();
  const sse = useSSE();
  const { theme } = useTheme();
  const { t, lang: currentLang } = useI18n();
  const { data: project, error: projectError, refetch: refetchProject } = useApi<{ language: string; languageExplicit: boolean }>("/project");
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [ready, setReady] = useState(false);

  const { books, publications, waiting, tails, modelLabel, paletteExtra } = useShellData();

  // 全局语言同步：app-language 是模块级单例，供用不了 hook 的代码（lib 纯函数、
  // store slice）读取。这里在渲染期同步赋值，让子组件在同一次渲染里调用 tr() 时
  // 就读到正确语言（只用 effect 的话，effect 要等本次渲染提交后才执行，本次渲染
  // 里的 tr() 会读到旧语言）。赋值是幂等的模块变量写入，StrictMode 重复渲染无影
  // 响；下面的 effect 在语言加载完成和切换时再设置一次，保证提交后的值也正确。
  setAppLanguage(currentLang);
  useEffect(() => {
    setAppLanguage(currentLang);
  }, [currentLang]);

  useEffect(() => {
    if (project) {
      if (!project.languageExplicit) {
        setShowLanguageSelector(true);
      }
      setReady(true);
    }
  }, [project]);

  useSessionEvents(sse, route, setRoute);

  const nav = useMemo(() => ({
    toDashboard: () => setRoute({ page: "dashboard" }),
    toChat: () => setRoute({ page: "chat" }),
    toBooks: () => setRoute({ page: "books" }),
    toBook: (bookId: string) => setRoute({ page: "book", bookId }),
    toBookSettings: (bookId: string) => setRoute({ page: "book-settings", bookId }),
    toBookCreate: () => setRoute({ page: "book-create" }),
    toChapter: (bookId: string, chapterNumber: number) =>
      setRoute({ page: "chapter", bookId, chapterNumber }),
    toAnalytics: (bookId: string) => setRoute({ page: "analytics", bookId }),
    toServices: () => setRoute({ page: "services" }),
    toProjectSettings: () => setRoute({ page: "project-settings" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
    toTruth: (bookId: string) => setRoute({ page: "truth", bookId }),
    toDaemon: () => setRoute({ page: "daemon" }),
    toLogs: () => setRoute({ page: "logs" }),
    toGenres: () => setRoute({ page: "genres" }),
    toStyle: () => setRoute({ page: "style" }),
    toTranslation: () => setRoute({ page: "translation" }),
    toImport: (tab?: "chapters" | "canon" | "fanfic" | "spinoff" | "imitation") => setRoute({ page: "import", ...(tab ? { tab } : {}) }),
    toRadar: () => setRoute({ page: "radar" }),
    toDoctor: () => setRoute({ page: "doctor" }),
    toMcp: () => setRoute({ page: "mcp" }),
    toSetup: () => setRoute({ page: "setup" }),
    toAgents: () => setRoute({ page: "setup", tab: "agents" }),
    toAudit: () => setRoute({ page: "audit" }),
    toNew: () => setRoute({ page: "new" }),
    toRun: () => setRoute({ page: "run" }),
    toPublication: (issueId: string) => setRoute({ page: "publication", issueId }),
    toPlay: (projectId: string) => setRoute({ page: "play", projectId }),
    toFilm: (projectId: string) => setRoute({ page: "film", projectId }),
    toFlow: (projectId: string) => setRoute({ page: "flow", projectId }),
    toFilmAuthor: (projectId: string) => setRoute({ page: "film-author", projectId }),
    toFilmStudio: (projectId: string) => setRoute({ page: "film-studio", projectId }),
  }), [setRoute]);

  const startupGate = deriveStartupGate({ ready, projectError });

  const activeRun = useMemo(() => deriveActiveRun(sse.messages), [sse.messages]);

  const crumbs = useMemo(
    () =>
      crumbsFor(route, {
        book: (id) => books.find((b) => b.id === id)?.title,
        publication: (id) => publications.find((p) => p.id === id)?.title,
      }),
    [route, books, publications],
  );

  if (startupGate === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-destructive/30 bg-destructive/5 p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-destructive">无法加载项目配置 / Failed to load project config</h1>
            <p className="mt-2 text-sm text-muted-foreground break-all">{projectError}</p>
          </div>
          {/* 项目配置没加载出来，语言未知，所以这屏中英双语并排展示。 */}
          <p className="text-sm text-muted-foreground">
            请检查项目根目录下的 inkos.json 是否存在且为合法 JSON，然后重试。
            <br />
            Check that inkos.json in the project root exists and is valid JSON, then retry.
          </p>
          <button
            type="button"
            onClick={() => refetchProject()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            重试 / Retry
          </button>
        </div>
      </div>
    );
  }

  if (startupGate === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (showLanguageSelector) {
    return (
      <LanguageSelector
        onSelect={async (lang) => {
          await postApi("/project/language", { language: lang });
          setShowLanguageSelector(false);
          refetchProject();
        }}
      />
    );
  }

  return (
    <Shell
      route={route}
      setRoute={setRoute}
      crumbs={crumbs}
      variant={shellVariantFor(route)}
      tails={tails}
      run={activeRun ? { what: activeRun.what, where: activeRun.where } : null}
      model={modelLabel}
      waiting={waiting}
      paletteExtra={paletteExtra}
    >
      {/*
        * The server going away used to be invisible: a run in flight simply
        * stopped producing events and the screen sat on "Thinking…" with no
        * way to tell a dead backend from a slow model. The browser retries
        * the stream by itself, so this says so and then clears itself.
        */}
      {sse.lost ? (
        <div role="status" className="fail" style={{ marginBottom: 16 }}>
          Lost the connection to Quire. Anything already running keeps going; this reconnects on its own.
        </div>
      ) : null}

      {route.page === "dashboard" && (
        <Dashboard nav={nav} sse={sse} books={books} publications={publications} run={activeRun} />
      )}
      {route.page === "books" && <ProductionsPage kind="books" nav={nav} />}
      {route.page === "magazines" && <ProductionsPage kind="magazines" nav={nav} />}
      {route.page === "new" && <StartPage nav={nav} />}
      {route.page === "run" && <RunPage sse={sse} run={activeRun} />}
      {route.page === "styleguide" && <StyleGuide />}

      {isBookCreateChatRoute(route) && (
        <ChatPage mode="book-create" nav={nav} theme={theme} t={t} sse={sse} />
      )}
      {route.page === "chat" && (
        <ChatPage mode="project-chat" nav={nav} theme={theme} t={t} sse={sse} />
      )}
      {route.page === "book" && (
        <>
          <ChatPage activeBookId={route.bookId} mode="book" nav={nav} theme={theme} t={t} sse={sse} />
          <BookSidebar bookId={route.bookId} theme={theme} t={t} sse={sse} />
          <BookSidebarToggle bookId={route.bookId} theme={theme} t={t} sse={sse} />
        </>
      )}
      {route.page === "book-settings" && (
        <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} sse={sse} />
      )}
      {route.page === "chapter" && (
        <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} t={t} />
      )}
      {route.page === "analytics" && <Analytics bookId={route.bookId} t={t} />}
      {route.page === "services" && <ServiceListPage nav={nav} />}
      {route.page === "project-settings" && <ProjectSettings nav={nav} theme={theme} t={t} />}
      {route.page === "service-detail" && <ServiceDetailPage serviceId={route.serviceId} nav={nav} />}
      {route.page === "truth" && <TruthFiles bookId={route.bookId} t={t} />}
      {route.page === "daemon" && <DaemonControl t={t} sse={sse} />}
      {route.page === "logs" && <LogViewer t={t} />}
      {route.page === "genres" && <GenreManager nav={nav} theme={theme} t={t} />}
      {route.page === "style" && <StyleManager nav={nav} theme={theme} t={t} />}
      {route.page === "translation" && <TranslationManager nav={nav} theme={theme} t={t} />}
      {route.page === "import" && <ImportManager nav={nav} theme={theme} t={t} initialTab={route.tab} />}
      {route.page === "radar" && <RadarView nav={nav} theme={theme} t={t} />}
      {route.page === "doctor" && <DoctorView t={t} />}
      {route.page === "setup" && <SetupPage nav={nav} {...(route.tab ? { tab: route.tab } : {})} />}
      {route.page === "mcp" && <McpPage nav={nav} theme={theme} t={t} />}
      {route.page === "audit" && <AuditPage sse={sse} />}
      {route.page === "publication" && (
        <PublicationDetail issueId={route.issueId} nav={nav} />
      )}
      {route.page === "play" && <StoryPlayer projectId={route.projectId} nav={nav} theme={theme} t={t} />}
      {route.page === "film" && <StoryGraphTree projectId={route.projectId} nav={nav} theme={theme} t={t} />}
      {route.page === "film-studio" && (
        <Suspense fallback={<div className="p-6 text-sm">{tr("加载创作向导…", "Loading creation wizard…")}</div>}>
          <FilmWizard projectId={route.projectId} nav={nav} theme={theme} t={t} sse={sse} />
        </Suspense>
      )}
      {route.page === "flow" && (
        <Suspense fallback={<div className="p-6 text-sm">{tr("加载流程图…", "Loading flow view…")}</div>}>
          <FlowView projectId={route.projectId} nav={nav} theme={theme} t={t} />
        </Suspense>
      )}
    </Shell>
  );
}
