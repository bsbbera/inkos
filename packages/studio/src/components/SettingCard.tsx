import { useCallback, useEffect, useState } from "react";

/**
 * Where and when a work is set — the card that pins it, researches it, and
 * shows what came back (22 §5).
 *
 * It sits beside the manuscript rather than in a settings screen because the
 * two things a person does with a researched world are read it while writing
 * and correct it when it is wrong. The word list is editable for the same
 * reason: adding a term here is the cheapest way to teach the next audit.
 */

interface Setting {
  readonly enabled: boolean;
  readonly kind: string;
  readonly place: { name: string; then?: string; country?: string };
  readonly time: { from?: string; to?: string; label?: string };
  readonly fidelity: string;
  readonly reuseOf?: string | null;
  readonly researchedAt?: string | null;
}

interface Lexicon {
  readonly prefer: ReadonlyArray<{ term: string; for?: string; gloss?: string }>;
  readonly forbidden: ReadonlyArray<{ term: string; reason: string }>;
  readonly addressForms: ReadonlyArray<{ speaker: string; to: string; form: string }>;
}

interface Desk {
  readonly setting: Setting | null;
  readonly bible: string;
  readonly lexicon: Lexicon | null;
  readonly ask: { guess?: { place?: string; time?: string; confidence: number }; answered?: boolean } | null;
  readonly sources: number;
  readonly series: { id: string; title: string; works: ReadonlyArray<{ id: string }> } | null;
  readonly library: ReadonlyArray<{ id: string; setting: Setting }>;
}

type Jobs = { live: ReadonlyArray<{ stage?: string; status?: string; message?: string; ref?: { type?: string; id?: string } }> };

const api = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return await res.json().catch(() => ({}));
};

/** The headings the researcher writes, so the bible can be read a part at a time. */
function sectionsOf(bible: string): ReadonlyArray<{ heading: string; body: string }> {
  return bible.split(/^##\s+/m).slice(1).map((part) => {
    const cut = part.indexOf("\n");
    return {
      heading: (cut < 0 ? part : part.slice(0, cut)).trim(),
      body: cut < 0 ? "" : part.slice(cut + 1).trim(),
    };
  });
}

