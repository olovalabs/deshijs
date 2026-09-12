// Stage 5 — codegen: Deshi AST → ESM render module.
// Every template node becomes a string-concatenation expression; JSX found inside
// `{ }` expressions is spliced back into the expression source as `$r(...)` calls.
import type { Attr, Component, Element, Expression, Node, Root, Slot } from './types';
import type { ImportInfo, ScriptInfo } from './script';
import { escapeAttr, escapeHtml } from './runtime';
import { scopeAttribute } from './css';

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
}

function genExprCode(expr: Expression, g: G): string {
  let code = expr.raw;
  for (const j of [...expr.jsx].sort((a, b) => b.start - a.start)) {
    const em = new Em();
    genNodes(j.nodes, em, g);
    const rep = em.hasAwait ? `(async () => $r(${em.code()}))()` : `$r(${em.code()})`;
    code = code.slice(0, j.start - expr.start) + rep + code.slice(j.end - expr.start);
  }
  return `(${code})`;
}

function attrEntries(attrs: Attr[], g: G): string[] {
  const out: string[] = [];
  for (const a of attrs) {
    switch (a.kind) {
      case 'static':
        out.push(`${JSON.stringify(a.name)}: ${JSON.stringify(a.value)}`);
        break;
      case 'boolean':
        out.push(`${JSON.stringify(a.name)}: true`);
        break;
      case 'dynamic':
        out.push(`${JSON.stringify(a.name)}: ${genExprCode(a.expr, g)}`);
        break;
      case 'spread':
        out.push(`...${genExprCode(a.expr, g)}`);
        break;
      case 'setHtml':
        break;
    }
  }
  return out;
}

function genElement(el: Element, em: Em, g: G): void {
  if (el.isDocHead) {
    genDocHead(el, em, g);
    return;
  }
  em.str('<' + el.name);
  const dyn = el.attrs.some((a) => a.kind === 'dynamic' || a.kind === 'spread') || el.clientRoot;
  if (!dyn) {
    for (const a of el.attrs) {
      if (a.kind === 'static') em.str(` ${a.name}="${escapeAttr(a.value)}"`);
      else if (a.kind === 'boolean') em.str(` ${a.name}`);
    }
    if (el.scoped) em.str(' ' + scopeAttribute(g.hash));
  } else {
    const entries = attrEntries(el.attrs, g);
    if (el.scoped) entries.push(`${JSON.stringify(scopeAttribute(g.hash))}: true`);
    if (el.clientRoot) entries.push(`"data-deshi-c": ${JSON.stringify(g.hash)}`, `"data-deshi-props": $cp`);
    em.expr(`attrs({ ${entries.join(', ')} })`);
  }
  em.str('>');
  if (VOID.has(el.name.toLowerCase())) return;
  const setHtml = el.attrs.find((a) => a.kind === 'setHtml') as { expr: Expression } | undefined;
  if (setHtml) em.expr(`(await unsafe(${genExprCode(setHtml.expr, g)}))`, true);
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
  const dyn = el.attrs.some((x) => x.kind === 'dynamic' || x.kind === 'spread');
  if (dyn) em.expr(`attrs({ ${attrEntries(el.attrs, g).join(', ')} })`);
  else for (const x of el.attrs) em.str(x.kind === 'static' ? ` ${x.name}="${escapeAttr(x.value)}"` : x.kind === 'boolean' ? ` ${x.name}` : '');
  em.str('><!--deshi:head--></head>');
}

function genComponent(c: Component, em: Em, g: G): void {
  const props = attrEntries(c.props, g).join(', ');
  const slots = Object.entries(c.slots)
    .filter(([, nodes]) => nodes.length)
    .map(([name, nodes]) => {
      const s = new Em();
      genNodes(nodes, s, g);
      return `${JSON.stringify(name)}: async () => ${s.code()}`;
    })
    .join(', ');
  const cp = c.clientProps ? `, ${genExprCode(c.clientProps, g)}` : '';
  em.expr(`(await renderComponent(${c.ident}, { ${props} }, { ${slots} }, $ctx${cp}))`, true);
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
  const g: G = { ...input, heads: [] };
  const statements: string[] = [];
  for (const child of input.root.children) {
    const em = new Em();
    genNodes([child], em, g);
    if (em.parts.length) statements.push(`  $o += ${em.code()};`);
  }

  const body = input.script.body
    ? input.script.body.split('\n').map((l) => '  ' + l).join('\n') + '\n'
    : '';
  const heads = g.heads.map((h) => '  ' + h).join('\n');

  const renderFn = [
    `async function render({ props, slots, params, url, route, env }, $slotFns, $ctx, $cp) {`,
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
    `import { esc, unsafe, attrs, renderComponent, headPush, slot as $slot, raw as $r } from '${runtimeSource}';`,
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
    `const { esc, unsafe, attrs, renderComponent, headPush, slot: $slot, raw: $r } = $rt;`,
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
