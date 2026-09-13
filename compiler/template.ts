// Stage 2 — template parse: parse5 → Deshi AST.
//
// Expressions are located by a small state machine (text / tag / quoted attribute /
// comment / raw text) and parsed by acorn *at that position* in the original source,
// so the end of an expression is decided by the JS parser, not by brace counting.
// Each expression is replaced by an inert placeholder token (`deshi__eN__`) so that
// parse5 can build the tree; placeholders are mapped back to Expression nodes.
import { parse, parseFragment, type DefaultTreeAdapterTypes as P5 } from 'parse5';
import {
  fail,
  type Attr,
  type Component,
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

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const BLOCK = new Set([
  'html', 'head', 'body', 'div', 'main', 'section', 'article', 'header', 'footer', 'nav',
  'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr',
  'td', 'th', 'title', 'meta', 'link', 'script', 'style', 'pre', 'blockquote', 'form',
  'fieldset', 'figure', 'figcaption', 'aside', 'hr', 'dl', 'dt', 'dd', 'details', 'summary',
  'template', 'slot', 'head', 'option', 'select', 'br',
]);
const PRESERVE = new Set(['pre', 'textarea', 'script', 'style']);
const HEAD_OK = new Set(['base', 'link', 'meta', 'title', 'noscript', 'style', 'script', 'template']);

export interface ParseTemplateOptions {
  minify: boolean;
  isLayout: boolean;
}

interface Pretokenized {
  text: string;
  exprs: Expression[];
  toOrig: (p: number) => number;
  sawHtml: boolean;
}

const PLACEHOLDER = 'deshi__e';

function placeholder(i: number): string {
  return `${PLACEHOLDER}${i}__`;
}

function pretokenize(src: string, ctx: TemplateContext): Pretokenized {
  let out = '';
  const exprs: Expression[] = [];
  const map: Array<[number, number]> = []; // [outOffset, srcOffset]
  let i = 0;
  let sawHtml = false;
  let inHead = false;
  let inBody = false;

  const isNameChar = (c: string) => /[A-Za-z0-9:_.-]/.test(c);
  const readName = (from: number) => {
    let j = from;
    while (j < src.length && isNameChar(src[j])) j++;
    return src.slice(from, j);
  };
  const expression = (bracePos: number, spread = false): string => {
    const { ast, close } = parseBraceExpression(src, bracePos, ctx.file, spread ? bracePos + 4 : bracePos + 1);
    const expr = makeExpression(ast, ctx);
    exprs.push(expr);
    const ph = placeholder(exprs.length - 1);
    map.push([out.length + ph.length, close + 1]);
    return ph;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '<') {
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4);
        const stop = end === -1 ? src.length : end + 3;
        out += src.slice(i, stop);
        i = stop;
        continue;
      }
      if (src[i + 1] === '!' || src[i + 1] === '?') {
        const end = src.indexOf('>', i);
        const stop = end === -1 ? src.length : end + 1;
        out += src.slice(i, stop);
        i = stop;
        continue;
      }
      if (src[i + 1] === '/') {
        const name = readName(i + 2);
        const end = src.indexOf('>', i);
        const stop = end === -1 ? src.length : end + 1;
        if (name.toLowerCase() === 'head') {
          inHead = false;
          if (!sawHtml || inBody) {
            // fragment-level <head> block (page/component) → custom element name so
            // parse5 does not drop it in "in body" mode
            out += '</deshi-head>';
            map.push([out.length, stop]);
            i = stop;
            continue;
          }
        }
        out += src.slice(i, stop);
        i = stop;
        continue;
      }
      if (/[A-Za-z]/.test(src[i + 1] ?? '')) {
        let name = readName(i + 1);
        const lower = name.toLowerCase();
        if (lower === 'html') sawHtml = true;
        const tagStart = i;
        const outTagStart = out.length;
        const srcNameLen = name.length;
        if (lower === 'body') inBody = true;
        if (lower === 'head' && (!sawHtml || inBody)) name = 'deshi-head';
        out += '<' + name;
        i += 1 + srcNameLen;
        map.push([out.length, i]);
        // ── inside the tag ──
        let closed = false;
        let selfClosed = false;
        while (i < src.length && !closed) {
          const ch = src[i];
          if (ch === '"' || ch === "'") {
            const end = src.indexOf(ch, i + 1);
            const stop = end === -1 ? src.length : end + 1;
            out += src.slice(i, stop);
            i = stop;
          } else if (ch === '{') {
            out += expression(i, src.startsWith('{...', i));
            // advance i to after the closing brace: recover from the map
            i = map[map.length - 1][1];
          } else if (ch === '/' && src[i + 1] === '>') {
            if (VOID.has(lower)) out += '>';
            else out += '></' + name + '>';
            i += 2;
            closed = true;
            selfClosed = true;
          } else if (ch === '>') {
            out += '>';
            i += 1;
            closed = true;
          } else {
            out += ch;
            i += 1;
          }
        }
        if (!closed) fail('PF1001', `Unclosed <${name}> tag`, ctx.file, src, tagStart);
        if (inHead && lower === 'slot') {
          // parse5 would foster-parent an unknown element out of <head>; keep the
          // slot as a comment marker which is legal head content.
          const tagText = out.slice(outTagStart);
          const frag = parseFragment(selfClosed ? tagText : tagText + '</slot>');
          const el = frag.childNodes.find((n) => n.nodeName === 'slot') as P5.Element | undefined;
          const nameAttr = el?.attrs.find((a) => a.name === 'name')?.value ?? 'default';
          out = out.slice(0, outTagStart) + `<!--deshi-slot:${nameAttr}-->`;
        }
        if (lower === 'head') inHead = true;
        map.push([out.length, i]);
        if (lower === 'script' || lower === 'style') {
          const endTag = `</${lower}`;
          const idx = src.toLowerCase().indexOf(endTag, i);
          const stop = idx === -1 ? src.length : idx;
          out += src.slice(i, stop);
          i = stop;
          map.push([out.length, i]);
        }
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (c === '{') {
      out += expression(i);
      i = map[map.length - 1][1];
      continue;
    }
    out += c;
    i++;
  }

  const toOrig = (p: number): number => {
    let base: [number, number] = [0, 0];
    for (const m of map) {
      if (m[0] <= p) base = m;
      else break;
    }
    return base[1] + (p - base[0]);
  };
  return { text: out, exprs, toOrig, sawHtml };
}

