// @deshi/routes — file-system route scanning, route tree, matcher.
// The matcher is shared verbatim by the dev server, the build and the client router.
import type { Diagnostic } from './types';

export type SegmentKind = 'static' | 'dynamic' | 'catchAll' | 'optionalCatchAll';

export interface Segment {
  kind: SegmentKind;
  value: string; // static text or param name
}

export interface Route {
  pattern: string;
  regexSource: string;
  regex: RegExp;
  params: string[];
  segments: Segment[];
  file: string;
  layouts: string[];
  priority: number[];
  dynamic: boolean;
}

export interface ScanResult {
  routes: Route[];
  rootLayout: string | null;
  notFound: string | null;
  diagnostics: Diagnostic[];
  ignored: string[];
}

const KIND_PRIORITY: Record<SegmentKind, number> = { static: 0, dynamic: 1, catchAll: 2, optionalCatchAll: 3 };
const VALID_NAME = /^[A-Za-z_$][\w$-]*$/;

function d(code: string, message: string, file: string, severity: 'error' | 'warning' = 'error'): Diagnostic {
  return { code, message, file, line: 1, column: 1, frame: '', severity };
}

export function parseSegment(seg: string): Segment | { error: string } {
  if (seg.startsWith('[[...') && seg.endsWith(']]')) {
    const name = seg.slice(5, -2);
    return VALID_NAME.test(name) ? { kind: 'optionalCatchAll', value: name } : { error: `Invalid optional catch-all segment "${seg}"` };
  }
  if (seg.startsWith('[...') && seg.endsWith(']')) {
    const name = seg.slice(4, -1);
    return VALID_NAME.test(name) ? { kind: 'catchAll', value: name } : { error: `Invalid catch-all segment "${seg}"` };
  }
  if (seg.startsWith('[') && seg.endsWith(']')) {
    const name = seg.slice(1, -1);
    return VALID_NAME.test(name) ? { kind: 'dynamic', value: name } : { error: `Invalid dynamic segment "${seg}"` };
  }
  if (seg.includes('[') || seg.includes(']')) return { error: `Invalid segment "${seg}" — unbalanced brackets` };
  return { kind: 'static', value: seg };
}

