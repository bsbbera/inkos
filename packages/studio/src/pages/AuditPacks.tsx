import { Empty } from "../components/ui/states";
import { useCallback, useEffect, useMemo, useState } from "react";

/*
 * What the audit looks for (19 §4.2).
 *
 * The dimensions were always selectable — a genre pack chose from the thirty-
 * seven, `book_rules.md` could add to them — and there was nowhere to see it.
 * This is that switch: check rows for the catalogue, a sentence for anything
 * the catalogue does not cover, word lists as chips, thresholds as fields.
 *
 * "Try it on a file" is the reason this is a page rather than a config file:
 * edit a criterion, run it against one chapter, watch the findings change.
 */

interface CatalogueDimension {
  readonly id: number;
  readonly en: string;
  readonly zh?: string;
  readonly ask?: string;
}

interface Catalogue {
  readonly id: string;
  readonly kind: "book" | "story";
  readonly version: number;
  readonly dimensions: ReadonlyArray<CatalogueDimension>;
}

interface CustomDimension {
  readonly id: string;
  readonly label: string;
  readonly instruction: string;
  readonly severity?: string;
}

interface Pack {
  readonly id: string;
  readonly version: number;
  readonly source?: string;
  readonly appliesTo?: ReadonlyArray<string>;
  readonly extends?: string;
  readonly dimensions?: {
    readonly enable?: ReadonlyArray<number | string>;
    readonly disable?: ReadonlyArray<number | string>;
    readonly custom?: ReadonlyArray<CustomDimension>;
  };
  readonly deterministic?: {
    readonly fatigueWords?: { add?: ReadonlyArray<string>; remove?: ReadonlyArray<string> };
    readonly hedgeWords?: { add?: ReadonlyArray<string>; remove?: ReadonlyArray<string> };
    readonly markers?: { add?: ReadonlyArray<string>; remove?: ReadonlyArray<string> };
    readonly paragraph?: { readonly maxChars?: number };
  };
  readonly scoring?: { readonly passThreshold?: number; readonly maxIterations?: number };
  readonly blocking?: ReadonlyArray<string>;
  readonly rules?: ReadonlyArray<string>;
}

interface Finding {
  readonly section?: string;
  readonly severity?: string;
  readonly category?: string;
  readonly description?: string;
}

const api = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return await res.json().catch(() => ({}));
};

const numbers = (v: ReadonlyArray<number | string> | undefined): number[] =>
  (v ?? []).filter((x): x is number => typeof x === "number");

/** A comma- or newline-separated field, as the list a pack stores. */
const words = (s: string): string[] =>
  s.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

const BLANK: Pack = { id: "", version: 1, dimensions: { enable: [], disable: [], custom: [] } };

