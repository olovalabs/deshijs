// Document AST layer — markdown / MDX → Deshi AST.
//
// `.md` / `.mdx` files are parsed with the unified/remark pipeline into mdast
// (remark-parse + remark-gfm, plus remark-mdx for `.mdx`). The mdast tree is then
// mapped straight to Deshi AST nodes: real Element / Component / Expression /
// Text nodes with source locations. Nothing is turned into an HTML string and
// re-parsed, so scope analysis, codegen and diagnostics all operate on the AST.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMdx from 'remark-mdx';
import { parse as parseYaml } from 'yaml';
import * as acorn from 'acorn';
import {
  ACORN_OPTIONS,
  JsxParser,
  bucketSlots,
  checkAttrName,
  isComponentName,
  makeExpression,
  takeClientDirectives,
  type TemplateContext,
} from './expression';
import { analyzeScript, type ScriptInfo } from './script';
import { extname } from './filetype';
import { highlightCode } from './highlight';
import { fail, type Attr, type Diagnostic, type Element, type Expression, type Loc, type Node, type Root } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = any;

export const DOC_TYPOGRAPHY_CSS = `.deshi-md { max-width: 720px; margin: 0 auto; }
.deshi-md h1 { font-size: 2rem; color: #fafafa; }
.deshi-md h2 { font-size: 1.4rem; color: #fafafa; margin-top: 1.5rem; }
.deshi-md h3 { font-size: 1.15rem; color: #e4e4e7; margin-top: 1.25rem; }
.deshi-md p, .deshi-md li { color: #a1a1aa; line-height: 1.7; }
.deshi-md a { color: #a3e635; text-decoration: underline; text-underline-offset: 2px; }
.deshi-md pre { background: #18181b; padding: 1rem; border-radius: 8px; overflow: auto; border: 1px solid #27272a; }
.deshi-md code { font-family: ui-monospace, monospace; font-size: 0.9em; }
.deshi-md table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
.deshi-md th, .deshi-md td { border: 1px solid #27272a; padding: 0.5rem 0.75rem; text-align: left; }
.deshi-md th { background: #18181b; color: #fafafa; }
.deshi-md blockquote { border-left: 3px solid #3f3f46; padding-left: 1rem; margin: 1.5rem 0; color: #a1a1aa; }`;

export interface DocumentResult {
  root: Root;
  script: ScriptInfo;
  ctx: TemplateContext;
  globalCss: string;
  diagnostics: Diagnostic[];
}

export interface DocumentOptions {
  minify: boolean;
}

// Block-level tags: used to avoid nesting a block element inside an implicit <p>.
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figure',
  'blockquote', 'pre', 'table', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'form', 'fieldset', 'details', 'summary',
]);

// ─── mdast helpers ───────────────────────────────────────────────────────────

function loc(node: M): Loc {
  const p = node?.position;
  if (!p) return { line: 1, column: 1, start: 0, end: 0 };
  return {
    line: p.start?.line ?? 1,
    column: p.start?.column ?? 1,
    start: p.start?.offset ?? 0,
    end: p.end?.offset ?? 0,
  };
}

function el(name: string, attrs: Attr[], children: Node[], l: Loc): Element {
  return { type: 'Element', name, attrs, children, loc: l, scoped: false, clientRoot: false };
}

function text(value: string, l: Loc): Node {
  return { type: 'Text', value, loc: l };
}

function staticAttr(name: string, value: string): Attr {
  return { kind: 'static', name, value };
}

/** Plain-text content of an mdast subtree — used for heading ids. */
function toString(node: M): string {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return node.value ?? '';
  const kids: M[] = node.children ?? [];
  return kids.map(toString).join('');
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
}

// ─── expressions ─────────────────────────────────────────────────────────────

function exprFromSource(code: string, ctx: TemplateContext, l: Loc): Node {
  const sctx: TemplateContext = { ...ctx, source: code };
  let ast: acorn.Expression;
  try {
    ast = JsxParser.parseExpressionAt(code, 0, ACORN_OPTIONS) as acorn.Expression;
  } catch (e) {
    const err = e as { pos?: number; message: string };
    fail('PF4001', `Expression syntax error: ${err.message.replace(/ \(\d+:\d+\)$/, '')}`, ctx.file, code, err.pos ?? 0);
  }
  const expr = makeExpression(ast, sctx);
  expr.loc = l;
  return expr;
}

