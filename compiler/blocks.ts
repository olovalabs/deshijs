// Stage 1 — block split. Uses parse5's Tokenizer (not the tree builder) so that
// top-level <script>/<style> blocks in layout files, which sit outside <html>, are
// lifted by source location before any tree construction happens.
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
  let tokenizer!: Tokenizer;

  const finishBlock = (endTagStart: number, endTagEnd: number) => {
    if (!pending) return;
    const content = source.slice(pending.contentStart, endTagStart);
    const isScript = pending.name === 'script';
    const isClient = isScript && 'client' in pending.attrs;
    const isGlobal = !isScript && 'global' in pending.attrs;
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
        tokenizer.state = name === 'script' ? TokenizerMode.SCRIPT_DATA : TokenizerMode.RAWTEXT;
        return;
      }
      if (RAW.has(name)) tokenizer.state = name === 'script' ? TokenizerMode.SCRIPT_DATA : TokenizerMode.RAWTEXT;
      else if (RCDATA.has(name)) tokenizer.state = TokenizerMode.RCDATA;
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

  // Blank out lifted ranges while preserving every newline so that all offsets,
  // lines and columns of the remaining template still point into the original file.
  let template = source;
  for (const r of ranges) {
    const chunk = source.slice(r.start, r.end);
    let blank = '';
    for (let i = 0; i < chunk.length; i++) blank += chunk[i] === '\n' ? '\n' : ' ';
    template = template.slice(0, r.start) + blank + template.slice(r.end);
  }

  return { script, client, styles, template, diagnostics, sawHtml };
}
