/*
 * Connections: every way this machine reaches a model, in three kinds.
 *
 *   API    a vendor reached with a key
 *   CLI    an agent CLI installed here, signed in with its own account
 *   Local  a server on this machine (Ollama, LM Studio, any OpenAI-shaped URL)
 *
 * One rule for all three (api/connections.ts): a connection is connected when
 * a test made a real call and the provider listed models. Only those reach the
 * model picker. A connection that stops answering keeps its row and says why.
 *
 * Keys stay on this machine (~/.quire), never in the project or its config.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchJson, putApi } from "../hooks/use-api";
import { useServiceStore } from "../store/service/store";
import { Tabs, toast, toastError } from "../components/ui/vermilion";
import { Icon } from "../components/ui/icon";
import { Spinner } from "../components/ui/working";
import { Empty, ErrorLine, Failed, Loading } from "../components/ui/states";

type Kind = "api" | "cli" | "local";

interface Check {
  readonly ok: boolean;
  readonly at: string;
  readonly models: number;
  readonly error?: string;
}

export interface Connection {
  readonly service: string;
  readonly label: string;
  readonly kind: Kind;
  readonly hasKey: boolean;
  readonly connected: boolean;
  readonly check: Check | null;
}

const KINDS: ReadonlyArray<{ value: Kind; label: string; note: string }> = [
  { value: "api", label: "API", note: "A vendor's API, reached with your key. The key stays on this machine." },
  { value: "cli", label: "CLI", note: "Agent CLIs installed here, each signed in with its own account. Found automatically." },
  { value: "local", label: "Local", note: "A model server running on this machine. No key, no internet." },
];

/** "just now", "4 min ago", "3 h ago", or the date. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** What the row says under its name. */
export function statusLine(c: Connection): string {
  if (c.check?.ok) return `${c.check.models} model${c.check.models === 1 ? "" : "s"} · tested ${ago(c.check.at)}`;
  if (c.check) return c.check.error ?? "Did not answer.";
  return c.kind === "api" && !c.hasKey ? "No key yet." : "Not tested yet.";
}

