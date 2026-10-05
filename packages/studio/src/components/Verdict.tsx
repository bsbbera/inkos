/**
 * One feedback gesture on every card (04 §7).
 *
 * Keep · redo · tweak · reject. A negative verdict asks "what went wrong?" as
 * chips for this surface, and a line of note that is never required. What the
 * answer does is the server's business (api/taste.ts): keep chooses a picture,
 * reject trashes it, redo draws it again with the causes as the note, and a
 * redo on a page files a finding the rewrite pass can act on. Every one of
 * them is kept in the workspace's feedback stream.
 */
import { useEffect, useState } from "react";
import { fetchJson } from "../hooks/use-api";
import { toast } from "./ui/vermilion";

type Surface = "content" | "design" | "image" | "build";
type Choice = "keep" | "redo" | "tweak" | "reject";

let causes: Promise<Partial<Record<Surface, string[]>>> | null = null;
/** The chips come from the server's table, fetched once: one list, not two that drift. */
function loadCauses(): Promise<Partial<Record<Surface, string[]>>> {
  causes ??= fetchJson<{ causes: Record<Surface, string[]> }>("/feedback/causes")
    .then((r) => r.causes)
    .catch(() => {
      causes = null;
      return {};
    });
  return causes;
}

const CHOICES: ReadonlyArray<{ readonly v: Choice; readonly label: string; readonly title: string }> = [
  { v: "keep", label: "Keep", title: "Keep it" },
  { v: "redo", label: "Redo", title: "Do it again" },
  { v: "tweak", label: "Tweak", title: "Nearly — change one thing" },
  { v: "reject", label: "Reject", title: "Not this" },
];

const SAID: Readonly<Record<string, string>> = {
  chosen: "Kept, and chosen for its place.",
  trashed: "Rejected — moved to the trash.",
  redrawing: "Drawing it again with your note. It appears here when it is done.",
  "filed as a finding": "Filed as a finding. Rewrite it from the queue.",
  noted: "Noted.",
};

export function Verdict({ surface, refTo, target, source, onDone, keepLabel }: {
  readonly surface: Surface;
  readonly refTo: { readonly type: string; readonly id: string; readonly unit?: number };
  /** The file the verdict is about, when it is about one. */
  readonly target?: string;
  readonly source?: string;
  readonly onDone?: (event: { readonly acted?: string }) => void;
  readonly keepLabel?: string;
}) {
  const [open, setOpen] = useState<Choice | null>(null);
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [chips, setChips] = useState<ReadonlyArray<string>>([]);

  useEffect(() => {
    let live = true;
    void loadCauses().then((all) => { if (live) setChips(all[surface] ?? []); });
    return () => { live = false; };
  }, [surface]);

  const send = async (verdict: Choice) => {
    setBusy(true);
    try {
      const answer = await fetchJson<{ event: { acted?: string } }>("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: refTo, surface, verdict, cause: picked, note: note.trim(),
          ...(target ? { target } : {}), ...(source ? { source } : {}),
        }),
      });
      toast(SAID[answer.event.acted ?? "noted"] ?? "Noted.");
      setOpen(null);
      setPicked([]);
      setNote("");
      onDone?.(answer.event);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That did not take.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="verdict">
      <div className="verdict-row" role="group" aria-label="Your verdict">
        {CHOICES.map(({ v, label, title }) => (
          <button
            key={v}
            type="button"
            className={v === "keep" ? "btn btn-sm" : "btn btn-line btn-sm"}
            aria-pressed={open === v}
            aria-expanded={v === "keep" ? undefined : open === v}
            disabled={busy}
            title={title}
            onClick={() => (v === "keep" ? void send(v) : setOpen(open === v ? null : v))}
          >
            {v === "keep" && keepLabel ? keepLabel : label}
          </button>
        ))}
      </div>
      {open ? (
        <div className="verdict-why">
          <span className="label">What went wrong?</span>
          {chips.length ? (
            <div className="chips">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="chip"
                  aria-pressed={picked.includes(c)}
                  onClick={() => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}
          <div className="rowflex gap-1.5">
            <input
              className="input grow"
              value={note}
              autoFocus
              aria-label="A note, optional"
              placeholder={open === "tweak" ? "The one thing to change" : "Anything else (optional)"}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send(open);
                if (e.key === "Escape") setOpen(null);
              }}
            />
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void send(open)}>
              {open === "reject" ? "Reject" : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
