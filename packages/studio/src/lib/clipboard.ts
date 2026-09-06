/*
 * Copying text, in a window that is not always allowed to.
 *
 * Every copy button in the app called `navigator.clipboard.writeText` and
 * showed "Could not reach the clipboard" when it threw, which in the desktop
 * shell is most of the time: the async Clipboard API is gated on a secure
 * context and on the document being focused, and a webview that has just
 * handled a click inside a custom title bar frequently satisfies neither. The
 * button was therefore permanently broken in the one place the app actually
 * runs, and the message told the user nothing they could act on.
 *
 * `document.execCommand("copy")` is deprecated and works: it is synchronous,
 * needs no permission, and is driven by a selection the page makes itself. So
 * it is the fallback rather than the primary - the modern API is better when
 * it is available - and between them there is no ordinary case left where a
 * copy button does nothing.
 */

/** Copy through the deprecated selection-based path. Sync, no permission. */
function copyBySelection(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  // Off-screen rather than hidden: `display:none` and `visibility:hidden`
  // elements cannot hold a selection, so the copy silently does nothing.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);

  const selection = document.getSelection();
  // A selection the user made is theirs; put it back afterwards.
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
  }
}

/**
 * Put text on the clipboard, by whichever route this window allows.
 *
 * Resolves to whether it landed, so a caller can say "copied" only when it
 * was. Never throws: a copy button that raises is worse than one that reports.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Falls through. Denied permission, an unfocused document and an
      // insecure context all land here, and all three are recoverable.
    }
  }
  return copyBySelection(text);
}
