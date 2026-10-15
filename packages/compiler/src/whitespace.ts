// Shared whitespace + block-level semantics.
//
// Both the template AST pass (`template.ts`, `applyWhitespace`) and the final
// HTML string pass (`html.ts`, `collapse` / `formatHtml`) fold whitespace, and
// they must agree. Two rules live here so they cannot drift apart:
//
//   1. HTML only collapses *ASCII* whitespace in normal flow. Unicode spaces —
//      U+00A0 (`&nbsp;`), U+2002/U+2003 (en/em space), U+2009 (thin space),
//      U+200A, U+202F, U+3000 — are significant and must survive minification.
//      `String.prototype.trim` and `\s` in a regex both match them, so they are
//      never used on template text.
//   2. A whitespace-only run may only be dropped when it sits against a block
//      boundary (or between two block boxes); between inline content it is a
//      real, rendered space and must be kept as a single ASCII space.

/** ASCII whitespace as HTML defines it — and nothing else. */
export function collapseWhitespace(s: string): string {
  return s.replace(/[ \t\n\r\f]+/g, ' ');
}

/** Trim ASCII whitespace only (never Unicode spaces). */
export function trimWhitespace(s: string): string {
  return s.replace(/^[ \t\n\r\f]+/, '').replace(/[ \t\n\r\f]+$/, '');
}

/** True when `s` is empty or only ASCII whitespace. */
export function isAsciiWhitespace(s: string): boolean {
  return /^[ \t\n\r\f]*$/.test(s);
}

/**
 * Tags that establish a block formatting context (plus void/structural tags
 * whose inter-node whitespace never renders). Used only to decide whether a
 * whitespace-only run is safe to delete; unknown / inline tags are treated as
 * inline, which is the safe direction (keeping a space never changes layout).
 */
export const BLOCK_TAGS = new Set([
  'html', 'head', 'body', 'div', 'main', 'section', 'article', 'header', 'footer', 'nav',
  'ul', 'ol', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr',
  'td', 'th', 'title', 'meta', 'link', 'script', 'style', 'pre', 'blockquote', 'form',
  'fieldset', 'figure', 'figcaption', 'aside', 'hr', 'dl', 'dt', 'dd', 'details', 'summary',
  'template', 'slot', 'option', 'select', 'br',
  // SVG structural & graphical elements — drop interstitial whitespace, Astro-style.
  'svg', 'g', 'defs', 'symbol', 'mask', 'pattern', 'clippath', 'lineargradient',
  'radialgradient', 'filter', 'marker', 'path', 'circle', 'rect', 'line',
  'polyline', 'polygon', 'ellipse', 'use', 'stop', 'image',
]);

export function isBlockTag(name: string | null | undefined): boolean {
  return name != null && BLOCK_TAGS.has(name.toLowerCase());
}

/**
 * Decide whether a whitespace-only run between two siblings can be removed.
 *
 * `hasPrev`/`hasNext` say whether a sibling exists; `prevBlock`/`nextBlock`
 * classify the existing sibling (a missing sibling is never a block). A run at
 * a boundary counts as adjacent to a block when its parent is a block container.
 */
export function dropWhitespaceBetween(
  hasPrev: boolean,
  prevBlock: boolean,
  hasNext: boolean,
  nextBlock: boolean,
  parentBlock: boolean,
): boolean {
  if (!hasPrev && !hasNext) return true;
  const prevDrops = hasPrev ? prevBlock : parentBlock;
  const nextDrops = hasNext ? nextBlock : parentBlock;
  return prevDrops || nextDrops;
}
