/**
 * A model picker you can type into.
 *
 * The list is only what is connected — a provider that is signed out or has no
 * key never reaches this component — because offering a model that cannot
 * answer is the bug this page exists to prevent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { countModels, filterGroups, type SearchGroup } from "./model-search";

export function ModelCombo({
  groups,
  value,
  display,
  emptyLabel,
  disabled,
  onPick,
}: {
  readonly groups: ReadonlyArray<SearchGroup>;
  /** The `service::model` value currently chosen, or "" for none. */
  readonly value: string;
  readonly display: string;
  /** The first row: no pin / no model. */
  readonly emptyLabel: string;
  readonly disabled?: boolean;
  readonly onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const found = useMemo(() => filterGroups(groups, query), [groups, query]);
  const total = countModels(groups);

  const choose = (next: string) => {
    onPick(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-64 items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs disabled:opacity-40"
      >
        <span className="truncate">{display || emptyLabel}</span>
        <ChevronDown size={13} className="shrink-0 opacity-60" aria-hidden />
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-80 rounded-xl border border-border/60 bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border/40 px-2.5 py-2">
            <Search size={13} className="shrink-0 opacity-50" aria-hidden />
            <input
              ref={field}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${total} connected models`}
              aria-label="Search models"
              className="w-full bg-transparent text-xs outline-none"
            />
          </div>
          <div role="listbox" className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              onClick={() => choose("")}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs italic text-muted-foreground hover:bg-muted"
            >
              {value === "" ? <Check size={12} aria-hidden /> : <span className="w-3" />}
              {emptyLabel}
            </button>
            {found.map((group) => (
              <div key={group.service}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                {group.models.map((model) => {
                  const id = `${group.service}::${model.id}`;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={value === id}
                      onClick={() => choose(id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-muted"
                    >
                      {value === id ? <Check size={12} className="shrink-0" aria-hidden /> : <span className="w-3 shrink-0" />}
                      <span className="truncate">{model.name ?? model.id}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {found.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Nothing connected matches “{query}”.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
