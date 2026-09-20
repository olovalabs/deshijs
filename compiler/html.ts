// HTML Formatter and Minifier for Deshi Framework

/**
 * Pretty-formats HTML for development and runtime inspection.
 * Strips ghost whitespace gaps from lifted blocks and indents cleanly.
 */
export function formatHtml(html: string): string {
  const protectedBlocks: string[] = [];
  // Random nonce per call — deterministic placeholders (`___DESHI_BLOCK_0___`)
  // could collide with literal user content and corrupt output.
  const nonce = Math.random().toString(36).slice(2);
  const placeholder = (i: number): string => `___DESHI_FMT_${nonce}_${i}___`;
  const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Protect pre, code, textarea, script, and style blocks
  let processed = html.replace(
    /<(pre|code|textarea|script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs, content) => {
      if (tag.toLowerCase() === 'style') {
        const cleanCss = content.trim();
        const block = `<style${attrs}>\n${cleanCss}\n</style>`;
        const idx = protectedBlocks.length;
        protectedBlocks.push(block);
        return `\n${placeholder(idx)}\n`;
      }
      const idx = protectedBlocks.length;
      protectedBlocks.push(match.trim());
      return `\n${placeholder(idx)}\n`;
    }
  );

  // Filter out completely empty or blank lines
  const rawLines = processed.split('\n');
  const cleanTokens: string[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      cleanTokens.push(trimmed);
    }
  }

  // Split adjoining tags on separate lines
  const splitTags = cleanTokens
    .join('\n')
    .replace(/>\s*</g, '>\n<')
    .split('\n');

  const selfClosing = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);

  let indentLevel = 0;
  const indentStr = '  ';
  const resultLines: string[] = [];

  for (let item of splitTags) {
    item = item.trim();
    if (!item) continue;

    // Doctype
    if (item.toLowerCase().startsWith('<!doctype')) {
      resultLines.push(item);
      continue;
    }

    // Comment (including segment markers)
    if (item.startsWith('<!--')) {
      resultLines.push(indentStr.repeat(indentLevel) + item);
      continue;
    }

    // Closing tag
    if (item.startsWith('</')) {
      indentLevel = Math.max(0, indentLevel - 1);
      resultLines.push(indentStr.repeat(indentLevel) + item);
      continue;
    }

    // Opening tag
    if (item.startsWith('<')) {
      const tagMatch = item.match(/^<([a-zA-Z0-9:-]+)/);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';
      const isSelfClosing = selfClosing.has(tagName) || item.endsWith('/>');
      const hasInlineClose = item.includes(`</${tagName}>`);

      resultLines.push(indentStr.repeat(indentLevel) + item);

      if (!isSelfClosing && !hasInlineClose && !item.startsWith('<?')) {
        indentLevel++;
      }
      continue;
    }

    // Text content
    resultLines.push(indentStr.repeat(indentLevel) + item);
  }

  let formatted = resultLines.join('\n');

  // Restore protected blocks with matching indentation
  for (let i = 0; i < protectedBlocks.length; i++) {
    const ph = placeholder(i);
    const content = protectedBlocks[i];
    const regex = new RegExp(`^([ \t]*)${escapeRe(ph)}`, 'm');
    const match = formatted.match(regex);
    if (match) {
      const pad = match[1];
      const indented = content
        .split('\n')
        .map((l, idx) => (idx === 0 ? l : pad + l))
        .join('\n');
      formatted = formatted.replace(match[0], () => pad + indented);
    } else {
      formatted = formatted.split(ph).join(content);
    }
  }

  return formatted;
}

/**
 * Minifies HTML for production builds.
 * Collapses whitespace, minifies inline CSS, and optimizes tags.
 */
export function minifyHtml(html: string): string {
  const preserved: string[] = [];
  // Collision-proof placeholders: include a random-per-call nonce + index so
  // user content containing `___PRESERVED_0___` can never be clobbered.
  const nonce = Math.random().toString(36).slice(2);
  const placeholder = (i: number): string => `___DESHI_MIN_${nonce}_${i}___`;

  // Protect pre and textarea
  let out = html.replace(/<(pre|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => {
    const idx = preserved.length;
    preserved.push(m);
    return placeholder(idx);
  });

  // Minify <style> blocks
  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, css) => {
    const minCss = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,])\s*/g, '$1')
      .trim();
    return `<style${attrs}>${minCss}</style>`;
  });

  // Collapse inter-tag whitespace
  out = out.replace(/>\s+</g, '><');

  // Collapse redundant whitespace in text
  out = out.replace(/\s{2,}/g, ' ');

  // Restore preserved blocks (split/join = replace-all, function-safe for `$` in content)
  for (let i = 0; i < preserved.length; i++) {
    out = out.split(placeholder(i)).join(preserved[i]);
  }

  return out.trim();
}
