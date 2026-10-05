import type { Theme } from "./use-theme";

/*
 * The class names the shadcn-era pages reach for, pointed at the system's own
 * components. Kept as a map because those pages pass these strings around;
 * new code writes the class (`btn`, `panel`, `input`) directly.
 */
export function useColors(_theme: Theme) {
  return {
    card: "panel",
    cardStatic: "panel",
    surface: "",
    muted: "muted",
    subtle: "dim",
    link: "xref",
    input: "input",
    btnPrimary: "btn",
    btnSecondary: "btn btn-line",
    btnSuccess: "btn",
    btnDanger: "btn btn-bad",
    tableHeader: "label",
    tableDivide: "divide-(--line)",
    tableHover: "hover:bg-(--putty-2)",
    error: "fail",
    info: "pass",
    code: "mono",
    active: "text-(--ok)",
    paused: "text-(--warn)",
    mono: "mono",
    accent: "text-(--vermilion-ink)",
  };
}
