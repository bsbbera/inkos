/**
 * Where the work lives.
 *
 * This was in the launcher's drawer, next to a provider list drawn from the
 * same CLI scan as this page's — one machine described twice, in two places
 * that could disagree. The folder is a fact about this installation, and those
 * belong together.
 *
 * The shell keeps one job in it: only the shell has Tauri, so a webview inside
 * an iframe cannot restart the process it runs in. It is asked to, over the
 * same postMessage bridge the Updates entry already uses.
 */
import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { shimGet, shimPost } from "../lib/shim";

interface Workspace {
  readonly path: string;
  readonly exists?: boolean;
  readonly isDir?: boolean;
  readonly writable?: boolean;
  readonly parentExists?: boolean;
  readonly initialized?: boolean;
  readonly source?: string;
}

/** What this folder is, in the words someone needs before committing to it. */
function describe(w: Workspace): string {
  if (!w.exists) {
    return w.parentExists
      ? "New folder. Quire will create it and set it up on the next launch."
      : "The folder above it does not exist.";
  }
  if (!w.isDir) return "That is a file, not a folder.";
  if (!w.writable) return "Quire cannot write there.";
  if (w.initialized) return "An existing Quire folder. Quire will open the work already in it.";
  return "Not a Quire folder yet. It will be set up on the next launch; anything already in it is left alone.";
}

const usable = (w: Workspace) => (w.exists ? Boolean(w.isDir && w.writable) : w.parentExists === true);

export function WorkspaceFolder() {
  const [current, setCurrent] = useState<Workspace | null>(null);
  const [pending, setPending] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCurrent(await shimGet<Workspace>("/workspace"));
      setError(null);
    } catch {
      setError("unavailable until the shim is running");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * The chooser is native and lives in the shim: a webview cannot turn a
   * picked folder into a real filesystem path.
   */
  const browse = async () => {
    setBusy(true);
    try {
      const picked = await shimPost<{ path?: string }>("/workspace/pick", { start: current?.path });
      if (!picked?.path) return;
      setPending(await shimGet<Workspace>(`/workspace?path=${encodeURIComponent(picked.path)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await shimPost<{ ok?: boolean; error?: string }>("/workspace", { path: pending.path });
      if (r?.ok === false) throw new Error(r.error ?? "could not save");
      // Saved. The old root is still live in two running child processes, so
      // the restart is the change taking effect, not a courtesy.
      window.parent?.postMessage({ quire: "restart" }, "*");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <section className="q-crop rounded-2xl border border-border/60 bg-card p-6 shadow-sm sm:p-7">
      <header className="relative flex items-start gap-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[1.5px] border-primary text-primary" aria-hidden>
          <FolderOpen size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="q-title text-lg">Location</h2>
          <p className="q-note mt-1.5">The folder Quire keeps your books, worlds and magazines in.</p>
        </div>
      </header>

      <div className="relative mt-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs ${
            current?.initialized ? "border-primary/50 text-primary" : "border-border/60 text-muted-foreground"
          }`}>
            {current ? (current.initialized ? "in use" : "new") : "—"}
          </span>
          <span className="font-mono text-sm break-all">{current?.path ?? error ?? "reading…"}</span>
        </div>

        {current ? (
          <p className="text-xs text-muted-foreground">
            {/* Naming the variable matters: it is the only reason a folder picked
                here would appear not to take, and it is invisible from the app. */}
            {current.source === "environment"
              ? "Set by the QUIRE_WORKSPACE environment variable. Choosing a folder here overrides it."
              : describe(current)}
          </p>
        ) : null}

        {error && current ? <p className="text-xs text-destructive">{error}</p> : null}

        {pending ? (
          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 space-y-2">
            <div className="font-mono text-sm break-all">{pending.path}</div>
            <p className="text-xs text-muted-foreground">{describe(pending)}</p>
            <p className="text-xs text-muted-foreground">
              Nothing is moved or deleted. The books in the current folder stay where
              they are; Quire simply stops looking there.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !usable(pending)}
                onClick={() => { void apply(); }}
                className="q-btn q-btn-fill text-sm disabled:opacity-40"
              >
                Use this folder and restart
              </button>
              <button type="button" onClick={() => setPending(null)} className="q-btn q-btn-line text-sm">
                Keep the current one
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => { void browse(); }}
            className="q-btn q-btn-line text-sm disabled:opacity-40"
          >
            Change folder…
          </button>
        )}
      </div>
    </section>
  );
}
