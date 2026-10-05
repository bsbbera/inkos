/**
 * The UI guard (analysis/02, revision 2026-10-05, rule 6).
 *
 * Pages and components are built from tokens and shared classes. Three things
 * are counted, and each count is zero:
 *
 *   a literal in `style={{}}`   - a value a token or a class should carry.
 *                                 Computed geometry (a measured width, a
 *                                 percentage from data) is allowed: it is an
 *                                 expression, not a literal.
 *   an arbitrary `[12px]` class  - a size off the token scale.
 *   a raw hex colour             - a colour off the palette.
 *   a Tailwind palette colour    - `text-emerald-500`, `bg-white`: the same
 *                                 thing spelled as a utility.
 *
 * And the sweep of analysis/03 - one way to do each of these, so the same
 * condition never looks two ways:
 *
 *   a second icon set            - lucide-react; use <Icon> (or ui/glyphs).
 *   a browser popup              - alert() / confirm(); use toast() / ask().
 *   a hand-drawn box             - `border` + `rounded` + a fill or padding on
 *                                 one element; use panel / well / pop / pill.
 *   a raw px type size in CSS    - vermilion.css sizes come from --fs-*.
 *
 * A failure names every offender, so the fix is a lookup, not a hunt.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const ROOTS = ["pages", "components"].map((d) => join(SRC, d));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function unwrap(e: ts.Expression | undefined): ts.Expression | undefined {
  while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression;
  return e;
}

function isLiteral(node: ts.Expression): boolean {
  return ts.isNumericLiteral(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));
}

/** A box recipe: an edge, a radius, and a fill or padding, with no system class. */
function isHandDrawnBox(classes: string): boolean {
  return /(?<![\w:-])border(?![\w-]*-0\b)/.test(classes)
    && /(?<![\w:-])rounded(?!-full)/.test(classes)
    && /(?<![\w:-])(?:bg-|p[xy]?-\d)/.test(classes)
    && !/(?:^|\s)(?:file:\S*|well|panel|pop|pill|input|btn|chip|tile)(?=\s|$)/.test(classes);
}

export function scan(file: string, text: string) {
  const styles: string[] = [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "style" && node.initializer
      && ts.isJsxExpression(node.initializer)) {
      const obj = unwrap(node.initializer.expression);
      if (!obj || !ts.isObjectLiteralExpression(obj)) { ts.forEachChild(node, visit); return; }
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        // `["--rs" as string]` is how a custom property is spelled in a typed object.
        const name = p.name.getText(sf).replace(/^\[|\s+as\s+\w+\]$|["']/g, "");
        if (name.startsWith("--")) continue;
        if (isLiteral(p.initializer)) styles.push(`${at(p)} ${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const lines = text.split(/\r?\n/);
  const find = (re: RegExp) => lines.flatMap((line, i) =>
    [...line.matchAll(re)].map((m) => `${file}:${i + 1} ${m[0]}`));
  return {
    styles,
    lucide: find(/from "lucide-react"/g),
    popup: find(/(?<![.\w])(?:window\.)?(?:alert|confirm)\(/g),
    // components/ui holds the primitives the system classes are made from.
    box: file.startsWith("components/ui/") ? [] : lines.flatMap((line, i) =>
      [...line.matchAll(/className=["{`]+([^"`]*)/g)]
        .filter((m) => isHandDrawnBox(m[1]!))
        .map((m) => `${file}:${i + 1} ${m[1]}`)),
    arbitrary: find(/\[-?[\d.]+(?:px|rem|em)\]/g),
    palette: find(/(?<![\w-])(?:[a-z-]+:)*!?(?:text|bg|border|ring|fill|stroke|divide|outline|from|to|via)-(?:(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d+|white|black)(?![\w-])/g),
    hex: find(/(?<![\w&])#[0-9a-fA-F]{3,8}\b(?![\w-])/g).filter((h) => !/#\d+\b/.test(h.split(" ")[1]!) || /[a-fA-F]/.test(h.split(" ")[1]!)),
  };
}

describe("the UI guard", () => {
  const all = ROOTS.flatMap(walk).map((f) => scan(relative(SRC, f).replace(/\\/g, "/"), readFileSync(f, "utf-8")));
  it("finds no literal inline styles", () => {
    expect(all.flatMap((r) => r.styles)).toEqual([]);
  });
  it("finds no arbitrary pixel sizes", () => {
    expect(all.flatMap((r) => r.arbitrary)).toEqual([]);
  });
  it("finds no Tailwind palette colours", () => {
    expect(all.flatMap((r) => r.palette)).toEqual([]);
  });
  it("finds no raw hex colours", () => {
    expect(all.flatMap((r) => r.hex)).toEqual([]);
  });
  it("draws icons from one set", () => {
    expect(all.flatMap((r) => r.lucide)).toEqual([]);
  });
  it("uses the app's own dialogs, not the browser's", () => {
    expect(all.flatMap((r) => r.popup)).toEqual([]);
  });
  it("finds no hand-drawn boxes", () => {
    expect(all.flatMap((r) => r.box)).toEqual([]);
  });
  it("sizes type in vermilion.css from tokens", () => {
    const css = readFileSync(join(SRC, "vermilion.css"), "utf-8").split(/\r?\n/);
    // The document's base size is the one literal; everything else is a step.
    const raw = css.flatMap((l, i) =>
      /font-size:\s*[\d.]+px/.test(l) && !/^\s*font-size: 16px;/.test(l) ? [`vermilion.css:${i + 1} ${l.trim()}`] : []);
    expect(raw).toEqual([]);
  });
});
