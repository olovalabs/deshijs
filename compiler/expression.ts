// Stage 2b — `{ expression }` parsing with acorn + acorn-jsx, and the jsxToTemplate
// pass that converts JSXElement / JSXFragment nodes found in the ESTree into Deshi
// template nodes (Element / Component / Text / Expression).
import * as acorn from 'acorn';
import jsx from 'acorn-jsx';
import {
  fail,
  offsetToLineCol,
  type Attr,
  type ClientStrategy,
  type Component,
  type Element,
  type Expression,
  type Loc,
  type Node,
} from './types';

export const JsxParser = acorn.Parser.extend(jsx());

export const ACORN_OPTIONS: acorn.Options = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: false,
};

export interface TemplateContext {
  file: string;
  /** full original file source (template offsets are file offsets) */
  source: string;
  /** local identifiers of imported .html components */
  components: Set<string>;
  scoped: boolean;
  usedComponents: Set<string>;
  usedSlots: Set<string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

export function locAt(source: string, start: number, end: number): Loc {
  const { line, column } = offsetToLineCol(source, start);
  return { line, column, start, end };
}

/**
 * Parse an expression that starts right after a `{` at `bracePos`. Returns the
 * ESTree node and the offset of the matching `}`.
 */
export function parseBraceExpression(
  source: string,
  bracePos: number,
  file: string,
  exprStart: number = bracePos + 1,
): { ast: acorn.Expression; close: number } {
  let ast: acorn.Expression;
  try {
    ast = JsxParser.parseExpressionAt(source, exprStart, ACORN_OPTIONS) as acorn.Expression;
  } catch (e) {
    const err = e as { pos?: number; message: string };
    const pos = typeof err.pos === 'number' ? err.pos : bracePos;
    const msg = err.message.replace(/ \(\d+:\d+\)$/, '');
    if (pos >= source.length || source.indexOf('}', bracePos) === -1) {
      fail('PF1003', `Unterminated { expression: ${msg}`, file, source, bracePos);
    }
    fail('PF4001', `Expression syntax error: ${msg}`, file, source, pos);
  }
  let i = ast.end;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== '}') {
    fail('PF1003', 'Unterminated { expression — expected a closing }', file, source, i < source.length ? i : bracePos);
  }
  return { ast, close: i };
}

export function makeExpression(ast: acorn.Expression, ctx: TemplateContext): Expression {
  const expr: Expression = {
    type: 'Expression',
    ast,
    raw: ctx.source.slice(ast.start, ast.end),
    start: ast.start,
    loc: locAt(ctx.source, ast.start, ast.end),
    jsx: [],
  };
  jsxToTemplate(expr, ctx);
  return expr;
}

// ─── jsxToTemplate ─────────────────────────────────────────────────────────────

function jsxToTemplate(expr: Expression, ctx: TemplateContext): void {
  const visit = (node: AnyNode) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      expr.jsx.push({ start: node.start, end: node.end, nodes: convertJsxNode(node, ctx) });
      return; // nested JSX is handled by the recursive conversion
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      visit(node[key]);
    }
  };
  visit(expr.ast);
  expr.jsx.sort((a, b) => a.start - b.start);
}

function jsxName(nameNode: AnyNode, ctx: TemplateContext): string {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXNamespacedName') return `${nameNode.namespace.name}:${nameNode.name.name}`;
  fail('PF4001', 'Member expressions (<a.b>) are not valid tag names in Deshi', ctx.file, ctx.source, nameNode.start);
}

