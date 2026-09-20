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
});
