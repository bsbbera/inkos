import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui/icon";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly variant?: "danger" | "default";
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const isDanger = variant === "danger";

  return createPortal(
    <div
      ref={overlayRef}
      /*
        The offsets are inline rather than utilities, and the overlay no longer
        carries `fade-in`.

        A confirmation that asks before rewriting someone's manuscript was
        appearing at the bottom of the page, under everything, reachable only by
        scrolling — a dialog nobody sees is not a dialog. Whatever was defeating
        `fixed inset-0` there (an animation on the overlay, a utility losing to
        a later rule), an inline `position: fixed` with all four offsets set
        cannot be overridden by a stylesheet, so this stops depending on the
        cascade to be centred. The card keeps its own entrance animation.
      */
      className="flex items-center justify-center bg-(--char)/40 backdrop-blur-sm fixed top-0 right-0 bottom-0 left-0 z-200"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="panel panel-flush w-full max-w-md mx-4 overflow-hidden fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            {isDanger && (
              <span className="icon-ring text-(--bad)"><Icon name="alert" size={18} /></span>
            )}
            <h3 className="h-panel">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            aria-label={cancelLabel}
            title={cancelLabel}
            className="btn btn-quiet btn-icon"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="dim">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            className="btn btn-line"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={isDanger ? "btn btn-bad" : "btn"}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/*
 * ask() is window.confirm in the app's own dialog. The browser's box cannot be
 * styled, names the page's origin as its title, and freezes every timer while
 * it is open; this one says what will happen in the product's words.
 */
interface Asking {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly danger?: boolean;
  readonly resolve: (ok: boolean) => void;
}
let asking: Asking | null = null;
const askListeners = new Set<() => void>();
const emitAsk = () => { for (const l of askListeners) l(); };

export function ask(q: Omit<Asking, "resolve">): Promise<boolean> {
  asking?.resolve(false);
  return new Promise((resolve) => {
    asking = { ...q, resolve };
    emitAsk();
  });
}

export function AskHost() {
  const q = useSyncExternalStore(
    (cb) => { askListeners.add(cb); return () => { askListeners.delete(cb); }; },
    () => asking,
    () => null,
  );
  const done = (ok: boolean) => { q?.resolve(ok); asking = null; emitAsk(); };
  return (
    <ConfirmDialog
      open={q !== null}
      title={q?.title ?? ""}
      message={q?.message ?? ""}
      confirmLabel={q?.confirmLabel ?? "OK"}
      cancelLabel="Cancel"
      variant={q?.danger ? "danger" : "default"}
      onConfirm={() => done(true)}
      onCancel={() => done(false)}
    />
  );
}