function expressionNode(node: M, ctx: TemplateContext): Node[] {
  const value: string = node.value ?? '';
  if (!value.trim()) return [];
  return [exprFromSource(value, ctx, loc(node))];
}

// ─── JSX (MDX) elements ──────────────────────────────────────────────────────

function attrFromMdx(a: M, ctx: TemplateContext, l: Loc): Attr {
  if (a.type === 'mdxJsxExpressionAttribute') {
    return { kind: 'spread', expr: exprFromSource(a.value, ctx, l) as never };
  }
  const name: string = a.name;
  checkAttrName(name, l.start, ctx);
  const value = a.value;
  if (value == null) {
    if (name === 'set:html' || name === 'set:text' || name === 'class:list' || name === 'define:vars') {
      fail('PF1002', `${name} requires an expression value: ${name}={...}`, ctx.file, ctx.source, l.start);
    }
    if (name.startsWith('transition:')) return { kind: 'transition', name, value: '' };
    return { kind: 'boolean', name };
  }
  if (typeof value === 'string') {
    if (name === 'set:html' || name === 'set:text' || name === 'class:list' || name === 'define:vars') {
      fail('PF1002', `${name} requires an expression value: ${name}={...}`, ctx.file, ctx.source, l.start);
    }
    if (name.startsWith('transition:')) return { kind: 'transition', name, value };
    return { kind: 'static', name, value };
  }
  const expr = exprFromSource(value.value ?? '', ctx, l) as never;
  if (name === 'set:html') return { kind: 'setHtml', expr };
  if (name === 'set:text') return { kind: 'setText', expr };
  if (name === 'class:list') return { kind: 'classList', expr };
  if (name === 'define:vars') return { kind: 'defineVars', expr };
  if (name.startsWith('transition:')) return { kind: 'transition', name, value: expr };
  return { kind: 'dynamic', name, expr };
}

function mdxElement(node: M, ctx: TemplateContext): Node[] {
  const name: string | null = node.name;
  const l = loc(node);
  const children = convertChildren(node.children ?? [], ctx);
  if (name == null) return children; // fragment
  const attrs: Attr[] = (node.attributes ?? []).map((a: M) => attrFromMdx(a, ctx, l));

  if (isComponentName(name)) {
    if (!ctx.components.has(name)) {
      fail('PF4024', `<${name}> is not an imported component`, ctx.file, ctx.source, l.start,
        `Add: import ${name} from './${name}.deshi' to the top of the file.`);
    }
    ctx.usedComponents.add(name);
    const taken = takeClientDirectives(attrs, l, ctx, name, true);
    return [{
      type: 'Component',
      ident: name,
      props: taken.attrs,
      slots: bucketSlots(children, ctx),
      clientProps: taken.clientProps,
      clientStrategy: taken.clientStrategy,
      clientMedia: taken.clientMedia,
      clientOnly: taken.clientOnly,
      loc: l,
    }];
  }

  if (name === 'slot') {
    const nameAttr = attrs.find((a) => a.kind === 'static' && a.name === 'name');
    return [{ type: 'Slot', name: (nameAttr as { value?: string } | undefined)?.value || 'default', fallback: children, loc: l }];
  }

  takeClientDirectives(attrs, l, ctx, name, false);
  return [el(name, attrs, children, l)];
}

// ─── mdast → Deshi ───────────────────────────────────────────────────────────

function convertChildren(children: M[], ctx: TemplateContext): Node[] {
  const out: Node[] = [];
  for (const c of children) out.push(...convertNode(c, ctx));
  return out;
}

function headingNode(node: M, ctx: TemplateContext): Element {
  const level = Math.min(6, Math.max(1, node.depth || 1));
  const kids = convertChildren(node.children ?? [], ctx);
  const id = slug(toString(node));
  const attrs: Attr[] = id ? [staticAttr('id', id)] : [];
  return el(`h${level}`, attrs, kids, loc(node));
}

