/**
 * The pictures a work has, where the work is being read (04 §2).
 *
 * Images existed only in the folder, so reading a chapter never showed what
 * had been drawn for it. A row of thumbnails beside the text — this page's own
 * first, then the rest of the work's — each one a way into the gallery where
 * the verdicts are given. Draws nothing when the work has no pictures, so a
 * script or a translation shows no empty box.
 */
import { useEffect, useState } from "react";
import { buildApiUrl, fetchJson } from "../hooks/use-api";

interface Picture {
  readonly path: string;
  readonly name: string;
  readonly approved: string | null;
  readonly recipe: { readonly unit?: unknown } | null;
}

const fileUrl = (path: string) =>
  buildApiUrl(`/project/files/${path.split("/").map(encodeURIComponent).join("/")}`) ?? undefined;

export function PicturesStrip({ kind, id, unit }: {
  readonly kind: string;
  readonly id: string;
  /** The unit being read, so its own pictures lead. */
  readonly unit?: number;
}) {
  const [pictures, setPictures] = useState<ReadonlyArray<Picture>>([]);

  useEffect(() => {
    let live = true;
    fetchJson<{ assets: ReadonlyArray<Picture> }>(
      `/assets?type=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
    )
      .then((data) => { if (live) setPictures(data.assets); })
      .catch(() => { if (live) setPictures([]); });
    return () => { live = false; };
  }, [kind, id]);

  if (pictures.length === 0) return null;
  const gallery = `#/gallery/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
  const ownUnit = (p: Picture) => unit !== undefined && p.recipe?.unit === unit;
  const mine = pictures.filter(ownUnit);
  const ordered = [...mine, ...pictures.filter((p) => !ownUnit(p))];

  return (
    <div className="panel-body py-3 px-4">
      <div className="label spread mb-2">
        <span>
          {unit !== undefined
            ? `${mine.length} for this page · ${pictures.length} in all`
            : `${pictures.length} picture${pictures.length === 1 ? "" : "s"}`}
        </span>
        <a href={gallery}>Open the gallery</a>
      </div>
      <div className="thumbs">
        {ordered.slice(0, 8).map((p) => (
          <a key={p.path} href={gallery} title={p.name}>
            <img
              src={fileUrl(p.path)}
              alt={p.name}
              loading="lazy"
              data-chosen={p.approved ? "true" : undefined}
              data-here={ownUnit(p) ? "true" : undefined}
            />
          </a>
        ))}
      </div>
    </div>
  );
}
