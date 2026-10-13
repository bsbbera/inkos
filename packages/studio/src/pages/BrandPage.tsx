import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../components/ui/page-head";
import { toast } from "../components/ui/vermilion";

/*
 * The brand (core brand.ts): the fixed layer above the house - colours, faces,
 * shapes and pictures. The one selected here is what every new issue is held
 * to; an issue can still be moved off it on its own page.
 */

interface BrandRow { id: string; name: string; mark: string }

export function BrandPage() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const body = await fetch("/api/v1/brands").then((r) => r.json()) as { brands: BrandRow[]; selected: string | null };
    setBrands(body.brands ?? []);
    setSelected(body.selected ?? null);
    setShown((s) => s ?? body.selected ?? body.brands?.[0]?.id ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // The reference spreads are listed by the design system's own files; ask the brand for them.
  useEffect(() => {
    if (!shown) return;
    void fetch(`/api/v1/brands/${shown}`).then((r) => r.ok ? r.json() : { references: [] })
      .then((b: { references?: string[] }) => setRefs(b.references ?? []));
  }, [shown]);

  const select = async (id: string | null) => {
    setBusy(true);
    const res = await fetch("/api/v1/brands/selected", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ brand: id }),
    });
    setBusy(false);
    if (!res.ok) { toast((await res.json().catch(() => ({}))).error ?? "Could not select the brand"); return; }
    await load();
    toast(id ? "New issues will be held to this brand" : "New issues are held to no brand");
  };

  const brand = brands.find((b) => b.id === shown);

  return (
    <div className="stack-lg">
      <PageHead
        title="Brand"
        lede="The fixed layer above the house: colours, faces, shapes and pictures. New issues are held to the selected brand."
        actions={
          <>
            {brands.map((b) => (
              <button key={b.id} type="button" className={b.id === shown ? "btn btn-sm" : "btn btn-line btn-sm"} onClick={() => setShown(b.id)}>
                {b.name}{b.mark && b.mark !== b.name ? ` ${b.mark}` : ""}
              </button>
            ))}
            {brand && (selected === brand.id
              ? <>
                  <span className="pill pill-ok">selected</span>
                  <button type="button" className="btn btn-line btn-sm" disabled={busy} onClick={() => void select(null)}>Use no brand</button>
                </>
              : <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void select(brand.id)}>Select for new issues</button>)}
          </>
        }
      />
      {!brands.length && <p className="muted">No brands are installed.</p>}
      {brand && (
        <>
          <iframe
            title={`${brand.name} design system`}
            src={`/api/v1/brands/${brand.id}/design-system`}
            style={{ width: "100%", height: "78vh", border: "1px solid var(--line, #ddd)", borderRadius: 6, background: "#fff" }}
          />
          {refs.length > 0 && (
            <section className="stack">
              <h2 className="h3">Reference spreads</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {refs.map((f) => (
                  <a key={f} href={`/api/v1/brands/${brand.id}/references/${f}`} target="_blank" rel="noreferrer">
                    <img src={`/api/v1/brands/${brand.id}/references/${f}`} alt={f} loading="lazy" style={{ width: "100%", display: "block", borderRadius: 4 }} />
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
