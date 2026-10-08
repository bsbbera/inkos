/**
 * MCP servers, as a page rather than a config file.
 *
 * Quire discovers servers from every agent that already has some installed —
 * Claude Desktop extensions, Devin, Codex, Claude Code — plus its own. That
 * discovery was invisible: a server could be found, enabled, and forwarded to
 * a model with nothing on screen saying so, which made a missing tool
 * impossible to tell apart from a broken one. This page is the seam.
 *
 * One place for all of them: ~/.quire/mcp.json, in the { "mcpServers": {} }
 * shape every other agent uses. Servers other agents have are detected at
 * launch and on Rescan and added to it; a server can be added here by pasting
 * that same JSON, and removed. A source app's own config is never written.
 */
import { useCallback, useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Plug, Loader2, ChevronRight, AlertTriangle } from "../components/ui/glyphs";

import { Spinner } from "../components/ui/working";
import { Failed } from "../components/ui/states";
interface McpServer {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly source?: string;
  readonly enabled?: boolean;
  /** Ships with Quire rather than being discovered from another app's config. */
  readonly bundled?: boolean;
  /**
   * Copied out of another app's config on first run and into Quire's own.
   * `source` still says where it came from; this says Quire owns it now.
   */
  readonly imported?: boolean;
}

interface McpTool {
  readonly name: string;
  readonly description?: string;
}

interface Nav { toDashboard: () => void }

/** Where a server was found. The label matters more than the id on screen. */
const SOURCE_LABELS: Record<string, string> = {
  builtin: "Quire",
  quire: "Quire",
  "claude-extension": "Claude Desktop",
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  devin: "Devin",
  codex: "Codex",
  cursor: "Cursor",
  windsurf: "Windsurf",
  antigravity: "Antigravity",
  gemini: "Gemini CLI",
  vscode: "VS Code",
  override: "Added here",
  user: "Added here",
};

const EXAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Users\\\\me\\\\Documents"]
    }
  }
}`;

const post = async (path: string, body: unknown) => {
  const res = await fetch(`/api/v1/mcp/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) throw new Error(out.error || `HTTP ${res.status}`);
  return out as { added?: string[]; removed?: string };
};

