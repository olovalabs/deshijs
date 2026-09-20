// deshi — compile(source, options) => { code, css, client, meta, diagnostics }
import { splitBlocks } from './blocks';
import { analyzeScript, emptyScript, type ScriptInfo } from './script';
import { parseTemplate, walkNodes } from './template';
import { analyzeTemplateScope } from './scope';
import { scopeCss, minifyCss, scopedCssUrl } from './css';
import { generate } from './codegen';
import { compileDocument } from './document';
import { isDocumentFile, isLayoutPath } from './filetype';
import { highlightStateToken } from './highlight';
import {
  DeshiError,
  hashString,
  makeDiagnostic,
  type Diagnostic,
  type Node,
  type Root,
} from './types';
import type { TemplateContext } from './expression';

export interface CompileOptions {
  /** path relative to the project root, e.g. `src/app/blog/[slug]/page.html` */
  file: string;
  minify?: boolean;
  isLayout?: boolean;
  /** route pattern of this layout (router mode only) → segment markers */
  segment?: string | null;
  runtimeImport?: string;
  /** File-stable `/_deshi/<filehash>.css` (dev HMR). Default is content-hashed. */
  stableCssUrl?: boolean;
}

export interface CompileMeta {
  file: string;
  hash: string;
  isLayout: boolean;
  isDocument: boolean;
  slots: string[];
  deps: string[];
  hasClient: boolean;
  hasCss: boolean;
  headBlocks: number;
  usesParams: boolean;
  bindings: string[];
}

export interface CompileResult {
  code: string;
  evalBody: string;
  css: { scoped: string; global: string; hash: string };
  client?: { code: string; body: string };
  meta: CompileMeta;
  diagnostics: Diagnostic[];
  ast: Root;
  script: ScriptInfo;
}

const compileMemo = new Map<string, CompileResult>();
const MAX_COMPILE_MEMO = 400;

/** Test hook — clears the module-global compile cache. */
export function __clearCompileMemoForTests(): void {
  compileMemo.clear();
}