async function test(id: string, apiKey?: string): Promise<Check> {
  // Not fetchJson: a failed test is an answer with a body, not an exception.
  const res = await fetch(`/api/v1/connections/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apiKey ? { apiKey } : {}),
  });
  const body = await res.json().catch(() => ({})) as { check?: Check; error?: string };
  if (body.check) return body.check;
  throw new Error(body.error ?? `HTTP ${res.status}`);
}

function Row({ c, onChanged }: { readonly c: Connection; readonly onChanged: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const check = await test(c.service, key.trim() || undefined);
      if (check.ok) {
        toast(`${c.label}: ${check.models} model${check.models === 1 ? "" : "s"} found.`);
        setKey("");
      } else {
        // A wrong key is said here, beside the field it came from, and not kept.
        setError(check.error ?? "Did not answer.");
      }
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    try {
      await fetchJson(`/connections/${encodeURIComponent(c.service)}/key`, { method: "DELETE" });
      toast(`${c.label}: key removed.`);
      onChanged();
    } catch (e) {
      toastError(e, "Could not remove the key.");
    }
  };

  // Grey when it was connected once and is not now; red only for a test that just failed here.
  const dot = c.connected ? "dot-clean" : c.check && !c.check.ok ? "dot-bad" : "dot-never";
  const needsKey = c.kind === "api" && !c.service.startsWith("custom:");

  return (
    <li className="row still flex-wrap" aria-busy={busy}>
      <span className={`dot ${dot}`} aria-hidden="true" />
      <span className="grow min-w-0">
        <span className="name">{c.label}</span>
        <span className={`meta ${c.connected ? "" : "dim"}`}>{statusLine(c)}</span>
      </span>
      {needsKey ? (
        <input
          type="password"
          className="input w-56 max-w-full"
          placeholder={c.hasKey ? "Key saved · paste to replace" : "Paste API key"}
          aria-label={`${c.label} API key`}
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) void run(); }}
        />
      ) : null}
      <button
        type="button"
        className="btn btn-line btn-sm"
        disabled={busy || (needsKey && !c.hasKey && !key.trim())}
        onClick={() => void run()}
      >
        {busy ? <Spinner /> : <Icon name="plug" size={14} />}
        {busy ? "Testing…" : "Test connection"}
      </button>
      {c.hasKey ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void forget()}>Remove key</button>
      ) : null}
      {error ? <ErrorLine className="basis-full">{error}</ErrorLine> : null}
    </li>
  );
}

/** A connection the catalogue does not list: any OpenAI-shaped base URL. */
function AddCustom({ kind, onAdded }: { readonly kind: Kind; readonly onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(kind === "local" ? "http://localhost:11434/v1" : "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="btn btn-line btn-sm mt-4" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />
        {kind === "local" ? "Add a local URL" : "Add a custom API"}
      </button>
    );
  }

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await putApi("/services/config", { services: [{ service: "custom", name: name.trim(), baseUrl: baseUrl.trim() }] });
      const check = await test(`custom:${name.trim()}`, key.trim() || undefined);
      if (!check.ok) { setError(check.error ?? "Did not answer."); onAdded(); return; }
      toast(`${name.trim()}: ${check.models} models found.`);
      setOpen(false);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="well mt-4 stack gap-3">
      <div className="rowflex gap-3 flex-wrap">
        <label className="field grow">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Work gateway" />
        </label>
        <label className="field grow">
          <span className="label">Base URL</span>
          <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" />
        </label>
        <label className="field grow">
          <span className="label">{kind === "local" ? "Key (if it asks for one)" : "API key"}</span>
          <input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
      </div>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      <div className="rowflex gap-2">
        <button type="button" className="btn btn-sm" disabled={busy || !name.trim() || !baseUrl.trim()} onClick={() => void add()}>
          {busy ? <Spinner /> : null}
          {busy ? "Testing…" : "Add and test"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function Connections() {
  const [rows, setRows] = useState<ReadonlyArray<Connection> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("api");
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);

  const load = useCallback(async () => {
    try {
      setRows((await fetchJson<{ connections: ReadonlyArray<Connection> }>("/connections")).connections);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // A test changes what every picker may offer, so the shared store reloads with it.
  const changed = useCallback(() => {
    void load();
    void refreshServices();
    void fetchBankModels();
  }, [load, refreshServices, fetchBankModels]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <Failed what="Could not read the connections." detail={error} retry={() => void load()} />;
  if (!rows) return <Loading what="Testing what this machine can reach…" />;

  const here = rows.filter((r) => r.kind === kind);
  const count = (k: Kind) => rows.filter((r) => r.kind === k && r.connected).length;
  const note = KINDS.find((k) => k.value === kind)!.note;

  return (
    <section className="panel">
      <div className="spread items-start gap-4">
        <div>
          <h2 className="h-panel">Connections</h2>
          <p className="note mt-1.5">Only a connection that passed its test offers models anywhere in the app.</p>
        </div>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>
          <Icon name="redo" size={14} />Refresh
        </button>
      </div>

      <div className="mt-4">
        <Tabs
          items={KINDS.map((k) => ({ value: k.value, label: `${k.label}${count(k.value) ? ` · ${count(k.value)}` : ""}` }))}
          value={kind}
          onChange={setKind}
        />
      </div>
      <p className="hint mt-3">{note}</p>

      {here.length === 0 ? (
        <div className="mt-3">
          <Empty compact icon="plug" title={kind === "cli" ? "Install Claude Code, Codex, Devin or Antigravity and it shows here." : "Nothing here yet."} />
        </div>
      ) : (
        <ul className="rows mt-2 list-none p-0">
          {here.map((c) => <Row key={c.service} c={c} onChanged={changed} />)}
        </ul>
      )}

      {kind !== "cli" ? <AddCustom key={kind} kind={kind} onAdded={changed} /> : null}
    </section>
  );
}