export function McpPage({ nav, theme, t, embedded }: { nav: Nav; theme: Theme; t: TFunction; embedded?: boolean }) {
  const c = useColors(theme);
  const [servers, setServers] = useState<Record<string, McpServer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tools, setTools] = useState<Record<string, McpTool[] | "loading" | "error">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [config, setConfig] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/mcp/servers");
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
      setServers(body.servers || {});
      setConfig(body.config ?? null);
    } catch (e) {
      setError(String((e as Error).message));
      setServers({});
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * Tools are fetched per server, on expand. Listing every server's tools up
   * front would spawn every server process at once just to open a page.
   */
  const expand = async (name: string) => {
    if (open === name) return setOpen(null);
    setOpen(name);
    if (tools[name] && tools[name] !== "error") return;
    setTools((p) => ({ ...p, [name]: "loading" }));
    try {
      const res = await fetch(`/api/v1/mcp/tools?server=${encodeURIComponent(name)}`);
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
      setTools((p) => ({ ...p, [name]: body.tools || [] }));
    } catch {
      setTools((p) => ({ ...p, [name]: "error" }));
    }
  };

  const toggle = async (name: string, enabled: boolean) => {
    setBusy(name);
    // Optimistic: the switch is the only thing that moves, and load() below is
    // the correction if the write failed.
    setServers((p) => (p ? { ...p, [name]: { ...p[name], enabled } } : p));
    try {
      await fetch("/api/v1/mcp/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ server: name, enabled }),
      });
    } finally {
      setBusy(null);
      void load();
    }
  };

  /** Look again at every other agent's config and add what Quire does not have yet. */
  const rescan = async () => {
    setBusy("rescan");
    setNote(null);
    try {
      const out = await post("rescan", {});
      setNote(out.added?.length ? `Added ${out.added.length}: ${out.added.join(", ")}` : "No new servers found in other apps.");
    } catch (e) {
      setNote(`Rescan failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      void load();
    }
  };

  const add = async () => {
    setAddError(null);
    let json: unknown;
    try { json = JSON.parse(draft); } catch { return setAddError("That is not valid JSON."); }
    setBusy("add");
    try {
      const out = await post("add", { json });
      setNote(`Added ${out.added?.join(", ")}`);
      setDraft("");
      setAdding(false);
      void load();
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (name: string) => {
    setBusy(name);
    try {
      await post("remove", { server: name });
      setNote(`Removed ${name}. Rescan will not bring it back; paste it again to restore it.`);
      setOpen(null);
    } catch (e) {
      setNote(`Could not remove ${name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      void load();
    }
  };

  const entries = Object.entries(servers || {}).sort(([a], [b]) => a.localeCompare(b));
  const onCount = entries.filter(([, s]) => s.enabled).length;

  return (
    <div className="stack-lg">
      <div className="flex items-center justify-between gap-4">
        {embedded ? <span className="grow" /> : (
        <div>
          <h1 className="h-page flex items-center gap-3">
            <span className="icon-ring icon-ring-lg" aria-hidden="true"><Plug size={19} /></span>
            MCP servers
          </h1>
          <p className={`mt-2 text-sm ${c.muted}`}>
            Tool servers found on this machine. Enabled ones are offered to every
            model in the workbench, whichever provider it runs on.
          </p>
        </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => { setAdding((a) => !a); setAddError(null); }} className="btn btn-line btn-sm">
            Add server
          </button>
          <button type="button" disabled={busy === "rescan"} onClick={() => void rescan()} className="btn btn-line btn-sm">
            {busy === "rescan" ? "Scanning…" : "Rescan"}
          </button>
        </div>
      </div>

      {config && (
        <p className={`text-xs ${c.muted}`}>
          All servers live in <span className={`font-mono ${c.code} rounded px-1`}>{config}</span>, the same
          format as Claude, Cursor and Devin. Servers in those apps are added automatically at launch;
          edit the file by hand or paste a config below.
        </p>
      )}

      {adding && (
        <div className="panel space-y-3">
          <p className="text-sm">Paste the server's config, as its README or another app gives it.</p>
          <textarea
            className="input font-mono text-xs w-full"
            rows={9}
            value={draft}
            placeholder={EXAMPLE}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          {addError && <p className="hint is-bad" role="alert">{addError}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={!draft.trim() || busy === "add"} onClick={() => void add()} className="btn btn-sm">
              {busy === "add" ? "Adding…" : "Add"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="btn btn-line btn-sm">Cancel</button>
          </div>
        </div>
      )}

      {note && <p className={`text-xs ${c.muted}`} role="status">{note}</p>}

      {error && (
        <Failed what="Could not read the server list." detail={error} />
      )}

      {!servers ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : entries.length === 0 ? (
        <div className={`panel  text-center ${c.muted}`}>
          <p className="text-sm">No MCP servers found.</p>
          <p className="mt-2 text-xs">
            Quire's own server ships with the app. Servers configured in Claude,
            Cursor, Windsurf, Devin, Codex, Antigravity or VS Code are added at
            launch, credentials included. Use Add server to paste one in.
          </p>
        </div>
      ) : (
        <>
          <p className={`text-xs ${c.muted}`}>{onCount} of {entries.length} enabled</p>
          <div className={`panel panel-flush  divide-y ${c.tableDivide} overflow-hidden`}>
            {entries.map(([name, s]) => {
              const list = tools[name];
              const expanded = open === name;
              return (
                <div key={name}>
                  <div className={`flex items-center gap-3 p-4 ${c.tableHover}`}>
                    <button
                      onClick={() => void expand(name)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <ChevronRight
                        size={16}
                        className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
                      />
                      <span className="text-sm font-medium truncate">{name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${c.code} shrink-0`}>
                        {SOURCE_LABELS[s.source ?? ""] ?? s.source ?? "unknown"}
                      </span>
                      {/* A bundled server that fails to start is Quire's own
                          fault and worth seeing. An imported one was copied
                          out of another app's config once and is Quire's to
                          edit now — the source tag above it is history, not a
                          live dependency. */}
                      {s.bundled || s.imported ? (
                        <span className="pill shrink-0">
                          {s.bundled ? "bundled" : "imported"}
                        </span>
                      ) : null}
                    </button>

                    <button
                      role="switch"
                      aria-checked={!!s.enabled}
                      aria-label={`${s.enabled ? "Disable" : "Enable"} ${name}`}
                      disabled={busy === name}
                      onClick={() => void toggle(name, !s.enabled)}
                      className={`relative w-10 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${
                        s.enabled ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-background transition-transform ${
                          s.enabled ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                  </div>

                  {expanded && (
                    <div className="px-4 pb-4 pl-11 space-y-3">
                      {s.command && (
                        <p className={`text-xs ${c.code} rounded px-2 py-1 inline-block break-all`}>
                          {s.command} {(s.args || []).join(" ")}
                        </p>
                      )}
                      {!s.bundled && (
                        <div>
                          <button type="button" disabled={busy === name} onClick={() => void remove(name)} className="btn btn-line btn-sm">
                            Remove
                          </button>
                        </div>
                      )}
                      {list === "loading" && (
                        <p className={`text-xs flex items-center gap-2 ${c.muted}`}>
                          <Spinner /> starting server…
                        </p>
                      )}
                      {list === "error" && (
                        <p className="hint is-bad">
                          Could not start this server or read its tools.
                        </p>
                      )}
                      {Array.isArray(list) && list.length === 0 && (
                        <p className={`text-xs ${c.muted}`}>This server offers no tools.</p>
                      )}
                      {Array.isArray(list) && list.length > 0 && (
                        <ul className="space-y-1.5">
                          {list.map((tool) => (
                            <li key={tool.name} className="text-xs">
                              <span className="font-mono text-foreground/90">{tool.name}</span>
                              {tool.description && (
                                <span className={`ml-2 ${c.muted}`}>{tool.description}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