export function compile(source: string, opts: CompileOptions): CompileResult {
  const file = opts.file;
  const minify = opts.minify ?? true;
  const isMarkdownDoc = isDocumentFile(file);
  const memoKey = `${file}\0${minify}\0${opts.isLayout ?? ''}\0${opts.segment ?? ''}\0${opts.runtimeImport ?? ''}\0${opts.stableCssUrl ? '1' : '0'}\0${highlightStateToken()}\0${hashString(source)}`;
  const cached = compileMemo.get(memoKey);
  if (cached) {
    return {
      ...cached,
      meta: { ...cached.meta },
      css: { ...cached.css },
      diagnostics: [...cached.diagnostics],
    };
  }
  if (compileMemo.size >= MAX_COMPILE_MEMO) compileMemo.clear();

  const diagnostics: Diagnostic[] = [];
  const hash = hashString(file);
  const isLayout = opts.isLayout ?? isLayoutPath(file);

  let scoped = '';
  let global = '';
  let script: ScriptInfo;
  let root: Root;
  let tctx: TemplateContext;
  let hasClient = false;
  let blocks: ReturnType<typeof splitBlocks> | undefined;

  if (isMarkdownDoc) {
    // .md / .mdx — mdast → Deshi AST directly (no HTML string round-trip).
    const doc = compileDocument(source, file, { minify });
    script = doc.script;
    root = doc.root;
    tctx = doc.ctx;
    global = doc.globalCss;
    diagnostics.push(...doc.diagnostics);
  } else {
    // 1. block split (parse5 tokenizer)
    blocks = splitBlocks(source, file);
    diagnostics.push(...blocks.diagnostics);

    // 2. <script> analysis (acorn)
    script = blocks.script
      ? analyzeScript(blocks.script.content, file, source, blocks.script.contentStart)
      : emptyScript();
    diagnostics.push(...script.diagnostics);

    // 3. styles (css-tree) — respects Astro parity: is:global, global, is:inline
    for (const s of blocks.styles) {
      if (s.attrs.lang && s.attrs.lang !== 'css') {
        diagnostics.push(
          makeDiagnostic('PF2011', `<style lang="${s.attrs.lang}"> is handed to Vite's CSS pipeline in deshi/vite; the playground passes it through as CSS`, file, source, s.start, 'warning'),
        );
      }
      const isInline = 'is:inline' in s.attrs;
      const hasDefineVars = 'define:vars' in s.attrs;
      if (isInline) {
        // is:inline styles are injected raw (no scoping) — Astro behavior
        global += minifyCss(s.content);
      } else if (hasDefineVars) {
        // define:vars styles remain scoped but with CSS vars preamble
        scoped += scopeCss(s.content, hash);
      } else if (s.kind === 'style') scoped += scopeCss(s.content, hash);
      else global += minifyCss(s.content);
    }

    // 4. template parse (parse5 + acorn-jsx) incl. jsxToTemplate / components / slots / head
    tctx = {
      file,
      source,
      components: script.components,
      scoped: scoped.length > 0,
      usedComponents: new Set(),
      usedSlots: new Set(),
    };
    const parsed = parseTemplate(blocks.template, tctx, { minify, isLayout });
    root = parsed.root;

    // 5. client roots
    hasClient = !!blocks.client;
    if (hasClient) {
      if (root.document) {
        throw new DeshiError(
          makeDiagnostic('PF1002', '<script client> is not allowed in the root layout; put it in a component', file, source, blocks.client!.start),
        );
      }
      for (const n of root.children) if (n.type === 'Element') n.clientRoot = true;
    }
  }

  // 6. scope analysis
  analyzeTemplateScope(root.children, script.bindings, file, source);

  // 7. meta
  const slots = new Set<string>();
  let headBlocks = 0;
  walkNodes(root.children, (n: Node) => {
    if (n.type === 'Slot' && !(root.document && n.name === 'head')) slots.add(n.name);
    if (n.type === 'HeadBlock') headBlocks++;
  });
  const deps = script.imports.filter((i) => i.isComponent).map((i) => i.source);
  for (const c of script.components) {
    if (!tctx.usedComponents.has(c)) {
      const imp = script.imports.find((i) => i.specifiers.some((s) => s.local === c));
      const at = imp ? (blocks?.script ? blocks.script.contentStart + imp.start : imp.start) : 0;
      diagnostics.push(
        makeDiagnostic('PF2011', `Component "${c}" is imported but never used`, file, source, at, 'warning'),
      );
    }
  }
  const usesParams = scriptUsesParams(script) || (root.children.length > 0 && sourceUsesParams(root));

  // 8. codegen
  const out = generate({
    file,
    root,
    script,
    hash,
    hasCss: scoped.length > 0 || global.length > 0,
    hasClient,
    isLayout,
    isDocument: root.document,
    segment: opts.segment ?? null,
    cssUrl: opts.stableCssUrl
      ? (scoped || global ? `/_deshi/${hash}.css` : null)
      : scopedCssUrl(scoped),
    slots: [...slots],
    deps,
    runtimeImport: opts.runtimeImport,
  });

  const client = blocks?.client
    ? {
        body: blocks.client.content,
        code: `// \0deshi:client:${file}\nexport default function mount(root, ctx) {\n${indent(blocks.client.content.trim())}\n}\n`,
      }
    : undefined;

  const result: CompileResult = {
    code: out.esm,
    evalBody: out.evalBody,
    css: { scoped, global, hash },
    client,
    meta: {
      file,
      hash,
      isLayout,
      isDocument: root.document,
      slots: [...slots],
      deps,
      hasClient,
      hasCss: scoped.length > 0 || global.length > 0,
      headBlocks,
      usesParams,
      bindings: script.bindings,
    },
    diagnostics,
    ast: root,
    script,
  };
  compileMemo.set(memoKey, result);
  return result;
}

