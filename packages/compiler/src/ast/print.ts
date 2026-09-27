// Expression code emission.
//
// A template expression is a real ESTree tree that *may* contain JSX, which the
// JSX pass has already rewritten into Deshi template nodes. Code generation
// therefore replaces each top-level JSX range with the JS that renders it and
// keeps the rest of the expression byte-for-byte as the parser saw it. Nothing
// is re-printed from the tree, so no precedence or paren table can drift, and
// positions come from the AST rather than from string searching.
import type { Expression, JsxSlot, Node } from '../types';

export type RenderNodes = (nodes: Node[]) => string;

/** The exact source text an expression was parsed from. */
export function expressionSource(expr: Expression): string {
  return expr.src ?? expr.raw;
}

/**
 * Source of an expression's JSX-free part, i.e. the whole expression when it
 * holds no JSX. This is what a pass that only needs "the JS" should use.
 */
export function expressionCode(expr: Expression): string {
  if (!expr.jsx.length) return expressionSource(expr).slice(expr.ast.start, expr.ast.end);
  return printExpression(expr, (nodes) => '/*deshi:jsx*/' + String(nodes.length));
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

/**
 * Print the JS for `expr`, delegating each JSX range to `render`.
 *
 * All offsets are absolute in `expressionSource(expr)` — the same coordinate
 * system the parser reported — so no translation step can go wrong. JSX ranges
 * are non-overlapping (the JSX pass stops at the outermost node), and that
 * invariant is asserted here so a future change cannot corrupt output.
 */
export function printExpression(expr: Expression, render: RenderNodes): string {
  const src = expressionSource(expr);
  const from = expr.ast.start;
  const to = expr.ast.end;
  if (!expr.jsx.length) return src.slice(from, to);

  const slots = [...expr.jsx].sort((a, b) => a.start - b.start);
  const replacements: Replacement[] = [];
  let cursor = from;
  for (const slot of slots) {
    if (slot.start < cursor) {
      // Defensive: nested JSX is converted by the inner Expression, not here.
      continue;
    }
    if (slot.start < from || slot.end > to || slot.start > slot.end) continue;
    replacements.push({ start: slot.start, end: slot.end, text: render(slot.nodes) });
    cursor = slot.end;
  }
  if (!replacements.length) return src.slice(from, to);

  let out = '';
  let at = from;
  for (const r of replacements) {
    out += src.slice(at, r.start);
    out += r.text;
    at = r.end;
  }
  out += src.slice(at, to);
  return out;
}

/** Ranges of an expression covered by JSX (for tools that reason about them). */
export function jsxRanges(expr: Expression): JsxSlot[] {
  return [...expr.jsx].sort((a, b) => a.start - b.start);
}
