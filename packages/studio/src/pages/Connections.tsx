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
import { Orb } from "../components/ui/working";
import { Empty, ErrorLine, Failed, Loading } from "../components/ui/states";
import { when } from "../lib/when";

type Kind = "api" | "cli" | "local";
type Via = "api-key" | "subscription" | "cli";

const VIAS: ReadonlyArray<{ value: Via; label: string }> = [
  { value: "api-key", label: "API key" },
  { value: "subscription", label: "Subscription" },
  { value: "cli", label: "Installed CLI" },
];

interface Login {
  readonly state: "none" | "waiting" | "done" | "error";
  readonly url?: string;
  readonly userCode?: string;
  readonly message?: string;
  readonly error?: string;
  readonly awaitingCode?: boolean;
  readonly choice?: { readonly message: string; readonly options: ReadonlyArray<{ readonly id: string; readonly label: string }> };
}

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
  /** Anthropic and OpenAI only: reached with a key, a subscription, or the installed CLI. */
  readonly via?: Via;
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
  return when(iso, now);
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

  const [login, setLogin] = useState<Login | null>(null);
  const [code, setCode] = useState("");
  const path = `/connections/${encodeURIComponent(c.service)}`;

  // A sign-in finishes in the browser, so the row asks how it went until it ends.
  useEffect(() => {
    if (login?.state !== "waiting") return;
    const t = setInterval(() => {
      void fetchJson<Login>(`${path}/login`).then((l) => {
        // The link can arrive after a choice was made: open it the first time it shows.
        setLogin((prev) => { if (l.url && !prev?.url) window.open(l.url, "_blank", "noopener"); return l; });
        if (l.state === "done") { toast(`${c.label}: signed in.`); onChanged(); }
        if (l.state === "error") setError(l.error ?? "Sign-in failed.");
      }).catch(() => { /* next tick */ });
    }, 2000);
    return () => clearInterval(t);
  }, [login?.state, path, c.label, onChanged]);

  const choose = async (via: Via) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<{ check: Check }>(`${path}/via`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ via }) });
      if (!res.check.ok) setError(res.check.error ?? "Not connected.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setError(null);
    try {
      const l = await fetchJson<Login>(`${path}/login`, { method: "POST" });
      setLogin(l);
      if (l.state === "error") setError(l.error ?? "Sign-in failed.");
      else if (l.url) window.open(l.url, "_blank", "noopener");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pick = async (id: string) => {
    try {
      const l = await fetchJson<Login>(`${path}/login/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: id }) });
      setLogin((prev) => { if (l.url && !prev?.url) window.open(l.url, "_blank", "noopener"); return l; });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sendCode = async () => {
    try {
      setLogin(await fetchJson<Login>(`${path}/login/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }) }));
      setCode("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const signOut = async () => {
    try {
      await fetchJson(`${path}/login`, { method: "DELETE" });
      setLogin(null);
      toast(`${c.label}: signed out.`);
      onChanged();
    } catch (e) {
      toastError(e, "Could not sign out.");
    }
  };

  // Grey when it was connected once and is not now; red only for a test that just failed here.
  const dot = c.connected ? "dot-clean" : c.check && !c.check.ok ? "dot-bad" : "dot-never";
  const via = c.via ?? "api-key";
  const needsKey = c.kind === "api" && !c.service.startsWith("custom:") && via === "api-key";

  return (
    <li className="row still flex-wrap" aria-busy={busy}>
      <span className={`dot ${dot}`} aria-hidden="true" />
      <span className="grow min-w-0">
        <span className="name">{c.label}</span>
        <span className={`meta ${c.connected ? "" : "dim"}`}>{statusLine(c)}</span>
      </span>
      {c.via ? (
        <select
          className="input py-1.5 px-2 text-small w-auto"
          aria-label={`Connect ${c.label} via`}
          value={via}
          disabled={busy}
          onChange={(e) => void choose(e.target.value as Via)}
        >
          {VIAS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      ) : null}
      {via === "subscription" ? (
        c.connected
          ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => void signOut()}>Sign out</button>
          : (
            <button type="button" className="btn btn-sm" disabled={login?.state === "waiting"} onClick={() => void signIn()}>
              {login?.state === "waiting" ? <Orb state="connecting" /> : <Icon name="plug" size={14} />}
              {login?.state === "waiting" ? "Waiting for sign-in…" : "Sign in"}
            </button>
          )
      ) : null}
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
        {busy ? <Orb state="connecting" /> : <Icon name="plug" size={14} />}
        {busy ? "Testing…" : "Test connection"}
      </button>
      {c.hasKey && via === "api-key" ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void forget()}>Remove key</button>
      ) : null}
      {login?.state === "waiting" ? (
        <div className="basis-full rowflex gap-2 flex-wrap items-center">
          {login.url ? <a className="link text-small" href={login.url} target="_blank" rel="noopener noreferrer">Open the sign-in page</a> : null}
          {login.choice ? (
            <>
              <span className="text-small">{login.choice.message}</span>
              {login.choice.options.map((o) => (
                <button key={o.id} type="button" className="btn btn-line btn-sm" onClick={() => void pick(o.id)}>{o.label}</button>
              ))}
            </>
          ) : null}
          {login.userCode ? <span className="text-small">Code to enter: <b className="mono">{login.userCode}</b></span> : null}
          {login.awaitingCode ? (
            <>
              <input className="input w-56 max-w-full" placeholder="Paste the code it shows" aria-label="Sign-in code" value={code} onChange={(e) => setCode(e.target.value)} />
              <button type="button" className="btn btn-line btn-sm" disabled={!code.trim()} onClick={() => void sendCode()}>Send code</button>
            </>
          ) : null}
        </div>
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
          {busy ? <Orb state="connecting" /> : null}
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
  const [kind, setKind] = useState<Kind | null>(null);
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

  /* Open on the kind that has something working, not on API keys: a machine
     running four CLIs opened on five empty "Paste API key" rows. */
  const shown: Kind = kind
    ?? (["cli", "api", "local"] as const).find((k) => rows.some((r) => r.kind === k && r.connected))
    ?? "api";
  const here = rows.filter((r) => r.kind === shown);
  const count = (k: Kind) => rows.filter((r) => r.kind === k && r.connected).length;
  const note = KINDS.find((k) => k.value === shown)!.note;

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
          value={shown}
          onChange={setKind}
        />
      </div>
      <p className="hint mt-3">{note}</p>

      {here.length === 0 ? (
        <div className="mt-3">
          <Empty compact icon="plug" title={shown === "cli" ? "Install Claude Code, Codex, Devin or Antigravity and it shows here." : "Nothing here yet."} />
        </div>
      ) : (
        <ul className="rows mt-2 list-none p-0">
          {here.map((c) => <Row key={c.service} c={c} onChanged={changed} />)}
        </ul>
      )}

      {shown !== "cli" ? <AddCustom key={shown} kind={shown} onAdded={changed} /> : null}
    </section>
  );
}