function listItemNode(node: M, ctx: TemplateContext, tight: boolean): Element {
  const kids: Node[] = [];
  for (const c of node.children ?? []) {
    // Tight lists do not wrap item content in <p> (CommonMark/GFM rendering).
    if (tight && c.type === 'paragraph') kids.push(...convertChildren(c.children ?? [], ctx));
    else kids.push(...convertNode(c, ctx));
  }
  if (typeof node.checked === 'boolean') {
    const boxAttrs: Attr[] = [staticAttr('type', 'checkbox'), { kind: 'boolean', name: 'disabled' }];
    if (node.checked) boxAttrs.push({ kind: 'boolean', name: 'checked' });
    const box = el('input', boxAttrs, [], loc(node));
    return el('li', [], [box, text(' ', loc(node)), ...kids], loc(node));
  }
  return el('li', [], kids, loc(node));
}

function listNode(node: M, ctx: TemplateContext): Element {
  const attrs: Attr[] = [];
  if (node.ordered && typeof node.start === 'number' && node.start !== 1) {
    attrs.push(staticAttr('start', String(node.start)));
  }
  const tight = !node.spread;
  const items = (node.children ?? []).map((item: M) => listItemNode(item, ctx, tight));
  return el(node.ordered ? 'ol' : 'ul', attrs, items, loc(node));
}

function linkNode(node: M, ctx: TemplateContext): Element {
  const attrs: Attr[] = [staticAttr('href', String(node.url ?? ''))];
  if (node.title) attrs.push(staticAttr('title', String(node.title)));
  return el('a', attrs, convertChildren(node.children ?? [], ctx), loc(node));
}

function imageNode(node: M): Element {
  const attrs: Attr[] = [staticAttr('src', String(node.url ?? '')), staticAttr('alt', String(node.alt ?? ''))];
  if (node.title) attrs.push(staticAttr('title', String(node.title)));
  return el('img', attrs, [], loc(node));
}

function codeNode(node: M): Element {
  const lang = String(node.lang ?? '').trim();
  const code = String(node.value ?? '');
  // Build-time Shiki highlighting (when a highlighter has been prepared).
  const hl = lang ? highlightCode(code, lang) : null;
  if (hl) {
    const expr = literalExpression(hl.inner, loc(node));
    return el('pre', [...hl.attrs, { kind: 'setHtml', expr }], [], loc(node));
  }
  const codeAttrs: Attr[] = [];
  if (lang) codeAttrs.push(staticAttr('class', `language-${lang}`));
  return el('pre', [], [el('code', codeAttrs, [text(code, loc(node))], loc(node))], loc(node));
}

/** An Expression wrapping a plain string literal (used for `set:html`). */
function literalExpression(value: string, l: Loc): Expression {
  const raw = JSON.stringify(value);
  const ast = JsxParser.parseExpressionAt(raw, 0, ACORN_OPTIONS) as acorn.Expression;
  return { type: 'Expression', ast, raw, start: 0, loc: l, jsx: [] };
}

function tableNode(node: M, ctx: TemplateContext): Element {
  const rows: M[] = node.children ?? [];
  const [head, ...body] = rows;
  const cell = (r: M, tag: 'th' | 'td'): Element =>
    el(tag, [], convertChildren(r.children ?? [], ctx), loc(r));
  const thead = el('thead', [], [el('tr', [], (head?.children ?? []).map((c: M) => cell(c, 'th')), loc(node))], loc(node));
  const tbody = el('tbody', [], body.map((r) => el('tr', [], (r.children ?? []).map((c: M) => cell(c, 'td')), loc(r))), loc(node));
  return el('table', [], [thead, tbody], loc(node));
}