export function isGroup(seg: string): boolean {
  return seg.startsWith('(') && seg.endsWith(')');
}
export function isPrivate(seg: string): boolean {
  return seg.startsWith('_');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function toRegex(segments: Segment[]): { source: string; params: string[] } {
  if (!segments.length) return { source: '^\\/$', params: [] };
  const params: string[] = [];
  let src = '^';
  for (const s of segments) {
    switch (s.kind) {
      case 'static':
        src += '\\/' + escapeRe(s.value);
        break;
      case 'dynamic':
        src += '\\/([^/]+?)';
        params.push(s.value);
        break;
      case 'catchAll':
        src += '\\/(.+?)';
        params.push(s.value);
        break;
      case 'optionalCatchAll':
        src += '(?:\\/(.+?))?';
        params.push(s.value);
        break;
    }
  }
  return { source: src + '$', params };
}

export function patternOf(segments: Segment[]): string {
  if (!segments.length) return '/';
  return (
    '/' +
    segments
      .map((s) =>
        s.kind === 'static' ? s.value
        : s.kind === 'dynamic' ? `[${s.value}]`
        : s.kind === 'catchAll' ? `[...${s.value}]`
        : `[[...${s.value}]]`,
      )
      .join('/')
  );
}

function comparePriority(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Scan a list of files relative to the app dir (e.g. "blog/[slug]/page.html").
 */
export function scan(files: string[]): ScanResult {
  const set = new Set(files.map((f) => f.replace(/^\.?\//, '')));
  const diagnostics: Diagnostic[] = [];
  const ignored: string[] = [];
  const routes: Route[] = [];
  const byPattern = new Map<string, string>();

  const PAGE_INDEX = /^(page|index)\.(deshi|html|md)$/;
  const RESERVED_FILE = /^(layout|template|not-found)\.(deshi|html|md)$/;
  const hasLayout = (dir: string) => {
    for (const ext of ['deshi', 'html']) {
      const p = dir ? `${dir}/layout.${ext}` : `layout.${ext}`;
      if (set.has(p)) return p;
      const t = dir ? `${dir}/template.${ext}` : `template.${ext}`;
      if (set.has(t)) return t;
    }
    return null;
  };
  const rootLayout = hasLayout('');
  if (!rootLayout) diagnostics.push(d('PF2001', 'Missing root layout: layout.deshi is required', 'layout.deshi'));
  const notFound = set.has('not-found.deshi')
    ? 'not-found.deshi'
    : set.has('not-found.html')
      ? 'not-found.html'
      : set.has('not-found.md')
        ? 'not-found.md'
        : null;

  const isRoutePage = (base: string): boolean => {
    if (PAGE_INDEX.test(base)) return true;
    if (RESERVED_FILE.test(base)) return false;
    if (/\.(md|html)$/.test(base)) return true;
    if (base.endsWith('.deshi') && !/^[A-Z]/.test(base)) return true;
    return false;
  };

  for (const file of [...set].sort()) {
    const parts = file.split('/');
    const base = parts[parts.length - 1];
    const dirs = parts.slice(0, -1);
    if (dirs.some(isPrivate) || dirs[0] === 'components' || dirs[0] === 'lib' || dirs[0] === 'data') continue;
    if (base === 'default.deshi' || base === 'default.html' || base === 'default.md') {
      diagnostics.push(d('PF2010', `${file}: parallel routes (${base}) are not supported`, file));
      continue;
    }
    if (['loading.deshi', 'loading.html', 'loading.md', 'error.deshi', 'error.html', 'error.md', 'route.js', 'route.ts', 'middleware.js', 'middleware.ts'].includes(base)) {
      diagnostics.push(d('PF2011', `${file}: "${base}" has no meaning in a static site and is ignored`, file, 'warning'));
      ignored.push(file);
      continue;
    }
    if (!isRoutePage(base)) continue;

    const segments: Segment[] = [];
    let bad = false;
    for (const dir of dirs) {
      if (isGroup(dir)) continue;
      const seg = parseSegment(dir);
      if ('error' in seg) {
        diagnostics.push(d('PF2005', `${file}: ${seg.error}`, file));
        bad = true;
        break;
      }
      segments.push(seg);
    }
    if (!PAGE_INDEX.test(base)) {
      const stem = base.replace(/\.(deshi|html|md)$/, '');
      const leaf = parseSegment(stem);
      if ('error' in leaf) {
        diagnostics.push(d('PF2005', `${file}: ${leaf.error}`, file));
        continue;
      }
      segments.push(leaf);
    }
    if (bad) continue;
    const catchIdx = segments.findIndex((s) => s.kind === 'catchAll' || s.kind === 'optionalCatchAll');
    if (catchIdx !== -1 && catchIdx !== segments.length - 1) {
      diagnostics.push(d('PF2005', `${file}: catch-all segments must be the last segment`, file));
      continue;
    }

    const pattern = patternOf(segments);
    const other = byPattern.get(pattern);
    if (other) {
      diagnostics.push(d('PF2004', `Output path conflict: "${other}" and "${file}" both resolve to ${pattern}`, file));
      continue;
    }
    byPattern.set(pattern, file);

    const layouts: string[] = [];
    for (let i = 0; i <= dirs.length; i++) {
      const l = hasLayout(dirs.slice(0, i).join('/'));
      if (l) layouts.push(l);
    }
    const { source, params } = toRegex(segments);
    routes.push({
      pattern,
      regexSource: source,
      regex: new RegExp(source),
      params,
      segments,
      file,
      layouts,
      priority: segments.map((s) => KIND_PRIORITY[s.kind]),
      dynamic: segments.some((s) => s.kind !== 'static'),
    });
  }

  routes.sort((a, b) => comparePriority(a.priority, b.priority) || a.pattern.localeCompare(b.pattern));
  return { routes, rootLayout, notFound, diagnostics, ignored };
}

export type TrailingSlash = 'never' | 'always' | 'ignore';

export function normalizePath(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURI(p);
  } catch {
    /* keep as-is */
  }
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p.endsWith('/index.html')) p = p.slice(0, -'/index.html'.length) || '/';
  if (p.endsWith('/page.html')) p = p.slice(0, -'/page.html'.length) || '/';
  return p || '/';
}

export interface Match {
  route: Route;
  params: Record<string, string | string[]>;
}

export function match(routes: Route[], pathname: string): Match | null {
  const p = normalizePath(pathname);
  for (const r of routes) {
    const m = r.regex.exec(p);
    if (!m) continue;
    const params: Record<string, string | string[]> = {};
    r.params.forEach((name, i) => {
      const raw = m[i + 1];
      const seg = r.segments.find((s) => s.value === name && s.kind !== 'static');
      if (seg?.kind === 'catchAll' || seg?.kind === 'optionalCatchAll') {
        params[name] = raw === undefined ? [] : raw.split('/').map(safeDecode);
      } else {
        params[name] = safeDecode(raw);
      }
    });
    return { route: r, params };
  }
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Build the URL for a set of params (used by the build to enumerate files). */
export function buildUrl(route: Route, params: Record<string, string | string[]>): string {
  const parts: string[] = [];
  for (const s of route.segments) {
    if (s.kind === 'static') parts.push(s.value);
    else {
      const v = params[s.value];
      if (s.kind === 'dynamic') parts.push(encodeURIComponent(String(v)));
      else {
        const arr = Array.isArray(v) ? v : v == null ? [] : [String(v)];
        if (!arr.length && s.kind === 'catchAll') throw new Error(`Catch-all "${s.value}" needs at least one segment`);
        parts.push(...arr.map((x) => encodeURIComponent(x)));
      }
    }
  }
  return '/' + parts.join('/');
}

export function outputFile(url: string, mode: 'page' | 'index'): string {
  const name = mode === 'page' ? 'page.html' : 'index.html';
  const p = url.replace(/^\/+|\/+$/g, '');
  return p ? `${p}/${name}` : name;
}

/** Compiled table shipped to the optional client router. */
export function compileTable(routes: Route[], chunks: Record<string, string[]>): Array<[string, string[], string, string[]]> {
  return routes.map((r) => [r.regexSource, r.params, r.pattern, chunks[r.pattern] ?? []]);
}
