// Stage 5 — codegen: Deshi AST → ESM render module.
// Every template node becomes a string-concatenation expression; JSX found inside
// `{ }` expressions is spliced back into the expression source as `$r(...)` calls.
import type { Component, Element, Expression, Node, Root, Slot } from './types';
import type { ImportInfo, ScriptInfo } from './script';
import { escapeHtml } from './runtime';
import { planAttributes, planPropsObject } from './attrs';
import { printExpression } from './ast/print';
import { scopeAttribute } from './css';
import { DESHI_VERSION } from './types';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

export interface CodegenInput {
  file: string;
  root: Root;
  script: ScriptInfo;
  hash: string;
  hasCss: boolean;
  hasClient: boolean;
  isLayout: boolean;
  isDocument: boolean;
  /** layout route pattern (kept for future use; no longer emitted into HTML) */
  segment?: string | null;
  /** content-hashed URL of this file's scoped CSS; emitted as a side-effect import (React-style) */
  cssUrl?: string | null;
  slots: string[];
  deps: string[];
  runtimeImport?: string;
}

export interface CodegenOutput {
  esm: string;
  evalBody: string;
}

type Part = { lit: string } | { code: string };

class Em {
  parts: Part[] = [];
  hasAwait = false;
  str(s: string): void {
    if (!s) return;
    const last = this.parts[this.parts.length - 1];
    if (last && 'lit' in last) last.lit += s;
    else this.parts.push({ lit: s });
  }
  expr(code: string, awaits = false): void {
    this.parts.push({ code });
    if (awaits) this.hasAwait = true;
  }
  code(): string {
    if (!this.parts.length) return "''";
    return this.parts.map((p) => ('lit' in p ? JSON.stringify(p.lit) : p.code)).join(' + ');
  }
}

interface G extends CodegenInput {
  heads: string[];
  /** island markers for a component with a `<script client>` block */
  island: { hash: string } | null;
}

/** Render a run of template nodes to a JS expression that produces its HTML. */
function renderNodes(nodes: Node[], g: G): { code: string; hasAwait: boolean } {
  const em = new Em();
  genNodes(nodes, em, g);
  return { code: em.code(), hasAwait: em.hasAwait };
}

function genExprCode(expr: Expression, g: G): string {
  // The JS comes from the AST: JSX ranges are handed to the node renderer and
  // the rest of the expression is emitted exactly as the parser saw it. The
  // result is parenthesised so it is safe in any position (object value, call
  // argument, template hole).
  const code = printExpression(expr, (nodes) => {
    const { code, hasAwait } = renderNodes(nodes, g);
    return hasAwait ? `(async () => $r(${code}))()` : `$r(${code})`;
  });
  return `(${code})`;
}

function genElement(el: Element, em: Em, g: G): void {
  if (el.isDocHead) {
    genDocHead(el, em, g);
    return;
  }
  em.str('<' + el.name);
  // The attribute planner folds class/class:list, style/define:vars, spreads and
  // the island markers into one literal prefix plus at most one attrs() call, so
  // a fully static element costs nothing at runtime and nothing is ever emitted
  // twice.
  const plan = planAttributes(el.attrs, {
    print: (expr) => genExprCode(expr, g),
    scopeAttr: el.scoped ? scopeAttribute(g.hash) : undefined,
    island: el.clientRoot ? g.island : null,
  });
  for (const part of plan.parts) {
    if (typeof part === 'string') em.str(part);
    else em.expr(part.code);
  }
  if (plan.scopeAttr) em.str(' ' + plan.scopeAttr);
  em.str('>');
  if (VOID.has(el.name.toLowerCase())) return;
  const setHtml = el.attrs.find((a) => a.kind === 'setHtml') as { expr: Expression } | undefined;
  const setText = el.attrs.find((a) => a.kind === 'setText') as { expr: Expression } | undefined;
  if (setHtml) em.expr(`(await unsafe(${genExprCode(setHtml.expr, g)}))`, true);
  else if (setText) em.expr(`(await esc(${genExprCode(setText.expr, g)}))`, true);
  else genNodes(el.children, em, g);
  em.str(`</${el.name}>`);
}