function convertJsxAttr(a: AnyNode, ctx: TemplateContext): Attr {
  if (a.type === 'JSXSpreadAttribute') {
    return { kind: 'spread', expr: makeExpression(a.argument, ctx) };
  }
  const name = jsxName(a.name, ctx);
  checkAttrName(name, a.start, ctx);
  // Astro/Dishi directives with special kinds
  if (a.value == null) {
    if (name === 'set:html' || name === 'set:text' || name === 'class:list' || name === 'define:vars') {
      fail('PF1002', `${name} requires an expression value: ${name}={...}`, ctx.file, ctx.source, a.start);
    }
    if (name.startsWith('transition:')) return { kind: 'transition', name, value: '' };
    return { kind: 'boolean', name };
  }
  if (a.value.type === 'Literal') {
    if (name === 'set:html' || name === 'set:text' || name === 'class:list' || name === 'define:vars') {
      fail('PF1002', `${name} requires an expression value: ${name}={value}`, ctx.file, ctx.source, a.start);
    }
    if (name.startsWith('transition:')) return { kind: 'transition', name, value: String(a.value.value) };
    return { kind: 'static', name, value: String(a.value.value) };
  }
  if (a.value.type === 'JSXExpressionContainer') {
    if (a.value.expression.type === 'JSXEmptyExpression') {
      fail('PF1002', `Attribute "${name}" has an empty expression`, ctx.file, ctx.source, a.start);
    }
    const expr = makeExpression(a.value.expression, ctx);
    if (name === 'set:html') return { kind: 'setHtml', expr };
    if (name === 'set:text') return { kind: 'setText', expr };
    if (name === 'class:list') return { kind: 'classList', expr };
    if (name === 'define:vars') return { kind: 'defineVars', expr };
    if (name.startsWith('transition:')) return { kind: 'transition', name, value: expr };
    return { kind: 'dynamic', name, expr };
  }
  // <a title=<b/> /> — JSX element as attribute value
  fail('PF1002', `Unsupported attribute value for "${name}"`, ctx.file, ctx.source, a.start);
}

const CLIENT_STRATEGIES = new Set<string>(['load', 'visible', 'idle', 'click', 'media', 'only']);

export function takeClientDirectives(
  attrs: Attr[],
  loc: Loc,
  ctx: TemplateContext,
  tagName: string,
  isComponent: boolean,
): { attrs: Attr[]; clientStrategy?: ClientStrategy; clientProps?: Expression; clientMedia?: string; clientOnly?: string } {
  let clientStrategy: ClientStrategy | undefined;
  let clientProps: Expression | undefined;
  let clientMedia: string | undefined;
  let clientOnly: string | undefined;
  const rest: Attr[] = [];
  for (const a of attrs) {
    const name =
      a.kind === 'static' || a.kind === 'boolean' || a.kind === 'dynamic' ? a.name : '';
    if (!name.startsWith('client:')) {
      rest.push(a);
      continue;
    }
    if (!isComponent) {
      fail(
        'PF4026',
        `client:* directives can only be used on Deshi components, not <${tagName}>`,
        ctx.file,
        ctx.source,
        loc.start,
      );
    }
    const dir = name.slice('client:'.length);
    if (dir === 'props') {
      if (a.kind !== 'dynamic') {
        fail('PF4026', 'client:props requires an expression value: client:props={{ ... }}', ctx.file, ctx.source, loc.start);
      }
      if (clientProps) {
        fail('PF4026', 'Duplicate client:props on one component usage', ctx.file, ctx.source, loc.start);
      }
      clientProps = a.expr;
      continue;
    }
    if (dir === 'media') {
      if (a.kind === 'static') clientMedia = a.value;
      else if (a.kind === 'dynamic') clientMedia = a.expr.raw;
      else fail('PF4026', 'client:media requires a value: client:media="(max-width: 600px)"', ctx.file, ctx.source, loc.start);
      if (clientStrategy) fail('PF4026', `Two hydration strategies on one usage (client:${clientStrategy} and client:${dir})`, ctx.file, ctx.source, loc.start);
      clientStrategy = 'media';
      continue;
    }
    if (dir === 'only') {
      if (a.kind === 'static') clientOnly = a.value;
      else if (a.kind === 'boolean') clientOnly = 'deshi';
      else if (a.kind === 'dynamic') clientOnly = String((a.expr as any).raw ?? 'deshi');
      if (clientStrategy) fail('PF4026', `Two hydration strategies on one usage (client:${clientStrategy} and client:${dir})`, ctx.file, ctx.source, loc.start);
      clientStrategy = 'only';
      continue;
    }
    if (CLIENT_STRATEGIES.has(dir)) {
      if (a.kind !== 'boolean') {
        fail(
          'PF4026',
          `Directive client:${dir} must not have a value (use client:${dir} not client:${dir}="...")`,
          ctx.file,
          ctx.source,
          loc.start,
        );
      }
      if (clientStrategy) {
        fail(
          'PF4026',
          `Two hydration strategies on one usage (client:${clientStrategy} and client:${dir})`,
          ctx.file,
          ctx.source,
          loc.start,
        );
      }
      clientStrategy = dir as ClientStrategy;
      continue;
    }
    fail('PF4026', `Unknown client:* directive "client:${dir}"`, ctx.file, ctx.source, loc.start);
  }
  return { attrs: rest, clientStrategy, clientProps, clientMedia, clientOnly };
}

