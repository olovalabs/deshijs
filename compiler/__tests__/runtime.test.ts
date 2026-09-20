import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  escapeAttr,
  attrs,
  cls,
  sty,
  cache,
  resetCache,
  mergeHead,
  raw,
  esc,
} from '../runtime';

describe('escapeHtml / escapeAttr', () => {
  it('escapes the dangerous chars', () => {
    expect(escapeHtml('a&<b>c')).toBe('a&amp;&lt;b&gt;c');
    expect(escapeAttr('a"b&<c>')).toBe('a&quot;b&amp;&lt;c&gt;');
  });
});

describe('cls / sty / attrs', () => {
  it('merges class lists from objects and arrays', () => {
    expect(cls({ a: true, b: false })).toBe('a');
    expect(cls(['a', 'b'])).toBe('a b');
  });

  it('serializes style objects to kebab-case', () => {
    expect(sty({ backgroundColor: 'red', '--x': '1' })).toContain('background-color:red');
  });

  it('skips false/null attrs and escapes values', () => {
    expect(attrs({ a: false, b: null, c: 'x"y' })).toBe(' c="x&quot;y"');
    expect(attrs({ disabled: true })).toBe(' disabled');
  });
});

describe('esc', () => {
  it('awaits promises, drops nulls, and rejects functions', async () => {
    await expect(esc(Promise.resolve('a<b'))).resolves.toBe('a&lt;b');
    await expect(esc(null)).resolves.toBe('');
    await expect(esc(() => 1)).rejects.toThrow(/PF4011/);
    await expect(esc(raw('<b>ok</b>'))).resolves.toBe('<b>ok</b>');
  });
});

describe('cache', () => {
  it('memoizes until resetCache and survives circular args', () => {
    resetCache();
    let n = 0;
    const f = cache((x: unknown) => (++n, x));
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    expect(f(circ)).toBe(circ);
    expect(f(circ)).toBe(circ);
    expect(n).toBe(2); // circular args bypass the cache instead of throwing
    resetCache();
    expect(f({ a: 1 })).toEqual({ a: 1 });
  });
});

describe('mergeHead', () => {
  it('deepest title wins and duplicates are dropped', () => {
    const html = mergeHead([
      { html: '<title>A</title>', depth: 1 },
      { html: '<title>B</title>', depth: 2 },
      { html: '<meta name="x" content="1">', depth: 1 },
      { html: '<meta name="x" content="1">', depth: 1 },
    ]);
    expect(html).toContain('<title>B</title>');
    expect(html).not.toContain('<title>A</title>');
    expect(html.match(/meta name="x"/g)).toHaveLength(1);
  });
});