function genDocHead(el: Element, em: Em, g: G): void {
  const idx = el.children.findIndex((c) => c.type === 'Slot' && c.name === 'head');
  const before = idx === -1 ? el.children : el.children.slice(0, idx);
  const after = idx === -1 ? [] : el.children.slice(idx + 1);
  const b = new Em();
  genNodes(before, b, g);
  if (b.parts.length) g.heads.push(`headPush($ctx, ${b.code()});`);
  const a = new Em();
  genNodes(after, a, g);
  if (a.parts.length) g.heads.push(`headPush($ctx, ${a.code()}, true);`);
  em.str('<head');
  const headAttrs = planAttributes(el.attrs, { print: (e) => genExprCode(e, g) });
  for (const part of headAttrs.parts) {
    if (typeof part === 'string') em.str(part);
    else em.expr(part.code);
  }
  em.str('><!--deshi:head--></head>');
}

function genComponent(c: Component, em: Em, g: G): void {
  const props = planPropsObject(c.props, { print: (e) => genExprCode(e, g) });
  const slots = Object.entries(c.slots)
    .filter(([, nodes]) => nodes.length)
    .map(([name, nodes]) => {
      const s = new Em();
      genNodes(nodes, s, g);
      return `${JSON.stringify(name)}: async () => ${s.code()}`;
    })
    .join(', ');
  const cp = c.clientProps ? genExprCode(c.clientProps, g) : 'undefined';
  const strat = c.clientStrategy ? JSON.stringify(c.clientStrategy) : 'undefined';
  const media = (c as any).clientMedia ? JSON.stringify((c as any).clientMedia) : 'undefined';
  const only = (c as any).clientOnly ? JSON.stringify((c as any).clientOnly) : 'undefined';
  // renderComponent signature now includes media/only for islands
  if ((c as any).clientMedia || (c as any).clientOnly) {
    em.expr(`(await renderComponent(${c.ident}, ${props}, { ${slots} }, $ctx, ${cp}, ${strat}, ${media}, ${only}))`, true);
  } else {
    em.expr(`(await renderComponent(${c.ident}, ${props}, { ${slots} }, $ctx, ${cp}, ${strat}))`, true);
  }
}

function genSlot(s: Slot, em: Em, g: G): void {
  if (g.isDocument && s.name === 'head') {
    em.str('<!--deshi:head-->');
    return;
  }
  let fb = '';
  if (s.fallback.length) {
    const f = new Em();
    genNodes(s.fallback, f, g);
    fb = `, async () => ${f.code()}`;
  }
  const code = `(await $slot($slotFns, ${JSON.stringify(s.name)}${fb}))`;
  // No marker comments in output (Astro-clean HTML): the client router swaps
  // <main> (everything route-specific renders inside it, layouts nest under
  // one root), so no per-segment hooks are needed in the markup.
  em.expr(code, true);
}

function genNodes(nodes: Node[], em: Em, g: G): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'Text':
        em.str(escapeHtml(n.value));
        break;
      case 'Expression':
        em.expr(`(await esc(${genExprCode(n, g)}))`, true);
        break;
      case 'Element':
        genElement(n, em, g);
        break;
      case 'Component':
        genComponent(n, em, g);
        break;
      case 'Slot':
        genSlot(n, em, g);
        break;
      case 'Fragment':
        genNodes(n.children, em, g);
        break;
      case 'HeadBlock': {
        const h = new Em();
        genNodes(n.children, h, g);
        if (h.parts.length) g.heads.push(`headPush($ctx, ${h.code()}${n.tail ? ', true' : ''});`);
        break;
      }
      case 'Comment':
        em.str(`<!--${n.value}-->`);
        break;
      case 'Doctype':
        em.str('<!doctype html>');
        break;
      case 'Root':
        genNodes(n.children, em, g);
        break;
    }
  }
}

function esmImport(imp: ImportInfo): string {
  const def = imp.specifiers.find((s) => s.imported === 'default');
  const ns = imp.specifiers.find((s) => s.imported === '*');
  const named = imp.specifiers.filter((s) => s.imported !== 'default' && s.imported !== '*');
  const parts: string[] = [];
  if (def) parts.push(def.local);
  if (ns) parts.push(`* as ${ns.local}`);
  if (named.length) parts.push(`{ ${named.map((s) => (s.imported === s.local ? s.local : `${s.imported} as ${s.local}`)).join(', ')} }`);
  if (!parts.length) return `import ${JSON.stringify(imp.source)};`;
  return `import ${parts.join(', ')} from ${JSON.stringify(imp.source)};`;
}