export function checkAttrName(name: string, offset: number, ctx: TemplateContext): void {
  if (name === 'className' || name === 'htmlFor') {
    fail(
      'PF4022',
      `React-style attribute "${name}" — Deshi templates use plain HTML attribute names`,
      ctx.file,
      ctx.source,
      offset,
      `Use "${name === 'className' ? 'class' : 'for'}" instead.`,
    );
  }
}

function jsxTextValue(raw: string): string {
  // JSX whitespace rules: lines are trimmed, whitespace-only lines with a newline vanish.
  const lines = raw.split('\n');
  const out: string[] = [];
  lines.forEach((l, i) => {
    let s = l;
    if (i !== 0) s = s.replace(/^\s+/, '');
    if (i !== lines.length - 1) s = s.replace(/\s+$/, '');
    if (s) out.push(s);
  });
  return out.join(' ');
}

export function isComponentName(name: string): boolean {
  const c = name.charCodeAt(0);
  return c >= 65 && c <= 90;
}

function convertJsxChildren(children: AnyNode[], ctx: TemplateContext): Node[] {
  const out: Node[] = [];
  for (const c of children) {
    if (c.type === 'JSXText') {
      const v = jsxTextValue(c.value);
      if (v) out.push({ type: 'Text', value: v, loc: locAt(ctx.source, c.start, c.end) });
    } else if (c.type === 'JSXExpressionContainer') {
      if (c.expression.type === 'JSXEmptyExpression') continue;
      out.push(makeExpression(c.expression, ctx));
    } else if (c.type === 'JSXElement' || c.type === 'JSXFragment') {
      out.push(...convertJsxNode(c, ctx));
    } else if (c.type === 'JSXSpreadChild') {
      out.push(makeExpression(c.expression, ctx));
    }
  }
  return out;
}

export function bucketSlots(children: Node[], ctx: TemplateContext): Record<string, Node[]> {
  const slots: Record<string, Node[]> = {};
  for (const child of children) {
    let name = 'default';
    if (child.type === 'Element') {
      const idx = child.attrs.findIndex((a) => a.kind === 'static' && a.name === 'slot');
      if (idx >= 0) {
        const a = child.attrs[idx] as { kind: 'static'; value: string };
        name = a.value || 'default';
        child.attrs.splice(idx, 1);
      }
    }
    if (child.type === 'Text' && !child.value.trim()) continue;
    (slots[name] ??= []).push(child);
    ctx.usedSlots.add(name);
  }
  return slots;
}

export function convertJsxNode(node: AnyNode, ctx: TemplateContext): Node[] {
  if (node.type === 'JSXFragment') {
    return convertJsxChildren(node.children, ctx);
  }
  const opening = node.openingElement;
  const name = jsxName(opening.name, ctx);
  const loc = locAt(ctx.source, node.start, node.end);
  const attrs = opening.attributes.map((a: AnyNode) => convertJsxAttr(a, ctx));
  const children = convertJsxChildren(node.children, ctx);

  if (name === 'Fragment') return children;

  if (isComponentName(name)) {
    if (!ctx.components.has(name)) {
      fail(
        'PF4024',
        `<${name}> is not an imported component`,
        ctx.file,
        ctx.source,
        node.start,
        `Add: import ${name} from './${name}.html' to the <script> block.`,
      );
    }
    ctx.usedComponents.add(name);
    const taken = takeClientDirectives(attrs, loc, ctx, name, true);
    const comp: Component = {
      type: 'Component',
      ident: name,
      props: taken.attrs,
      slots: bucketSlots(children, ctx),
      clientProps: taken.clientProps,
      clientStrategy: taken.clientStrategy,
      clientMedia: taken.clientMedia,
      clientOnly: taken.clientOnly,
      loc,
    };
    return [comp];
  }

  if (name === 'slot') {
    const nameAttr = attrs.find((a: Attr) => a.kind === 'static' && a.name === 'name') as
      | { value: string }
      | undefined;
    return [{ type: 'Slot', name: nameAttr?.value || 'default', fallback: children, loc }];
  }

  takeClientDirectives(attrs, loc, ctx, name, false);
  const setHtml = attrs.find((a: Attr) => a.kind === 'setHtml' || a.kind === 'setText');
  if (setHtml && children.length) {
    fail('PF4023', `An element with ${setHtml.kind === 'setHtml' ? 'set:html' : 'set:text'} must not have children`, ctx.file, ctx.source, node.start);
  }
  const el: Element = {
    type: 'Element',
    name,
    attrs,
    children,
    loc,
    scoped: ctx.scoped,
    clientRoot: false,
  };
  return [el];
}
