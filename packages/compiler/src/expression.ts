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
  /** local identifiers of imported .deshi/.html components */
  components: Set<string>;
  /**
   * every `<script>` binding (imports + declarations). Component tags may name
   * any of them, not just imports — `const Tag = registry[k]; <Tag />` — so
   * classification consults this set as well. Optional: single-file tooling
   * may omit it, and then only imported components match.
   */
  bindings?: Set<string>;
  scoped: boolean;
  usedComponents: Set<string>;
  usedSlots: Set<string>;
  /** set when a `<slot name={…}>` computes its name, so slot checks relax */
  dynamicSlots?: { value: boolean };
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
  // AST ranges omit redundant grouping parentheses and trailing comments.
  // Acorn's consumed tokens/comments retain the complete expression boundary.
  let consumedEnd = exprStart;
  try {
    ast = JsxParser.parseExpressionAt(source, exprStart, {
      ...ACORN_OPTIONS,
      onToken: (token) => { consumedEnd = Math.max(consumedEnd, token.end); },
      onComment: (_block, _text, _start, end) => { consumedEnd = Math.max(consumedEnd, end); },
    }) as acorn.Expression;
  } catch (e) {
    const err = e as { pos?: number; message: string };
    const pos = typeof err.pos === 'number' ? err.pos : bracePos;
    const msg = err.message.replace(/ \(\d+:\d+\)$/, '');
    if (pos >= source.length || source.indexOf('}', bracePos) === -1) {
      fail('PF1003', `Unterminated { expression: ${msg}`, file, source, bracePos);
    }
    fail('PF4001', `Expression syntax error: ${msg}`, file, source, pos);
  }
  let i = Math.max(ast.end, consumedEnd);
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
    src: ctx.source,
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
  if (nameNode.type === 'JSXMemberExpression') {
    // `<UI.Card />`, `<Icons.Tone.Info />` — a dotted tag is a component whose
    // value expression is the dotted chain itself. Computed JSX is not real
    // syntax (neither in React), so anything else stays a syntax error.
    const obj = jsxName(nameNode.object, ctx);
    if (nameNode.property.type !== 'JSXIdentifier') {
      fail('PF4001', 'Computed JSX member tags are not valid — assign the value to a const first', ctx.file, ctx.source, nameNode.start);
    }
    return `${obj}.${nameNode.property.name}`;
  }
  fail('PF4001', 'Member expressions (<a.b>) are not valid tag names in Deshi', ctx.file, ctx.source, nameNode.start);
}

/**
 * Whether a capitalized (or dotted) tag can resolve in scope: an imported
 * component, or any `<script>` binding (`const Tag = registry[k]`), or the
 * head of a dotted chain bound either way.
 */
export function componentTagResolves(name: string, ctx: TemplateContext): boolean {
  const head = name.split('.')[0];
  if (ctx.components.has(head)) return true;
  if (ctx.bindings?.has(head)) return true;
  if (head === 'props' || head === 'slots' || head === 'Deshi' || head === 'Astro') return true;
  return false;
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

export function takeClientDirectives(
  attrs: Attr[],
  loc: Loc,
  ctx: TemplateContext,
  tagName: string,
  isComponent: boolean,
): {
  attrs: Attr[];
  clientStrategy?: ClientStrategy;
  clientProps?: Expression;
  clientValue?: Expression;
  clientValueStatic?: string;
} {
  let clientStrategy: ClientStrategy | undefined;
  let clientProps: Expression | undefined;
  let clientValue: Expression | undefined;
  let clientValueStatic: string | undefined;
  const rest: Attr[] = [];
  const takeStrategy = (dir: string): void => {
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
  };
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
      // Astro parity: the media query is the *evaluated* value, not source text.
      if (a.kind === 'static') clientValueStatic = a.value;
      else if (a.kind === 'dynamic') clientValue = a.expr;
      else fail('PF4026', 'client:media requires a value: client:media="(max-width: 600px)"', ctx.file, ctx.source, loc.start);
      takeStrategy('media');
      continue;
    }
    if (dir === 'only') {
      if (a.kind === 'static') clientValueStatic = a.value;
      else if (a.kind === 'dynamic') clientValue = a.expr;
      // boolean client:only lets the framework come from the component file
      takeStrategy('only');
      continue;
    }
    if (dir === 'idle' || dir === 'visible') {
      // Astro parity: client:idle={{ timeout }} / client:visible={{ rootMargin }}
      if (a.kind === 'dynamic') clientValue = a.expr;
      else if (a.kind !== 'boolean') {
        const hint = dir === 'idle' ? '{{ timeout: 500 }}' : "{{ rootMargin: '200px' }}";
        fail(
          'PF4026',
          `client:${dir} takes an options object: client:${dir}=${hint}`,
          ctx.file,
          ctx.source,
          loc.start,
        );
      }
      takeStrategy(dir);
      continue;
    }
    if (dir === 'load') {
      if (a.kind !== 'boolean') {
        fail(
          'PF4026',
          'Directive client:load must not have a value (use client:load not client:load="...")',
          ctx.file,
          ctx.source,
          loc.start,
        );
      }
      takeStrategy('load');
      continue;
    }
    fail('PF4026', `Unknown client:* directive "client:${dir}"`, ctx.file, ctx.source, loc.start);
  }
  return { attrs: rest, clientStrategy, clientProps, clientValue, clientValueStatic };
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
  if (!name) return false;
  if (name.includes('-')) return false;
  if (name.includes('.')) return true;
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

