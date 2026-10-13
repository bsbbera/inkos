/*
 * The frame every screen sits in.
 *
 * Rail in column one, everything else in column two. The rail answers "where
 * am I" and "what is the machine doing"; the topbar answers "what needs me".
 * Both are answered before any screen renders a single word of its own, which
 * is the whole point of having a shell.
 *
 * Three variants, because three shapes of screen exist and pretending
 * otherwise is what produced pages that scrolled twice or not at all:
 *
 *   stage  the default. Padded, scrolls, content is a document.
 *   flush  topbar, then the screen owns the remaining height and its own
 *          scrolling - audit's three columns, the reader.
 *   chat   the screen owns the whole main column including its topbar,
 *          because the conversation sits between two of its own columns.
 */
import type { ReactNode } from "react";
import type { HashRoute } from "../../hooks/use-hash-route";
import { Rail, type RailRun } from "./Rail";
import { Topbar, type Crumb } from "./Topbar";
import { Palette, type PaletteEntry, usePaletteHotkey } from "./Palette";
import { NowDrawer, NowPill, NowSlot, type NowState } from "./NowDrawer";
import { Icon, IconSprite } from "../ui/icon";
import { ToastHost, useListKeys } from "../ui/vermilion";
import { AskHost } from "../ConfirmDialog";
import { useCallback, useEffect, useState } from "react";
import { useResumeTimer } from "../../lib/resume-later";

export type ShellVariant = "stage" | "flush" | "chat";

export function Shell({
  route,
  setRoute,
  crumbs,
  variant = "stage",
  tails,
  run,
  model,
  waiting,
  paletteExtra,
  topbarExtras,
  now,
  children,
}: {
  readonly route: HashRoute;
  readonly setRoute: (r: HashRoute) => void;
  readonly crumbs: readonly Crumb[];
  readonly variant?: ShellVariant;
  readonly tails?: Readonly<Record<string, string | number | undefined>>;
  readonly run?: RailRun | null;
  readonly model?: { readonly text: string; readonly full: string } | null;
  readonly waiting?: number;
  readonly paletteExtra?: readonly PaletteEntry[];
  /** Controls that belong to this screen, sitting left of the standing pills. */
  readonly topbarExtras?: ReactNode;
  /** Everything running, for the Now pill and drawer on every screen. */
  readonly now?: NowState;
  readonly children: ReactNode;
}) {
  const [nowOpen, setNowOpen] = useState(false);
  const openNow = useCallback(() => setNowOpen(true), []);
  /* A drawer is a glance: walking anywhere, or Escape, puts it away. */
  useEffect(() => { setNowOpen(false); }, [route]);
  useEffect(() => {
    if (!nowOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNowOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nowOpen]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  usePaletteHotkey(openPalette);
  useResumeTimer();
  useListKeys();

  /* Whether the rail is open. A preference about this monitor, so it is kept
     here rather than on the server: 196px matters on a laptop and does not on
     a 30in panel, and the same account uses both. */
  const [railOpen, setRailOpen] = useState(() => {
    try { return localStorage.getItem("quire.rail") !== "off"; } catch { return true; }
  });
  const toggleRail = useCallback(() => {
    setRailOpen((was) => {
      try { localStorage.setItem("quire.rail", was ? "off" : "on"); } catch { /* private mode */ }
      return !was;
    });
  }, []);

  return (
    <div className={railOpen ? "screen embedded" : "screen embedded rail-off"}>
      <IconSprite />
      <Rail route={route} setRoute={setRoute} tails={tails} run={run} onOpenPalette={openPalette} {...(now ? { onRun: openNow } : {})} />

      <div className={variant === "chat" ? "main chat" : "main"}>
        {variant === "chat" ? (
          <>
            {/* Chat draws no topbar, so the toggle that lives there is not on
                this screen — and a rail closed on audit would be unreopenable
                the moment you walked into a conversation. */}
            {railOpen ? null : (
              <button
                type="button"
                className="btn btn-quiet btn-sm absolute top-2 left-2 z-12"
                aria-label="Open the rail"
                title="Open the rail"
                onClick={toggleRail}
              >
                <Icon name="list" size={15} />
              </button>
            )}
            {/* No app topbar here; the conversation's own topbar carries the
                Now pill (NowPillHere), opening the same drawer. */}
            <NowSlot.Provider value={now ? { now, open: openNow } : null}>
              {children}
            </NowSlot.Provider>
          </>
        ) : (
          <>
            <Topbar
              crumbs={crumbs}
              setRoute={setRoute}
              model={model}
              waiting={waiting}
              onOpenPalette={openPalette}
              railOpen={railOpen}
              onToggleRail={toggleRail}
              {...(now ? { nowPill: <NowPill now={now} onOpen={openNow} /> } : {})}
            >
              {topbarExtras}
            </Topbar>
            {variant === "flush" ? (
              <div className="stage-flush">{children}</div>
            ) : (
              /* The measure lives here, not on each page. Every screen used to
                 carry its own max-width utility and they disagreed - 4xl on
                 most, 6xl on translation, 1400px on the reader - so the same
                 app changed column width as you walked through it. */
              <div className="stage">
                {/* Keyed on the page, not its parameters: arriving at a screen
                    replays its settle (motion.css), picking another work on the
                    same screen does not throw away what is open. */}
                <div className="wrap route-enter" key={route.page}>{children}</div>
              </div>
            )}
          </>
        )}
      </div>

      <Palette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        setRoute={setRoute}
        extra={paletteExtra}
      />
      {now && nowOpen ? <NowDrawer now={now} waiting={waiting ?? 0} onClose={() => setNowOpen(false)} /> : null}
      <ToastHost />
      <AskHost />
    </div>
  );
}
