/*
 * The command palette.
 *
 * Charcoal, because it is a surface you work inside rather than a menu you
 * read. Ctrl/Cmd K from anywhere; it navigates for now, and takes actions once
 * there is an action registry to take them from.
 *
 * Every rail destination is in here, plus every open production, so the two
 * things the old sidebar's expandable trees were for - finding a book, finding
 * an issue - survive the tree being deleted.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { HashRoute } from "../../hooks/use-hash-route";
import { Icon, type IconName } from "../ui/icon";
import { NAV } from "./nav";

export interface PaletteEntry {
  readonly id: string;
  readonly icon: IconName;
  readonly label: string;
  readonly hint?: string;
  readonly group: string;
  readonly route: HashRoute;
}

export function usePaletteHotkey(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/** The rail, flattened. Screens contribute the rest through `extra`. */
export function navEntries(): PaletteEntry[] {
  return NAV.flatMap((g) =>
    g.items.map((it) => ({
      id: `nav:${it.id}`,
      icon: it.icon,
      label: it.label,
      group: g.label,
      route: it.route,
    })),
  );
}

export function Palette({
  open,
  onClose,
  setRoute,
  extra = [],
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly setRoute: (r: HashRoute) => void;
  /** Live destinations - books, issues - that only the app knows about. */
  readonly extra?: readonly PaletteEntry[];
}) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => [...extra, ...navEntries()], [extra]);
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? all.filter(
          (e) =>
            e.label.toLowerCase().includes(needle) || e.hint?.toLowerCase().includes(needle),
        )
      : all;
    return matched.slice(0, 40);
  }, [all, q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setAt(0);
    inputRef.current?.focus();
  }, [open]);

  // The selection has to survive the list shrinking under it as the user types.
  useEffect(() => {
    setAt((i) => Math.min(i, Math.max(0, hits.length - 1)));
  }, [hits.length]);

  if (!open) return null;

  const go = (e: PaletteEntry | undefined) => {
    if (!e) return;
    setRoute(e.route);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[at]);
    }
  };

  /* Groups render in first-seen order so live results - the books someone is
     actually working on - sit above the fixed rail destinations. */
  const groups: { label: string; items: PaletteEntry[] }[] = [];
  for (const hit of hits) {
    const found = groups.find((g) => g.label === hit.group);
    if (found) found.items.push(hit);
    else groups.push({ label: hit.group, items: [hit] });
  }

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search or run a command">
        <div className="q">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to…"
            aria-label="Search or run a command"
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="grp scroll-y" style={{ maxHeight: "52vh" }}>
          {hits.length === 0 ? (
            <div className="label">Nothing matches “{q}”.</div>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="label">{g.label}</div>
                {g.items.map((e) => {
                  const i = hits.indexOf(e);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className="pitem"
                      aria-selected={i === at}
                      onMouseEnter={() => setAt(i)}
                      onClick={() => go(e)}
                    >
                      <Icon name={e.icon} size={16} />
                      {e.label}
                      {e.hint ? (
                        <span className="dim" style={{ marginLeft: 6 }}>
                          {e.hint}
                        </span>
                      ) : null}
                      {i === at ? <span className="tailk kbd">Enter</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