/**
 * Strip `let-*` attributes off a slot wrapper or a component usage. Each
 * `let-item` names a scoped-slot binding: a plain identifier that resolves to
 * the slot props of the bucket it declares (`let-` + identifier).
 */
export function takeLetProps(
  attrs: Attr[],
  file: string,
  source: string,
  offset: number,
): { attrs: Attr[]; lets: string[] } {
  const rest: Attr[] = [];
  const lets: string[] = [];
  for (const a of attrs) {
    const name = 'name' in a ? a.name : '';
    if (!name.startsWith('let-')) {
      rest.push(a);
      continue;
    }
    const binding = name.slice('let-'.length);
    if (!/^[A-Za-z_$][\w$]*$/.test(binding)) {
      fail(
        'PF4046',
        `"${name}" is not a valid slot binding — use let-item with a plain identifier`,
        file,
        source,
        offset,
      );
    }
    lets.push(binding);
  }
  return { attrs: rest, lets };
}

export interface BucketResult {
  /** bucket name → slot content nodes */
  nodes: Record<string, Node[]>;
  /** bucket name → `let-*` scoped-slot bindings in scope for that bucket */
  lets: Record<string, string[]>;
}

export function bucketSlots(children: Node[], ctx: TemplateContext, defaultLets: string[] = []): BucketResult {
  const nodes: Record<string, Node[]> = Object.create(null);
  const lets: Record<string, string[]> = Object.create(null);
  if (defaultLets.length) lets['default'] = [...defaultLets];
  for (const child of children) {
    let name = 'default';
    if (child.type === 'Element') {
      const idx = child.attrs.findIndex((a) => a.kind === 'static' && a.name === 'slot');
      if (idx >= 0) {
        const a = child.attrs[idx] as { kind: 'static'; value: string };
        name = a.value || 'default';
        child.attrs.splice(idx, 1);
      }
      // `<template slot="name" let-item>` names a scoped slot; the wrapper
      // itself disappears and its children become the slot content.
      if (name !== 'default' && child.name.toLowerCase() === 'template') {
        const { attrs: rest, lets: wrapperLets } = takeLetProps(child.attrs, ctx.file, ctx.source, child.loc.start);
        child.attrs = rest;
        if (wrapperLets.length || child.children.length) {
          (nodes[name] ??= []).push(...child.children);
          if (wrapperLets.length) lets[name] = [...(lets[name] ?? []), ...wrapperLets];
        }
        ctx.usedSlots.add(name);
        continue;
      }
    }
    if (child.type === 'Text' && !child.value.trim()) continue;
    (nodes[name] ??= []).push(child);
    ctx.usedSlots.add(name);
  }
  // every bucket carrying lets counts as used, even if its content is empty
  for (const name of Object.keys(lets)) ctx.usedSlots.add(name);
  return { nodes, lets };
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
    if (!componentTagResolves(name, ctx)) {
      if (name.includes('.')) {
        const head = name.split('.')[0];
        fail(
          'PF4041',
          `<${name}> must resolve to a component`,
          ctx.file,
          ctx.source,
          node.start,
          `Bind "${head}" in the <script> block (e.g. import * as ${head} from './…').`,
        );
      }
      fail(
        'PF4024',
        `<${name}> is not an imported component`,
        ctx.file,
        ctx.source,
        node.start,
        `Add: import ${name} from './${name}.deshi' to the <script> block.`,
      );
    }
    // Only directly imported plain names participate in unused-import
    // diagnostics; scope-resolved tags (`const Tag = …`, dotted chains) are
    // opaque until render time.
    if (!name.includes('.') && ctx.components.has(name)) {
      ctx.usedComponents.add(name);
    }
    const { attrs: plain, lets: usageLets } = takeLetProps(attrs, ctx.file, ctx.source, loc.start);
    const taken = takeClientDirectives(plain, loc, ctx, name, true);
    const bucketed = bucketSlots(children, ctx, usageLets);
    const comp: Component = {
      type: 'Component',
      ident: name,
      props: taken.attrs,
      slots: bucketed.nodes,
      slotLets: bucketed.lets,
      clientProps: taken.clientProps,
      clientStrategy: taken.clientStrategy,
      clientValue: taken.clientValue,
      clientValueStatic: taken.clientValueStatic,
      loc,
    };
    return [comp];
  }

  if (name === 'slot') {
    const nameAttr = attrs.find((a: Attr) => a.kind === 'static' && a.name === 'name') as
      | { value: string }
      | undefined;
    return [{ type: 'Slot', name: nameAttr?.value || 'default', fallback: children, props: [], loc }];
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
  };
  return [el];
}
