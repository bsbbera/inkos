/**
 * Every picture a creation has, and your say on each (04 §2, §7).
 *
 * Pictures were written into each work's folder and nothing showed them. This
 * is the one place they are seen together, under the design desk that decides
 * how they look. Each card carries the same verdict as every other card in the
 * app — keep chooses it, redo and tweak draw it again with what went wrong,
 * reject moves it to the trash — and a treatment switch that changes how it
 * sits on the page without drawing it again. The trash is a view of the same
 * folder, and deleting from there is the only move that cannot be taken back.
 */
import { useCallback, useEffect, useState } from "react";
import { buildApiUrl, fetchJson, useApi } from "../hooks/use-api";
import type { JobsView } from "../hooks/use-jobs";
import { DesignDesk } from "../components/DesignDesk";
import { Verdict } from "../components/Verdict";
import { Empty, Failed, Loading } from "../components/ui/states";
import { Seg, toast } from "../components/ui/vermilion";
import { ask } from "../components/ConfirmDialog";

interface Asset {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly modified: string;
  readonly recipe: Record<string, unknown> | null;
  readonly approved: string | null;
  readonly stale: boolean;
  readonly source: "generated" | "kit" | "user";
}

interface Project {
  readonly kind: string;
  readonly kindLabel: string;
  readonly id: string;
}

/** How a picture may sit. "" is the render as drawn; the server holds the real table. */
const TREATMENTS = [
  "", "full-bleed", "vignette", "fade-vignette", "cutout", "spot", "ornament",
  "watercolor-bleed", "duotone", "wash", "tile", "plate",
] as const;

const text = (v: unknown) => (typeof v === "string" ? v : "");
/* The version rides in the query, so a re-treated picture is fetched again
   rather than shown from the cache under the same name. */
const fileUrl = (path: string, version: string) => {
  const base = buildApiUrl(`/project/files/${path.split("/").map(encodeURIComponent).join("/")}`);
  return base ? `${base}?v=${encodeURIComponent(version)}` : undefined;
};

