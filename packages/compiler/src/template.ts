// Stage 2 — template parse: source → Deshi AST.
//
// Parsing happens in two coordinates that never get confused:
//
//   1. A *prescan* walks the template once and records where every `{ … }`
//      expression is, by exact source offset. Each expression is then masked
//      with same-width filler (newlines preserved), so the text handed to
//      parse5 is the same length as the original and parse5's own source
//      locations are already original offsets — no offset translation table, no
//      placeholder tokens, no string searching to find things again later.
//   2. parse5 builds the element tree, and every attribute/text node is joined
//      with the expressions whose offsets fall inside it. Expressions are
//      parsed by acorn *at their real position in the real source*, so the end
//      of an expression is decided by the JS parser, not by brace counting.
import { parse, parseFragment, type DefaultTreeAdapterTypes as P5 } from 'parse5';
import {
  fail,
  makeDiagnostic,
  type Attr,
  type Component,
  type Diagnostic,
  type Element,
  type Expression,
  type Loc,
  type Node,
  type Root,
  type Slot,
} from './types';
import {
  bucketSlots,
  checkAttrName,
  isComponentName,
  locAt,
  makeExpression,
  parseBraceExpression,
  takeClientDirectives,
  type TemplateContext,
} from './expression';
import { duplicateAttrNames, scanStartTag } from './attrs';
import { decodeText } from './html';
import { walk } from './ast/walk';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const BLOCK = new Set([
  'html', 'head', 'body', 'div', 'main', 'section', 'article', 'header', 'footer', 'nav',
  'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr',
  'td', 'th', 'title', 'meta', 'link', 'script', 'style', 'pre', 'blockquote', 'form',
  'fieldset', 'figure', 'figcaption', 'aside', 'hr', 'dl', 'dt', 'dd', 'details', 'summary',
  'template', 'slot', 'option', 'select', 'br',
]);
const PRESERVE = new Set(['pre', 'textarea', 'script', 'style']);
const HEAD_OK = new Set(['base', 'link', 'meta', 'title', 'noscript', 'style', 'script', 'template']);

/** Elements whose attributes are never scoped and never dynamic-worthy. */
const NO_SCOPE = new Set([
  'html', 'head', 'body', 'title', 'meta', 'link', 'script', 'style',
]);

export interface ParseTemplateOptions {
  minify: boolean;
  isLayout: boolean;
}

// ─── prescan ────────────────────────────────────────────────────────────────

interface FoundExpr {
  /** offset of the opening `{` */
  open: number;
  /** offset of the closing `}` */
  close: number;
  /** true when the expression occupies a whole attribute (`{...spread}`) */
  spread: boolean;
  /** true when the expression sits inside a start tag rather than in text */
  inTag: boolean;
  expr: Expression;
}

export interface Prescan {
  /** same-length, expression-masked template handed to parse5 */
  text: string;
  /** every expression, sorted by `open` */
  exprs: FoundExpr[];
  /**
   * `<slot>` tags inside a real `<head>`. They are blanked out of the parse5
   * text and re-inserted into the AST afterwards, because the HTML parser
   * closes `<head>` as soon as it meets an element it does not know there.
   */
  headSlots: Array<{ at: number; name: string }>;
  sawHtml: boolean;
}

/**
 * A fragment-level `<head>` block is renamed to this same-length custom element
 * in the *masked* text only, so the HTML parser does not discard it. The real
 * name is recovered from the original source, so this never reaches the output.
 */
const HEAD_ALIAS = 'dhds';

/**
 * Same-width mask: every character is replaced by `fill`, except newlines which
 * are kept so line/column numbers of the rest of the file stay exact.
 */
function mask(chars: string[], from: number, to: number, fill: string): void {
  const end = Math.min(chars.length, to);
  for (let k = Math.max(0, from); k < end; k++) {
    if (chars[k] !== '\n') chars[k] = fill;
  }
}

/** Every expression whose `{…}` lies inside `[start, end)`. */
function exprsIn(exprs: FoundExpr[], start: number, end: number): FoundExpr[] {
  let lo = 0;
  let hi = exprs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (exprs[mid].open < start) lo = mid + 1;
    else hi = mid;
  }
  const out: FoundExpr[] = [];
  for (let i = lo; i < exprs.length && exprs[i].open < end; i++) {
    if (exprs[i].close < end) out.push(exprs[i]);
  }
  return out;
}

