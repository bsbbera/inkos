import { describe, expect, it } from "vitest";
import { renderComposerDisplay } from "../tui/composer-display.js";

describe("tui composer display", () => {
  it("renders placeholder when empty", () => {
    expect(renderComposerDisplay("", "Ask Quire", false)).toEqual({
      textBeforeCursor: "Ask Quire",
      textAfterCursor: "",
      cursor: "",
      isPlaceholder: true,
    });
  });

  it("keeps the initial caret before the placeholder text", () => {
    expect(renderComposerDisplay("", "Ask Quire", true)).toEqual({
      textBeforeCursor: "",
      textAfterCursor: "Ask Quire",
      cursor: "│",
      isPlaceholder: true,
    });
  });

  it("renders plain input text with a blinking bar cursor when active", () => {
    expect(renderComposerDisplay("continue", "Ask Quire", true)).toEqual({
      textBeforeCursor: "continue",
      textAfterCursor: "",
      cursor: "│",
      isPlaceholder: false,
    });
  });

  it("hides the cursor between blink frames", () => {
    expect(renderComposerDisplay("continue", "Ask Quire", false)).toEqual({
      textBeforeCursor: "continue",
      textAfterCursor: "",
      cursor: "",
      isPlaceholder: false,
    });
  });
});
