import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { PageHead } from "../components/ui/page-head";
import { toast } from "../components/ui/vermilion";

/*
 * The house book (Phase 7, analysis/26-design-engine.md): what never changes
 * between issues. Masthead, type, scale, margins, rules and the composition
 * systems an issue may use. Colour, panels and art are not here: each section
 * writes its own from its copy. Approved once; any edit makes it a draft
 * again, and a draft decides nothing - the design stage only obeys an approved house.
 */

interface House {
  name: string; status: "draft" | "approved"; approvedAt?: string;
  type: { display: string; text: string };
  scale: { body: number; ratio: number };
  marginMm: number; gutterMm: number; baselineMm: number;
  grids: string[];
  devices: { rule: string; folio: string; kicker: string };
  notes?: string;
}

interface Choices { grids: string[]; rules: string[] }

const BLANK: House = {
  name: "", status: "draft", type: { display: "", text: "" }, scale: { body: 9.5, ratio: 1.333 },
  marginMm: 16, gutterMm: 5, baselineMm: 4.5,
  grids: ["columns"], devices: { rule: "hairline", folio: "", kicker: "" },
};

const GRID_WORDS: Record<string, string> = {
  columns: "columns - even, for reading",
  modular: "modular - fields, for data",
  thirds: "thirds - calm, balanced",
  golden: "golden ratio - classical tension",
  canon: "canon - a book's text block",
};