export function SettingCard({ type, id, jobs }: { type: string; id: string; jobs?: Jobs }) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ place: "", time: "", fidelity: "flavour" });
  const [busy, setBusy] = useState("");
  const [newTerm, setNewTerm] = useState("");

  // What `researchedAt` said when the run was asked for. The run is over when
  // it says something else — including for a re-research, where the old value
  // was already set and "has a value" would have read as finished at once.
  const [since, setSince] = useState<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    const next = await api(`/setting?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`) as unknown as Desk;
    setDesk(next);
    setBusy((b) => (b === "research" && next.setting?.researchedAt !== since ? "" : b));
  }, [type, id, since]);

  useEffect(() => { void load(); }, [load]);

  // Researching a world is ~25 searches and several minutes. Rather than
  // subscribe this card to the job feed, it watches its own file: the run is
  // over exactly when `researchedAt` moves, which is also the only change the
  // card would redraw for.
  const running = (jobs?.live ?? []).find((j) =>
    j.ref?.id === id && String(j.stage ?? "").startsWith("content.research"));
  const waiting = busy === "research" || Boolean(running);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  if (!desk) return null;
  const { setting, lexicon, ask } = desk;
  const pinned = Boolean(setting?.enabled);
  const guess = ask?.answered ? null : ask?.guess;

  const pin = async (body: Record<string, unknown>) => {
    setBusy("pin");
    await api("/setting", { method: "POST", body: JSON.stringify({ type, id, ...body }) });
    await load();
    setBusy("");
    setOpen(false);
  };

  const research = async () => {
    setSince(desk?.setting?.researchedAt ?? null);
    setBusy("research");
    await api("/setting/research", { method: "POST", body: JSON.stringify({ type, id }) });
  };

  const addForbidden = async () => {
    const term = newTerm.trim();
    if (!term) return;
    const next = {
      prefer: lexicon?.prefer ?? [],
      addressForms: lexicon?.addressForms ?? [],
      forbidden: [...(lexicon?.forbidden ?? []), { term, reason: "you said so" }],
    };
    setNewTerm("");
    await api("/setting/lexicon", { method: "POST", body: JSON.stringify({ type, id, lexicon: next }) });
    await load();
  };

  const dropForbidden = async (term: string) => {
    const next = {
      prefer: lexicon?.prefer ?? [],
      addressForms: lexicon?.addressForms ?? [],
      forbidden: (lexicon?.forbidden ?? []).filter((f) => f.term !== term),
    };
    await api("/setting/lexicon", { method: "POST", body: JSON.stringify({ type, id, lexicon: next }) });
    await load();
  };

  const where = setting
    ? [setting.place.then || setting.place.name, setting.time.label || setting.time.from].filter(Boolean).join(", ")
    : "";

  return (
    <section className="desk-card">
      <div className="desk-head">
        <span className="label">Where and when</span>
        {pinned && <span className="pill">{setting?.fidelity}</span>}
        {desk.series && <span className="pill">series: {desk.series.title}</span>}
      </div>

      {/* The one card this work is allowed to raise: it looks set somewhere
          real, and nobody has said yes or no yet. */}
      {!pinned && guess?.place && (
        <div className="verdict-why">
          <p>
            This looks set in <strong>{[guess.place, guess.time].filter(Boolean).join(", ")}</strong>.
            {" "}Research that world before writing?
          </p>
          <div className="verdict-row">
            <button type="button" className="btn btn-sm" onClick={() => void pin({ place: guess.place, time: guess.time, fidelity: "flavour" })}>
              Yes, research it
            </button>
            <button type="button" className="btn btn-line btn-sm" onClick={() => setOpen(true)}>Different place or time…</button>
            <button type="button" className="btn btn-line btn-sm" onClick={() => void pin({ action: "clear" })}>No, keep it loose</button>
          </div>
        </div>
      )}

      {pinned ? (
        <>
          <p className="clamp2">
            <strong>{where}</strong>
            {setting?.researchedAt
              ? ` · researched, ${desk.sources} sources`
              : " · not researched yet"}
            {setting?.reuseOf ? ` · from ${setting.reuseOf}` : ""}
          </p>

          <div className="verdict-row">
            <button type="button" className="btn btn-sm" onClick={() => void research()} disabled={waiting}>
              {waiting
                ? (running?.message ?? "Researching…")
                : setting?.researchedAt ? "Research again" : "Research this world"}
            </button>
            <button type="button" className="btn btn-line btn-sm" onClick={() => setOpen((v) => !v)}>Change</button>
            {setting?.researchedAt && (
              <button type="button" className="btn btn-line btn-sm" onClick={() => void api("/setting/library", { method: "POST", body: JSON.stringify({ type, id }) }).then(load)}>
                Keep in library
              </button>
            )}
          </div>

          {desk.bible && (
            <details>
              <summary>The bible — {sectionsOf(desk.bible).length} sections</summary>
              {sectionsOf(desk.bible).map((s) => (
                <div key={s.heading} className="proposal">
                  <strong>{s.heading}</strong>
                  <pre className="clamp3">{s.body}</pre>
                </div>
              ))}
            </details>
          )}

          {lexicon && (
            <div>
              <p className="desk-head"><strong>Never say</strong></p>
              <div className="chips">
                {lexicon.forbidden.map((f) => (
                  <button
                    key={f.term}
                    className="chip"
                    title={f.reason}
                    onClick={() => void dropForbidden(f.term)}
                  >
                    {f.term} ×
                  </button>
                ))}
              </div>
              <div className="verdict-row">
                <input
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void addForbidden(); }}
                  placeholder="a word this world would not have"
                />
                <button type="button" className="btn btn-line btn-sm" onClick={() => void addForbidden()} disabled={!newTerm.trim()}>Add</button>
              </div>
            </div>
          )}
        </>
      ) : (
        !guess?.place && !open && (
          <div className="verdict-row">
            <p className="clamp2">Not pinned — the writing invents its own century.</p>
            <button type="button" className="btn btn-line btn-sm" onClick={() => setOpen(true)}>Pin a place and time</button>
          </div>
        )
      )}

      {open && (
        <div className="verdict-why">
          <div className="verdict-row">
            <input
              value={form.place}
              onChange={(e) => setForm({ ...form, place: e.target.value })}
              placeholder="Place — Calcutta"
            />
            <input
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
              placeholder="Time — 1943"
            />
            <select value={form.fidelity} onChange={(e) => setForm({ ...form, fidelity: e.target.value })}>
              <option value="strict">strict — a wrong word blocks approval</option>
              <option value="flavour">flavour — a wrong word is a warning</option>
              <option value="loose">loose — just a note</option>
            </select>
            <button type="button" className="btn btn-sm" onClick={() => void pin(form)} disabled={!form.place.trim() || busy === "pin"}>Pin</button>
          </div>
          {desk.library.length > 0 && (
            <div className="chips">
              <span className="chip-static">or reuse:</span>
              {desk.library.map((entry) => (
                <button key={entry.id} className="chip" onClick={() => void pin({ reuseOf: entry.id })}>
                  {entry.id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