// ─── parse5 tree → Deshi AST ────────────────────────────────────────────────

interface ConvCtx extends TemplateContext {
  pre: Pretokenized;
  opts: ParseTemplateOptions;
  document: boolean;
  inRootBody: boolean;
}

function nodeLoc(n: P5.Node, ctx: ConvCtx): Loc {
  const l = (n as P5.Element).sourceCodeLocation;
  if (!l) return { line: 1, column: 1, start: 0, end: 0 };
  const start = ctx.pre.toOrig(l.startOffset);
  const end = ctx.pre.toOrig(l.endOffset);
  return locAt(ctx.source, start, end);
}

function findPlaceholder(s: string, from: number): { index: number; end: number; id: number } | null {
  const idx = s.indexOf(PLACEHOLDER, from);
  if (idx === -1) return null;
  let j = idx + PLACEHOLDER.length;
  let digits = '';
  while (j < s.length && s[j] >= '0' && s[j] <= '9') digits += s[j++];
  if (!digits || s[j] !== '_' || s[j + 1] !== '_') return findPlaceholder(s, idx + 1);
  return { index: idx, end: j + 2, id: Number(digits) };
}

function splitText(value: string, loc: Loc, ctx: ConvCtx): Node[] {
  const out: Node[] = [];
  let cursor = 0;
  let ph = findPlaceholder(value, 0);
  while (ph) {
    if (ph.index > cursor) out.push({ type: 'Text', value: value.slice(cursor, ph.index), loc });
    out.push(ctx.pre.exprs[ph.id]);
    cursor = ph.end;
    ph = findPlaceholder(value, cursor);
  }
  if (cursor < value.length) out.push({ type: 'Text', value: value.slice(cursor), loc });
  return out;
}