function convertNode(node: M, ctx: TemplateContext): Node[] {
  switch (node.type) {
    case 'text':
      return [text(node.value ?? '', loc(node))];
    case 'paragraph': {
      const kids = convertChildren(node.children ?? [], ctx);
      // A paragraph whose only child is a block element (MDX often parses an
      // indented <div>/<p> this way) must not be wrapped in <p> again.
      if (kids.length === 1 && kids[0].type === 'Element' && BLOCK_TAGS.has(kids[0].name)) return kids;
      return [el('p', [], kids, loc(node))];
    }
    case 'heading':
      return [headingNode(node, ctx)];
    case 'thematicBreak':
      return [el('hr', [], [], loc(node))];
    case 'blockquote':
      return [el('blockquote', [], convertChildren(node.children ?? [], ctx), loc(node))];
    case 'list':
      return [listNode(node, ctx)];
    case 'listItem':
      return [listItemNode(node, ctx, false)];
    case 'code':
      return [codeNode(node)];
    case 'inlineCode':
      return [el('code', [], [text(node.value ?? '', loc(node))], loc(node))];
    case 'emphasis':
      return [el('em', [], convertChildren(node.children ?? [], ctx), loc(node))];
    case 'strong':
      return [el('strong', [], convertChildren(node.children ?? [], ctx), loc(node))];
    case 'delete':
      return [el('del', [], convertChildren(node.children ?? [], ctx), loc(node))];
    case 'link':
      return [linkNode(node, ctx)];
    case 'image':
      return [imageNode(node)];
    case 'break':
      return [el('br', [], [], loc(node))];
    case 'html':
      // `.md` treats raw HTML as literal text (escaped by codegen) — unchanged behavior.
      return [text(node.value ?? '', loc(node))];
    case 'table':
      return [tableNode(node, ctx)];
    case 'mdxFlowExpression':
    case 'mdxTextExpression':
      return expressionNode(node, ctx);
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement':
      return mdxElement(node, ctx);
    case 'mdxjsEsm':
    case 'yaml':
    case 'definition':
      return [];
    default:
      return node.children ? convertChildren(node.children, ctx) : [];
  }
}

// ─── frontmatter + ESM ───────────────────────────────────────────────────────

function collectMeta(tree: M): { data: Record<string, unknown>; esm: string[] } {
  const data: Record<string, unknown> = {};
  const esm: string[] = [];
  for (const child of tree.children ?? []) {
    if (child.type === 'yaml') {
      try {
        const parsed = parseYaml(child.value ?? '');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(data, parsed);
      } catch {
        /* unparsable frontmatter is ignored, like the previous engine */
      }
    } else if (child.type === 'mdxjsEsm') {
      esm.push(child.value ?? '');
    }
  }
  return { data, esm };
}

/** True when an ESM declaration exports getStaticParams/getStaticPaths. */
function isStaticParamsExport(decl: M): boolean {
  if (decl.type !== 'ExportNamedDeclaration' || !decl.declaration) return false;
  if (decl.declaration.type === 'FunctionDeclaration' || decl.declaration.type === 'ClassDeclaration') {
    return decl.declaration.id?.name === 'getStaticParams' || decl.declaration.id?.name === 'getStaticPaths';
  }
  if (decl.declaration.type === 'VariableDeclaration') {
    return decl.declaration.declarations?.some((d: M) => d.id?.name === 'getStaticParams' || d.id?.name === 'getStaticPaths');
  }
  return false;
}

/**
 * Rewrite an MDX ESM statement for the synthetic script:
 * imports pass through, `export const X` becomes `const X` (still a binding, but
 * not a forbidden component export), and getStaticParams stays exported so the
 * build can enumerate dynamic routes.
 */
