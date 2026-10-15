import { describe, expect, it } from 'vitest';
import { compile, __clearCompileMemoForTests } from '../index';

describe('compile', () => {
  it('compiles a minimal template to a render module', () => {
    __clearCompileMemoForTests();
    const res = compile(`<script>const name = 'Ada';</script>\n<h1>Hello {name}</h1>`, {
      file: 'src/page.deshi',
    });
    expect(res.meta.hasClient).toBe(false);
    expect(res.code).toContain('Hello');
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('returns defensive copies from the memo cache', () => {
    __clearCompileMemoForTests();
    const src = `<div>cached</div>`;
    const a = compile(src, { file: 'src/cached.deshi' });
    const b = compile(src, { file: 'src/cached.deshi' });
    expect(a.code).toBe(b.code);
    expect(a.diagnostics).not.toBe(b.diagnostics);
    b.diagnostics.push({ code: 'X', severity: 'error', message: 'm', file: 'f', line: 1, column: 1, frame: '' });
    const c = compile(src, { file: 'src/cached.deshi' });
    expect(c.diagnostics).toHaveLength(a.diagnostics.length);
  });

  it('fails loudly on unknown template bindings', () => {
    __clearCompileMemoForTests();
    expect(() => compile(`<div>{totallyUnknownBinding}</div>`, { file: 'src/bad.deshi' })).toThrow(
      /PF4010/,
    );
  });

  it('compiles markdown pages via frontmatter bindings', () => {
    __clearCompileMemoForTests();
    const res = compile(`---\ntitle: Hello\n---\n# Hi\n`, { file: 'src/post.md' });
    expect(res.script.bindings).toContain('title');
  });

  it('preserves SVG casing, namespaces, and eliminates interstitial whitespace', () => {
    __clearCompileMemoForTests();
    const svg = `<svg viewBox="0 0 100 100" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="g1">
      <stop stopColor="red" xlink:href="#icon" xml:space="preserve" />
    </linearGradient>
  </defs>
</svg>`;
    const res = compile(svg, { file: 'src/icon.deshi' });
    expect(res.code).toContain('viewBox=\\"0 0 100 100\\"');
    expect(res.code).toContain('xmlns:xlink=\\"http://www.w3.org/1999/xlink\\"');
    expect(res.code).toContain('stopColor=\\"red\\"');
    expect(res.code).toContain('xlink:href=\\"#icon\\"');
    expect(res.code).toContain('xml:space=\\"preserve\\"');
    expect(res.code).not.toContain('<svg viewBox="0 0 100 100"> <defs>');
  });

  it('supports standalone full-document pages without requiring a slot (Astro parity)', () => {
    __clearCompileMemoForTests();
    const doc = `<!doctype html><html><head><title>Astro</title></head><body><h1>Hello</h1></body></html>`;
    const res = compile(doc, { file: 'src/page.deshi', isLayout: false });
    expect(res.meta.isDocument).toBe(true);
    expect(res.code).toContain('<h1>Hello</h1>');
  });

  it('preserves @font-face rules in scoped component styles without mangling', () => {
    __clearCompileMemoForTests();
    const src = `<div>Font test</div><style>@font-face { font-family: 'Custom'; src: url('/fonts/custom.woff2'); } .text { font-family: 'Custom'; }</style>`;
    const res = compile(src, { file: 'src/font.deshi' });
    // Lightning CSS (or the css-tree fallback) may drop the quotes around the
    // valid custom-ident; both forms are equivalent, so accept either.
    expect(res.css.scoped).toMatch(/@font-face\{font-family:['"]?Custom['"]?;src:url\(['"]?\/fonts\/custom\.woff2['"]?\)\}/);
    expect(res.css.scoped).not.toContain('@font-face[data-deshi');
  });
});