function convertAttrs(el: P5.Element, ctx: ConvCtx): Attr[] {
  const attrs: Attr[] = [];
  const loc = nodeLoc(el, ctx);
  for (const a of el.attrs) {
    const phName = findPlaceholder(a.name, 0);
    if (phName && phName.index === 0 && phName.end === a.name.length) {
      attrs.push({ kind: 'spread', expr: ctx.pre.exprs[phName.id] });
      continue;
    }
    // allow Astro-style colon directives without failing checkAttrName for them
    const allowColon = a.name.includes(':') && (
      a.name.startsWith('client:') || a.name.startsWith('set:') || a.name === 'class:list' || a.name === 'define:vars' || a.name.startsWith('transition:') || a.name.startsWith('data-') || a.name.startsWith('is:')
    );
    if (!allowColon) checkAttrName(a.name, loc.start, ctx);
    const phVal = findPlaceholder(a.value, 0);
    if (phVal && phVal.index === 0 && phVal.end === a.value.length) {
      const expr = ctx.pre.exprs[phVal.id];
      if (a.name === 'set:html') attrs.push({ kind: 'setHtml', expr });
      else if (a.name === 'set:text') attrs.push({ kind: 'setText', expr });
      else if (a.name === 'class:list') attrs.push({ kind: 'classList', expr });
      else if (a.name === 'define:vars') attrs.push({ kind: 'defineVars', expr });
      else if (a.name.startsWith('transition:')) attrs.push({ kind: 'transition', name: a.name, value: expr });
      else attrs.push({ kind: 'dynamic', name: a.name, expr });
      continue;
    }
    if (phVal) {
      // class:list and define:vars must be pure expr, already handled; other mixed values error
      if (a.name === 'class:list' || a.name === 'define:vars' || a.name.startsWith('transition:')) {
        fail('PF1002', `Attribute "${a.name}" requires a single expression value`, ctx.file, ctx.source, loc.start);
      }
      fail('PF1002', `Attribute "${a.name}" mixes text and an expression; use a template literal: ${a.name}={\`…\${expr}…\`}`, ctx.file, ctx.source, loc.start);
    }
    if (a.name === 'set:html' || a.name === 'set:text' || a.name === 'class:list' || a.name === 'define:vars') {
      fail('PF1002', `${a.name} requires an expression value: ${a.name}={html}`, ctx.file, ctx.source, loc.start);
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

function originalTagName(el: P5.Element, ctx: ConvCtx): string {
  const l = el.sourceCodeLocation;
  if (!l) return el.nodeName;
  const start = (l.startTag ?? l).startOffset + 1;
  return ctx.pre.text.slice(start, start + el.nodeName.length);
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

function convertChildren(children: P5.ChildNode[], parentName: string | null, ctx: ConvCtx): Node[] {
  const out: Node[] = [];
  for (const c of children) out.push(...convertNode(c, ctx));
  return applyWhitespace(out, parentName, ctx);
}

function convertNode(n: P5.ChildNode, ctx: ConvCtx): Node[] {
  if (n.nodeName === '#text') {
    return splitText((n as P5.TextNode).value, nodeLoc(n, ctx), ctx);
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

  if (ctx.document && !el.sourceCodeLocation && (lower === 'html' || lower === 'head' || lower === 'body')) {
    fail('PF2003', `Root layout must contain an explicit <${lower}> element`, ctx.file, ctx.source, 0);
  }

  if (lower === 'fragment' && name === 'Fragment') {
    return convertChildren(rawChildren, null, ctx);
  }

  if (isComponentName(name)) {
    if (!ctx.components.has(name)) {
      fail('PF4024', `<${name}> is not an imported component`, ctx.file, ctx.source, loc.start,
        `Add: import ${name} from './${name}.html' to the <script> block.`);
    }
    ctx.usedComponents.add(name);
    const attrs = convertAttrs(el, ctx);
    const taken = takeClientDirectives(attrs, loc, ctx, name, true);
    const children = convertChildren(rawChildren, 'div', ctx);
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

  if (lower === 'slot') {
    const nameAttr = el.attrs.find((a) => a.name === 'name')?.value || 'default';
    const slot: Slot = { type: 'Slot', name: nameAttr, fallback: convertChildren(rawChildren, 'div', ctx), loc };
    return [slot];
  }

  if (lower === 'head' || lower === 'deshi-head') {
    if (ctx.document && ctx.inRootBody) {
      fail('PF4025', '<head> blocks are not allowed inside the root layout body', ctx.file, ctx.source, loc.start);
    }
    if (!ctx.document || lower === 'deshi-head') {
      return [{ type: 'HeadBlock', children: convertChildren(rawChildren, 'head', ctx), loc }];
    }
    const children = convertChildren(rawChildren, 'head', ctx);
    for (const ch of children) {
      if (ch.type === 'Element' && !HEAD_OK.has(ch.name.toLowerCase())) {
        fail('PF1002', `<${ch.name}> is not valid inside <head>`, ctx.file, ctx.source, ch.loc.start);
      }
    }
    const headEl: Element = {
      type: 'Element', name: 'head', attrs: convertAttrs(el, ctx), children, loc,
      scoped: false, clientRoot: false, isDocHead: true,
    };
    return [headEl];
  }

  const attrs = convertAttrs(el, ctx);
  takeClientDirectives(attrs, loc, ctx, name, false);
  const wasRootBody = ctx.inRootBody;
  if (ctx.document && lower === 'body') ctx.inRootBody = true;
  const children = VOID.has(lower) ? [] : convertChildren(rawChildren, lower, ctx);
  ctx.inRootBody = wasRootBody;

  const setHtml = attrs.find((a) => a.kind === 'setHtml' || a.kind === 'setText');
  if (setHtml && children.some((c) => c.type !== 'Text' || c.value.trim())) {
    fail('PF4023', `An element with ${setHtml.kind === 'setHtml' ? 'set:html' : 'set:text'} must not have children`, ctx.file, ctx.source, loc.start);
  }
  const noScope = lower === 'html' || lower === 'head' || lower === 'body' || lower === 'title' || lower === 'meta' || lower === 'link' || lower === 'script' || lower === 'style';
  const element: Element = {
    type: 'Element',
    name: lower === name ? lower : name,
    attrs,
    children: setHtml ? [] : children,
    loc,
    scoped: ctx.scoped && !noScope,
    clientRoot: false,
  };
  return [element];
}

export function parseTemplate(
  template: string,
  base: TemplateContext,
  opts: ParseTemplateOptions,
): { root: Root; exprs: Expression[] } {
  const pre = pretokenize(template, base);
  const document = pre.sawHtml;
  const ctx: ConvCtx = { ...base, pre, opts, document, inRootBody: false };

  let root: Root;
  if (document) {
    const doc = parse(pre.text, { sourceCodeLocationInfo: true });
    const children = convertChildren(doc.childNodes, null, ctx);
    root = { type: 'Root', document: true, children };
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
    root = { type: 'Root', document: false, children: convertChildren(frag.childNodes, null, ctx) };
    if (opts.isLayout && !containsDefaultSlot(root.children)) {
      fail('PF2002', 'Layout must render a <slot /> for nested content', ctx.file, ctx.source, 0);
    }
  }
  return { root, exprs: pre.exprs };
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

export function walkNodes(nodes: Node[], fn: (n: Node) => void): void {
  for (const n of nodes) {
    fn(n);
    if (n.type === 'Element' || n.type === 'Fragment' || n.type === 'HeadBlock') walkNodes(n.children, fn);
    else if (n.type === 'Component') for (const s of Object.values(n.slots)) walkNodes(s, fn);
    else if (n.type === 'Slot') walkNodes(n.fallback, fn);
    else if (n.type === 'Expression') for (const j of n.jsx) walkNodes(j.nodes, fn);
  }
}
