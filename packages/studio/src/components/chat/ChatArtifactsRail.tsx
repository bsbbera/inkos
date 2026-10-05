/**
 * What the conversation has produced on disk — the mock's right column.
 *
 * Files, not messages, because files are the truth in this product. The token
 * table sits under them rather than above: what a session made is the reason
 * to look, and what it spent is the footnote.
 *
 * Putty, not charcoal. The conversation is the work and gets the dark ground;
 * the rails around it are chrome and must not compete with it.
 */
import { useResizable } from "../../hooks/use-resizable";
import { useState } from "react";
import { FileText, Activity, Pencil, X } from "../ui/glyphs";
import { useChatStore } from "../../store/chat";
import { sessionFiles, whenAgo, type SessionFile } from "./chat-session-files";
import { ledgerLines, ledgerTotal, type LedgerGrouping } from "./session-ledger-state";

function Glyph({ kind }: { readonly kind: SessionFile["kind"] }) {
  const Icon = kind === "audit" ? Activity : kind === "edit" ? Pencil : FileText;
  return (
    <span className="glyph w-7 h-7">
      <Icon size={13} aria-hidden="true" />
    </span>
  );
}

export function ChatArtifactsRail({ bookId }: { readonly bookId?: string }) {
  const [grouping, setGrouping] = useState<LedgerGrouping>("agent");
  const [open, setOpen] = useState(true);
  const sessionId = useChatStore((s) => s.activeSessionId);
  const session = useChatStore((s) => (sessionId ? s.sessions[sessionId] : undefined));
  // A book's file opens in the book's own reader; a project file has its own
  // drawer. Same row, two homes, and the rail should not have to know more.
  const openArtifact = useChatStore((s) => s.openArtifact);
  const openProjectArtifact = useChatStore((s) => s.openProjectArtifact);

  /* Same handle as the other rail and the book sidebar. This one grips from
     its left edge, so the drag reads the way the edge moves.

     Above the early return, and it must stay there: this rail unmounts itself
     when there is no session and when the close button is pressed, so a hook
     below that line runs on some renders and not others. React counts hooks,
     and the count changing is what took the whole app down to a blank screen
     the first time a book-create session appeared under it. */
  const { width, gripProps } = useResizable({
    key: "quire.chat.artifacts",
    initial: 268,
    min: 200,
    max: 480,
    side: "start",
  });

  if (!sessionId || !open) return null;

  const files = sessionFiles(session?.messages);
  const lines = ledgerLines(session?.usage, grouping);
  const total = ledgerTotal(session?.usage);
  const startedAt = session?.messages?.[0]?.timestamp ?? null;

  return (
    <aside className="subrail" style={{ width }}>
      <div
        {...gripProps}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the column"
        title="Drag to resize · double-click for the default width"
        className="subrail-grip subrail-grip-start"
      />
      <div className="subrail-head">
        <div className="rowflex justify-between">
          <div className="label">Made in this session</div>
          <button type="button" className="btn btn-quiet btn-sm" data-esc aria-label="Close" onClick={() => setOpen(false)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="subrail-body">
        {files.length === 0 ? (
          // "Nothing yet" and "this panel does not exist" are different facts,
          // and a rail that hides itself when empty says the wrong one.
          <p className="hint text-cap px-1 pt-1 pb-0">
            Nothing written to disk yet.
          </p>
        ) : (
          <div className="rows">
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="row py-2.5 px-1"
                onClick={() => (bookId ? openArtifact(file.path) : openProjectArtifact(file.path))}
              >
                <Glyph kind={file.kind} />
                <span className="grow min-w-0">
                  <span className="name mono trunc text-cap">{file.name}</span>
                  <span className="meta text-cap">{file.meta}</span>
                </span>
                {file.busy ? (
                  <span className="sev sev-warn w-1.5 h-1.5 rounded-full" />
                ) : null}
              </button>
            ))}
          </div>
        )}

        <div className="grp">
          <div className="rowflex justify-between px-1 pt-0 pb-1.5">
            <span className="label">This session</span>
            <span className="seg text-cap">
              {(["agent", "model"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={grouping === mode}
                  onClick={() => setGrouping(mode)}
                >
                  by {mode}
                </button>
              ))}
            </span>
          </div>

          {lines.length === 0 ? (
            <p className="hint text-cap py-0 px-1">
              Nothing has run in this session yet.
            </p>
          ) : (
            <table className="spec mt-1">
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td className="trunc max-w-24">{line.who}</td>
                    <td>
                      <span className="mono trunc block text-cap">
                        {line.service ? `${line.service} · ` : ""}{line.model}
                      </span>
                      <span
                        className="mono text-cap"
                        style={{ fontStyle: line.reported ? undefined : "italic" }}
                      >
                        {line.tokens}
                      </span>
                      {line.note ? <span className="meta text-cap">{line.note}</span> : null}
                    </td>
                  </tr>
                ))}
                {total ? (
                  <tr>
                    <td>{total.label}</td>
                    <td className="mono font-semibold">{total.tokens}</td>
                  </tr>
                ) : null}
                {/* The mock's own last line: when this conversation began. */}
                {startedAt ? (
                  <tr>
                    <td>started</td>
                    <td className="mono">{whenAgo(startedAt)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}

          <p className="hint mt-2.5 text-cap leading-normal">
            {total?.partial
              // Naming the gap is the difference between a figure and a claim.
              ? "Some providers report no token counts, so the total is a floor. "
              : ""}
            Token counts are the machine&rsquo;s, not a bill. Quire holds no account and charges nothing.
          </p>
        </div>
      </div>
    </aside>
  );
}
