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
import { FileText, Activity, Pencil, X } from "lucide-react";
import { useChatStore } from "../../store/chat";
import { sessionFiles, whenAgo, type SessionFile } from "./chat-session-files";
import { ledgerLines, ledgerTotal, type LedgerGrouping } from "./session-ledger-state";

function Glyph({ kind }: { readonly kind: SessionFile["kind"] }) {
  const Icon = kind === "audit" ? Activity : kind === "edit" ? Pencil : FileText;
  return (
    <span className="glyph" style={{ width: 28, height: 28 }}>
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
        <div className="rowflex" style={{ justifyContent: "space-between" }}>
          <div className="label">Made in this session</div>
          <button type="button" className="btn btn-quiet btn-sm" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="subrail-body">
        {files.length === 0 ? (
          // "Nothing yet" and "this panel does not exist" are different facts,
          // and a rail that hides itself when empty says the wrong one.
          <p className="hint" style={{ fontSize: 11, padding: "4px 4px 0" }}>
            Nothing written to disk yet.
          </p>
        ) : (
          <div className="rows">
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="row"
                style={{ padding: "10px 4px" }}
                onClick={() => (bookId ? openArtifact(file.path) : openProjectArtifact(file.path))}
              >
                <Glyph kind={file.kind} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="name mono trunc" style={{ fontSize: 11 }}>{file.name}</span>
                  <span className="meta" style={{ fontSize: 11 }}>{file.meta}</span>
                </span>
                {file.busy ? (
                  <span className="sev sev-warn" style={{ width: 6, height: 6, borderRadius: "50%" }} />
                ) : null}
              </button>
            ))}
          </div>
        )}

        <div className="grp">
          <div className="rowflex" style={{ justifyContent: "space-between", padding: "0 4px 6px" }}>
            <span className="label">This session</span>
            <span className="seg" style={{ fontSize: 11 }}>
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
            <p className="hint" style={{ fontSize: 11, padding: "0 4px" }}>
              Nothing has run in this session yet.
            </p>
          ) : (
            <table className="spec" style={{ marginTop: 4 }}>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td className="trunc" style={{ maxWidth: 96 }}>{line.who}</td>
                    <td>
                      <span className="mono trunc" style={{ display: "block", fontSize: 11 }}>
                        {line.service ? `${line.service} · ` : ""}{line.model}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 11, fontStyle: line.reported ? undefined : "italic" }}
                      >
                        {line.tokens}
                      </span>
                      {line.note ? <span className="meta" style={{ fontSize: 11 }}>{line.note}</span> : null}
                    </td>
                  </tr>
                ))}
                {total ? (
                  <tr>
                    <td>{total.label}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{total.tokens}</td>
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

          <p className="hint" style={{ marginTop: 10, fontSize: 11, lineHeight: 1.45 }}>
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