/**
 * Walk the template once: parse every `{ … }` at its real position and mask it
 * so parse5 sees inert, same-width text. Comments, doctypes, raw-text elements
 * and quoted attribute values are skipped — a `{` inside any of them is literal.
 */
export function prescan(src: string, ctx: TemplateContext, file: string): Prescan {
  const chars = src.split('');
  const exprs: FoundExpr[] = [];
  const headSlots: Prescan['headSlots'] = [];
  let i = 0;
  let sawHtml = false;
  let inHead = false;
  let inBody = false;

  const isNameChar = (c: string) => /[A-Za-z0-9:_.-]/.test(c);
  const readName = (from: number) => {
    let j = from;
    while (j < src.length && isNameChar(src[j])) j++;
    return { name: src.slice(from, j), end: j };
  };
  /** Overwrite `src[at, at+len)` in the masked text (length must match). */
  const alias = (at: number, text: string) => {
    for (let k = 0; k < text.length; k++) chars[at + k] = text[k] ?? ' ';
  };
  const blank = (from: number, to: number) => mask(chars, from, to, ' ');

  /** Parse the expression at `bracePos` and mask `[open, close]`. */
  const take = (bracePos: number, inTag: boolean): FoundExpr => {
    const spread = src.startsWith('{...', bracePos);
    const { ast, close } = parseBraceExpression(src, bracePos, file, spread ? bracePos + 4 : bracePos + 1);
    const expr = makeExpression(ast, ctx);
    const found: FoundExpr = { open: bracePos, close, spread, inTag, expr };
    exprs.push(found);
    mask(chars, bracePos, close + 1, inTag ? 'x' : ' ');
    return found;
  };

  while (i < src.length) {
    const c = src[i];

    if (c === '<') {
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4);
        i = end === -1 ? src.length : end + 3;
        continue;
      }
      if (src[i + 1] === '!' || src[i + 1] === '?') {
        const end = src.indexOf('>', i);
        i = end === -1 ? src.length : end + 1;
        continue;
      }
      if (src[i + 1] === '/') {
        const { name } = readName(i + 2);
        const lower = name.toLowerCase();
        const end = src.indexOf('>', i);
        const stop = end === -1 ? src.length : end + 1;
        if (lower === 'head' && (!sawHtml || inBody)) alias(i + 2, HEAD_ALIAS);
        if (lower === 'head') inHead = false;
        if (lower === 'slot' && inHead) blank(i, stop);
        i = stop;
        continue;
      }
      if (/[A-Za-z]/.test(src[i + 1] ?? '')) {
        const { name, end: nameEnd } = readName(i + 1);
        const lower = name.toLowerCase();
        if (lower === 'html') sawHtml = true;
        const tagStart = i;
        if (lower === 'body') inBody = true;
        const aliasedHead = lower === 'head' && (!sawHtml || inBody);
        if (aliasedHead) alias(tagStart + 1, HEAD_ALIAS);
        else if (lower === 'head') inHead = true;
        const isHeadSlot = lower === 'slot' && inHead;

        let closed = false;
        i = nameEnd;
        while (i < src.length && !closed) {
          const ch = src[i];
          if (ch === '"' || ch === "'") {
            // a quoted run is literal text: a `{` inside it is not an expression
            const end = src.indexOf(ch, i + 1);
            const stop = end === -1 ? src.length : end + 1;
            i = stop;
          } else if (ch === '{') {
            take(i, true);
            i = exprs[exprs.length - 1].close + 1;
          } else if (ch === '/' && src[i + 1] === '>') {
            i += 2;
            closed = true;
          } else if (ch === '>') {
            i += 1;
            closed = true;
          } else {
            i += 1;
          }
        }
        if (!closed) fail('PF1001', `Unclosed <${name}> tag`, file, src, tagStart);
        if (isHeadSlot) {
          // Recorded and blanked: the HTML parser would otherwise close <head>.
          const tag = scanStartTag(src, tagStart, i);
          headSlots.push({ at: tagStart, name: tag.attrs.find((a) => a.name === 'name')?.value ?? 'default' });
          blank(tagStart, i);
        }
        if (lower === 'script' || lower === 'style') {
          const endTag = `</${lower}`;
          const idx = src.toLowerCase().indexOf(endTag, i);
          i = idx === -1 ? src.length : idx;
        }
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') {
      take(i, false);
      i = exprs[exprs.length - 1].close + 1;
      continue;
    }
    i++;
  }

  return { text: chars.join(''), exprs, headSlots, sawHtml };
}