/** True when an ESTree subtree references the identifier `params`. */
function astUsesParams(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(astUsesParams);
  const n = node as { type?: string; name?: string; [k: string]: unknown };
  if (typeof n.type !== 'string') return false;
  if (n.type === 'Identifier' && n.name === 'params') return true;
  for (const k of Object.keys(n)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    if (astUsesParams(n[k])) return true;
  }
  return false;
}

function sourceUsesParams(root: Root): boolean {
  let found = false;
  walkNodes(root.children, (n) => {
    if (n.type === 'Expression' && astUsesParams(n.ast)) found = true;
  });
  return found;
}

function scriptUsesParams(script: ScriptInfo): boolean {
  return astUsesParams(script.programBody);
}

function indent(s: string): string {
  return s.split('\n').map((l) => '  ' + l).join('\n');
}

// ─── debug printer (deshi compile --print-ast) ─────────────────────────────

export function astToJson(node: Node | Node[]): unknown {
  if (Array.isArray(node)) return node.map(astToJson);
  switch (node.type) {
    case 'Root':
      return { type: 'Root', document: node.document, children: astToJson(node.children) };
    case 'Doctype':
      return { type: 'Doctype' };
    case 'Text':
      return { type: 'Text', value: node.value };
    case 'Comment':
      return { type: 'Comment', value: node.value };
    case 'Expression':
      return {
        type: 'Expression',
        raw: node.raw,
        estree: node.ast.type,
        loc: `${node.loc.line}:${node.loc.column}`,
        ...(node.jsx.length ? { jsx: node.jsx.map((j) => ({ range: [j.start, j.end], nodes: astToJson(j.nodes) })) } : {}),
      };
    case 'Element':
      return {
        type: 'Element',
        name: node.name,
        ...(node.scoped ? { scoped: true } : {}),
        ...(node.clientRoot ? { clientRoot: true } : {}),
        ...(node.isDocHead ? { docHead: true } : {}),
        attrs: node.attrs.map(attrToJson),
        children: astToJson(node.children),
      };
    case 'Component':
      return {
        type: 'Component',
        ident: node.ident,
        props: node.props.map(attrToJson),
        ...(node.clientProps ? { clientProps: node.clientProps.raw } : {}),
        ...(node.clientStrategy ? { clientStrategy: node.clientStrategy } : {}),
        ...((node as any).clientMedia ? { clientMedia: (node as any).clientMedia } : {}),
        ...((node as any).clientOnly ? { clientOnly: (node as any).clientOnly } : {}),
        slots: Object.fromEntries(Object.entries(node.slots).map(([k, v]) => [k, astToJson(v)])),
      };
    case 'Slot':
      return { type: 'Slot', name: node.name, fallback: astToJson(node.fallback) };
    case 'Fragment':
      return { type: 'Fragment', children: astToJson(node.children) };
    case 'HeadBlock':
      return { type: 'HeadBlock', ...(node.tail ? { tail: true } : {}), children: astToJson(node.children) };
  }
}

function attrToJson(a: import('./types').Attr): unknown {
  switch (a.kind) {
    case 'static':
      return { kind: 'static', name: a.name, value: a.value };
    case 'boolean':
      return { kind: 'boolean', name: a.name };
    case 'dynamic':
      return { kind: 'dynamic', name: a.name, expr: a.expr.raw };
    case 'spread':
      return { kind: 'spread', expr: a.expr.raw };
    case 'setHtml':
      return { kind: 'setHtml', expr: a.expr.raw };
    case 'setText':
      return { kind: 'setText', expr: a.expr.raw };
    case 'classList':
      return { kind: 'classList', expr: a.expr.raw };
    case 'defineVars':
      return { kind: 'defineVars', expr: a.expr.raw };
    case 'transition':
      return { kind: 'transition', name: (a as any).name, value: typeof (a as any).value === 'string' ? (a as any).value : (a as any).value.raw };
  }
}

export { DeshiError, ERROR_CATALOG } from './types';
export type { Diagnostic, Root, Node } from './types';
