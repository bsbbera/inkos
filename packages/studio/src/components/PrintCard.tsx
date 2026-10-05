import { useCallback, useEffect, useState } from "react";

/**
 * The bound copy (07 §Print, 11 #1): what it is printed on, and the folder
 * that is ready to upload.
 *
 * Nothing on this card orders or pays for anything. It makes the files, checks
 * them the way the service will, and opens the service's own upload page —
 * price and address are decided there, by the person, not here.
 */

interface Profile {
  readonly trim: { w: number; h: number; name: string };
  readonly binding: string;
  readonly stock: string;
  readonly colour: string;
  readonly service: string;
  readonly isbn?: string;
  readonly author?: string;
}

interface Finding { readonly severity: "blocking" | "warning" | "note"; readonly code: string; readonly message: string }

interface Desk {
  readonly profile: Profile;
  readonly services: ReadonlyArray<{ id: string; label: string; bindings: ReadonlyArray<string>; upload: string; approx: boolean }>;
  readonly trims: ReadonlyArray<{ id: string; name: string }>;
  readonly typst: boolean;
  readonly package: { dir: string; at: string; pages: number | null; spineMm: number | null; findings: ReadonlyArray<Finding> } | null;
  readonly error?: string;
}

const api = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return await res.json().catch(() => ({}));
};

const STOCKS = ["cream", "white", "color"] as const;

export function PrintCard({ type, id }: { type: string; id: string }) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  // The package's timestamp when a build was asked for; it is done when that changes.
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const base = `/productions/${encodeURIComponent(type)}/${encodeURIComponent(id)}/print`;

  const load = useCallback(async () => {
    const out = await api(base) as unknown as Desk;
    if (out.error) return setDesk(null);
    setDesk(out);
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (since === undefined) return;
    const timer = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(timer);
  }, [since, load]);

  useEffect(() => {
    if (since !== undefined && desk?.package?.at && desk.package.at !== since) setSince(undefined);
  }, [desk, since]);

  if (!desk) return null;
  const { profile } = desk;
  const service = desk.services.find((s) => s.id === profile.service);
  const trimId = desk.trims.find((t) => t.name === profile.trim.name)?.id ?? "";
  const blocking = desk.package?.findings.filter((f) => f.severity === "blocking").length ?? 0;

  const save = async (patch: Record<string, unknown>) => {
    setBusy("save");
    const out = await api(base, { method: "POST", body: JSON.stringify(patch) });
    setBusy("");
    setNote(typeof out.error === "string" ? out.error : "");
    await load();
  };

  const build = async () => {
    setBusy("build");
    const out = await api(`${base}/build`, { method: "POST", body: "{}" });
    setBusy("");
    if (typeof out.error === "string") return setNote(out.error);
    setNote("Typesetting — this runs in the background and shows in the rail.");
    setSince(desk.package?.at ?? null);
  };

  return (
    <div className="panel">
      <div className="spread items-start">
        <div>
          <h3 className="h-panel">Print a copy</h3>
          <p className="hint mt-1">
            {service?.label ?? profile.service} · {profile.trim.name} · {profile.binding}
            {desk.package?.spineMm ? ` · spine ${desk.package.spineMm} mm` : ""}
          </p>
        </div>
        {desk.package ? (
          <span className={blocking ? "pill" : "pill"} title={desk.package.dir}>
            {blocking ? `${blocking} to fix` : "ready to upload"}
          </span>
        ) : null}
      </div>

      <div className="rowflex flex-wrap gap-2 mt-3">
        <select
          value={profile.service}
          onChange={(e) => void save({ service: e.target.value })}
          aria-label="Print service"
        >
          {desk.services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={trimId} onChange={(e) => void save({ trim: e.target.value })} aria-label="Trim size">
          {trimId ? null : <option value="">{profile.trim.name}</option>}
          {desk.trims.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={profile.binding} onChange={(e) => void save({ binding: e.target.value })} aria-label="Binding">
          {(service?.bindings ?? [profile.binding]).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={profile.stock} onChange={(e) => void save({ stock: e.target.value })} aria-label="Paper">
          {STOCKS.map((s) => <option key={s} value={s}>{s} paper</option>)}
        </select>
      </div>

      <div className="rowflex flex-wrap gap-2 mt-2">
        <input
          defaultValue={profile.author ?? ""}
          placeholder="Author on the cover"
          aria-label="Author"
          onBlur={(e) => { if (e.target.value !== (profile.author ?? "")) void save({ author: e.target.value }); }}
        />
        <input
          defaultValue={profile.isbn ?? ""}
          placeholder="ISBN-13 (optional)"
          aria-label="ISBN"
          onBlur={(e) => { if (e.target.value !== (profile.isbn ?? "")) void save({ isbn: e.target.value }); }}
        />
      </div>

      {!desk.typst && type !== "publication" ? (
        <p className="hint mt-2.5">
          The print PDF needs Typst, which is not installed. Install it with
          {" "}<code>winget install --id Typst.Typst</code>, then build.
        </p>
      ) : null}

      {desk.package?.findings.length ? (
        <div className="rows mt-3">
          {desk.package.findings.map((f) => (
            <div className="row py-2 px-1 gap-2.5" key={f.code + f.message}>
              <span className={`${f.severity === "blocking" ? "st now" : "st"} gap-2.5`}><i />{f.severity}</span>
              <span className="meta whitespace-normal">{f.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rowflex mt-3.5 gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy !== "" || since !== undefined || (!desk.typst && type !== "publication")}
          onClick={() => void build()}
        >
          {since !== undefined ? "Typesetting…" : desk.package ? "Rebuild the print files" : "Make the print files"}
        </button>
        {desk.package && service?.upload && !blocking ? (
          <a className="btn btn-quiet btn-sm" href={service.upload} target="_blank" rel="noreferrer">
            Open {service.label} to upload
          </a>
        ) : null}
      </div>
      {desk.package ? (
        <p className="hint mt-2">
          {desk.package.pages ? `${desk.package.pages} pages. ` : ""}Files and a checklist are in <code>{desk.package.dir}</code>. Nothing is uploaded or ordered for you.
        </p>
      ) : null}
      {note ? <p className="hint mt-1.5">{note}</p> : null}
    </div>
  );
}