/**
 * Put the head slots the HTML parser never saw back into the tree, inside the
 * *innermost* element that spans their source offset, at the position that
 * offset implies. Placement order matters: a head slot splits a layout's own
 * head contribution into "before" and "after", which is what decides which
 * `<title>` wins.
 */
function restoreHeadSlots(root: Root, ctx: ConvCtx): void {
  const pending = ctx.pre.headSlots;
  if (!pending.length) return;
  const src = ctx.source;

  const insertIndex = (nodes: Node[], at: number): number => {
    for (let i = 0; i < nodes.length; i++) {
      const child: Node = nodes[i];
      const l = 'loc' in child ? child.loc : null;
      if (l && l.start > at) return i;
    }
    return nodes.length;
  };

  const innermost = (nodes: Node[], at: number): [Node[], number] => {
    for (const child of nodes) {
      if (child.type !== 'Element' && child.type !== 'HeadBlock') continue;
      if (child.loc.start > at || child.loc.end <= at) continue;
      return innermost(child.children, at);
    }
    return [nodes, insertIndex(nodes, at)];
  };

  for (const s of pending) {
    const [list, index] = innermost(root.children, s.at);
    list.splice(index, 0, { type: 'Slot', name: s.name, fallback: [], loc: locAt(src, s.at, s.at + 6) });
  }
}

// ─── parse5 tree → Deshi AST ────────────────────────────────────────────────

interface ConvCtx extends TemplateContext {
  pre: Prescan;
  opts: ParseTemplateOptions;
  document: boolean;
  inRootBody: boolean;
  diagnostics: Diagnostic[];
}

/** A half-open source range. */
interface Range {
  start: number;
  end: number;
}

function nodeLoc(n: P5.Node, ctx: ConvCtx): Loc {
  const l = (n as P5.Element).sourceCodeLocation;
  if (!l) return { line: 1, column: 1, start: 0, end: 0 };
  return locAt(ctx.source, l.startOffset, l.endOffset);
}

/**
 * Split a text node at the expressions inside it.
 *
 * Characters come from the *masked* template (what the HTML parser actually
 * saw), not from the file source: lifted `<script>` / `<style>` blocks are
 * blanked there, and that blanking is part of the document. Offsets are shared
 * by both, so expressions still line up exactly, and each text run is decoded
 * with the same tokenizer the parser used.
 */
function splitText(masked: string, start: number, end: number, ctx: ConvCtx): Node[] {
  const found = exprsIn(ctx.pre.exprs, start, end);
  const out: Node[] = [];
  let cursor = start;
  const text = (from: number, to: number) => ({
    type: 'Text' as const,
    value: decodeText(masked.slice(from, to)),
    loc: locAt(ctx.source, from, to),
  });
  for (const f of found) {
    if (f.open > cursor) out.push(text(cursor, f.open));
    out.push(f.expr);
    cursor = f.close + 1;
  }
  if (cursor < end) out.push(text(cursor, end));
  return out;
}

/** The source range an element's *content* occupies (between its tags). */
function contentRange(el: P5.Element, parent: Range): Range {
  const loc = el.sourceCodeLocation;
  const start = loc?.startTag?.endOffset ?? loc?.startOffset ?? parent.start;
  const end = loc?.endTag?.startOffset ?? parent.end;
  return { start, end: Math.max(start, end) };
}

/** parse5 records one source location per (surviving) attribute, keyed by name. */
function attrLocation(el: P5.Element, name: string): { start: number; end: number } | null {
  const locs = el.sourceCodeLocation?.attrs as unknown as Record<string, { startOffset: number; endOffset: number }> | undefined;
  const l = locs?.[name];
  return l ? { start: l.startOffset, end: l.endOffset } : null;
}

/** Where an attribute's value sits inside its source range (unquoted only). */
function attrValueRange(src: string, loc: { start: number; end: number }, name: string): { from: number; to: number } | null {
  const nameEnd = loc.start + name.length;
  if (src[nameEnd] !== '=') return null;
  return { from: nameEnd + 1, to: loc.end };
}

