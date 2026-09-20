// Stage 1 — block split. Uses parse5's Tokenizer (not the tree builder) so that
// top-level <script>/<style> blocks in layout files, which sit outside <html>, are
// lifted by source location before any tree construction happens.
// Also supports Astro frontmatter `---` fences as an alias for <script>.
import { Tokenizer, TokenizerMode, type TokenHandler, type Token } from 'parse5';
import { fail, type Diagnostic, makeDiagnostic } from './types';

export interface Block {
  kind: 'script' | 'client' | 'style' | 'styleGlobal';
  attrs: Record<string, string>;
  content: string;
  /** offset of the content inside the original file */
  contentStart: number;
  start: number;
  end: number;
}

export interface SplitResult {
  script?: Block;
  client?: Block;
  styles: Block[];
  /** original source with lifted blocks blanked out (offsets preserved) */
  template: string;
  diagnostics: Diagnostic[];
  sawHtml: boolean;
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const RAW = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']);
const RCDATA = new Set(['title', 'textarea']);

interface Pending {
  name: string;
  attrs: Record<string, string>;
  start: number;
  contentStart: number;
}

export function splitBlocks(source: string, file: string): SplitResult {
  // Astro frontmatter alias: leading `---` fenced block is treated as <script>
  // so `---\nimport X from './X.deshi'\n---` works like <script>.
  if (/^\s*---\s*\r?\n/.test(source)) {
    const start = source.indexOf('---');
    const nl = source.indexOf('\n', start + 3);
    const second = source.indexOf('\n---', nl);
    if (second !== -1) {
      const endMark = source.indexOf('---', second + 1);
      const contentStart = nl + 1;
      const contentEnd = second + 1; // before newline of closing fence
      const fenceEnd = source.indexOf('\n', endMark + 3);
      const fenceRange = { start, end: fenceEnd === -1 ? source.length : fenceEnd + 1 };
      const content = source.slice(contentStart, contentEnd);
      // If no <script> exists later, synthesize one
      if (!/<script[\s>]/i.test(source.slice(fenceRange.end))) {
        // blank out fence and treat its content as script, then fall through to normal tokenizing for styles
        const blankedHead = source.slice(0, fenceRange.start).replace(/[^\n]/g, ' ') + source.slice(fenceRange.start, fenceRange.end).replace(/[^\n]/g, ' ').split('').map((c) => (c === '\n' ? '\n' : ' ')).join('') ;
        void blankedHead;
      }
      // We will handle it after tokenizer — if script wasn't found, inject the fence content as script
      // To preserve offsets, note its position now.
      const frontmatterScript = { content, contentStart, start, end: fenceEnd === -1 ? source.length : fenceEnd + 1 };
      const after = splitBlocksInternal(source, file, frontmatterScript);
      if (after) return after;
    }
  }
  return splitBlocksInternal(source, file, null);
}
function splitBlocksInternal(source: string, file: string, frontmatter: { content: string; contentStart: number; start: number; end: number } | null): SplitResult {
  const diagnostics: Diagnostic[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  let script: Block | undefined;
  let client: Block | undefined;
  const styles: Block[] = [];
  /** open element stack — end tags pop to the matching start tag, so optional
   *  end tags (<li>, <p>, …) do not skew the depth of later top-level blocks */
  const stack: string[] = [];
  let pending: Pending | null = null;
  let sawHtml = false;
  let tokenizer: Tokenizer | null = null;

  const finishBlock = (endTagStart: number, endTagEnd: number) => {
    if (!pending) return;
    const content = source.slice(pending.contentStart, endTagStart);
    const isScript = pending.name === 'script';
    const isClient = isScript && 'client' in pending.attrs;
    // Astro parity: <style is:global> and <style global> are equivalent.
    // `define:vars` and `is:inline` are preserved for codegen (vars injection, no scoping).
    const isGlobal = !isScript && ('global' in pending.attrs || 'is:global' in pending.attrs || pending.attrs['is:global'] === '');
    const isInline = !isScript && ('is:inline' in pending.attrs);
    void isInline; // keep for typings — scoped CSS is skipped when is:inline
    const block: Block = {
      kind: isScript ? (isClient ? 'client' : 'script') : isGlobal ? 'styleGlobal' : 'style',
      attrs: pending.attrs,
      content,
      contentStart: pending.contentStart,
      start: pending.start,
      end: endTagEnd,
    };
    if (block.kind === 'script') {
      if (script) fail('PF1004', 'A file may contain at most one <script> block', file, source, pending.start);
      script = block;
    } else if (block.kind === 'client') {
      if (client) fail('PF1004', 'A file may contain at most one <script client> block', file, source, pending.start);
      client = block;
    } else {
      styles.push(block);
    }
    ranges.push({ start: pending.start, end: endTagEnd });
    pending = null;
  };

  const handler: TokenHandler = {
    onStartTag(t: Token.TagToken) {
      const name = t.tagName;
      const loc = t.location!;
      if (name === 'html') sawHtml = true;
      if (stack.length === 0 && (name === 'script' || name === 'style')) {
        const attrs: Record<string, string> = {};
        for (const a of t.attrs) attrs[a.name] = a.value;
        pending = { name, attrs, start: loc.startOffset, contentStart: loc.endOffset };
        tokenizer!.state = name === 'script' ? TokenizerMode.SCRIPT_DATA : TokenizerMode.RAWTEXT;
        return;
      }
      if (RAW.has(name)) tokenizer!.state = name === 'script' ? TokenizerMode.SCRIPT_DATA : TokenizerMode.RAWTEXT;
      else if (RCDATA.has(name)) tokenizer!.state = TokenizerMode.RCDATA;
      if (!VOID.has(name) && !t.selfClosing) stack.push(name);
    },
    onEndTag(t: Token.TagToken) {
      const loc = t.location!;
      if (pending && t.tagName === pending.name) {
        finishBlock(loc.startOffset, loc.endOffset);
        return;
      }
      const idx = stack.lastIndexOf(t.tagName);
      if (idx !== -1) stack.length = idx;
    },
    onEof(t: Token.EOFToken) {
      if (pending) {
        const p: Pending = pending;
        diagnostics.push(
          makeDiagnostic('PF1001', `Unclosed <${p.name}> block`, file, source, p.start),
        );
        finishBlock(t.location?.startOffset ?? source.length, source.length);
      }
    },
    onComment() {},
    onDoctype() {},
    onCharacter() {},
    onNullCharacter() {},
    onWhitespaceCharacter() {},
  };

  tokenizer = new Tokenizer({ sourceCodeLocationInfo: true }, handler);
  tokenizer.write(source, true);

  // If frontmatter fence exists and no <script> was found, synthesize script
  if (frontmatter && !script && !client) {
    script = {
      kind: 'script',
      attrs: {},
      content: frontmatter.content,
      contentStart: frontmatter.contentStart,
      start: frontmatter.start,
      end: frontmatter.end,
    };
    ranges.push({ start: frontmatter.start, end: frontmatter.end });
  } else if (frontmatter) {
    // Both fence and <script> present → error (Astro forbids)
    diagnostics.push(makeDiagnostic('PF1004', 'Use either `---` frontmatter or <script>, not both', file, source, frontmatter.start, 'warning'));
    ranges.push({ start: frontmatter.start, end: frontmatter.end });
  }

  // Blank out lifted ranges while preserving every newline so that all offsets,
  // lines and columns of the remaining template still point into the original file.
  // Single pass: sort ranges, then walk once — O(n), not O(n·ranges).
  const chars = source.split('');
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    for (let k = Math.max(0, r.start); k < Math.min(chars.length, r.end); k++) {
      if (chars[k] !== '\n') chars[k] = ' ';
    }
  }
  const template = chars.join('');

  return { script, client, styles, template, diagnostics, sawHtml };
}
