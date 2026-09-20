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
});

describe('minifyHtml', () => {
  it('collapses inter-tag whitespace and preserves <pre>', () => {
    const out = minifyHtml('<div>  <span>a</span>  </div><pre>  keep  </pre>');
    expect(out).toContain('<div><span>a</span></div>');
    expect(out).toContain('<pre>  keep  </pre>');
  });

  it('minifies inline <style> blocks', () => {
    const out = minifyHtml('<style>/* c */ .a { color: red; }</style>');
    expect(out).toBe('<style>.a{color:red;}</style>');
  });

  it('treats `$` in content literally when restoring blocks', () => {
    // `$&` in a *string* replacement pattern would interpolate the match.
    const out = minifyHtml('<pre>$& $` $\'</pre><div>  x  </div>');
    expect(out).toContain('<pre>$& $` $\'</pre>');
  });
});
