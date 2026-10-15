// deshi — compile(source, options) => { code, css, client, meta, diagnostics }
import { splitBlocks } from './blocks';
import { analyzeScript, emptyScript, type ScriptInfo } from './script';
import { parseTemplate } from './template';
import { walk, hasDescendant } from './ast/walk';
import { referencesIdentifier } from './ast/estree';
import { analyzeTemplateScope } from './scope';
import { checkComponentUsages, collectPropReads, unusedDeclaredProps, type ComponentResolver } from './props';
import { scopeCss, minifyCss, optimizeCss, scopedCssUrl } from './css';
import { generate } from './codegen';
import { compileDocument } from './document';
import { isDocumentFile, isLayoutPath } from './filetype';
import { highlightStateToken } from './highlight';
import type { PropContract, SlotContract } from './tsprops';
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
  /**
   * Resolves an imported component to its declared interface, enabling the
   * cross-file prop/slot checks. Omitted by single-file callers (a Vite
   * transform), which then only get the file-local checks.
   */
  resolveComponent?: ComponentResolver;
}

export interface CompileMeta {
  file: string;
  hash: string;
  isLayout: boolean;
  isDocument: boolean;
  slots: string[];
  /** slots rendered without a fallback — a usage must provide them */
  requiredSlots: string[];
  /** true when a `<slot name={…}>` is computed, so slot checks are skipped */
  dynamicSlots: boolean;
  /** the slot interface declared via `defineSlots`, if any */
  declaredSlots: SlotContract | null;
  /** slot name → the slot props `<slot name="x" {p} />` forwards */
  slotPropsFor: Record<string, string[]>;
  deps: string[];
  hasClient: boolean;
  hasCss: boolean;
  headBlocks: number;
  usesParams: boolean;
  bindings: string[];
  /** the prop contract this file declares via `defineProps` */
  contract: PropContract | null;
  /** `props.x` names this file reads */
  propReads: string[];
  /** true when props are read in a way static analysis cannot follow */
  propReadsOpaque: boolean;
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
  // Source hashes can collide; cache identity must include the exact source.
  const memoKey = `${file}\0${minify}\0${opts.isLayout ?? ''}\0${opts.segment ?? ''}\0${opts.runtimeImport ?? ''}\0${opts.stableCssUrl ? '1' : '0'}\0${opts.resolveComponent ? 'l' : ''}\0${highlightStateToken()}\0${source}`;
  // Resolver results depend on other files (and can change even when the
  // callback identity does not). Do not memoize cross-file validation.
  const cacheable = !opts.resolveComponent;
  const cached = cacheable ? compileMemo.get(memoKey) : undefined;
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
        scoped += optimizeCss(scopeCss(s.content, hash));
      } else if (s.kind === 'style') scoped += optimizeCss(scopeCss(s.content, hash));
      else global += optimizeCss(s.content);
    }

    // 4. template parse (parse5 + acorn-jsx) incl. jsxToTemplate / components / slots / head
    tctx = {
      file,
      source,
      components: script.components,
      bindings: new Set(script.bindings),
      scoped: scoped.length > 0,
      usedComponents: new Set(),
      usedSlots: new Set(),
      dynamicSlots: { value: false },
    };
    const parsed = parseTemplate(blocks.template, tctx, { minify, isLayout });
    root = parsed.root;
    diagnostics.push(...parsed.diagnostics);

    // 5. client blocks
    hasClient = !!blocks.client;
    if (hasClient && root.document) {
      throw new DeshiError(
        makeDiagnostic('PF1002', '<script client> is not allowed in the root layout; put it in a component', file, source, blocks.client!.start),
      );
    }
  }

  // 6. scope analysis
  analyzeTemplateScope(root.children, script.bindings, file, source);

  // 7. meta
  const slots = new Set<string>();
  const requiredSlots = new Set<string>();
  const slotPropsFor: Record<string, string[]> = Object.create(null);
  let headBlocks = 0;
  walk(root.children, (n) => {
    if (n.type === 'Slot' && !(root.document && n.name === 'head')) {
      slots.add(n.name);
      if (!n.fallback.some((c) => c.type !== 'Text' || c.value.trim())) requiredSlots.add(n.name);
      const forwarded = (n.props ?? []).filter((a) => a.kind === 'slotProp');
      const names: string[] = [];
      for (const a of forwarded) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ast = (a as { expr: { ast: any; raw: string } }).expr.ast;
        if (ast.type === 'Identifier') names.push(ast.name);
      }
      if (names.length) for (const key of names) (slotPropsFor[n.name] ??= []).push(key);
    }
    if (n.type === 'HeadBlock') headBlocks++;
  });

  // The writer of the component must keep its declared slot interface honest.
  if (script.slotDecls) {
    const scriptBase = blocks?.script ? blocks.script.contentStart : 0;
    for (const name of script.slotDecls.order) {
      const spec = script.slotDecls.slots[name];
      if (slots.has(name) || spec.required) continue;
      diagnostics.push(
        makeDiagnostic(
          'PF4042',
          `Slot "${name}" is declared in defineSlots but never rendered by ${file}`,
          file,
          source,
          scriptBase + spec.offset,
          'warning',
          'Render <slot name="' + name + '" /> somewhere, or drop the declaration.',
        ),
      );
    }
  }
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
  const usesParams =
    referencesIdentifier(script.programBody, 'params') ||
    hasDescendant(root.children, (n) => n.type === 'Expression' && referencesIdentifier(n.ast, 'params'));

  // 8. component props & attributes: what this file exposes, and what its
  //    component usages are allowed to ask for.
  const { reads, opaque } = collectPropReads(root, script.programBody, [
    'props',
    ...(script.propsLocal && script.propsLocal !== 'props' ? [script.propsLocal] : []),
  ]);
  if (script.contract) {
    // contract offsets are relative to the <script> body; diagnostics are not
    const scriptBase = blocks?.script ? blocks.script.contentStart : 0;
    for (const name of unusedDeclaredProps({
      file,
      slots: [...slots],
      requiredSlots: [...requiredSlots],
      dynamicSlots: false,
      contract: script.contract,
      reads,
      opaque,
      client: hasClient,
    })) {
      const spec = script.contract.props[name];
      diagnostics.push(
        makeDiagnostic(
          'PF4034',
          `Prop "${name}" is declared but never read by ${file}`,
          file,
          source,
          scriptBase + spec.offset,
          'warning',
          'Remove it from the contract, or read it in the template / <script>.',
        ),
      );
    }
  }
  if (opts.resolveComponent) {
    for (const issue of checkComponentUsages(root, { file, resolve: opts.resolveComponent })) {
      diagnostics.push(
        makeDiagnostic(issue.code, issue.message, file, source, issue.loc.start, issue.severity, issue.hint),
      );
    }
  }

  // 9. codegen
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
        // Astro renderer contract: the chunk default-exports a factory that
        // receives the <deshi-island> element and returns the hydrate function
        // `(Component, props, slots, { client })`. The `<script client>` body
        // keeps its documented `root` / `ctx` bindings.
        code: `// deshi island chunk for ${file}\nexport default function islandRenderer(element) {\n  return function ($Component, $props, $slots, $client) {\n    if (!element.hasAttribute("ssr")) return;\n    const root = element;\n    const ctx = { props: $props, slots: $slots, url: location.href, client: $client && $client.client };\n${indent(blocks.client.content.trim())}\n  };\n}\n`,
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
      requiredSlots: [...requiredSlots],
      dynamicSlots: tctx.dynamicSlots?.value ?? false,
      declaredSlots: script.slotDecls,
      slotPropsFor,
      deps,
      hasClient,
      hasCss: scoped.length > 0 || global.length > 0,
      headBlocks,
      usesParams,
      bindings: script.bindings,
      contract: script.contract,
      propReads: reads,
      propReadsOpaque: opaque,
    },
    diagnostics,
    ast: root,
    script,
  };
  if (cacheable) compileMemo.set(memoKey, result);
  return result;
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
        ...(node.clientValue ? { clientValue: node.clientValue.raw } : {}),
        ...(node.clientValueStatic !== undefined ? { clientValueStatic: node.clientValueStatic } : {}),
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
export { optimizeHtml, optimizeJs } from './optimize';
export { minifyCss, minifyDeclarationList, optimizeCss } from './css';
export { setContext, getContext, hasContext, runWithContext } from './runtime';
export { detectFramework, generateFrameworkIslandChunk, renderFrameworkComponent, serializeVNode } from './frameworks';
