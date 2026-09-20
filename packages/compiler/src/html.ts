// HTML formatter and minifier — parse5 AST in, serialized string out.
// The document/fragment is parsed once, transformed at the tree level
// (whitespace, inline <style> minification) and serialized, so no regex ever
// touches markup.
import { parse, parseFragment, serialize, serializeOuter, type DefaultTreeAdapterTypes as P5 } from 'parse5';
import { minifyCss } from './css';

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
// Content whose inner whitespace must never be rewritten.
const PRESERVE = new Set(['pre', 'textarea', 'script', 'style']);

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

// ─── format ──────────────────────────────────────────────────────────────────

/** Pretty-format HTML for development: block elements on their own lines. */
export function formatHtml(html: string): string {
  // Full documents must be parsed as documents — parseFragment would drop the
  // <html>/<head>/<body> wrappers and their closing tags.
  const root = isDocument(html) ? parse(html) : parseFragment(html);
  const lines: string[] = [];

  const emit = (nodes: P5.ChildNode[], depth: number): void => {
    const pad = '  '.repeat(depth);
    for (const n of nodes) {
      if (n.nodeName === '#text') {
        const t = ((n as P5.TextNode).value ?? '').trim();
        if (t) lines.push(pad + t);
        continue;
      }
      if (n.nodeName === '#comment') {
        lines.push(pad + serializeOuter(n));
        continue;
      }
      if (n.nodeName === '#documentType') {
        lines.push('<!doctype html>');
        continue;
      }
      const el = n as P5.Element;
      if (PRESERVE.has(el.tagName) || !hasElementChild(el)) {
        lines.push(pad + serializeOuter(el));
        continue;
      }
      lines.push(pad + startTag(el));
      emit(el.childNodes, depth + 1);
      lines.push(pad + `</${el.tagName}>`);
    }
  };

  emit(root.childNodes as P5.ChildNode[], 0);
  return lines.join('\n');
}

// ─── minify ──────────────────────────────────────────────────────────────────

function collapse(node: P5.ParentNode, preserve: boolean): void {
  const kids = (node as { childNodes?: P5.ChildNode[] }).childNodes;
  if (!kids) return;
  const out: P5.ChildNode[] = [];
  for (const child of kids) {
    if (child.nodeName === '#text') {
      const txt = child as P5.TextNode;
      if (preserve) {
        out.push(child);
        continue;
      }
      const v = (txt.value ?? '').replace(/\s+/g, ' ');
      if (!v.trim()) continue; // drop whitespace-only text between markup
      txt.value = v;
      out.push(child);
      continue;
    }
    if (child.nodeName === '#comment') {
      out.push(child);
      continue;
    }
    const el = child as P5.Element;
    if (el.tagName === 'style') {
      const styleText = el.childNodes.find((c) => c.nodeName === '#text') as P5.TextNode | undefined;
      if (styleText) styleText.value = minifyCss(styleText.value ?? '');
      out.push(child);
      continue;
    }
    collapse(el, preserve || PRESERVE.has(el.tagName));
    out.push(child);
  }
  (node as { childNodes: P5.ChildNode[] }).childNodes = out;
}

/** Minify HTML for production builds. */
export function minifyHtml(html: string): string {
  if (isDocument(html)) {
    const doc = parse(html);
    collapse(doc, false);
    // parse5 uppercases the doctype; keep the historical lowercase form.
    return serialize(doc).replace(/^<!DOCTYPE html>/i, '<!doctype html>');
  }
  const frag = parseFragment(html);
  collapse(frag, false);
  return serialize(frag);
}
