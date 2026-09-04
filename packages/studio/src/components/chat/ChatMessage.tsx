/**
 * One turn, drawn the way the mockup draws it.
 *
 * `.msg` / `.who-av` / `.tag` / `.body` / `.read` all come from vermilion.css,
 * which the app already ships byte-identical to the mock's copy. This carries
 * the class names across rather than approximating them in utilities, which is
 * what the design system was set up for and what chat had never done.
 */
import { memo } from "react";
import { Check, File, Sparkles, XCircle } from "lucide-react";
import { parseToolMarks } from "./tool-marks";
import type { MessageChip } from "../../store/chat/types";
import { MessageResponse } from "../ai-elements/message";

export interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp: number;
  /** Uppercase label above the turn: "Reading first", "Writing · 380 words so far". */
  readonly tag?: string;
  /** Attachment and skill chips, under a person's own message. */
  readonly chips?: ReadonlyArray<MessageChip>;
  readonly initials?: string;
  /** Draws the block caret at the end, and lets the caller add a footer. */
  readonly streaming?: boolean;
  readonly footer?: React.ReactNode;
}

/** "11 minutes ago" — the mock's phrasing, because that is how people say it. */
export function whenLabel(at: number, now = Date.now()): string {
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString();
}

/**
 * Whether the first paragraph can carry a drop cap.
 *
 * The test is the whole message, not its opening line. Two earlier cuts asked
 * the first paragraph to be 180 then 110 characters long, on the theory that a
 * three-line float needs three lines to sit against. Both were wrong in the
 * same way: a real prose answer often opens with one short sentence before it
 * gets going, and that sentence disqualified the entire turn — so no message in
 * the app ever drew a cap, including the one this rule was written from.
 *
 * What matters is whether the turn is prose at all. A passage that opens with a
 * heading, a list, a quote, a table or a fence is not, and a one-word answer is
 * not worth an initial. Everything else gets the cap where a cap goes.
 */
const LEAD_MIN = 200;

/**
 * @see LEAD_MIN
 */
function takesLead(content: string): boolean {
  const text = content.trimStart();
  const first = text.split(/\n\s*\n/)[0] ?? "";
  if (/^[#>\-*\d`|]/.test(first)) return false;
  return text.length >= LEAD_MIN;
}

export const ChatMessage = memo(function ChatMessage({
  role, content, timestamp, tag, chips, initials, streaming, footer,
}: ChatMessageProps) {
  const isUser = role === "user";
  const isError = content.startsWith("✗");
  return (
    <div className="msg">
      <span className={`who-av ${isUser ? "human" : "model"}`} aria-hidden="true">
        {initials ?? (isUser ? "You" : "Q")}
      </span>
      <div className="body">
        <div className="tag">{tag ?? (isUser ? `You · ${whenLabel(timestamp)}` : "Quire")}</div>
        {isError ? (
          <div className="flex items-center gap-2 text-destructive">
            <XCircle size={14} className="shrink-0" />
            <span>{content.replace(/^✗\s*/, "")}</span>
          </div>
        ) : isUser ? (
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--on-char)" }}>{content}</p>
        ) : (
          <>
            {parseToolMarks(content).map((segment, i) =>
              segment.kind === "tools" ? (
                /* What it read before it answered. A CLI runs its own tools, so
                   this is the only account of them there is. */
                <div key={`t${i}`} className="stack" style={{ gap: 7, marginBottom: 10 }}>
                  {segment.marks.map((mark, j) => (
                    <div className="tool" key={`${mark.name}-${j}`}>
                      <Check size={14} className="tick shrink-0" aria-hidden="true" />
                      <span>{mark.name}</span>
                      {mark.target ? <span className="mono trunc">{mark.target}</span> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  key={`p${i}`}
                  className={`read${takesLead(segment.text) ? " has-lead" : ""}`}
                  style={{ color: "var(--on-char)", ["--rs" as string]: "15px", ["--rl" as string]: "1.7", ["--rm" as string]: "calc(100% - 5px)" }}
                >
                  {/* Streamdown hardcodes `text-[17px] leading-[1.72]` on its own
                     root, which is the direct child of `.read` — so every --rs/--rl
                     this element sets was overridden before it reached a word, and
                     the 60ch measure was sizing a column for 15px type that then
                     got filled with 17px type. cn() runs tailwind-merge, so naming
                     the same groups here removes them rather than fighting them. */}
                  <MessageResponse className="text-[length:inherit] leading-[inherit] [&>p+p]:mt-[.8em]">
                    {segment.text}
                  </MessageResponse>
                </div>
              ),
            )}
            {streaming ? <span className="caret" aria-hidden="true" /> : null}
          </>
        )}
        {chips && chips.length > 0 ? (
          <div className="rowflex" style={{ marginTop: 9, gap: 6 }}>
            {chips.map((chip) => (
              <span className="attach" key={`${chip.kind}:${chip.label}`}>
                {chip.kind === "skill"
                  ? <Sparkles size={12} aria-hidden="true" />
                  : <File size={12} aria-hidden="true" />}
                {chip.label}
              </span>
            ))}
          </div>
        ) : null}
        {footer ? <div className="rowflex" style={{ marginTop: 12, gap: 8 }}>{footer}</div> : null}
      </div>
    </div>
  );
});
