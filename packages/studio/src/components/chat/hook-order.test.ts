/**
 * No hook below an early return.
 *
 * ChatArtifactsRail unmounts itself twice over — when there is no session, and
 * when its close button is pressed — and a `useResizable` sat below that line.
 * React counts hooks per render, so the count changed the first time a session
 * appeared underneath it, React threw, and the whole app rendered blank. tsc
 * cannot see this and there is no eslint in the repo to run
 * react-hooks/rules-of-hooks, so the rule is asserted here instead.
 *
 * The heuristic is deliberately narrow: a two-space indent is the top level of
 * a component body, which is the only place this class of bug is invisible.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry) || entry.includes(".test.")) return [];
    return [path];
  });
}

/** `[file, early-return line, offending hook line]` for anything that breaks the rule. */
function hooksBelowAnEarlyReturn(file: string): string[] {
  const lines = readFileSync(file, "utf-8").split("\n");
  const found: string[] = [];
  let inComponent = false;
  let earlyReturn: number | null = null;

  lines.forEach((line, index) => {
    if (/^(export\s+)?function\s+[A-Z]/.test(line)) { inComponent = true; earlyReturn = null; return; }
    if (/^\}/.test(line)) { inComponent = false; earlyReturn = null; return; }
    if (!inComponent) return;
    if (/^ {2}if\s*\(.*\)\s*return\b/.test(line) || /^ {2}return\s+null;/.test(line)) earlyReturn = index + 1;
    if (earlyReturn === null) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/\buse[A-Z]\w*\s*\(/.test(line)) {
      found.push(`${file}:${index + 1} calls a hook below the early return on line ${earlyReturn}`);
      earlyReturn = null;
    }
  });
  return found;
}

describe("rules of hooks", () => {
  it("has no component calling a hook after it can return early", () => {
    expect(sourceFiles(SRC).flatMap(hooksBelowAnEarlyReturn)).toEqual([]);
  });
});