/**
 * Original (case-preserved) attribute names of a start tag, keyed by the offset
 * of the attribute name.
 *
 * The HTML tokenizer lower-cases attribute names, which is right for elements
 * but wrong for a component: `<Card showIcon />` must pass `showIcon`, not
 * `showicon`. The masked text still carries the name as written, so the tag is
 * re-read from the source at the offsets the parser reported.
 */
function originalAttrNames(el: P5.Element, ctx: ConvCtx): Map<number, string> {
  const out = new Map<number, string>();
  const startTag = el.sourceCodeLocation?.startTag;
  if (!startTag || startTag.endOffset <= startTag.startOffset) return out;
  for (const a of scanStartTag(ctx.pre.text, startTag.startOffset, startTag.endOffset).attrs) {
    if (a.masked) continue;
    out.set(a.nameStart, a.name);
  }
  return out;
}

function convertAttrs(el: P5.Element, ctx: ConvCtx, restoreCase = false): Attr[] {
  const attrs: Attr[] = [];
  const elLoc = nodeLoc(el, ctx);
  const src = ctx.source;
  const written = restoreCase ? originalAttrNames(el, ctx) : null;

  // The HTML parser drops a repeated attribute silently; report it instead.
  // The masked text is scanned (not the raw source) so an unquoted expression
  // value — which may contain spaces, `/` or `>` — cannot derail the scan.
  const startTag = el.sourceCodeLocation?.startTag;
  if (startTag && startTag.endOffset > startTag.startOffset) {
    for (const dup of duplicateAttrNames(scanStartTag(ctx.pre.text, startTag.startOffset, startTag.endOffset))) {
      ctx.diagnostics.push(
        makeDiagnostic(
          'PF1002',
          `Duplicate attribute "${dup.name}" on <${el.nodeName}> — the HTML parser keeps only the first one`,
          ctx.file,
          src,
          dup.nameStart,
          'warning',
          dup.name === 'class'
            ? 'Combine them: class:list={["a", cond && "b"]}'
            : 'Combine them into a single expression value.',
        ),
      );
    }
  }

  for (const parsed of el.attrs) {
    const a = { ...parsed, name: '' } as typeof parsed;
    const parsedLoc = attrLocation(el, parsed.name);
    a.name = (written && parsedLoc ? written.get(parsedLoc.start) : null) ?? parsed.name;
    const loc = attrLocation(el, parsed.name);
    // Astro-style directive names are not HTML attribute names; let them through.
    const allowColon =
      a.name.includes(':') &&
      (a.name.startsWith('client:') ||
        a.name.startsWith('set:') ||
        a.name === 'class:list' ||
        a.name === 'define:vars' ||
        a.name.startsWith('transition:') ||
        a.name.startsWith('data-') ||
        a.name.startsWith('is:'));
    if (!allowColon) checkAttrName(a.name, loc?.start ?? elLoc.start, ctx);

    const found = loc ? exprsIn(ctx.pre.exprs, loc.start, loc.end) : [];
    const valueRange = loc ? attrValueRange(src, loc, a.name) : null;

    if (found.length) {
      const f = found[0];
      // A whole-attribute `{...rest}` is a spread; anything else is a value.
      const isSpread = f.spread && valueRange === null;
      // text around the braces inside a value is not a valid attribute
      if (!isSpread && valueRange) {
        const before = src.slice(valueRange.from, f.open);
        const after = src.slice(f.close + 1, valueRange.to);
        if (before.trim() || after.trim()) {
          fail(
            'PF1002',
            `Attribute "${a.name}" mixes text and an expression; use a template literal: ${a.name}={\`…\${expr}…\`}`,
            ctx.file,
            src,
            f.open,
          );
        }
      }
      if (isSpread) {
        attrs.push({ kind: 'spread', expr: f.expr });
        continue;
      }
      if (a.name === 'set:html') attrs.push({ kind: 'setHtml', expr: f.expr });
      else if (a.name === 'set:text') attrs.push({ kind: 'setText', expr: f.expr });
      else if (a.name === 'class:list') attrs.push({ kind: 'classList', expr: f.expr });
      else if (a.name === 'define:vars') attrs.push({ kind: 'defineVars', expr: f.expr });
      else if (a.name.startsWith('transition:')) attrs.push({ kind: 'transition', name: a.name, value: f.expr });
      else attrs.push({ kind: 'dynamic', name: a.name, expr: f.expr });
      continue;
    }

    if (a.name === 'set:html' || a.name === 'set:text' || a.name === 'class:list' || a.name === 'define:vars') {
      fail('PF1002', `${a.name} requires an expression value: ${a.name}={expr}`, ctx.file, src, loc?.start ?? elLoc.start);
    }
    if (a.name.startsWith('transition:')) {
      attrs.push({ kind: 'transition', name: a.name, value: a.value });
      continue;
    }
    if (a.value === '') attrs.push({ kind: 'boolean', name: a.name });
    else attrs.push({ kind: 'static', name: a.name, value: a.value });
  }
  return attrs;
}

