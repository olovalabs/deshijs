import { describe, expect, it } from 'vitest';
import { parseBraceExpression, makeExpression, isComponentName } from '../expression';
import type { TemplateContext } from '../expression';

const ctx = (source: string): TemplateContext => ({
  file: 'src/page.deshi',
  source,
  components: new Set(['Card']),
  scoped: false,
  usedComponents: new Set(),
  usedSlots: new Set(),
});

describe('parseBraceExpression', () => {
  it('parses an expression and finds its closing brace', () => {
    const src = '{a + b} tail';
    const { ast, close } = parseBraceExpression(src, 0, 'src/page.deshi');
    expect(ast.type).toBe('BinaryExpression');
    expect(src[close]).toBe('}');
  });

  it('reports unterminated expressions as PF1003', () => {
    expect(() => parseBraceExpression('{a + ', 0, 'src/page.deshi')).toThrow(/PF1003/);
  });
});

describe('makeExpression', () => {
  it('captures raw source and converts JSX to template nodes', () => {
    const src = '{items.map((x) => <span>{x}</span>)}';
    const { ast } = parseBraceExpression(src, 0, 'src/page.deshi');
    const expr = makeExpression(ast, ctx(src));
    expect(expr.raw).toContain('items.map');
    expect(expr.jsx.length).toBeGreaterThan(0);
  });
});

describe('isComponentName', () => {
  it('treats uppercase-first names as components, never hyphenated elements', () => {
    expect(isComponentName('Card')).toBe(true);
    expect(isComponentName('div')).toBe(false);
    expect(isComponentName('my-widget')).toBe(false);
    expect(isComponentName('')).toBe(false);
  });
});