const call = async (path: string, init?: RequestInit) => {
  const res = await fetch(`/api/v1${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, unknown> };
};

export function HousePage() {
  const [house, setHouse] = useState<House | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [scale, setScale] = useState<number[]>([]);
  const [choices, setChoices] = useState<Choices>({ grids: [], rules: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [blank, setBlank] = useState<House>(BLANK);

  const load = useCallback(async () => {
    const { body } = await call("/house");
    setHouse((body.house as House | null) ?? null);
    setProblems((body.problems as string[]) ?? []);
    setScale((body.scale as number[]) ?? []);
    setChoices((body.choices as Choices) ?? { grids: [], rules: [] });
    if (body.blank) setBlank(body.blank as House);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const h = house ?? blank;
  const edit = (patch: Partial<House>) => setHouse({ ...h, ...patch, status: "draft" });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    setBusy("save");
    const { ok, body } = await call("/house", { method: "PUT", body: JSON.stringify(h) });
    setBusy(null);
    if (!ok) { toast(String(body.error ?? "Could not save the house"), "bad"); return; }
    toast("House saved as a draft");
    await load();
  };
  const approve = async () => {
    setBusy("approve");
    const { ok, body } = await call("/house/approve", { method: "POST" });
    setBusy(null);
    if (!ok) { setProblems((body.problems as string[]) ?? [String(body.error)]); toast("The house is not ready to approve", "bad"); return; }
    toast("House approved: every design now follows it");
    await load();
  };
  const propose = async () => {
    setBusy("propose");
    const { ok, body } = await call("/house/propose", { method: "POST" });
    const id = (body.job as { id?: string } | undefined)?.id;
    if (!ok || !id) { setBusy(null); toast(String(body.error ?? "Could not start the draft"), "bad"); return; }
    for (;;) {
      await new Promise((r) => setTimeout(r, 2500));
      const jobs = ((await call("/jobs")).body.jobs as Array<{ id: string; status: string; error?: string }>) ?? [];
      const job = jobs.find((j) => j.id === id);
      if (!job || ["done", "failed", "cancelled"].includes(job.status)) {
        setBusy(null);
        if (job?.status === "failed") toast(`The draft failed: ${job.error ?? ""}`, "bad");
        await load();
        return;
      }
    }
  };

  const unsaved = house !== null && house.status === "draft";
  return (
    <div className="stack-lg">
      <PageHead
        title="House"
        lede="What every issue shares, whatever its subject: masthead, type, margins, rules and grids. Each section writes its own colours, panels and art from its copy."
        actions={
          <>
            <span className={h.status === "approved" ? "pill pill-ok" : "pill"}>{house ? h.status : "none yet"}</span>
            <button type="button" className="btn btn-line btn-sm" disabled={busy !== null} onClick={() => void propose()}>
              {busy === "propose" ? "Drafting…" : "Draft with the model"}
            </button>
            <button type="button" className="btn btn-line btn-sm" disabled={busy !== null || !unsaved} onClick={() => void save()}>Save draft</button>
            <button type="button" className="btn btn-sm" disabled={busy !== null || !house || h.status === "approved"} onClick={() => void approve()}>Approve</button>
          </>
        }
      />

      {problems.length ? (
        <div className="notice">
          <p className="mb-1.5">Before it can be approved:</p>
          <ul className="stack-xs">{problems.map((p) => <li key={p} className="hint is-bad">{p}</li>)}</ul>
        </div>
      ) : null}

      <section className="cols cols-a items-start">
        <div className="stack">
          <div className="panel stack">
            <h3 className="h-panel">Masthead and type</h3>
            <div className="cols cols-2">
              <label className="field"><span className="field-label">Masthead</span>
                <input className="input" value={h.name} onChange={(e) => edit({ name: e.target.value })} /></label>
              <span />
              <label className="field"><span className="field-label">Display face</span>
                <input className="input" value={h.type.display} onChange={(e) => edit({ type: { ...h.type, display: e.target.value } })} /></label>
              <label className="field"><span className="field-label">Text face</span>
                <input className="input" value={h.type.text} onChange={(e) => edit({ type: { ...h.type, text: e.target.value } })} /></label>
              <label className="field"><span className="field-label">Body size (pt)</span>
                <input className="input" type="number" step="0.5" value={h.scale.body} onChange={(e) => edit({ scale: { ...h.scale, body: Number(e.target.value) } })} /></label>
              <label className="field"><span className="field-label">Scale ratio</span>
                <input className="input" type="number" step="0.001" value={h.scale.ratio} onChange={(e) => edit({ scale: { ...h.scale, ratio: Number(e.target.value) } })} /></label>
            </div>
          </div>

          <div className="panel stack">
            <h3 className="h-panel">Space</h3>
            <div className="cols cols-3">
              {(["marginMm", "gutterMm", "baselineMm"] as const).map((k) => (
                <label key={k} className="field"><span className="field-label">{{ marginMm: "Margin (mm)", gutterMm: "Gutter (mm)", baselineMm: "Baseline (mm)" }[k]}</span>
                  <input className="input" type="number" step="0.25" value={h[k]} onChange={(e) => edit({ [k]: Number(e.target.value) } as Partial<House>)} /></label>
              ))}
            </div>
            <p className="hint">Colour is not a house decision: every section chooses its own palette from what it is about.</p>
          </div>

          <div className="panel stack">
            <h3 className="h-panel">Composition systems</h3>
            <div className="chips">
              {choices.grids.map((g) => (
                <button key={g} type="button" className="chip" aria-pressed={h.grids.includes(g)} onClick={() => edit({ grids: toggle(h.grids, g) })}>
                  {GRID_WORDS[g] ?? g}
                </button>
              ))}
            </div>
            <p className="hint">An issue picks one of these for its subject; pages are composed on its lines.</p>
          </div>

          <div className="panel stack">
            <h3 className="h-panel">Devices</h3>
            <div className="cols cols-2">
              <label className="field"><span className="field-label">Rules</span>
                <select className="input" value={h.devices.rule} onChange={(e) => edit({ devices: { ...h.devices, rule: e.target.value } })}>
                  {choices.rules.map((r) => <option key={r} value={r}>{r}</option>)}
                </select></label>
              <label className="field"><span className="field-label">Folio</span>
                <input className="input" value={h.devices.folio} onChange={(e) => edit({ devices: { ...h.devices, folio: e.target.value } })} /></label>
              <label className="field"><span className="field-label">Kicker</span>
                <input className="input" value={h.devices.kicker} onChange={(e) => edit({ devices: { ...h.devices, kicker: e.target.value } })} /></label>
            </div>
          </div>

          <label className="field"><span className="field-label">Notes: what makes a page ours</span>
            <textarea className="input" value={h.notes ?? ""} onChange={(e) => edit({ notes: e.target.value })} /></label>
        </div>

        {/* The house as it will print: masthead, scale and text in its own faces. */}
        <div className="panel stack house-specimen" style={{
          "--hs-display": `"${h.type.display}"`, "--hs-text": `"${h.type.text}"`,
        } as CSSProperties}>
          <p className="trunc house-display house-mast">{h.name || "Masthead"}</p>
          <div className="stack-xs">
            {(scale.length ? scale : [42, 24, 18, 13, 9.5]).map((pt) => (
              <p key={pt} className="trunc house-display" style={{ fontSize: `${Math.min(pt, 40) * 1.33}px` }}>
                {pt} pt <span className="house-text">The line that holds</span>
              </p>
            ))}
          </div>
          <p className="house-text house-body" style={{ fontSize: `${h.scale.body * 1.33}px` }}>
            Every point on a contour line sits at the same height, so it never breaks and never crosses another. Follow one far enough and it stops being a drawing.
          </p>
        </div>
      </section>
    </div>
  );
}