/** The tag name exactly as written (parse5 lower-cases HTML element names). */
function originalTagName(el: P5.Element, ctx: ConvCtx): string {
  const l = el.sourceCodeLocation;
  if (!l) return el.nodeName;
  const start = (l.startTag ?? l).startOffset + 1;
  return ctx.source.slice(start, start + el.nodeName.length);
}

function isBlockNode(n: Node | undefined): boolean {
  if (!n) return true;
  if (n.type === 'Element') return BLOCK.has(n.name.toLowerCase());
  if (n.type === 'Component' || n.type === 'Slot' || n.type === 'HeadBlock' || n.type === 'Doctype') return true;
  return false;
}

function applyWhitespace(nodes: Node[], parentName: string | null, ctx: ConvCtx): Node[] {
  if (!ctx.opts.minify) return nodes;
  if (parentName && PRESERVE.has(parentName.toLowerCase())) return nodes;
  const parentBlock = parentName === null ? true : BLOCK.has(parentName.toLowerCase());
  const out: Node[] = [];
  nodes.forEach((n, i) => {
    if (n.type !== 'Text') {
      out.push(n);
      return;
    }
    const prev = nodes[i - 1];
    const next = nodes[i + 1];
    let v = n.value.replace(/\s+/g, ' ');
    if (!v.trim()) {
      const dropped =
        (isBlockNode(prev) && (prev !== undefined || parentBlock)) ||
        (isBlockNode(next) && (next !== undefined || parentBlock)) ||
        (prev === undefined && next === undefined);
      if (dropped) return;
      out.push({ ...n, value: ' ' });
      return;
    }
    if (v.startsWith(' ') && (prev === undefined ? parentBlock : isBlockNode(prev))) v = v.slice(1);
    if (v.endsWith(' ') && (next === undefined ? parentBlock : isBlockNode(next))) v = v.slice(0, -1);
    if (v) out.push({ ...n, value: v });
  });
  return out;
}

function convertChildren(children: P5.ChildNode[], parentName: string | null, ctx: ConvCtx, clip: Range): Node[] {
  const out: Node[] = [];
  for (const c of children) out.push(...convertNode(c, ctx, clip));
  return applyWhitespace(out, parentName, ctx);
}

/**
 * True when the source wrote `<tag … />`.
 *
 * The HTML parser does not honour a self-closing flag on HTML elements, so
 * `<Card />` keeps swallowing what follows it. Detecting the syntax here lets
 * the element render empty and its would-be children be hoisted back to
 * siblings — the JSX-style syntax authors expect — without rewriting the text
 * (which would cost the offset alignment the whole parse depends on).
 */
function isSelfClosing(el: P5.Element, ctx: ConvCtx): boolean {
  if (VOID.has(el.tagName.toLowerCase())) return false;
  const st = el.sourceCodeLocation?.startTag;
  if (!st || st.endOffset <= st.startOffset) return false;
  return scanStartTag(ctx.pre.text, st.startOffset, st.endOffset).selfClosing;
}

