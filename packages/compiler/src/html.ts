// HTML formatter and minifier — parse5 AST in, serialized string out.
// The document/fragment is parsed once, transformed at the tree level
// (whitespace, inline <style> minification) and serialized, so no regex ever
// touches markup.
import { parse, parseFragment, serialize, serializeOuter, Tokenizer, type DefaultTreeAdapterTypes as P5 } from 'parse5';
import { minifyCss } from './css';
import { collapseWhitespace, dropWhitespaceBetween, isAsciiWhitespace, isBlockTag } from './whitespace';

/**
 * Decode character references the way the HTML parser does.
 *
 * The parser hands back already-decoded text, but the template pass works on
 * masked source offsets; decoding each text run with the tokenizer (instead of
 * re-implementing entities) is what keeps `&larr;` from being escaped twice.
 */
export function decodeText(raw: string): string {
  // Nothing to decode — by far the common case.
  if (raw.indexOf('&') === -1) return raw;
  let out = '';
  const handler = {
    onCharacter(t: { chars: string }) {
      out += t.chars;
    },
    onNullCharacter() {
      out += '\uFFFD';
    },
    onWhitespaceCharacter(t: { chars: string }) {
      out += t.chars;
    },
    onStartTag() {},
    onEndTag() {},
    onEof() {},
    onComment() {},
    onDoctype() {},
  };
  new Tokenizer({}, handler).write(raw, true);
  return out;
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
// Content whose inner whitespace must never be rewritten.
const PRESERVE = new Set(['pre', 'textarea', 'script', 'style']);

// ─── optional production optimizations ───────────────────────────────────────

export interface HtmlMinifyOptions {
  /** Drop comments except deshi/astro markers, conditional comments and SSI. */
  removeComments?: boolean;
  /** Remove redundant / empty attributes and collapse `class` whitespace. */
  optimizeAttributes?: boolean;
  /** Minifier for a bare `style="…"` declaration list. Default: identity. */
  minifyDeclarations?: (declarations: string) => string;
  /** Minifier for an inline `<style>`. Defaults to `minifyCss`. */
  minifyStyle?: (css: string) => string;
  /** Minifier for an inline classic/module `<script>`. Default: identity. */
  minifyScript?: (code: string) => string;
}

/** Comments that must survive minification (hydration markers, IE, SSI). */
function keepComment(value: string): boolean {
  const v = value.trim();
  if (v.startsWith('deshi:') || v.startsWith('astro:')) return true;
  if (v.startsWith('[') || v.startsWith('!') || v.startsWith('#')) return true; // conditional / bang / SSI
  return v.includes('<![endif') || v.includes('[if ');
}

/** Inline `<script>` whose body is JavaScript (not JSON/data) and has no `src`. */
function isInlineJsScript(el: P5.Element): boolean {
  const attrs = el.attrs ?? [];
  if (attrs.some((a) => a.name === 'src')) return false;
  const type = (attrs.find((a) => a.name === 'type')?.value ?? '').trim().toLowerCase();
  return type === '' || type === 'text/javascript' || type === 'application/javascript' || type === 'module';
}

function isRedundantAttribute(tag: string, name: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (tag === 'script') {
    if (name === 'language' && v === 'javascript') return true;
    if (name === 'type' && (v === 'text/javascript' || v === 'application/javascript')) return true;
  }
  if (tag === 'style' && name === 'type' && v === 'text/css') return true;
  if (tag === 'link' && name === 'type' && v === 'text/css') return true;
  return false;
}

function optimizeElement(element: P5.Element, options: HtmlMinifyOptions): void {
  const tag = element.tagName;
  const out: P5.Element['attrs'] = [];
  for (const a of element.attrs ?? []) {
    const value = a.value ?? '';
    if (isRedundantAttribute(tag, a.name, value)) continue;
    if (a.name === 'class') {
      const v = value.replace(/[ \t\n\r\f]+/g, ' ').trim();
      if (!v) continue;
      out.push({ name: a.name, value: v });
      continue;
    }
    if (a.name === 'style') {
      const v = options.minifyDeclarations ? options.minifyDeclarations(value) : value.trim();
      if (!v) continue;
      out.push({ name: a.name, value: v });
      continue;
    }
    out.push(a);
  }
  element.attrs = out;
}

function isDocument(html: string): boolean {
  const t = html.trimStart();
  return t.startsWith('<!doctype') || t.startsWith('<!DOCTYPE') || t.startsWith('<html');
}

/** Start tag only (`<tag attrs>`) — serialized by parse5, close tag stripped. */
function startTag(el: P5.Element): string {
  const clone = { ...el, childNodes: [], content: undefined } as P5.Element;
  const full = serializeOuter(clone);
  if (VOID.has(el.tagName)) return full;
  return full.slice(0, full.length - `</${el.tagName}>`.length);
}

function hasElementChild(el: P5.Element): boolean {
  const kids = el.childNodes ?? [];
  return kids.some((c) => Boolean((c as P5.Element).tagName));
}

/** Block/inline classification of a sibling, for whitespace folding. */
function isBlockChild(n: P5.ChildNode | undefined): boolean {
  if (!n) return false;
  const tag = (n as P5.Element).tagName;
  return typeof tag === 'string' && isBlockTag(tag);
}

/** Serialize a run of inline nodes exactly, together, as one string. */
function serializeRun(run: P5.ChildNode[]): string {
  return serialize({ nodeName: '#document-fragment', childNodes: run } as unknown as P5.ParentNode);
}

// ─── format ──────────────────────────────────────────────────────────────────

/** Pretty-format HTML for development: block elements on their own lines. */
export function formatHtml(html: string): string {
  // Full documents must be parsed as documents — parseFragment would drop the
  // <html>/<head>/<body> wrappers and their closing tags.
  const root = isDocument(html) ? parse(html) : parseFragment(html);
  const lines: string[] = [];

  // Inline content is kept on a single line and serialized as-is, so formatting
  // never inserts (or removes) a space between inline boxes. Only block elements
  // are broken onto their own lines; the surrounding newlines they add are
  // insignificant in a block formatting context. Children are only emitted for
  // block elements, so their parent context is always block-level.
  const emitNodes = (nodes: P5.ChildNode[], depth: number): void => {
    const pad = '  '.repeat(depth);
    let run: P5.ChildNode[] = [];
    const flush = (): void => {
      if (!run.length) return;
      lines.push(pad + serializeRun(run));
      run = [];
    };

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeName === '#text') {
        const t = n as P5.TextNode;
        const value = t.value ?? '';
        if (isAsciiWhitespace(value)) {
          const dropped = dropWhitespaceBetween(
            i > 0,
            isBlockChild(nodes[i - 1]),
            i + 1 < nodes.length,
            isBlockChild(nodes[i + 1]),
            true,
          );
          if (dropped) continue;
        }
        // Collapsing ASCII runs is rendering-neutral and keeps dev output tidy.
        t.value = collapseWhitespace(value);
        run.push(n);
        continue;
      }
      if (n.nodeName === '#comment') {
        flush();
        lines.push(pad + serializeOuter(n));
        continue;
      }
      if (n.nodeName === '#documentType') {
        flush();
        lines.push('<!doctype html>');
        continue;
      }
      const el = n as P5.Element;
      if (PRESERVE.has(el.tagName)) {
        // Whitespace inside is significant — never reformat or split it.
        flush();
        lines.push(pad + serializeOuter(el));
        continue;
      }
      if (!isBlockTag(el.tagName)) {
        // Inline element: belongs to the surrounding inline run.
        run.push(n);
        continue;
      }
      flush();
      if (!hasElementChild(el)) {
        lines.push(pad + serializeOuter(el));
        continue;
      }
      lines.push(pad + startTag(el));
      emitNodes(el.childNodes, depth + 1);
      lines.push(pad + `</${el.tagName}>`);
    }
    flush();
  };

  emitNodes(root.childNodes as P5.ChildNode[], 0);
  return lines.join('\n');
}

