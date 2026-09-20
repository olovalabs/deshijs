import { describe, expect, it } from 'vitest';
import {
  parseSegment,
  paramNames,
  patternOf,
  matchSegments,
  match,
  buildUrl,
  normalizePath,
  scan,
  type Route,
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

describe('matchSegments (structural matcher)', () => {
  it('matches a static route and rejects a mismatch', () => {
    const segs = [{ kind: 'static' as const, value: 'about' }];
    expect(matchSegments(segs, '/about')).toEqual({});
    expect(matchSegments(segs, '/aboutx')).toBeNull();
  });

  it('matches dynamic params with decoding', () => {
    const segs = [
      { kind: 'static' as const, value: 'blog' },
      { kind: 'dynamic' as const, value: 'slug' },
    ];
    expect(matchSegments(segs, '/blog/hello%20world')).toEqual({ slug: 'hello world' });
    expect(matchSegments(segs, '/blog')).toBeNull();
    expect(matchSegments(segs, '/blog/a/b')).toBeNull();
  });

  it('splits catch-all params into arrays', () => {
    const segs = [{ kind: 'catchAll' as const, value: 'rest' }];
    expect(matchSegments(segs, '/a/b/c')).toEqual({ rest: ['a', 'b', 'c'] });
    expect(matchSegments(segs, '/')).toBeNull();
  });

  it('optional catch-all matches zero or more segments', () => {
    const segs = [{ kind: 'static' as const, value: 'shop' }, { kind: 'optionalCatchAll' as const, value: 'all' }];
    expect(matchSegments(segs, '/shop')).toEqual({ all: [] });
    expect(matchSegments(segs, '/shop/a/b')).toEqual({ all: ['a', 'b'] });
    expect(matchSegments(segs, '/other')).toBeNull();
  });
});

describe('match', () => {
  it('returns the first matching route in priority order', () => {
    const routes: Route[] = [
      {
        pattern: '/blog/new',
        params: [],
        segments: [
          { kind: 'static', value: 'blog' },
          { kind: 'static', value: 'new' },
        ],
        file: 'src/blog/new/page.deshi',
        layouts: [],
        priority: [0, 0],
        dynamic: false,
      },
      {
        pattern: '/blog/[slug]',
        params: ['slug'],
        segments: [
          { kind: 'static', value: 'blog' },
          { kind: 'dynamic', value: 'slug' },
        ],
        file: 'src/blog/[slug]/page.deshi',
        layouts: [],
        priority: [0, 1],
        dynamic: true,
      },
    ];
    expect(match(routes, '/blog/new')?.route.pattern).toBe('/blog/new');
    expect(match(routes, '/blog/other')?.params).toEqual({ slug: 'other' });
  });
});

describe('paramNames', () => {
  it('lists non-static segment values', () => {
    expect(
      paramNames([
        { kind: 'static', value: 'a' },
        { kind: 'dynamic', value: 'slug' },
        { kind: 'catchAll', value: 'rest' },
      ]),
    ).toEqual(['slug', 'rest']);
  });
});

describe('buildUrl', () => {
  const route: Route = {
    pattern: '/blog/[slug]',
    params: ['slug'],
    segments: [
      { kind: 'static', value: 'blog' },
      { kind: 'dynamic', value: 'slug' },
    ],
    file: '',
    layouts: [],
    priority: [0, 1],
    dynamic: true,
  };

  it('encodes single segments and rejects slashes in dynamic params', () => {
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

  it('routes .mdx files like .md and .deshi', () => {
    const res = scan([
      'layout.deshi',
      'page.mdx',
      'guide/page.mdx',
      'guide/getting-started.mdx',
      'guide/[slug]/page.mdx',
      'not-found.mdx',
    ]);
    const patterns = res.routes.map((r) => r.pattern);
    expect(patterns).toContain('/');
    expect(patterns).toContain('/guide');
    expect(patterns).toContain('/guide/getting-started');
    expect(patterns).toContain('/guide/[slug]');
    expect(res.routes.find((r) => r.pattern === '/guide/[slug]')?.dynamic).toBe(true);
    expect(res.notFound).toBe('not-found.mdx');
  });
});
