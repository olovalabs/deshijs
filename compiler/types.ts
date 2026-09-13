// ─── Deshi AST ──────────────────────────────────────────────────────────────
import type * as ESTree from 'acorn';

export interface Loc {
  line: number;
  column: number;
  start: number;
  end: number;
}

export type Node =
  | Root
  | Doctype
  | Element
  | Component
  | Text
  | Expression
  | Slot
  | Fragment
  | HeadBlock
  | Comment;

export interface Root {
  type: 'Root';
  document: boolean;
  children: Node[];
}
export interface Doctype {
  type: 'Doctype';
  loc: Loc;
}
export interface Element {
  type: 'Element';
  name: string;
  attrs: Attr[];
  children: Node[];
  loc: Loc;
  scoped: boolean;
  clientRoot: boolean;
  /** document-mode <head>: children are lifted into a head contribution */
  isDocHead?: boolean;
}
export type ClientStrategy = 'load' | 'visible' | 'idle' | 'click' | 'media' | 'only';

export interface Component {
  type: 'Component';
  ident: string;
  props: Attr[];
  slots: Record<string, Node[]>;
  clientProps?: Expression;
  /** Per-usage island strategy — Astro-parity: load, visible, idle, media, only, click. */
  clientStrategy?: ClientStrategy;
  /** For client:media — the media query string */
  clientMedia?: string;
  /** For client:only — framework hint (kept for compat) */
  clientOnly?: string;
  loc: Loc;
}
export interface Text {
  type: 'Text';
  value: string;
  loc: Loc;
}
export interface JsxSlot {
  /** absolute offsets in the template source */
  start: number;
  end: number;
  nodes: Node[];
}
export interface Expression {
  type: 'Expression';
  ast: ESTree.Expression;
  raw: string;
  /** absolute start offset of `raw` in the template source */
  start: number;
  loc: Loc;
  jsx: JsxSlot[];
}
export interface Slot {
  type: 'Slot';
  name: string;
  fallback: Node[];
  loc: Loc;
  /** marks the position of the tail of the document head (after <slot name="head"/>) */
  headMarker?: boolean;
}
export interface Fragment {
  type: 'Fragment';
  children: Node[];
}
export interface HeadBlock {
  type: 'HeadBlock';
  children: Node[];
  loc: Loc;
  tail?: boolean;
}
export interface Comment {
  type: 'Comment';
  value: string;
  loc: Loc;
}

export type Attr =
  | { kind: 'static'; name: string; value: string }
  | { kind: 'dynamic'; name: string; expr: Expression }
  | { kind: 'boolean'; name: string }
  | { kind: 'spread'; expr: Expression }
  | { kind: 'setHtml'; expr: Expression }
  | { kind: 'setText'; expr: Expression }
  | { kind: 'classList'; expr: Expression }
  | { kind: 'defineVars'; expr: Expression }
  | { kind: 'transition'; name: string; value: string | Expression };

// ─── Diagnostics ───────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  file: string;
  line: number;
  column: number;
  frame: string;
  hint?: string;
}

export const ERROR_CATALOG: Record<string, string> = {
  PF1001: 'Unclosed tag',
  PF1002: 'Invalid attribute',
  PF1003: 'Unterminated { expression',
  PF1004: 'More than one <script> / <script client> block',
  PF2001: 'Missing root layout (src/app/layout.html)',
  PF2002: 'Root layout is missing <slot />',
  PF2003: 'Root layout is missing <html>, <head> or <body>',
  PF2004: 'Two files resolve to the same output path',
  PF2005: 'Invalid route segment name',
  PF2010: 'Unsupported convention (default.html / parallel routes)',
  PF2011: 'Ignored file (loading/error/route/middleware)',
  PF2012: 'Ignored export (prerender/dynamic/revalidate/runtime) — SSG only',
  PF3001: 'Dynamic page without getStaticParams()',
  PF3002: 'getStaticParams() returned a bad shape',
  PF3003: '<script> body threw',
  PF3004: 'getStaticParams() threw',
  PF4001: 'Expression syntax error',
  PF4002: 'Component nesting deeper than 50',
  PF4003: 'Component import cycle',
  PF4004: 'Component file not found',
  PF4005: 'Unknown slot name',
  PF4010: 'Unresolved identifier in template expression',
  PF4011: 'A function value was interpolated',
  PF4020: 'Component import must be capitalized',
  PF4021: 'Forbidden export in component',
  PF4022: 'React-style attribute (className / htmlFor)',
  PF4023: 'set:html on an element with children',
  PF4024: 'Capitalized tag is not an imported component',
  PF4025: '<head> block inside the root layout body',
  PF4026: 'Invalid client:* directive',
  PF4027: 'Invalid transition:* directive',
  PF4028: 'Invalid define:vars',
  PF5001: 'Forbidden <script> in zero-JS mode',
  PF5002: 'Asset not found',
  PF5003: 'Client chunk missing from manifest',
  PF6001: 'Config error',
};

export class DeshiError extends Error {
  code: string;
  file: string;
  line: number;
  column: number;
  frame: string;
  hint?: string;
  constructor(d: Diagnostic) {
    super(`${d.code}: ${d.message}`);
    this.name = 'DeshiError';
    this.code = d.code;
    this.file = d.file;
    this.line = d.line;
    this.column = d.column;
    this.frame = d.frame;
    this.hint = d.hint;
  }
  toDiagnostic(): Diagnostic {
    return {
      code: this.code,
      severity: 'error',
      message: this.message.replace(/^PF\d{4}: /, ''),
      file: this.file,
      line: this.line,
      column: this.column,
      frame: this.frame,
      hint: this.hint,
    };
  }
}

export function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = 0;
  const max = Math.min(offset, source.length);
  for (let i = 0; i < max; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      last = i + 1;
    }
  }
  return { line, column: max - last + 1 };
}

export function codeFrame(source: string, line: number, column: number, context = 2): string {
  const lines = source.split('\n');
  const from = Math.max(1, line - context);
  const to = Math.min(lines.length, line + context);
  const width = String(to).length;
  const out: string[] = [];
  for (let n = from; n <= to; n++) {
    const marker = n === line ? '>' : ' ';
    out.push(`${marker} ${String(n).padStart(width)} | ${lines[n - 1] ?? ''}`);
    if (n === line) {
      out.push(`  ${' '.repeat(width)} | ${' '.repeat(Math.max(0, column - 1))}^`);
    }
  }
  return out.join('\n');
}

export function makeDiagnostic(
  code: string,
  message: string,
  file: string,
  source: string,
  offset: number,
  severity: Severity = 'error',
  hint?: string,
): Diagnostic {
  const { line, column } = offsetToLineCol(source, offset);
  return {
    code,
    severity,
    message,
    file,
    line,
    column,
    frame: codeFrame(source, line, column),
    hint,
  };
}

export function fail(
  code: string,
  message: string,
  file: string,
  source: string,
  offset: number,
  hint?: string,
): never {
  throw new DeshiError(makeDiagnostic(code, message, file, source, offset, 'error', hint));
}

/** FNV-1a based 8-hex-char hash (the Node build uses sha256(relPath).slice(0, 8)). */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c * 31 + ((h2 << 5) | (h2 >>> 27))) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 8);
}
