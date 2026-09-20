import { describe, expect, it } from 'vitest';
import { isViteInternalId } from '../vite';

describe('isViteInternalId', () => {
  it('flags the HTML proxy that carries inline island scripts', () => {
    // Vite lifts `<script type="module">` out of HTML into this virtual id.
    // Stripping the query leaves `index.html`, which looks like a source file —
    // compiling its JS as a template used to throw PF4001.
    expect(isViteInternalId('/index.html?html-proxy&index=0.js')).toBe(true);
    expect(isViteInternalId('/docs/index.html?html-proxy&index=2.js')).toBe(true);
  });

  it('flags other Vite virtual/raw/url ids', () => {
    expect(isViteInternalId('\0virtual:deshi/content')).toBe(true);
    expect(isViteInternalId('/src/docs/a.md?raw')).toBe(true);
    expect(isViteInternalId('/src/public/hero.png?url')).toBe(true);
  });

  it('leaves real source ids (and HMR queries) alone', () => {
    expect(isViteInternalId('/src/page.deshi')).toBe(false);
    expect(isViteInternalId('/src/layout.deshi?t=1712345678901')).toBe(false);
    expect(isViteInternalId('/src/docs/guide.mdx')).toBe(false);
    expect(isViteInternalId('/src/about.md')).toBe(false);
    expect(isViteInternalId('/index.html')).toBe(false);
  });
});
