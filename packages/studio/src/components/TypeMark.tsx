/**
 * The silhouette is the type.
 *
 * `design/mock/03-books.html` draws this table once and then says: "It is
 * drawn once here and never labelled again anywhere else in the app." So a
 * screen that names a production and does not draw its mark has dropped out
 * of the vocabulary the rest of the app speaks — which is how the chat column
 * came to name a short without ever saying it was one.
 *
 * The values are the styleguide's own, at row scale. It lives here rather
 * than inside a page because two screens now need the same mark, and a second
 * copy is how the audit screen's production list drifted in the first place.
 */
import type { CSSProperties } from "react";

export function TypeMark({ kind, size = 13 }: { readonly kind: string; readonly size?: number }) {
  const base: CSSProperties = {
    width: size, height: size, borderRadius: "50%", display: "inline-block",
    flex: "none", verticalAlign: "middle",
  };
  const style: CSSProperties =
    kind === "publication" || kind === "magazine"
      // Halftone: ink on paper, up close.
      ? { ...base, backgroundImage: "radial-gradient(currentColor 1.05px, transparent 1.15px)",
          backgroundSize: "4px 4px", color: "var(--ink-3)" }
      : kind === "storybook"
      // A ring: two facing pages, the unit a storybook is written in.
      ? { ...base, border: "1.5px solid var(--vermilion)" }
      : kind === "short"
      // The book's mark, smaller. One sitting.
      ? { ...base, width: size * 0.7, height: size * 0.7, background: "var(--vermilion)", opacity: 0.42 }
      : kind === "storyboard"
      ? { ...base, width: size + 1, height: size - 2, borderRadius: 3, border: "1.5px solid var(--vermilion)", opacity: 0.6 }
      // The filled disc: the heaviest mark, for the heaviest thing on the shelf.
      : { ...base, background: "var(--vermilion)", opacity: 0.5 };

  // A script is ruled paper and speaker names; a circle would lie about it.
  if (kind === "script") {
    return (
      <span aria-hidden="true" style={{ display: "inline-block", width: size + 1, flex: "none" }}>
        <span style={{ display: "block", height: 1.5, background: "var(--vermilion)", opacity: 0.6 }} />
        <span style={{ display: "block", height: 1.5, background: "var(--line)", marginTop: 4, width: size - 4 }} />
      </span>
    );
  }
  return <span aria-hidden="true" style={style} />;
}
