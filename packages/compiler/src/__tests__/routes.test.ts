import { describe, expect, it } from 'vitest';
import {
  parseSegment,
  toRegex,
  patternOf,
  match,
  buildUrl,
  normalizePath,
  scan,
} from '../routes';

describe('parseSegment', () => {
  it('parses static / dynamic / catch-all segments', () => {
    expect(parseSegment('about')).toEqual({ kind: 'static', value: 'about' });
    expect(parseSegment('[slug]')).toEqual({ kind: 'dynamic', value: 'slug' });
    expect(parseSegment('[...rest]')).toEqual({ kind: 'catchAll', value: 'rest' });
    expect(parseSegment('[[...all]]')).toEqual({ kind: 'optionalCatchAll', value: 'all' });
  });

  it('rejects invalid param names and unbalanced brackets', () => {
    expect(parseSegment('[$bad]')).toHaveProperty('error');
    expect(parseSegment('[a-b]')).toHaveProperty('error');
    expect(parseSegment('[oops')).toHaveProperty('error');
  });
});

describe('toRegex / match', () => {
  it('matches dynamic params with decoding', () => {
    const { source, params } = toRegex([
      { kind: 'static', value: 'blog' },
      { kind: 'dynamic', value: 'slug' },
    ]);
    expect(source).toBe('^\\/blog\\/([^/]+?)$');
    expect(params).toEqual(['slug']);
    const r = match(
      [
        {
          pattern: '/blog/[slug]',
          regexSource: source,
          regex: new RegExp(source),
          params,
          segments: [
            { kind: 'static', value: 'blog' },
            { kind: 'dynamic', value: 'slug' },
          ],
          file: 'src/blog/[slug]/page.deshi',
          layouts: [],
          priority: [0, 1],
          dynamic: true,
        },
      ],
      '/blog/hello%20world',
    );
    expect(r?.params).toEqual({ slug: 'hello world' });
  });

  it('splits catch-all params into arrays', () => {
    const { source, params } = toRegex([{ kind: 'catchAll', value: 'rest' }]);
    const routes = [
      {
        pattern: '/[...rest]',
        regexSource: source,
        regex: new RegExp(source),
        params,
        segments: [{ kind: 'catchAll' as const, value: 'rest' }],
        file: 'src/[...rest]/page.deshi',
        layouts: [],
        priority: [2],
        dynamic: true,
      },
    ];
    expect(match(routes, '/a/b/c')?.params).toEqual({ rest: ['a', 'b', 'c'] });
  });
});

describe('buildUrl', () => {
  it('encodes single segments and rejects slashes in dynamic params', () => {
    const route = {
      pattern: '/blog/[slug]',
      regexSource: '',
      regex: /^$/,
      params: ['slug'],
      segments: [
        { kind: 'static' as const, value: 'blog' },
        { kind: 'dynamic' as const, value: 'slug' },
      ],
      file: '',
      layouts: [],
      priority: [0, 1],
      dynamic: true,
    };
    expect(buildUrl(route, { slug: 'a b' })).toBe('/blog/a%20b');
    expect(() => buildUrl(route, { slug: 'a/b' })).toThrow(/single path segment/);
  });
});

describe('normalizePath', () => {
  it('strips query/hash, trailing slash, and index suffixes', () => {
    expect(normalizePath('/about/?x=1')).toBe('/about');
    expect(normalizePath('/about#team')).toBe('/about');
    expect(normalizePath('/about/index.html')).toBe('/about');
  });
});

describe('patternOf', () => {
  it('round-trips segments to a pattern', () => {
    expect(patternOf([])).toBe('/');
    expect(
      patternOf([
        { kind: 'static', value: 'blog' },
        { kind: 'dynamic', value: 'slug' },
      ]),
    ).toBe('/blog/[slug]');
  });
});

describe('scan', () => {
  it('flags duplicate params and mid-route catch-alls', () => {
    // Same relative-path rule as above: no `src/` prefix.
    const dup = scan(['[a]/[a]/page.deshi']);
    expect(dup.diagnostics.some((d) => d.message.includes('duplicate route param'))).toBe(true);
    const mid = scan(['[...rest]/about/page.deshi']);
    expect(mid.diagnostics.some((d) => d.message.includes('must be the last'))).toBe(true);
  });

  it('detects output conflicts and root layout', () => {
    // scan() takes paths *relative to the app dir* (see its docstring), so
    // the root layout is `layout.deshi`, not `src/layout.deshi`.
    const res = scan(['layout.deshi', 'page.deshi', 'about/page.deshi']);
    expect(res.rootLayout).toBe('layout.deshi');
    expect(res.routes.map((r) => r.pattern)).toContain('/about');
  });
});