// ─── minify ──────────────────────────────────────────────────────────────────

function collapse(node: P5.ParentNode, preserve: boolean, options: HtmlMinifyOptions): void {
  const kids = (node as { childNodes?: P5.ChildNode[] }).childNodes;
  if (!kids) return;
  const parentTag = (node as P5.Element).tagName;
  const parentBlock = !parentTag || isBlockTag(parentTag);
  const out: P5.ChildNode[] = [];
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child.nodeName === '#text') {
      const txt = child as P5.TextNode;
      if (preserve) {
        out.push(child);
        continue;
      }
      const prev = kids[i - 1];
      const next = kids[i + 1];
      let v = collapseWhitespace(txt.value ?? '');
      if (isAsciiWhitespace(v)) {
        // Kept only when it separates inline boxes (a rendered space); dropped
        // against a block boundary, where it can never be seen.
        const dropped = dropWhitespaceBetween(
          prev !== undefined,
          isBlockChild(prev),
          next !== undefined,
          isBlockChild(next),
          parentBlock,
        );
        if (dropped) continue;
        txt.value = ' ';
        out.push(child);
        continue;
      }
      txt.value = v;
      out.push(child);
      continue;
    }
    if (child.nodeName === '#comment') {
      if (options.removeComments && !keepComment((child as P5.CommentNode).data ?? '')) continue;
      out.push(child);
      continue;
    }
    const el = child as P5.Element;
    if (options.optimizeAttributes) optimizeElement(el, options);
    if (el.tagName === 'style') {
      const styleText = el.childNodes.find((c) => c.nodeName === '#text') as P5.TextNode | undefined;
      if (styleText) styleText.value = (options.minifyStyle ?? minifyCss)(styleText.value ?? '');
      out.push(child);
      continue;
    }
    if (el.tagName === 'script' && options.minifyScript && isInlineJsScript(el)) {
      const scriptText = el.childNodes.find((c) => c.nodeName === '#text') as P5.TextNode | undefined;
      if (scriptText) scriptText.value = options.minifyScript(scriptText.value ?? '');
      out.push(child);
      continue;
    }
    collapse(el, preserve || PRESERVE.has(el.tagName), options);
    out.push(child);
  }
  (node as { childNodes: P5.ChildNode[] }).childNodes = out;
}

/** Minify HTML for production builds. */
export function minifyHtml(html: string, options: HtmlMinifyOptions = {}): string {
  if (isDocument(html)) {
    const doc = parse(html);
    collapse(doc, false, options);
    // parse5 uppercases the doctype; keep the historical lowercase form.
    return serialize(doc).replace(/^<!DOCTYPE html>/i, '<!doctype html>');
  }
  const frag = parseFragment(html);
  collapse(frag, false, options);
  return serialize(frag);
}
