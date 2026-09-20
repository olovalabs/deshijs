import { describe, expect, it } from 'vitest';
import { islandInlineScript, stampIslandRoot } from '../islands';

describe('stampIslandRoot', () => {
  it('adds the island id to the root element', () => {
    expect(stampIslandRoot('<div class="x">hi</div>', 'd-1')).toContain('id="d-1"');
  });

  it('uses data-deshi-i when an id already exists', () => {
    expect(stampIslandRoot('<div id="keep">hi</div>', 'd-2')).toContain('data-deshi-i="d-2"');
  });

  it('wraps non-element html in a display:contents div', () => {
    expect(stampIslandRoot('just text', 'd-3')).toContain('display:contents');
  });
});

describe('islandInlineScript', () => {
  it('emits a strategy-specific loader for visible/idle/media/click', () => {
    expect(islandInlineScript('i', '/c.js', 'visible')).toContain('IntersectionObserver');
    expect(islandInlineScript('i', '/c.js', 'idle')).toContain('requestIdleCallback');
    expect(islandInlineScript('i', '/c.js', 'media', '(max-width: 1px)')).toContain('matchMedia');
    expect(islandInlineScript('i', '/c.js', 'click')).toContain('addEventListener');
    expect(islandInlineScript('i', '/c.js', 'load')).toContain('import(');
  });

  it('requires a media query for client:media', () => {
    expect(() => islandInlineScript('i', '/c.js', 'media')).toThrow(/client:media/);
  });

  it('JSON-escapes the chunk src (no script-breakout injection)', () => {
    const evil = '/c.js"></script><script>alert(1)</script>';
    const out = islandInlineScript('i', evil, 'load');
    // The literal `</script>` must never appear — it is unicode-escaped.
    expect(out).not.toContain('</script><script>');
    expect(out).toContain('\\u003c/script\\u003e');
  });
});