function evalImport(imp: ImportInfo): string {
  const lines: string[] = [];
  const src = JSON.stringify(imp.source);
  const def = imp.specifiers.find((s) => s.imported === 'default');
  const ns = imp.specifiers.find((s) => s.imported === '*');
  const named = imp.specifiers.filter((s) => s.imported !== 'default' && s.imported !== '*');
  if (!imp.specifiers.length) lines.push(`await $import(${src});`);
  if (def) lines.push(`const ${def.local} = (await $import(${src})).default;`);
  if (ns) lines.push(`const ${ns.local} = await $import(${src});`);
  if (named.length) {
    lines.push(`const { ${named.map((s) => (s.imported === s.local ? s.local : `${s.imported}: ${s.local}`)).join(', ')} } = await $import(${src});`);
  }
  return lines.join('\n');
}

export function generate(input: CodegenInput): CodegenOutput {
  // A component with a `<script client>` block renders island markers on its
  // root element. When it has no root element (it starts with text or a
  // comment) the output is wrapped, so the boot script always has a node to
  // attach to — decided here, at compile time, instead of by re-parsing the
  // rendered HTML at runtime.
  const hasClientRoot = input.hasClient;
  const wrapIslandRoot = hasClientRoot && !input.root.children.some((c) => c.type === 'Element');
  const g: G = { ...input, heads: [], island: hasClientRoot ? { hash: input.hash } : null };
  const statements: string[] = [];
  for (const child of input.root.children) {
    const em = new Em();
    genNodes([child], em, g);
    if (em.parts.length) statements.push(`  $o += ${em.code()};`);
  }
  if (wrapIslandRoot) {
    statements.unshift(`  $o += '<div' + islandAttrs() + ' style="display:contents">';`);
    statements.push(`  $o += '</div>';`);
  }

  const body = input.script.body
    ? input.script.body.split('\n').map((l) => '  ' + l).join('\n') + '\n'
    : '';
  const heads = g.heads.map((h) => '  ' + h).join('\n');

  // Astro global parity: expose Astro alongside props/params/url/route/env.
  // Template expressions can use `Astro.props`, `Astro.params`, `Astro.url`, etc.
  const renderFn = [
    `async function render({ props, slots, params, url, route, env, Astro }, $slotFns, $ctx, $cp, $island) {`,
    `  if (!Astro) { Astro = { props, params, url, route, site: url ? new (globalThis.URL||URL)(url.origin) : undefined, generator: ${JSON.stringify('Deshi ' + DESHI_VERSION)}, slots: slots || {}, request: { url: url ? url.href : '/', headers: new Headers() }, cookies: { get:()=>undefined, has:()=>false }, redirect:(p,s)=>new Response(null,{status:s||302, headers:{Location:p}}), rewrite:()=>null }; }`,
    hasClientRoot
      ? `  const islandAttrs = () => attrs($island ? { id: $island.id, "data-deshi-c": ${JSON.stringify(input.hash)}, "data-deshi-props": $cp } : {});`
      : '',
    body.trimEnd(),
    heads,
    `  let $o = '';`,
    statements.join('\n'),
    `  return $o;`,
    `}`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const meta = JSON.stringify({
    file: input.file,
    hash: input.hash,
    slots: input.slots,
    deps: input.deps,
    css: input.hasCss,
    client: input.hasClient,
    isLayout: input.isLayout,
    isDocument: input.isDocument,
  });

  const sp = input.script.staticParams;

  const runtimeSource = input.runtimeImport ?? 'deshi/runtime';
  const esm = [
    `import { esc, unsafe, attrs, cls, sty, renderComponent, headPush, slot as $slot, raw as $r } from '${runtimeSource}';`,
    // React-style co-located CSS: Vite serves/transforms this (postcss, HMR, bundling).
    // The SSG evaluator ignores it (see evalBody below) and links the emitted file instead.
    ...(input.cssUrl ? [`import ${JSON.stringify(input.cssUrl)};`] : []),
    ...input.script.imports.map(esmImport),
    sp ? `export ${sp}` : '',
    '',
    renderFn,
    `render.__deshi = ${meta};`,
    `export const __deshi = render.__deshi;`,
    `export default render;`,
    '',
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');

  const evalBody = [
    `const { esc, unsafe, attrs, cls, sty, renderComponent, headPush, slot: $slot, raw: $r } = $rt;`,
    ...input.script.imports.map(evalImport),
    sp ?? '',
    renderFn,
    `render.__deshi = ${meta};`,
    `return { default: render, __deshi: render.__deshi${sp ? ', getStaticParams' : ''} };`,
  ]
    .filter(Boolean)
    .join('\n');

  return { esm, evalBody };
}