function convertNode(n: P5.ChildNode, ctx: ConvCtx, clip: Range): Node[] {
  if (n.nodeName === '#text') {
    const l = (n as P5.TextNode).sourceCodeLocation;
    if (!l) return [{ type: 'Text', value: (n as P5.TextNode).value, loc: { line: 1, column: 1, start: 0, end: 0 } }];
    // Clip to the parent's content: parse5 hangs trailing whitespace off the
    // end tag it follows, so a node's raw range can otherwise cover `</body>`.
    const start = Math.max(l.startOffset, clip.start);
    const end = Math.min(l.endOffset, clip.end);
    if (end <= start) return [];
    return splitText(ctx.pre.text, start, end, ctx);
  }
  if (n.nodeName === '#comment') {
    const data = (n as P5.CommentNode).data;
    const loc = nodeLoc(n, ctx);
    if (data.startsWith('deshi-slot:')) {
      return [{ type: 'Slot', name: data.slice('deshi-slot:'.length), fallback: [], loc }];
    }
    if (data.startsWith('!')) return [{ type: 'Comment', value: data.slice(1), loc }];
    return [];
  }
  if (n.nodeName === '#documentType') {
    return [{ type: 'Doctype', loc: nodeLoc(n, ctx) }];
  }
  if (n.nodeName === '#document' || n.nodeName === '#document-fragment') return [];

  const el = n as P5.Element;
  const loc = nodeLoc(el, ctx);
  const name = originalTagName(el, ctx);
  const lower = name.toLowerCase();
  const rawChildren: P5.ChildNode[] =
    lower === 'template' && (el as P5.Template).content
      ? (el as P5.Template).content.childNodes
      : el.childNodes;
  const selfClosed = isSelfClosing(el, ctx);
  const kids = (parent: string | null): Node[] =>
    selfClosed ? [] : convertChildren(rawChildren, parent, ctx, contentRange(el, clip));
  /** Nodes the parser nested inside a `<tag />`; they belong to the parent. */
  const hoisted = (): Node[] => {
    if (!selfClosed) return [];
    const out: Node[] = [];
    for (const c of rawChildren) out.push(...convertNode(c, ctx, clip));
    return out;
  };
  const done = (built: Node[]): Node[] => [...built, ...hoisted()];

  if (ctx.document && !el.sourceCodeLocation && (lower === 'html' || lower === 'head' || lower === 'body')) {
    fail('PF2003', `Root layout must contain an explicit <${lower}> element`, ctx.file, ctx.source, 0);
  }

  if (lower === 'fragment' && name === 'Fragment') {
    return done(convertChildren(rawChildren, null, ctx, contentRange(el, clip)));
  }

  if (isComponentName(name)) {
    if (!ctx.components.has(name)) {
      fail('PF4024', `<${name}> is not an imported component`, ctx.file, ctx.source, loc.start,
        `Add: import ${name} from './${name}.deshi' to the <script> block.`);
    }
    ctx.usedComponents.add(name);
    const attrs = convertAttrs(el, ctx, true);
    const taken = takeClientDirectives(attrs, loc, ctx, name, true);
    const comp: Component = {
      type: 'Component',
      ident: name,
      props: taken.attrs,
      slots: bucketSlots(kids('div'), ctx),
      clientProps: taken.clientProps,
      clientStrategy: taken.clientStrategy,
      clientMedia: taken.clientMedia,
      clientOnly: taken.clientOnly,
      loc,
    };
    return done([comp]);
  }

  if (lower === 'slot') {
    const attrs = convertAttrs(el, ctx);
    const named = attrs.filter((a) => (a.kind === 'static' || a.kind === 'boolean' || a.kind === 'dynamic') && a.name === 'name');
    if (named.some((a) => a.kind !== 'static') && ctx.dynamicSlots) ctx.dynamicSlots.value = true;
    const staticName = named.find((a) => a.kind === 'static');
    const slot: Slot = {
      type: 'Slot',
      name: (staticName && staticName.kind === 'static' ? staticName.value : '') || 'default',
      fallback: kids('div'),
      loc,
    };
    return done([slot]);
  }

  if (lower === 'head' || lower === 'deshi-head') {
    if (ctx.document && ctx.inRootBody) {
      fail('PF4025', '<head> blocks are not allowed inside the root layout body', ctx.file, ctx.source, loc.start);
    }
    if (!ctx.document || lower === 'deshi-head') {
      return done([{ type: 'HeadBlock', children: kids('head'), loc }]);
    }
    const children = kids('head');
    for (const ch of children) {
      if (ch.type === 'Element' && !HEAD_OK.has(ch.name.toLowerCase())) {
        fail('PF1002', `<${ch.name}> is not valid inside <head>`, ctx.file, ctx.source, ch.loc.start);
      }
    }
    const headEl: Element = {
      type: 'Element', name: 'head', attrs: convertAttrs(el, ctx), children, loc,
      scoped: false, clientRoot: false, isDocHead: true,
    };
    return done([headEl]);
  }

  const attrs = convertAttrs(el, ctx);
  takeClientDirectives(attrs, loc, ctx, name, false);
  const wasRootBody = ctx.inRootBody;
  if (ctx.document && lower === 'body') ctx.inRootBody = true;
  const children = VOID.has(lower) ? [] : kids(lower);
  ctx.inRootBody = wasRootBody;

  const setHtml = attrs.find((a) => a.kind === 'setHtml' || a.kind === 'setText');
  if (setHtml && children.some((c) => c.type !== 'Text' || c.value.trim())) {
    fail('PF4023', `An element with ${setHtml.kind === 'setHtml' ? 'set:html' : 'set:text'} must not have children`, ctx.file, ctx.source, loc.start);
  }
  const element: Element = {
    type: 'Element',
    name: lower === name ? lower : name,
    attrs,
    children: setHtml ? [] : children,
    loc,
    scoped: ctx.scoped && !NO_SCOPE.has(lower),
    clientRoot: false,
  };
  return done([element]);
}

