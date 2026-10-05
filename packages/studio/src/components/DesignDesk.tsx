/**
 * The design desk: a work's world, its kit, its cast and the person's own
 * final, as four cards above its pictures (08 §6, 07 §1b, 08 §9, 04 §6).
 *
 * Every one of these was a file nobody could see: the world the pictures are
 * drawn in, the swatches and masks that follow from it, who the recurring
 * characters are and which drawing of each is the real one, and the finished
 * text or PDF the person made after the pipeline stopped. Here they can be
 * kept, changed, or learned from — and each decision is a verdict in the
 * feedback stream like any other.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { buildApiUrl, fetchJson } from "../hooks/use-api";
import type { JobsView } from "../hooks/use-jobs";
import { toast } from "./ui/vermilion";

interface Policy {
  readonly surfaces: ReadonlyArray<string>;
  readonly realism: string;
  readonly worldScope: string;
}
interface World {
  readonly n?: number;
  readonly register?: string;
  readonly technique?: string;
  readonly idiom?: string;
  readonly paper?: string;
  readonly ink?: string;
  readonly hue?: string;
  readonly imagePrompt?: string;
  readonly props?: ReadonlyArray<string>;
  readonly approvedAt?: string;
  readonly kit?: string;
}
interface KitAsset {
  readonly id: string;
  readonly kind: string;
  readonly file: string;
  readonly subjectKey?: string;
  readonly state: string;
  readonly origin: string;
}
interface Kit {
  readonly dir: string;
  readonly manifest: { readonly id: string; readonly version: number; readonly approvedAt: string | null; readonly assets: ReadonlyArray<KitAsset> };
  readonly swatches: {
    readonly paper: string; readonly ink: string; readonly hue: string;
    readonly tints: Readonly<Record<string, string>>;
    readonly gradients: ReadonlyArray<{ readonly id: string; readonly stops: ReadonlyArray<{ readonly at: number; readonly hex: string }> }>;
  };
  readonly textStyles: { readonly display: string; readonly text: string };
  readonly fx: { readonly allowed: ReadonlyArray<{ readonly id: string }> };
}
interface CastMember {
  readonly id: string;
  readonly name: string;
  readonly species?: string;
  readonly age?: string;
  readonly wardrobe: ReadonlyArray<string>;
  readonly traits: ReadonlyArray<string>;
  readonly chosen?: string | null;
  readonly candidates: ReadonlyArray<string>;
}
interface DesignView {
  readonly policy: Policy | null;
  readonly world: World | null;
  readonly sections: ReadonlyArray<World>;
  readonly kits: ReadonlyArray<Kit>;
  readonly cast: ReadonlyArray<CastMember>;
  readonly castAsked: boolean;
}
interface FinalFile {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly kind: string;
}
interface FinalView {
  readonly dir: string;
  readonly files: ReadonlyArray<FinalFile>;
  readonly last: null | {
    readonly ingestedAt: string;
    readonly text: { readonly source: string; readonly edits: number; readonly removed: number; readonly added: number };
    readonly drift: ReadonlyArray<{ readonly feature: string; readonly before: number; readonly after: number }>;
    readonly pdf: null | { readonly pages: number; readonly builtPages: number | null; readonly changed: ReadonlyArray<number> };
    readonly assets: { readonly entered: number; readonly kit: number };
    readonly afdesign: ReadonlyArray<string>;
    readonly notes: ReadonlyArray<string>;
  };
}
interface Proposal {
  readonly id: string;
  readonly text: string;
  readonly scope: Readonly<Record<string, string>>;
}

const enc = encodeURIComponent;
const fileUrl = (path: string) => buildApiUrl(`/project/files/${path.split("/").map(enc).join("/")}`) ?? undefined;
const post = (path: string, body: unknown) => fetchJson(path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const asDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error ?? new Error("could not read the file"));
  r.readAsDataURL(file);
});
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const round = (n: number) => Math.round(n * 10) / 10;
const FEATURE: Readonly<Record<string, string>> = {
  avgSentenceLength: "sentence length",
  avgParagraphLength: "paragraph length",
  vocabularyDiversity: "word variety",
};

function policyLine(policy: Policy | null): string {
  if (!policy) return "This kind of work has no pictures.";
  const scope = policy.worldScope === "section" ? "One world per section." : "One world for the whole work.";
  if (policy.realism === "forbidden") return `Illustrated, never photographed. ${scope}`;
  return `Pictures: ${policy.surfaces.join(", ")}. ${scope}`;
}

function Swatches({ colours }: { readonly colours: ReadonlyArray<string | undefined> }) {
  const shown = colours.filter((c): c is string => !!c);
  if (!shown.length) return null;
  return (
    <div className="swatches">
      {shown.map((c, i) => <span key={`${c}-${i}`} className="swatch" style={{ background: c }} title={c} />)}
    </div>
  );
}

function NoteRow({ placeholder, action, onSend, onCancel }: {
  readonly placeholder: string;
  readonly action: string;
  readonly onSend: (text: string) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="rowflex gap-1.5">
      <input
        className="input grow"
        autoFocus
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSend(text.trim());
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className="btn btn-sm" onClick={() => onSend(text.trim())}>{action}</button>
    </div>
  );
}

function Card({ title, badge, children }: { readonly title: string; readonly badge?: ReactNode; readonly children: ReactNode }) {
  return (
    <article className="desk-card">
      <header className="desk-head">
        <span className="label">{title}</span>
        {badge ?? null}
      </header>
      {children}
    </article>
  );
}

function KitView({ kit }: { readonly kit: Kit }) {
  const s = kit.swatches;
  const drawn = kit.manifest.assets.filter((a) => a.origin === "kit");
  const kept = kit.manifest.assets.filter((a) => a.origin !== "kit");
  return (
    <div className="kit">
      <span className="mono dim text-cap">{kit.manifest.id}@{kit.manifest.version}</span>
      <Swatches colours={[s.paper, ...Object.values(s.tints), s.hue, s.ink]} />
      <div className="gradbars">
        {s.gradients.map((g) => (
          <span
            key={g.id}
            className="gradbar"
            title={g.id}
            style={{ background: `linear-gradient(90deg, ${g.stops.map((x) => `${x.hex} ${Math.round(x.at * 100)}%`).join(", ")})` }}
          />
        ))}
      </div>
      {drawn.length ? (
        <div className="thumbs kit-thumbs">
          {drawn.map((a) => <img key={a.id} src={fileUrl(a.file)} alt={a.id} title={a.id} loading="lazy" />)}
        </div>
      ) : null}
      <div className="specimen">
        <span style={{ fontFamily: `"${kit.textStyles.display}", var(--font-read)` }}>Aa</span>
        <span className="dim">{kit.textStyles.display} / {kit.textStyles.text}</span>
      </div>
      <span className="hint">
        {kit.fx.allowed.length ? `Effects allowed: ${kit.fx.allowed.map((f) => f.id).join(", ")}` : "No effects — this world earns none."}
      </span>
      {kept.length ? (
        <>
          <span className="label">Kept, never drawn again</span>
          <div className="thumbs kit-thumbs">
            {kept.map((a) => (
              <img
                key={a.id}
                src={fileUrl(a.file)}
                alt={a.subjectKey ?? a.id}
                title={`${a.subjectKey ?? a.id} · ${a.state}${a.origin === "final" ? " · from your final" : ""}`}
                data-chosen={a.state === "approved" ? "true" : undefined}
                loading="lazy"
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function DesignDesk({ type, id, jobs }: {
  readonly type: string;
  readonly id: string;
  readonly jobs: JobsView;
}) {
  const [design, setDesign] = useState<DesignView | null>(null);
  const [final, setFinal] = useState<FinalView | null>(null);
  const [proposals, setProposals] = useState<ReadonlyArray<Proposal>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = `type=${enc(type)}&id=${enc(id)}`;
    const [d, f, p] = await Promise.all([
      fetchJson<DesignView>(`/design?${q}`).catch(() => null),
      fetchJson<FinalView>(`/final?${q}`).catch(() => null),
      fetchJson<{ proposals: ReadonlyArray<Proposal> }>("/taste/proposals?state=pending").catch(() => ({ proposals: [] })),
    ]);
    setDesign(d);
    setFinal(f);
    setProposals(p.proposals.filter((x) => x.scope.work === `${type}/${id}`));
  }, [type, id]);

  useEffect(() => { void load(); }, [load]);

  /* Worlds, casts and finals change from the queue. Look again when this
     work's last design or taste job ends. */
  const working = jobs.live.filter((j) => j.ref.type === type && j.ref.id === id
    && (j.stage.startsWith("design.") || j.stage.startsWith("taste."))).length;
  const learning = jobs.live.some((j) => j.ref.type === type && j.ref.id === id && j.stage === "taste.ingestFinal");
  useEffect(() => { if (working === 0) void load(); }, [working, load]);

  const run = async (key: string, fn: () => Promise<unknown>, said: string) => {
    setBusy(key);
    setAsking(null);
    try {
      await fn();
      toast(said);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not take.");
    } finally {
      setBusy(null);
    }
  };

  const world = design?.world ?? null;
  const kits = design?.kits ?? [];
  const cast = design?.cast ?? [];
  const files = final?.files ?? [];
  const last = final?.last ?? null;
  const prose = type !== "publication";

  return (
    <section className="desk" aria-label="Design desk">
      {/* ------------------------------------------------------ world */}
      <Card
        title="World"
        badge={world ? (world.approvedAt ? <span className="pill pill-ok">kept</span> : <span className="pill pill-warn">not kept yet</span>) : null}
      >
        <span className="hint">{policyLine(design?.policy ?? null)}</span>
        {!prose ? (
          design?.sections.length ? (
            <div className="stack-xs">
              {design.sections.map((w) => (
                <div key={w.n} className="rowflex gap-2 items-center">
                  <Swatches colours={[w.paper, w.ink, w.hue]} />
                  <span className="trunc text-small">§{w.n} · {w.technique ?? "—"}{w.idiom ? ` · ${w.idiom}` : ""}</span>
                </div>
              ))}
              <span className="hint">Chosen per section at the issue's design stage.</span>
            </div>
          ) : <p className="dim m-0">The issue's design stage chooses one world per section.</p>
        ) : world ? (
          <>
            <Swatches colours={[world.paper, world.ink, world.hue]} />
            <b className="text-small">{world.technique}{world.idiom ? ` · ${world.idiom}` : ""}</b>
            {world.imagePrompt ? <p className="dim clamp3">{world.imagePrompt}</p> : null}
            {world.props?.length ? (
              <div className="chips">{world.props.map((p) => <span key={p} className="chip chip-static">{p}</span>)}</div>
            ) : null}
            <div className="rowflex gap-1.5 flex-wrap">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== null || !!world.approvedAt}
                onClick={() => void run("world", () => post("/design/world", { type, id, action: "approve" }), "World kept.")}
              >
                {world.approvedAt ? "Kept" : "Keep this world"}
              </button>
              <button type="button" className="btn btn-line btn-sm" disabled={busy !== null} onClick={() => setAsking("world")}>
                Another world…
              </button>
            </div>
            {asking === "world" ? (
              <NoteRow
                placeholder="What should change? (optional)"
                action="Choose again"
                onCancel={() => setAsking(null)}
                onSend={(note) => void run(
                  "world",
                  () => post("/design/world", { type, id, action: "reworld", note }),
                  "Choosing another world. Pictures drawn in this one will show as older.",
                )}
              />
            ) : null}
          </>
        ) : (
          <p className="dim m-0">Chosen from the text the first time this work's art is planned.</p>
        )}
      </Card>

      {/* -------------------------------------------------------- kit */}
      <Card
        title="Kit"
        badge={kits.length
          ? kits.every((k) => k.manifest.approvedAt)
            ? <span className="pill pill-ok">approved</span>
            : <span className="pill pill-warn">proposed</span>
          : null}
      >
        {kits.length === 0 ? (
          <p className="dim m-0">
            Swatches, gradients, masks and paper for this world — and every ornament once it is kept, so nothing is drawn twice.
          </p>
        ) : kits.map((k) => <KitView key={k.dir} kit={k} />)}
        <div className="rowflex gap-1.5 flex-wrap">
          <button
            type="button"
            className="btn btn-line btn-sm"
            disabled={busy !== null || (prose && !world)}
            title={prose && !world ? "The work needs a world first" : undefined}
            onClick={() => void run("kit", () => post("/design/kit", { type, id, action: "propose" }), "Kit proposed from the world.")}
          >
            {kits.length ? "Propose again" : "Propose a kit"}
          </button>
          {kits.length ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy !== null || kits.every((k) => k.manifest.approvedAt)}
              onClick={() => void run("kit", () => post("/design/kit", { type, id, action: "approve" }), "Kit approved.")}
            >
              Approve the kit
            </button>
          ) : null}
        </div>
      </Card>

      {/* ------------------------------------------------------- cast */}
      <Card
        title="Cast"
        badge={cast.length ? <span className="pill">{cast.filter((m) => m.chosen).length}/{cast.length} with a reference</span> : null}
      >
        {cast.length === 0 ? (
          <p className="dim m-0">
            {design?.castAsked
              ? "No recurring characters in this work."
              : "Read off the text the first time art is planned, so every picture draws the same faces."}
          </p>
        ) : null}
        {cast.map((m) => (
          <div key={m.id} className="castrow">
            {m.chosen
              ? <img className="castref" src={fileUrl(m.chosen)} alt={`${m.name}, the chosen reference`} />
              : <div className="castref castref-empty">no reference yet</div>}
            <div className="grow stack-xs min-w-0">
              <span><b>{m.name}</b> <span className="dim">{[m.age, m.species].filter(Boolean).join(" ")}</span></span>
              <p className="dim clamp2">{[...m.traits, ...m.wardrobe.map((w) => `wears ${w}`)].join(", ")}</p>
              {m.candidates.filter((c) => c !== m.chosen).length ? (
                <div className="thumbs">
                  {m.candidates.filter((c) => c !== m.chosen).slice(-6).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="thumbbtn"
                      title={`Choose this as ${m.name}`}
                      aria-label={`Choose this candidate as ${m.name}'s reference`}
                      disabled={busy !== null}
                      onClick={() => void run(`cast-${m.id}`, () => post("/design/cast/choose", { type, id, character: m.id, path: c }), `${m.name}'s reference chosen.`)}
                    >
                      <img src={fileUrl(c)} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="rowflex gap-1.5 flex-wrap">
                <button type="button" className="btn btn-line btn-sm" disabled={busy !== null} onClick={() => setAsking(`cast-${m.id}`)}>
                  Draw 3 candidates
                </button>
                <label className="btn btn-quiet btn-sm">
                  Upload a drawing
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      void run(`cast-${m.id}`, async () => post("/design/cast/upload", {
                        type, id, character: m.id, filename: file.name, dataUrl: await asDataUrl(file),
                      }), `Your drawing is ${m.name}'s reference now.`);
                    }}
                  />
                </label>
              </div>
              {asking === `cast-${m.id}` ? (
                <NoteRow
                  placeholder="Anything to change? (optional)"
                  action="Draw"
                  onCancel={() => setAsking(null)}
                  onSend={(note) => void run(
                    `cast-${m.id}`,
                    () => post("/design/cast/draw", { type, id, character: m.id, note }),
                    "Drawing three candidates. They appear here when they are done.",
                  )}
                />
              ) : null}
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy !== null}
            onClick={() => void run("cast", () => post("/design/cast", { type, id }), "Reading the cast off the text.")}
          >
            {design?.castAsked ? "Read the cast again" : "Read the cast now"}
          </button>
        </div>
      </Card>

      {/* ------------------------------------------------------ final */}
      <Card
        title="Your final"
        badge={last ? <span className="pill" title={last.ingestedAt}>learned {new Date(last.ingestedAt).toLocaleDateString()}</span> : null}
      >
        <span className="hint">
          Put the text you consider finished, the PDF you printed, or pictures you made in{" "}
          <span className="mono">{final?.dir ?? "my-final"}/</span>. The pipeline never writes there.
        </span>
        {files.length ? (
          <ul className="finalfiles">
            {files.map((f) => (
              <li key={f.path}>
                <span className="trunc" title={f.path}>{f.name}</span>
                <span className="dim">{f.kind} · {size(f.bytes)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="rowflex gap-1.5 flex-wrap">
          <label className="btn btn-line btn-sm">
            Add files
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                if (!picked.length) return;
                void run("final", async () => {
                  for (const file of picked) {
                    await post("/final/upload", { type, id, filename: file.name, dataUrl: await asDataUrl(file) });
                  }
                }, `${picked.length} file${picked.length === 1 ? "" : "s"} added to your final.`);
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== null || learning || files.length === 0}
            onClick={() => void run("learn", () => post("/final/learn", { type, id }), "Learning from your final. The summary appears here.")}
          >
            {learning ? "Learning…" : "Learn from final"}
          </button>
        </div>
        {last ? (
          <div className="stack-xs text-small">
            <span>
              {last.text.source === "none"
                ? "No text to compare."
                : `${last.text.edits} edits · ${last.text.removed} cut · ${last.text.added} new sentences`}
            </span>
            {last.drift.map((d) => (
              <span key={d.feature} className="dim">{FEATURE[d.feature] ?? d.feature}: {round(d.before)} → {round(d.after)}</span>
            ))}
            {last.pdf ? (
              <span className="dim">
                PDF: {last.pdf.pages} pages{last.pdf.builtPages !== null ? `, ${last.pdf.changed.length} differ from the build` : ""}
              </span>
            ) : null}
            {last.assets.entered ? <span className="dim">{last.assets.entered} pictures in, {last.assets.kit} kept as kit drafts</span> : null}
            {last.notes.map((n) => <span key={n} className="hint">{n}</span>)}
          </div>
        ) : null}
        {proposals.length ? (
          <div className="stack-xs">
            <span className="label">Proposed from your final</span>
            {proposals.map((p) => (
              <div key={p.id} className="proposal">
                <span>{p.text}</span>
                <span className="rowflex gap-1.5">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy !== null}
                    onClick={() => void run(p.id, () => post(`/taste/proposals/${enc(p.id)}/accept`, {}), "Accepted. The taste engine keeps it.")}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    disabled={busy !== null}
                    onClick={() => void run(p.id, () => post(`/taste/proposals/${enc(p.id)}/ignore`, {}), "Ignored. It will not be proposed again.")}
                  >
                    Ignore
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
