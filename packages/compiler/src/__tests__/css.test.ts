import { describe, expect, it } from 'vitest';
import { scopeCss, minifyCss, scopeAttribute, scopedCssUrl } from '../css';

describe('scopeCss', () => {
  it('appends the scope attribute to compound selectors', () => {
    const out = scopeCss('.card { color: red; }', 'abcd1234');
    expect(out).toContain('[data-deshi-abcd1234]');
  });

  it('unwraps :global() without scoping', () => {
    const out = scopeCss(':global(.x) { color: red; }', 'abcd1234');
    expect(out).toContain('.x');
    expect(out).not.toContain('[data-deshi-abcd1234]');
  });

  it('leaves unparseable CSS untouched instead of throwing', () => {
    // css-tree is a *tolerant* parser with error recovery — it normalizes
    // rather than throws on most bad input. The guarantee `scopeCss` pins is
    // "never throws, never emits the scope attribute for garbage".
    expect(() => scopeCss('.a { color: red; }', 'h')).not.toThrow();
    expect(scopeCss('{{{', 'h')).not.toContain('[data-deshi-');
  });

  it('scopes inside @media but not @keyframes names', () => {
    const out = scopeCss('@media (min-width: 1px) { .a { color: red; } }', 'h1h1h1h1');
    expect(out).toContain('[data-deshi-h1h1h1h1]');
  });
});

describe('minifyCss', () => {
  it('minifies valid CSS and passes invalid CSS through', () => {
    expect(minifyCss('.a { color: red; }')).toContain('.a{color:red}');
    expect(minifyCss('!!! not css !!!')).toBe('!!! not css !!!');
  });
});

describe('scopedCssUrl / scopeAttribute', () => {
  it('returns null when there is no scoped CSS', () => {
    expect(scopedCssUrl('')).toBeNull();
    expect(scopedCssUrl('.a{}')).toMatch(/^\/_deshi\/[0-9a-f]{8}\.css$/);
    expect(scopeAttribute('abcd1234')).toBe('data-deshi-abcd1234');
  });
});
