import { describe, expect, it } from 'vitest';
import { formatHtml, minifyHtml } from '../html';

describe('formatHtml', () => {
  it('indents nested markup', () => {
    const out = formatHtml('<div><p>hi</p></div>');
    expect(out).toContain('\n  <p>hi</p>');
  });

  it('does not corrupt literal placeholder-like user text', () => {
    const out = formatHtml('<div>___DESHI_BLOCK_0___</div><pre>  keep  </pre>');
    expect(out).toContain('___DESHI_BLOCK_0___');
    expect(out).toContain('keep');
  });

  it('preserves pre/code whitespace', () => {
    const out = formatHtml('<pre>a  b\n  c</pre>');
    expect(out).toContain('a  b');
  });

  it('keeps a full document\u2019s html/head/body wrappers and closing tags', () => {
    const out = formatHtml('<!doctype html><html><head><title>T</title></head><body><p>hi</p></body></html>');
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('</body>');
    expect(out).toContain('</html>');
    expect(out).toContain('<title>T</title>');
  });
});

describe('minifyHtml', () => {
  it('collapses inter-tag whitespace and preserves <pre>', () => {
    const out = minifyHtml('<div>  <span>a</span>  </div><pre>  keep  </pre>');
    expect(out).toContain('<div><span>a</span></div>');
    expect(out).toContain('<pre>  keep  </pre>');
  });

  it('minifies inline <style> blocks', () => {
    const out = minifyHtml('<style>/* c */ .a { color: red; }</style>');
    // css-tree minification (AST) drops the redundant trailing semicolon.
    expect(out).toBe('<style>.a{color:red}</style>');
  });

  it('never interpolates `$` sequences from content', () => {
    // The old engine used string replacements, where `$&`/`` $` ``/`$'` would be
    // substituted. AST serialization escapes `&` → `&amp;` (renders identically)
    // and leaves the `$`-sequences literal.
    const out = minifyHtml('<pre>$& $` $\'</pre><div>  x  </div>');
    expect(out).toContain("$`");
    expect(out).toContain("$'");
    expect(out).toContain('<div> x </div>');
  });

  it('preserves a full document doctype and structure', () => {
    const out = minifyHtml('<!doctype html><html><head><title>T</title></head><body><p>  hi  </p></body></html>');
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<p> hi </p>');
  });
});
