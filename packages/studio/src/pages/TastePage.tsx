import { useCallback, useEffect, useMemo, useState } from "react";

/*
 * Taste (18 §3). What your verdicts added up to, waiting for a yes; the rules
 * you said yes to, and whether they are working; and the pack that carries
 * them to another work or another person.
 *
 * Nothing proposed here is applied until it is accepted. Proposals from your
 * own hand-finished finals come first, because they are the strongest thing
 * the app ever learns from.
 *
 * Grouped by what a rule is about - writing, pictures, design, build - because
 * a flat list read as a writing feature, and the question "does this cover my
 * pictures too?" had no answer on the page. The four are always shown, empty
 * or not, so the page says what it can learn before it has learned anything.
 */

interface Proposal {
  readonly id: string;
  readonly text: string;
  readonly kind: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly evidence: ReadonlyArray<string>;
  readonly source: string;
  readonly state: string;
}

interface Rule {
  readonly id: string;
  readonly text: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly source: string;
  readonly trial?: { seen: number; redo: number };
  readonly review?: boolean;
  readonly retired?: string;
}

type Ref = { type: string; id: string };

/* The feedback surfaces (api/taste.ts), in the words a person uses, with what
   feeds each one and where it is applied. */
const SURFACES: ReadonlyArray<{ id: string; label: string; from: string; used: string }> = [
  { id: "content", label: "Writing", from: "Redo, Tweak and Reject on pages", used: "every writer" },
  { id: "image", label: "Pictures", from: "verdicts on pictures in the Gallery", used: "every picture brief" },
  { id: "design", label: "Design", from: "verdicts on layouts, worlds and kits", used: "the magazine design spec" },
  { id: "build", label: "Build", from: "verdicts on the printed build", used: "nothing yet - kept for the build surface" },
];

const api = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return await res.json().catch(() => ({}));
};

/** Where a rule applies, minus the surface - the group heading already says that. */
const reach = (scope: Readonly<Record<string, string>>) => {
  const rest = Object.entries(scope).filter(([k]) => k !== "surface");
  return rest.length ? rest.map(([k, v]) => `${k}: ${v}`).join(" · ") : "every work";
};

const surfaceOf = (scope: Readonly<Record<string, string>>) => scope.surface ?? "";

