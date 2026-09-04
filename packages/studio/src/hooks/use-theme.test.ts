import { describe, expect, it } from "vitest";
import { readStoredMode, resolveTheme } from "./use-theme";

describe("resolveTheme", () => {
  it("follows the OS while the mode is system", () => {
    expect(resolveTheme({ mode: "system", systemPrefersDark: true })).toBe("dark");
    expect(resolveTheme({ mode: "system", systemPrefersDark: false })).toBe("light");
  });

  it("lets an explicit choice beat the OS in both directions", () => {
    expect(resolveTheme({ mode: "light", systemPrefersDark: true })).toBe("light");
    expect(resolveTheme({ mode: "dark", systemPrefersDark: false })).toBe("dark");
  });
});

describe("readStoredMode", () => {
  it("defaults to system when nothing is stored", () => {
    expect(readStoredMode({ getItem: () => null })).toBe("system");
  });

  it("accepts the three modes and rejects anything else", () => {
    expect(readStoredMode({ getItem: () => "system" })).toBe("system");
    expect(readStoredMode({ getItem: () => "light" })).toBe("light");
    expect(readStoredMode({ getItem: () => "dark" })).toBe("dark");
    expect(readStoredMode({ getItem: () => "auto" })).toBe("system");
  });

  it("carries a choice over from the two-state hook's key", () => {
    const only = (key: string, value: string) => ({
      getItem: (k: string) => (k === key ? value : null),
    });
    expect(readStoredMode(only("inkos:studio:theme", "dark"))).toBe("dark");
    // The new key wins when both are present: it is the more recent choice.
    expect(
      readStoredMode({
        getItem: (k: string) => (k === "quire:studio:theme" ? "light" : "dark"),
      }),
    ).toBe("light");
  });
});