function normalizeEsm(src: string, file: string): string {
  let program: M;
  try {
    program = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    const err = e as { pos?: number; message: string };
    fail('PF4001', `MDX module syntax error: ${err.message.replace(/ \(\d+:\d+\)$/, '')}`, file, src, err.pos ?? 0);
  }
  const statements: M[] = program.body ?? [];
  const parts: string[] = [];
  for (const stmt of statements) {
    if (stmt.type === 'ExportNamedDeclaration') {
      if (isStaticParamsExport(stmt)) {
        parts.push(src.slice(stmt.start, stmt.end));
      } else if (stmt.declaration) {
        parts.push(src.slice(stmt.declaration.start, stmt.declaration.end) + ';');
      } else {
        // `export { a, b }` — keep the locals if they are declared elsewhere.
        const locals: string[] = (stmt.specifiers ?? []).map((s: M) => s.local?.name).filter(Boolean);
        if (locals.length) parts.push(`void [${locals.join(', ')}];`);
      }
      continue;
    }
    if (stmt.type === 'ExportDefaultDeclaration' || stmt.type === 'ExportAllDeclaration') {
      fail('PF4021', 'Forbidden export — MDX pages may only export getStaticParams', file, src, stmt.start);
    }
    parts.push(src.slice(stmt.start, stmt.end));
  }
  return parts.join('\n');
}

// ─── entry point ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processor(kind: 'md' | 'mdx'): any {
  let p: any = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm);
  if (kind === 'mdx') p = p.use(remarkMdx);
  return p;
}

/** Parse just the frontmatter of a document (used by content collections). */
export function parseFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  const tree = processor('md').parse(source) as M;
  const { data } = collectMeta(tree);
  const yamlNode = (tree.children ?? []).find((c: M) => c.type === 'yaml');
  const body = yamlNode?.position ? source.slice(yamlNode.position.end.offset).replace(/^\r?\n/, '') : source;
  return { data, body };
}

export function compileDocument(source: string, file: string, _opts: DocumentOptions): DocumentResult {
  const kind: 'md' | 'mdx' = extname(file) === 'mdx' ? 'mdx' : 'md';
  const tree = processor(kind).parse(source) as M;
  const { data, esm } = collectMeta(tree);
  const layout = typeof data.layout === 'string' ? data.layout : null;

  // 1. synthetic <script> — analyzed by the shared acorn pass so imports,
  //    components, bindings and getStaticParams behave exactly like .deshi.
  const scriptParts: string[] = [];
  if (layout) scriptParts.push(`import Layout from ${JSON.stringify(layout)};`);
  for (const [k, v] of Object.entries(data)) {
    if (k === 'layout' || k === 'frontmatter') continue;
    scriptParts.push(`const ${k} = ${JSON.stringify(v)};`);
  }
  scriptParts.push(`const frontmatter = ${JSON.stringify(data)};`);
  for (const stmt of esm) scriptParts.push(normalizeEsm(stmt, file));
  const scriptSource = scriptParts.join('\n');
  const script = analyzeScript(scriptSource, file, scriptSource, 0);

  // 2. mdast → Deshi AST (needs script.components for <Component> validation).
  const ctx: TemplateContext = {
    file,
    source,
    components: script.components,
    scoped: false,
    usedComponents: new Set(),
    usedSlots: new Set(),
  };
  const bodyNodes = convertChildren(
    (tree.children ?? []).filter((c: M) => c.type !== 'yaml' && c.type !== 'mdxjsEsm'),
    ctx,
  );

  const rootLoc = loc(tree);
  const article = el('article', [staticAttr('class', 'deshi-md')], bodyNodes, rootLoc);
  const children: Node[] = [];

  if (layout) {
    ctx.usedComponents.add('Layout');
    children.push({
      type: 'Component',
      ident: 'Layout',
      props: [{ kind: 'dynamic', name: 'frontmatter', expr: exprFromSource('frontmatter', ctx, rootLoc) as never }],
      slots: { default: [article] },
      loc: rootLoc,
    });
  } else {
    children.push(article);
  }

  const title = typeof data.title === 'string' ? data.title : '';
  const description = typeof data.description === 'string' ? data.description : '';
  if (title || description) {
    const headChildren: Node[] = [];
    if (title) headChildren.push(el('title', [], [text(title, rootLoc)], rootLoc));
    if (description) headChildren.push(el('meta', [staticAttr('name', 'description'), staticAttr('content', description)], [], rootLoc));
    children.unshift({ type: 'HeadBlock', children: headChildren, loc: rootLoc });
  }

  const root: Root = { type: 'Root', document: false, children };
  return { root, script, ctx, globalCss: DOC_TYPOGRAPHY_CSS, diagnostics: script.diagnostics };
}
