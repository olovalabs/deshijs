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

  it('keeps a single space between inline elements', () => {
    // Dropping this whitespace-only text node glues the boxes together ("bolditalic").
    expect(minifyHtml('<p><strong>bold</strong> <em>italic</em></p>')).toBe(
      '<p><strong>bold</strong> <em>italic</em></p>',
    );
    expect(minifyHtml('<button>Save</button> <button>Cancel</button>')).toBe(
      '<button>Save</button> <button>Cancel</button>',
    );
  });

  it('never adds or removes a space between adjacent inline elements', () => {
    expect(minifyHtml('<nav><a>Home</a><a>About</a></nav>')).toBe('<nav><a>Home</a><a>About</a></nav>');
    expect(minifyHtml('<span>a</span>\n<span>b</span>')).toBe('<span>a</span> <span>b</span>');
  });

  it('still drops whitespace between block elements', () => {
    expect(minifyHtml('<p>one</p> <p>two</p>')).toBe('<p>one</p><p>two</p>');
    expect(minifyHtml('<div>  <span>a</span>  </div>')).toBe('<div><span>a</span></div>');
  });

  it('never collapses non-breaking or other Unicode whitespace', () => {
    // `\s` matches U+00A0; HTML does not collapse it, so it must survive as-is.
    const nbsp = minifyHtml('<p>Hello&nbsp;world</p>');
    expect(nbsp.includes('\u00a0') || nbsp.includes('&nbsp;')).toBe(true);
    expect(nbsp.includes('Hello world')).toBe(false);

    const trailing = minifyHtml('<p>x&nbsp;</p>');
    expect(trailing.includes('\u00a0') || trailing.includes('&nbsp;')).toBe(true);

    expect(minifyHtml('<p>a&ensp;b</p>')).toContain('a\u2002b');
    expect(minifyHtml('<p>a&emsp;b</p>')).toContain('a\u2003b');
    expect(minifyHtml('<p>a&thinsp;b</p>')).toContain('a\u2009b');
  });
});

describe('formatHtml inline handling', () => {
  it('does not introduce whitespace between adjacent inline elements', () => {
    expect(formatHtml('<nav><a>Home</a><a>About</a></nav>')).toContain('<a>Home</a><a>About</a>');
    expect(formatHtml('<p>Hello<a href="#">link</a></p>')).toContain('Hello<a href="#">link</a>');
  });

  it('keeps existing inline spacing intact', () => {
    expect(formatHtml('<p>Hello <a href="#">link</a> world</p>')).toContain('Hello <a href="#">link</a> world');
  });
});