export function TastePage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [works, setWorks] = useState<Ref[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [pack, setPack] = useState({ id: "", styles: [] as string[], works: [] as string[], rules: true });
  const [importPath, setImportPath] = useState("");
  const [clone, setClone] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([api("/taste/proposals?state=pending"), api("/taste/rules")]);
    setProposals((p.proposals as Proposal[] | undefined) ?? []);
    setRules((r.rules as Rule[] | undefined) ?? []);
  }, []);

  useEffect(() => {
    void load();
    void api("/productions/runs").then((out) => {
      const runs = (out.runs as Array<{ ref: Ref }> | undefined) ?? [];
      setWorks(runs.map((r) => r.ref));
    });
    void api("/styles").then((out) => {
      const list = (out.styles as Array<{ id?: string } | string> | undefined) ?? [];
      setStyles(list.map((s) => (typeof s === "string" ? s : String(s.id ?? ""))).filter(Boolean));
    });
  }, [load]);

  const fromFinals = useMemo(() => proposals.filter((p) => p.source === "final"), [proposals]);
  const others = useMemo(() => proposals.filter((p) => p.source !== "final"), [proposals]);
  const live = useMemo(() => rules.filter((r) => !r.retired), [rules]);
  /* A rule with no surface speaks to everything; it gets its own group rather
     than being filed under one it does not belong to. */
  const everywhere = useMemo(
    () => live.filter((r) => !SURFACES.some((s) => s.id === surfaceOf(r.scope))),
    [live],
  );

  const settle = async (p: Proposal, verb: "accept" | "ignore") => {
    const text = edits[p.id];
    await api(`/taste/proposals/${encodeURIComponent(p.id)}/${verb}`, {
      method: "POST", body: JSON.stringify(text && text !== p.text ? { text } : {}),
    });
    await load();
  };

  const run = async (path: string, body: unknown, done: (out: Record<string, unknown>) => string) => {
    setNote("");
    const out = await api(path, { method: "POST", body: JSON.stringify(body) });
    setNote(typeof out.error === "string" ? out.error : done(out));
    await load();
  };

  const surfaceWord = (scope: Readonly<Record<string, string>>) =>
    SURFACES.find((s) => s.id === surfaceOf(scope))?.label ?? "Everywhere";

  const proposalRow = (p: Proposal) => (
    <div className="row py-2.5 px-0 gap-2.5 items-start" key={p.id}>
      <div className="grow stack-xs min-w-0">
        <input
          className="input"
          value={edits[p.id] ?? p.text}
          onChange={(e) => setEdits({ ...edits, [p.id]: e.target.value })}
          aria-label="Rule text"
        />
        <span className="dim text-cap">
          {surfaceWord(p.scope)} · {reach(p.scope)} · {p.evidence.length} verdict{p.evidence.length === 1 ? "" : "s"} behind it
        </span>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => void settle(p, "accept")}>Accept</button>
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => void settle(p, "ignore")}>Ignore</button>
    </div>
  );

  const ruleRow = (r: Rule) => (
    <div className="row py-2 px-0 gap-2.5 items-baseline" key={r.id}>
      <span className={r.review ? "st now" : "st done"}><i /></span>
      <span className="grow text-small">{r.text}</span>
      <span className="dim text-cap">
        {reach(r.scope)}
        {r.review ? " · redone three times since - look again"
          : r.trial && r.trial.seen < 3 ? ` · watching (${r.trial.seen} of 3)` : ""}
      </span>
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        onClick={() => void run(`/taste/rules/${encodeURIComponent(r.id)}/retire`, {}, () => "Retired.")}
      >
        Retire
      </button>
    </div>
  );

  const split = (s: string) => { const [type, ...rest] = s.split("/"); return { type: type ?? "", id: rest.join("/") }; };

  return (
    <div className="stack-lg">
      <section className="crop pb-0">
        <span className="disc stroke w-47.5 h-47.5 -left-22 -top-23 opacity-30" />
        <div className="head">
          <h2 className="h-page">What you keep choosing</h2>
          <p>
            Every Keep, Redo, Tweak and Reject you give is counted. When the same reason comes up
            often enough it becomes a proposed rule, and a rule you accept goes into the next
            thing made. Style decides whose voice the prose is in; this is what you like, in the
            words and the pictures both.
          </p>
        </div>
      </section>

      <section className="cols grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <span className="grow">
                <h3 className="h-panel">Waiting for your yes</h3>
                <span className="dim text-cap">
                  Nothing here applies until you accept it. Edit the wording first if it is nearly right.
                </span>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void run("/taste/distill", {}, () => "Reading your verdicts - proposals appear here when it finishes.")}
              >
                Look for new rules
              </button>
            </div>
            <div className="panel-body stack">
              {note ? <p className="hint">{note}</p> : null}
              {fromFinals.length ? (
                <div>
                  <div className="label"><span>From your finals</span><span>{fromFinals.length}</span></div>
                  <div className="rows">{fromFinals.map(proposalRow)}</div>
                </div>
              ) : null}
              {others.length ? (
                <div>
                  <div className="label"><span>From your verdicts</span><span>{others.length}</span></div>
                  <div className="rows">{others.map(proposalRow)}</div>
                </div>
              ) : (
                <p className="hint">
                  Nothing waiting. A reason pressed five times on one work - or across two works -
                  becomes a proposal.
                </p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="grow">
                <h3 className="h-panel">Rules in force</h3>
                <span className="dim text-cap">
                  {live.length} accepted. Each is watched for three uses; one redone every time is flagged.
                </span>
              </span>
            </div>
            <div className="panel-body stack">
              {SURFACES.map((s) => {
                const mine = live.filter((r) => surfaceOf(r.scope) === s.id);
                return (
                  <div key={s.id}>
                    <div className="label"><span>{s.label}</span><span>{mine.length}</span></div>
                    {mine.length ? (
                      <div className="rows">{mine.map(ruleRow)}</div>
                    ) : (
                      <p className="dim text-cap mx-0 mt-1 mb-0">
                        None yet. Learned from {s.from}; used by {s.used}.
                      </p>
                    )}
                  </div>
                );
              })}
              {everywhere.length ? (
                <div>
                  <div className="label"><span>Everywhere</span><span>{everywhere.length}</span></div>
                  <div className="rows">{everywhere.map(ruleRow)}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="grow">
              <h3 className="h-panel">Carry it</h3>
              <span className="dim text-cap">
                A Taste Pack holds voices, a work&rsquo;s world and kit, and your rules - never your
                manuscripts or your verdicts.
              </span>
            </span>
          </div>
          <div className="panel-body stack">
            <div className="field">
              <label htmlFor="pack-name">Pack name</label>
              <input
                id="pack-name"
                className="input"
                value={pack.id}
                placeholder="pack-name"
                onChange={(e) => setPack({ ...pack, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-") })}
              />
            </div>
            <div className="field">
              <label htmlFor="pack-voices">Voices</label>
              <select
                id="pack-voices"
                className="input"
                multiple
                value={pack.styles}
                onChange={(e) => setPack({ ...pack, styles: [...e.target.selectedOptions].map((o) => o.value) })}
              >
                {styles.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pack-works">Worlds and kits from</label>
              <select
                id="pack-works"
                className="input"
                multiple
                value={pack.works}
                onChange={(e) => setPack({ ...pack, works: [...e.target.selectedOptions].map((o) => o.value) })}
              >
                {works.map((w) => <option key={`${w.type}/${w.id}`} value={`${w.type}/${w.id}`}>{w.type} · {w.id}</option>)}
              </select>
            </div>
            <label className="rowflex gap-1.5 text-small">
              <input type="checkbox" checked={pack.rules} onChange={(e) => setPack({ ...pack, rules: e.target.checked })} />
              Include my rules
            </label>
            <div className="rowflex">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!pack.id}
                onClick={() => void run("/taste/pack/export", {
                  id: pack.id, styles: pack.styles, rules: pack.rules, works: pack.works.map(split),
                }, (out) => `Written to ${String(out.file ?? "")}`)}
              >
                Export pack
              </button>
            </div>

            <div className="field border-t border-t-(--line) pt-3.5">
              <label htmlFor="pack-import">Import a pack</label>
              <div className="rowflex gap-2">
                <input
                  id="pack-import"
                  className="input grow"
                  value={importPath}
                  placeholder="Full path to a .zip pack"
                  onChange={(e) => setImportPath(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-line btn-sm"
                  disabled={!importPath.trim()}
                  onClick={() => void run("/taste/pack/import", { path: importPath.trim() }, (out) => {
                    const got = out as { styles?: unknown[]; worlds?: unknown[]; proposals?: number };
                    return `Installed ${got.styles?.length ?? 0} voice(s) and ${got.worlds?.length ?? 0} world(s); ${got.proposals ?? 0} rule(s) wait for your yes.`;
                  })}
                >
                  Import
                </button>
              </div>
            </div>

            <div className="field border-t border-t-(--line) pt-3.5">
              <label htmlFor="clone-to">Clone taste</label>
              <div className="stack-xs">
                <select id="clone-to" className="input" value={clone.to} onChange={(e) => setClone({ ...clone, to: e.target.value })}>
                  <option value="">Make this work…</option>
                  {works.map((w) => <option key={`to-${w.type}/${w.id}`} value={`${w.type}/${w.id}`}>{w.type} · {w.id}</option>)}
                </select>
                <select aria-label="Clone from" className="input" value={clone.from} onChange={(e) => setClone({ ...clone, from: e.target.value })}>
                  <option value="">…look and sound like this one</option>
                  {works.map((w) => <option key={`from-${w.type}/${w.id}`} value={`${w.type}/${w.id}`}>{w.type} · {w.id}</option>)}
                </select>
              </div>
              <div className="rowflex mt-2">
                <button
                  type="button"
                  className="btn btn-line btn-sm"
                  disabled={!clone.from || !clone.to || clone.from === clone.to}
                  onClick={() => void run("/taste/clone", { from: split(clone.from), to: split(clone.to) }, (out) => {
                    const got = out as { copied?: unknown[]; rules?: number };
                    return `Copied ${got.copied?.length ?? 0} file(s) and ${got.rules ?? 0} rule(s).`;
                  })}
                >
                  Clone
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