export function AuditPacks() {
  const [catalogues, setCatalogues] = useState<Catalogue[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [draft, setDraft] = useState<Pack>(BLANK);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [trial, setTrial] = useState({ type: "book", id: "", path: "" });
  const [findings, setFindings] = useState<Finding[] | null>(null);

  const load = useCallback(async () => {
    const [cat, list] = await Promise.all([api("/audit/catalogue"), api("/audit/packs")]);
    setCatalogues((cat.catalogues as Catalogue[]) ?? []);
    setPacks((list.packs as Pack[]) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Which catalogue's rows to show: a pack says so, and a pack for prose that
  // does not say defaults to the story dimensions, which is what most audits
  // outside a book actually run.
  const catalogue = useMemo(
    () => catalogues.find((c) => c.id === draft.extends) ?? catalogues.find((c) => c.id === "story-30"),
    [catalogues, draft.extends]);

  const enabled = new Set(numbers(draft.dimensions?.enable));
  const disabled = new Set(numbers(draft.dimensions?.disable));

  const setDimension = (id: number, state: "on" | "off" | "default"): void => {
    const on = new Set(enabled);
    const off = new Set(disabled);
    on.delete(id); off.delete(id);
    if (state === "on") on.add(id);
    if (state === "off") off.add(id);
    setDraft({
      ...draft,
      dimensions: { ...draft.dimensions, enable: [...on], disable: [...off] },
    });
  };

  const save = async (): Promise<void> => {
    if (!draft.id.trim()) { setNote("Give the pack a name first."); return; }
    setBusy(true);
    const out = await api(`/audit/packs/${encodeURIComponent(draft.id)}`, {
      method: "PUT", body: JSON.stringify(draft),
    });
    setBusy(false);
    if (out.error) { setNote(String(out.error)); return; }
    const saved = (out.pack as Pack) ?? draft;
    // The bench is a warning, never a refusal: the case may be the stale one.
    const bench = out.bench as { summary?: string; ok?: boolean } | undefined;
    setNote(bench && !bench.ok
      ? `Saved ${saved.id} as version ${saved.version}. ${bench.summary}`
      : `Saved ${saved.id} as version ${saved.version}.${bench?.summary ? ` ${bench.summary}` : ""}`);
    setDraft(saved);
    await load();
  };

  const seedBench = async (): Promise<void> => {
    setBusy(true);
    const out = await api("/audit/bench/seed", {
      method: "POST", body: JSON.stringify({ type: draft.appliesTo?.[0] ?? "book" }),
    });
    setBusy(false);
    setNote(out.error
      ? String(out.error)
      : `Bench now holds ${out.added} passage${out.added === 1 ? "" : "s"} from findings you settled.`);
  };

  const runBench = async (): Promise<void> => {
    setBusy(true);
    const out = await api("/audit/bench/run", {
      method: "POST",
      body: JSON.stringify({ type: draft.appliesTo?.[0] ?? null, pack: draft.id || undefined }),
    });
    setBusy(false);
    setNote(out.error ? String(out.error) : String(out.summary ?? "Bench run finished."));
  };

  const remove = async (id: string): Promise<void> => {
    await api(`/audit/packs/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (draft.id === id) setDraft(BLANK);
    setNote(`Removed ${id}. A shipped pack of that name is back in force.`);
    await load();
  };

  const tryIt = async (): Promise<void> => {
    if (!trial.id.trim() || !trial.path.trim()) {
      setNote("Name the work and the file to try it on.");
      return;
    }
    setBusy(true); setFindings(null);
    const out = await api("/audit/packs/preview", {
      method: "POST",
      body: JSON.stringify({ ...trial, pack: draft.id ? draft : undefined }),
    });
    setBusy(false);
    if (out.error) { setNote(String(out.error)); return; }
    setFindings((out.findings as Finding[]) ?? []);
    setNote("");
  };

  const custom = draft.dimensions?.custom ?? [];
  const setCustom = (next: CustomDimension[]): void =>
    setDraft({ ...draft, dimensions: { ...draft.dimensions, custom: next } });

  const wordField = (
    label: string,
    key: "fatigueWords" | "hedgeWords" | "markers",
    hint: string,
  ) => (
    <label className="field" key={key}>
      <span className="label">{label}</span>
      <input
        className="input"
        value={(draft.deterministic?.[key]?.add ?? []).join(", ")}
        placeholder={hint}
        onChange={(e) => setDraft({
          ...draft,
          deterministic: {
            ...draft.deterministic,
            [key]: { ...draft.deterministic?.[key], add: words(e.target.value) },
          },
        })}
      />
    </label>
  );

  return (
    <div className="stack">
      <div className="panel">
        <div className="spread items-start">
          <div>
            <h3 className="h-panel">What the audit looks for</h3>
            <p className="hint mt-1">
              A pack turns checks on and off, adds one of your own in a sentence, and moves
              the bar. Nothing here changes a work until the work picks the pack.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setDraft(BLANK)}>New pack</button>
        </div>
        {note ? <p className="hint mt-2">{note}</p> : null}
      </div>

      <div className="panel">
        <h3 className="h-panel">Packs</h3>
        <div className="rows mt-2.5">
          {packs.map((p) => (
            <div className="row py-2.5 px-1 gap-2.5" key={p.id}>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDraft(p)}>{p.id}</button>
              <span className="grow" />
              <span className="meta">
                v{p.version} · {p.source === "user" ? "yours" : "shipped"}
                {p.appliesTo?.length ? ` · ${p.appliesTo.join(", ")}` : " · every type"}
              </span>
              {p.source === "user" ? (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => void remove(p.id)}>Remove</button>
              ) : null}
            </div>
          ))}
          {packs.length === 0 ? <Empty compact icon="pulse" title="Your own checks go here. Write one in the panel below." /> : null}
        </div>
      </div>

      <div className="panel">
        <h3 className="h-panel">{draft.id ? `Editing ${draft.id}` : "New pack"}</h3>
        <div className="rowflex gap-2.5 mt-2.5 flex-wrap">
          <label className="field">
            <span className="label">Name</span>
            <input
              className="input" value={draft.id} placeholder="kids-clarity"
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">For which kinds of work</span>
            <input
              className="input" value={(draft.appliesTo ?? []).join(", ")} placeholder="book, short — blank means all"
              onChange={(e) => setDraft({ ...draft, appliesTo: words(e.target.value) })}
            />
          </label>
          <label className="field">
            <span className="label">Passes at</span>
            <input
              className="input" type="number" min={0} max={100}
              value={draft.scoring?.passThreshold ?? 85}
              onChange={(e) => setDraft({
                ...draft, scoring: { ...draft.scoring, passThreshold: Number(e.target.value) },
              })}
            />
          </label>
          <label className="field">
            <span className="label">Repair rounds</span>
            <input
              className="input" type="number" min={0} max={5}
              value={draft.scoring?.maxIterations ?? 2}
              onChange={(e) => setDraft({
                ...draft, scoring: { ...draft.scoring, maxIterations: Number(e.target.value) },
              })}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <h3 className="h-panel">Checks</h3>
        <p className="hint mt-1">
          Leave a row alone and the genre decides, as it does today. On always runs it;
          off never does.
        </p>
        <div className="rows mt-2.5">
          {(catalogue?.dimensions ?? []).map((d) => {
            const state = enabled.has(d.id) ? "on" : disabled.has(d.id) ? "off" : "default";
            return (
              <div className="row py-2 px-1 gap-2.5" key={d.id}>
                <span className="grow">
                  {d.id}. {d.en}
                  {d.ask ? <span className="meta ml-2">{d.ask}</span> : null}
                </span>
                {(["default", "on", "off"] as const).map((s) => (
                  <button
                    key={s} type="button"
                    className={state === s ? "btn btn-sm" : "btn btn-quiet btn-sm"}
                    onClick={() => setDimension(d.id, s)}
                  >
                    {s === "default" ? "As usual" : s === "on" ? "On" : "Off"}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="spread items-start">
          <div>
            <h3 className="h-panel">Your own checks</h3>
            <p className="hint mt-1">
              One sentence saying what to flag. This is where "I want warmer writing"
              becomes something the audit can actually find.
            </p>
          </div>
          <button
            type="button" className="btn btn-sm"
            onClick={() => setCustom([...custom, { id: "", label: "", instruction: "" }])}
          >
            Add a check
          </button>
        </div>
        <div className="rows mt-2.5">
          {custom.map((d, i) => (
            <div className="row py-2.5 px-1 gap-2 items-start" key={i}>
              <input
                className="input max-w-40" value={d.label} placeholder="Human warmth"
                aria-label="Check name"
                onChange={(e) => setCustom(custom.map((x, j) => j === i
                  ? { ...x, label: e.target.value, id: x.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-") }
                  : x))}
              />
              <input
                className="input grow" value={d.instruction}
                placeholder="Flag passages that state a feeling instead of showing it."
                aria-label="What to flag"
                onChange={(e) => setCustom(custom.map((x, j) => j === i ? { ...x, instruction: e.target.value } : x))}
              />
              <button
                type="button" className="btn btn-quiet btn-sm"
                onClick={() => setCustom(custom.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          {custom.length === 0 ? <p className="hint">None yet.</p> : null}
        </div>
      </div>

      <div className="panel">
        <h3 className="h-panel">Words and limits</h3>
        <p className="hint mt-1">
          Words to start flagging, and a paragraph ceiling. These cost nothing to check.
        </p>
        <div className="rowflex gap-2.5 mt-2.5 flex-wrap">
          {wordField("Tired words", "fatigueWords", "nestled, testament, tapestry")}
          {wordField("Hedges", "hedgeWords", "seems, perhaps")}
          {wordField("Joins", "markers", "however, meanwhile")}
          <label className="field">
            <span className="label">Longest paragraph</span>
            <input
              className="input" type="number" min={0}
              value={draft.deterministic?.paragraph?.maxChars ?? 0}
              onChange={(e) => setDraft({
                ...draft,
                deterministic: {
                  ...draft.deterministic,
                  paragraph: { maxChars: Number(e.target.value) || undefined },
                },
              })}
            />
          </label>
          <label className="field grow">
            <span className="label">Stops an approval</span>
            <input
              className="input" value={(draft.blocking ?? []).join(", ")}
              placeholder="readability/over-cap"
              onChange={(e) => setDraft({ ...draft, blocking: words(e.target.value) })}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="spread items-start">
          <div>
            <h3 className="h-panel">Try it on a file</h3>
            <p className="hint mt-1">
              Reports only — it never rewrites. Path is relative to the workspace.
            </p>
          </div>
          <div className="rowflex gap-2">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void tryIt()}>
              {busy ? "Reading…" : "Try it"}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>Save pack</button>
          </div>
        </div>
        <div className="rowflex gap-2.5 mt-2.5 flex-wrap">
          <label className="field">
            <span className="label">Kind</span>
            <input className="input" value={trial.type} onChange={(e) => setTrial({ ...trial, type: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Work</span>
            <input className="input" value={trial.id} onChange={(e) => setTrial({ ...trial, id: e.target.value })} />
          </label>
          <label className="field grow">
            <span className="label">File</span>
            <input
              className="input" value={trial.path} placeholder="books/my-book/chapters/01_opening.md"
              onChange={(e) => setTrial({ ...trial, path: e.target.value })}
            />
          </label>
        </div>
        {findings ? (
          <div className="rows mt-2.5">
            {findings.length === 0 ? <p className="hint">Nothing flagged.</p> : findings.map((f, i) => (
              <div className="row py-2 px-1 gap-2.5" key={i}>
                <span className="meta min-w-17.5">{f.severity}</span>
                <span className="grow">{f.description}</span>
                <span className="meta">{f.category}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="spread items-start">
          <div>
            <h3 className="h-panel">The bench</h3>
            <p className="hint mt-1">
              Passages from findings you already took or left. Saving a pack checks them,
              so loosening one check cannot quietly silence another. It warns; it never
              stops you saving.
            </p>
          </div>
          <div className="rowflex gap-2">
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void seedBench()}>
              Seed from my findings
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void runBench()}>
              Run the bench
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
