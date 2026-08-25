/**
 * MCP servers, as a page rather than a config file.
 *
 * Quire discovers servers from every agent that already has some installed —
 * Claude Desktop extensions, Devin, Codex, Claude Code — plus its own. That
 * discovery was invisible: a server could be found, enabled, and forwarded to
 * a model with nothing on screen saying so, which made a missing tool
 * impossible to tell apart from a broken one. This page is the seam.
 *
 * Read-mostly on purpose. Adding servers stays the source app's job, because a
 * server added here would be one more place to look when a tool goes missing.
 * What Quire owns is the on/off, and it keeps that in its own override file so
 * a source app's own setting is never rewritten.
 */
import { useCallback, useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Plug, Loader2, ChevronRight, AlertTriangle } from "lucide-react";

interface McpServer {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly source?: string;
  readonly enabled?: boolean;
  /** Ships with Quire rather than being discovered from another app's config. */
  readonly bundled?: boolean;
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
  override: "Added here",
};

export function McpPage({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [servers, setServers] = useState<Record<string, McpServer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tools, setTools] = useState<Record<string, McpTool[] | "loading" | "error">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/mcp/servers");
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
      setServers(body.servers || {});
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

  const entries = Object.entries(servers || {}).sort(([a], [b]) => a.localeCompare(b));
  const onCount = entries.filter(([, s]) => s.enabled).length;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>MCP</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl flex items-center gap-3">
            <Plug size={28} className="text-primary" />
            MCP servers
          </h1>
          <p className={`mt-2 text-sm ${c.muted}`}>
            Tool servers found on this machine. Enabled ones are offered to every
            model in the workbench, whichever provider it runs on.
          </p>
        </div>
        <button onClick={() => void load()} className={`px-4 py-2 text-sm rounded-lg shrink-0 ${c.btnSecondary}`}>
          Rescan
        </button>
      </div>

      {error && (
        <div className={`flex items-start gap-3 border rounded-lg p-4 text-sm ${c.error}`}>
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Could not read the server list.</p>
            <p className="mt-1 opacity-80 font-mono text-xs">{error}</p>
          </div>
        </div>
      )}

      {!servers ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : entries.length === 0 ? (
        <div className={`border ${c.cardStatic} rounded-lg p-8 text-center ${c.muted}`}>
          <p className="text-sm">No MCP servers found.</p>
          <p className="mt-2 text-xs">
            Quire's own server ships with the app. Servers configured in Claude
            Desktop, Claude Code, Devin or Codex are picked up automatically.
          </p>
        </div>
      ) : (
        <>
          <p className={`text-xs ${c.muted}`}>{onCount} of {entries.length} enabled</p>
          <div className={`border ${c.cardStatic} rounded-lg divide-y ${c.tableDivide} overflow-hidden`}>
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
                          fault and worth seeing; a discovered one that is
                          missing is the other app's business. Telling them
                          apart at a glance is the difference. */}
                      {s.bundled ? (
                        <span className={`text-xs px-2 py-0.5 rounded border ${c.tableDivide} ${c.muted} shrink-0`}>
                          bundled
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
                      {list === "loading" && (
                        <p className={`text-xs flex items-center gap-2 ${c.muted}`}>
                          <Loader2 size={12} className="animate-spin" /> starting server…
                        </p>
                      )}
                      {list === "error" && (
                        <p className="text-xs text-destructive">
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