export function parseTemplate(
  template: string,
  base: TemplateContext,
  opts: ParseTemplateOptions,
): { root: Root; exprs: Expression[]; diagnostics: Diagnostic[] } {
  const pre = prescan(template, base, base.file);
  const document = pre.sawHtml;
  const ctx: ConvCtx = { ...base, pre, opts, document, inRootBody: false, diagnostics: [] };

  let root: Root;
  if (document) {
    const doc = parse(pre.text, { sourceCodeLocationInfo: true });
    const children = convertChildren(doc.childNodes, null, ctx, { start: 0, end: ctx.source.length });
    root = { type: 'Root', document: true, children };
    // Before the implicit head slot is added below, so a real `<slot name="head" />`
    // in the layout is restored rather than duplicated.
    restoreHeadSlots(root, ctx);
    const html = children.find((c) => c.type === 'Element' && c.name === 'html') as Element | undefined;
    const head = html?.children.find((c) => c.type === 'Element' && c.name === 'head') as Element | undefined;
    const body = html?.children.find((c) => c.type === 'Element' && c.name === 'body') as Element | undefined;
    if (!html || !head || !body) {
      fail('PF2003', 'Root layout must contain <html>, <head> and <body>', ctx.file, ctx.source, 0);
    }
    if (!head.children.some((c) => c.type === 'Slot' && c.name === 'head')) {
      head.children.push({ type: 'Slot', name: 'head', fallback: [], loc: head.loc, headMarker: true });
    }
    if (!containsDefaultSlot(body.children)) {
      fail('PF2002', 'Root layout must render a <slot /> for the page content', ctx.file, ctx.source, body.loc.start);
    }
  } else {
    const frag = parseFragment(pre.text, { sourceCodeLocationInfo: true });
    root = { type: 'Root', document: false, children: convertChildren(frag.childNodes, null, ctx, { start: 0, end: ctx.source.length }) };
    restoreHeadSlots(root, ctx);
    if (opts.isLayout && !containsDefaultSlot(root.children)) {
      fail('PF2002', 'Layout must render a <slot /> for nested content', ctx.file, ctx.source, 0);
    }
  }
  return { root, exprs: pre.exprs.map((e) => e.expr), diagnostics: ctx.diagnostics };
}

export function containsDefaultSlot(nodes: Node[]): boolean {
  for (const n of nodes) {
    if (n.type === 'Slot' && n.name === 'default') return true;
    if (n.type === 'Element' || n.type === 'Fragment' || n.type === 'HeadBlock') {
      if (containsDefaultSlot(n.children)) return true;
    }
    if (n.type === 'Component') {
      for (const s of Object.values(n.slots)) if (containsDefaultSlot(s)) return true;
    }
    if (n.type === 'Expression') {
      for (const j of n.jsx) if (containsDefaultSlot(j.nodes)) return true;
    }
  }
  return false;
}

export { walkNodes } from './ast/walk';
