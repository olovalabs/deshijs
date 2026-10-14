// Stage 5 — codegen: Deshi AST → ESM render module.
// Every template node becomes a string-concatenation expression; JSX found inside
// `{ }` expressions is spliced back into the expression source as `$r(...)` calls.
import type { Component, Element, Expression, Node, Root, Slot } from './types';
import type { ImportInfo, ScriptInfo } from './script';
import { escapeHtml } from './escape';
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

/**
 * Write an element's opening tag (and, for void / set:html / set:text, the
 * whole element). Returns the children that still need to be emitted before
 * the closing tag, or null when the element is finished.
 */
function genElement(el: Element, em: Em, g: G): { children: Node[]; raw: boolean } | null {
  if (el.isDocHead) {
    genDocHead(el, em, g);
    return null;
  }
  em.str('<' + el.name);
  // The attribute planner folds class/class:list, style/define:vars and spreads
  // into one literal prefix plus at most one attrs() call, so a fully static
  // element costs nothing at runtime and nothing is ever emitted twice.
  const plan = planAttributes(el.attrs, {
    print: (expr) => genExprCode(expr, g),
    scopeAttr: el.scoped ? scopeAttribute(g.hash) : undefined,
  });
  for (const part of plan.parts) {
    if (typeof part === 'string') em.str(part);
    else em.expr(part.code);
  }
  if (plan.scopeAttr) em.str(' ' + plan.scopeAttr);
  em.str('>');
  if (VOID.has(el.name.toLowerCase())) return null;
  const setHtml = el.attrs.find((a) => a.kind === 'setHtml') as { expr: Expression } | undefined;
  const setText = el.attrs.find((a) => a.kind === 'setText') as { expr: Expression } | undefined;
  if (setHtml) {
    em.expr(`(await unsafe(${genExprCode(setHtml.expr, g)}))`, true);
    em.str(`</${el.name}>`);
    return null;
  }
  if (setText) {
    em.expr(`(await esc(${genExprCode(setText.expr, g)}))`, true);
    em.str(`</${el.name}>`);
    return null;
  }
  return {
    children: el.children,
    raw: el.name.toLowerCase() === 'script' || el.name.toLowerCase() === 'style',
  };
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
      return `[${JSON.stringify(name)}]: async () => ${s.code()}`;
    })
    .join(', ');
  const cp = c.clientProps
    ? `{ ...(${props}), ...(${genExprCode(c.clientProps, g)}) }`
    : c.clientStrategy
      ? props
      : 'undefined';
  const strat = c.clientStrategy ? JSON.stringify(c.clientStrategy) : 'undefined';
  const value = c.clientValue
    ? genExprCode(c.clientValue, g)
    : c.clientValueStatic !== undefined
      ? JSON.stringify(c.clientValueStatic)
      : 'undefined';
  em.expr(
    `(await renderComponent(${c.ident}, ${props}, { ${slots} }, $ctx, ${cp}, ${strat}, ${value}))`,
    true,
  );
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

function genNodes(nodes: Node[], em: Em, g: G, rawText = false): void {
  // Element nesting is a stack, not host recursion. JSX inside an expression
  // calls genNodes again and gets its own stack; that depth is expression
  // nesting, not the HTML tree.
  type Frame =
    | { kind: 'list'; nodes: Node[]; index: number; em: Em; raw: boolean }
    | { kind: 'close'; em: Em; html: string };
  const stack: Frame[] = [{ kind: 'list', nodes, index: 0, em, raw: rawText }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.kind === 'close') {
      frame.em.str(frame.html);
      stack.pop();
      continue;
    }
    if (frame.index >= frame.nodes.length) {
      stack.pop();
      continue;
    }
    const n = frame.nodes[frame.index++];
    switch (n.type) {
      case 'Text':
        frame.em.str(frame.raw ? n.value : escapeHtml(n.value));
        break;
      case 'Expression':
        frame.em.expr(`(await esc(${genExprCode(n, g)}))`, true);
        break;
      case 'Element': {
        const open = genElement(n, frame.em, g);
        if (open) {
          stack.push({ kind: 'close', em: frame.em, html: `</${n.name}>` });
          stack.push({ kind: 'list', nodes: open.children, index: 0, em: frame.em, raw: open.raw });
        }
        break;
      }
      case 'Component':
        genComponent(n, frame.em, g);
        break;
      case 'Slot':
        genSlot(n, frame.em, g);
        break;
      case 'Fragment':
        // Fragments do not inherit raw-text mode from the surrounding list.
        stack.push({ kind: 'list', nodes: n.children, index: 0, em: frame.em, raw: false });
        break;
      case 'HeadBlock': {
        const h = new Em();
        genNodes(n.children, h, g);
        if (h.parts.length) g.heads.push(`headPush($ctx, ${h.code()}${n.tail ? ', true' : ''});`);
        break;
      }
      case 'Comment':
        frame.em.str(`<!--${n.value}-->`);
        break;
      case 'Doctype':
        frame.em.str('<!doctype html>');
        break;
      case 'Root':
        stack.push({ kind: 'list', nodes: n.children, index: 0, em: frame.em, raw: false });
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
  // Islands are wrapped in <deshi-island> at render time (runtime.ts) — exactly
  // like Astro's <astro-island>: the component's own markup is never stamped or
  // re-parsed, so a component with zero or many root elements behaves the same.
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

  // Astro global parity: expose Astro alongside props/params/url/route/env.
  // Template expressions can use `Astro.props`, `Astro.params`, `Astro.url`, etc.
  const renderFn = [
    `async function render({ props, slots, params, url, route, env, Deshi, Astro }, $slotFns, $ctx) {`,
    `  if (!Deshi) { Deshi = Astro || { props, params, url, route, site: url ? new (globalThis.URL||URL)(url.origin) : undefined, generator: ${JSON.stringify('Deshi ' + DESHI_VERSION)}, slots: slots || {}, request: { url: url ? url.href : '/', headers: new Headers() }, cookies: { get:()=>undefined, has:()=>false }, redirect:(p,s)=>new Response(null,{status:s||302, headers:{Location:p}}), rewrite:()=>null, setContext, getContext, hasContext }; }`,
    `  if (!Astro) { Astro = Deshi; }`,
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
  const userImports = new Set<string>();
  for (const imp of input.script.imports) {
    for (const s of imp.specifiers) userImports.add(s.local);
  }
  const contextHelpers = ['setContext', 'getContext', 'hasContext'].filter((h) => !userImports.has(h));
  const esmHelpers = ['esc', 'unsafe', 'attrs', 'cls', 'sty', 'renderComponent', 'headPush', 'slot as $slot', 'raw as $r', ...contextHelpers];
  const evalHelpers = ['esc', 'unsafe', 'attrs', 'cls', 'sty', 'renderComponent', 'headPush', 'slot: $slot', 'raw: $r', ...contextHelpers];
  const esm = [
    `import { ${esmHelpers.join(', ')} } from '${runtimeSource}';`,
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
    `const { ${evalHelpers.join(', ')} } = $rt;`,
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