export function GalleryPage({ type, id, onPick, jobs }: {
  readonly type?: string;
  readonly id?: string;
  readonly onPick: (type: string, id: string) => void;
  readonly jobs: JobsView;
}) {
  const {
    data: projectData, error: projectError, loading: projectsLoading, refetch: refetchProjects,
  } = useApi<{ projects: ReadonlyArray<Project> }>("/audit/projects");
  const projects = projectData?.projects ?? [];
  const workType = type ?? projects[0]?.kind ?? null;
  const workId = id ?? projects[0]?.id ?? null;

  const [view, setView] = useState<"work" | "trash">("work");
  const [assets, setAssets] = useState<ReadonlyArray<Asset> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* The picture whose description is open for editing, and the words so far. */
  const [editing, setEditing] = useState<{ path: string; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!workType || !workId) return;
    const query = `type=${encodeURIComponent(workType)}&id=${encodeURIComponent(workId)}`
      + (view === "trash" ? "&trash=1" : "");
    try {
      setAssets((await fetchJson<{ assets: ReadonlyArray<Asset> }>(`/assets?${query}`)).assets);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workType, workId, view]);

  useEffect(() => {
    setAssets(null);
    void load();
  }, [load]);

  /* A redraw lands minutes later, from the queue. When the last one for this
     work finishes, look at the folder again. */
  const drawing = jobs.live.filter((j) =>
    j.stage.startsWith("design.redesign") && j.ref.type === workType && j.ref.id === workId).length;
  useEffect(() => {
    if (drawing === 0) void load();
  }, [drawing, load]);

  const act = async (verb: string, asset: Asset, extra: Record<string, unknown>, said: string) => {
    if (!workType || !workId) return;
    setBusy(asset.path);
    try {
      await fetchJson(`/assets/${verb}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: workType, id: workId, path: asset.path, ...extra }),
      });
      toast(said);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not take.");
    } finally {
      setBusy(null);
    }
  };

  if (projectError) {
    return <Failed what="Could not list the work." detail={projectError} retry={() => refetchProjects()} />;
  }
  if (projectsLoading && projects.length === 0) return <Loading what="Looking for work…" rows={3} />;
  if (!workType || !workId) {
    return (
      <Empty icon="grid" title="Nothing has been made yet.">
        Pictures appear here as soon as a book, a story or an issue has any.
      </Empty>
    );
  }

  const here = projects.find((p) => p.kind === workType && p.id === workId);

  return (
    <div className="grid gap-4.5">
      <div className="spread items-end gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="label">Gallery</div>
          <h2 className="trunc mt-1">
            {here ? `${here.kindLabel} · ${here.id}` : `${workType} · ${workId}`}
          </h2>
        </div>
        <div className="rowflex gap-2.5 flex-wrap">
          {drawing ? <span className="pill">{drawing} redrawing</span> : null}
          <select
            className="input"
            aria-label="Which work"
            value={`${workType}/${workId}`}
            onChange={(e) => {
              const [kind, ...rest] = e.target.value.split("/");
              if (kind) onPick(kind, rest.join("/"));
            }}
          >
            {here ? null : <option value={`${workType}/${workId}`}>{workType} · {workId}</option>}
            {projects.map((p) => (
              <option key={`${p.kind}/${p.id}`} value={`${p.kind}/${p.id}`}>{p.kindLabel} · {p.id}</option>
            ))}
          </select>
          <Seg
            compact
            value={view}
            onChange={setView}
            options={[
              { value: "work", label: "Pictures", icon: "grid" },
              { value: "trash", label: "Trash", icon: "trash" },
            ]}
          />
        </div>
      </div>

      {view === "work" ? <DesignDesk type={workType} id={workId} jobs={jobs} /> : null}

      {error ? <Failed what="Could not read the pictures." detail={error} retry={() => void load()} /> : null}
      {assets === null && !error ? <Loading what="Opening the pictures…" rows={2} /> : null}
      {assets && assets.length === 0 ? (
        <Empty icon="grid" title={view === "trash" ? "The trash is empty." : "No pictures yet."}>
          {view === "trash"
            ? "Deleted pictures wait here until you delete them for good."
            : "They appear here as the design stage draws them, each with the recipe that made it."}
        </Empty>
      ) : null}

      {assets && assets.length > 0 ? (
        <div className="tiles">
          {assets.map((a) => {
            const r = a.recipe ?? {};
            const unit = typeof r.unit === "number" ? r.unit : null;
            const treatment = text(r.treatment);
            const caption = [text(r.slot) || a.name, unit !== null ? `unit ${unit}` : "", treatment]
              .filter(Boolean).join(" · ");
            const parts = (r.components ?? {}) as Record<string, unknown>;
            const why = text(r.changeNote)
              ? `Redrawn: ${text(r.changeNote)}`
              : text(r.reusedFrom)
                ? "From the kit — drawn once, reused"
                : a.recipe
                  ? text(parts.technique) || text(r.workflow) || "Recipe kept"
                  : a.source === "user" ? "From your final" : "No recipe, so it cannot be redrawn";
            const mine = busy === a.path;
            return (
              <div key={a.path} className="tile pic" data-chosen={a.approved ? "true" : undefined}>
                <img src={fileUrl(a.path, text(r.treatedAt) || a.modified)} alt={caption} loading="lazy" />
                <div className="pic-body">
                  <div className="spread gap-2">
                    <b className="trunc" title={a.path}>{caption}</b>
                    <span className="rowflex gap-1 flex-none">
                      {a.approved ? <span className="pill pill-ok">chosen</span> : null}
                      {a.stale ? <span className="pill pill-warn" title="Drawn before this work's current world was chosen">older world</span> : null}
                      {a.source === "user" ? <span className="pill">yours</span> : null}
                      {a.source === "kit" ? <span className="pill">kit</span> : null}
                    </span>
                  </div>
                  <span className="who trunc" title={why}>{why}</span>

                  {view === "trash" ? (
                    <div className="rowflex gap-1.5 flex-wrap">
                      <button type="button" className="btn btn-sm" disabled={mine}
                              onClick={() => void act("restore", a, {}, "Put back.")}>
                        Restore
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        disabled={mine}
                        onClick={async () => {
                          if (await ask({ title: `Delete ${a.name} for good?`, message: "This cannot be undone.", confirmLabel: "Delete forever", danger: true })) {
                            void act("purge", a, {}, "Deleted for good.");
                          }
                        }}
                      >
                        Delete forever
                      </button>
                    </div>
                  ) : (
                    <>
                      <Verdict
                        surface="image"
                        refTo={{ type: workType, id: workId, ...(unit !== null ? { unit } : {}) }}
                        target={a.path}
                        source="gallery"
                        keepLabel={a.approved ? "Kept" : "Keep"}
                        onDone={() => void load()}
                      />
                      <div className="rowflex gap-1.5 flex-wrap items-center">
                        <select
                          className="input h-7 text-small py-0 px-1.5"
                          aria-label="How it sits on the page"
                          title={a.recipe ? "How it sits on the page — changed without drawing it again" : why}
                          value={treatment}
                          disabled={mine || !a.recipe || a.source !== "generated"}
                          onChange={(e) => void act(
                            "treat", a, { treatment: e.target.value },
                            e.target.value ? `Now ${e.target.value}.` : "Back to how it was drawn.",
                          )}
                        >
                          {TREATMENTS.map((t) => <option key={t} value={t}>{t || "as drawn"}</option>)}
                        </select>
                        {a.approved ? (
                          <button type="button" className="btn btn-quiet btn-sm" disabled={mine}
                                  onClick={() => void act("approve", a, { approve: false }, "No longer chosen.")}>
                            Unchoose
                          </button>
                        ) : null}
                        {a.recipe && a.source === "generated" && editing?.path !== a.path ? (
                          <button type="button" className="btn btn-quiet btn-sm" disabled={mine}
                                  title="Change what the picture shows; its style stays the world's"
                                  onClick={() => setEditing({
                                    path: a.path, text: text(parts.subject) || text(r.prompt),
                                  })}>
                            Edit description
                          </button>
                        ) : null}
                      </div>
                      {editing?.path === a.path ? (
                        <form
                          className="grid gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const subject = editing.text.trim();
                            if (!subject) return;
                            setEditing(null);
                            void act("redesign", a, { subject }, "Redrawing with the new description.");
                          }}
                        >
                          <textarea
                            className="input"
                            aria-label="What the picture shows"
                            rows={3}
                            value={editing.text}
                            onChange={(e) => setEditing({ path: a.path, text: e.target.value })}
                          />
                          <div className="rowflex gap-1.5">
                            <button type="submit" className="btn btn-sm" disabled={mine || !editing.text.trim()}>
                              Redraw
                            </button>
                            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
