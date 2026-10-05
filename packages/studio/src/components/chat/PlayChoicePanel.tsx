export function PlayChoicePanel(props: {
  readonly choices: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly isZh: boolean;
  readonly onChoose: (action: string) => void;
}) {
  if (props.choices.length === 0) {
    return (
      <div className="px-4 py-3 text-center text-xs text-muted-foreground/60">
        {props.disabled ? (props.isZh ? "推进中…" : "Advancing…") : (props.isZh ? "等待场景给出选项…" : "Waiting for choices…")}
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
        {props.choices.map((choice, i) => (
          <button
            key={`${i}-${choice}`}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChoose(choice)}
            className="btn btn-line group inline-flex items-center gap-2 text-foreground/90"
          >
            <span aria-hidden className="text-xs text-primary/50 transition-colors group-hover:text-primary">▸</span>
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}
