import { ChevronRight } from "../../ui/glyphs";
import type { HoldingRow } from "./types";
import { KIND_LABEL_ZH, KIND_LABEL_EN } from "./types";

export function HoldingSlot(props: {
  readonly row: HoldingRow;
  readonly isZh: boolean;
  readonly generating?: boolean;
  readonly onOpen: () => void;
}) {
  const { row, isZh, generating, onOpen } = props;
  const kind = (isZh ? KIND_LABEL_ZH : KIND_LABEL_EN)[row.kind] ?? row.kind;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="well flex w-full items-center gap-2.5 text-left"
    >
      {row.imageUrl ? (
        <img src={row.imageUrl} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-secondary/60 text-sm">
          {generating ? "⏳" : row.glyph}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body leading-6 font-semibold text-foreground">{row.label}</span>
          {row.isFresh ? (
            <span className="shrink-0 rounded-full bg-success/20 px-1.5 text-small leading-5 font-medium text-(--ok)">
              {isZh ? "新" : "NEW"}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-body leading-6 text-muted-foreground">
          <span className="shrink-0">{kind}</span>
          {row.preview ? <span className="truncate">· {row.preview}</span> : null}
        </span>
      </span>
      <ChevronRight size={13} className="shrink-0 text-muted-foreground/50" />
    </button>
  );
}
