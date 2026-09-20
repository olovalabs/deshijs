// deshi routes — file-system route scanning, route tree, matcher.
// The matcher is shared verbatim by the dev server, the build and the client router.
import type { Diagnostic } from './types';
import { LAYOUT_EXTENSIONS, isCodeExt, isPageStem, isReservedStem, isRouteFile, isSourceExt, splitFilename } from './filetype';

export type SegmentKind = 'static' | 'dynamic' | 'catchAll' | 'optionalCatchAll';

export interface Segment {
  kind: SegmentKind;
  value: string; // static text or param name
}

export interface Route {
  pattern: string;
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
// Route param names must be valid JS identifiers — they become `params.<name>` bindings.
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export function paramNames(segments: Segment[]): string[] {
  return segments.filter((s) => s.kind !== 'static').map((s) => s.value);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function splitPath(pathname: string): string[] {
  const p = normalizePath(pathname);
  return p === '/' ? [] : p.slice(1).split('/');
}

/**
 * Structural route matcher — walks pathname segments against a route's segments.
 * No per-route RegExp: static equality, dynamic = one segment, catch-all = one or
 * more, optional catch-all = zero or more. Returns decoded params or null.
 */
export function matchSegments(segments: Segment[], pathname: string): Record<string, string | string[]> | null {
  const parts = splitPath(pathname);
  const params: Record<string, string | string[]> = {};
  let i = 0;
  for (const seg of segments) {
    if (seg.kind === 'static') {
      if (parts[i] !== seg.value) return null;
      i++;
      continue;
    }
    if (seg.kind === 'dynamic') {
      if (i >= parts.length) return null;
      params[seg.value] = safeDecode(parts[i]);
      i++;
      continue;
    }
    if (seg.kind === 'catchAll') {
      if (i >= parts.length) return null;
      params[seg.value] = parts.slice(i).map(safeDecode);
      i = parts.length;
      continue;
    }
    // optionalCatchAll — matches the rest, or nothing at all
    params[seg.value] = i < parts.length ? parts.slice(i).map(safeDecode) : [];
    i = parts.length;
  }
  return i === parts.length ? params : null;
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

/** Drop a leading `./` or `/` — structural, no regex. */
function stripLeadingDotSlash(p: string): string {
  let s = p;
  if (s.startsWith('./')) s = s.slice(2);
  while (s.startsWith('/')) s = s.slice(1);
  return s;
}

/** Drop leading and trailing `/`. */
function trimSlashes(p: string): string {
  let s = p;
  while (s.startsWith('/')) s = s.slice(1);
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/**
 * Scan a list of files relative to the app dir (e.g. "blog/[slug]/page.html").
 */
export function scan(files: string[]): ScanResult {
  const set = new Set(files.map((f) => stripLeadingDotSlash(f)));
  const diagnostics: Diagnostic[] = [];
  const ignored: string[] = [];
  const routes: Route[] = [];
  const byPattern = new Map<string, string>();

  const hasLayout = (dir: string) => {
    for (const ext of LAYOUT_EXTENSIONS) {
      const p = dir ? `${dir}/layout.${ext}` : `layout.${ext}`;
      if (set.has(p)) return p;
      const t = dir ? `${dir}/template.${ext}` : `template.${ext}`;
      if (set.has(t)) return t;
    }
    return null;
  };
  const rootLayout = hasLayout('');
  if (!rootLayout) diagnostics.push(d('PF2001', 'Missing root layout: layout.deshi is required', 'layout.deshi'));
  const notFound =
    ['not-found.deshi', 'not-found.html', 'not-found.md', 'not-found.mdx'].find((p) => set.has(p)) ?? null;

  for (const file of [...set].sort()) {
    const parts = file.split('/');
    const base = parts[parts.length - 1];
    const dirs = parts.slice(0, -1);
    if (dirs.some(isPrivate) || dirs[0] === 'components' || dirs[0] === 'lib' || dirs[0] === 'data') continue;
    const { stem, ext } = splitFilename(base);
    if (isReservedStem(stem) && isSourceExt(ext)) continue;
    if (stem === 'default' && isSourceExt(ext)) {
      diagnostics.push(d('PF2010', `${file}: parallel routes (${base}) are not supported`, file));
      continue;
    }
    if ((stem === 'loading' || stem === 'error') && isSourceExt(ext)) {
      diagnostics.push(d('PF2011', `${file}: "${base}" has no meaning in a static site and is ignored`, file, 'warning'));
      ignored.push(file);
      continue;
    }
    if ((stem === 'route' || stem === 'middleware') && isCodeExt(ext)) {
      diagnostics.push(d('PF2011', `${file}: "${base}" has no meaning in a static site and is ignored`, file, 'warning'));
      ignored.push(file);
      continue;
    }
    if (!isRouteFile(base)) continue;

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
    if (!isPageStem(stem)) {
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
    // Duplicate param names would silently overwrite each other in `params`.
    const seenParams = new Set<string>();
    const dup = segments.find((s) => s.kind !== 'static' && (seenParams.has(s.value) || (seenParams.add(s.value), false)));
    if (dup) {
      diagnostics.push(d('PF2005', `${file}: duplicate route param "${(dup as Segment).value}"`, file));
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
    const params = paramNames(segments);
    routes.push({
      pattern,
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
  // Strip query + hash defensively — callers pass pathnames, but a full URL
  // must never produce a distinct cache key / missed route.
  const cut = firstIndex(p, '?', '#');
  if (cut !== -1) p = p.slice(0, cut);
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p.endsWith('/index.html')) p = p.slice(0, -'/index.html'.length) || '/';
  if (p.endsWith('/page.html')) p = p.slice(0, -'/page.html'.length) || '/';
  return p || '/';
}

/** Index of the first of the given single chars, or -1. */
function firstIndex(s: string, ...chars: string[]): number {
  let best = -1;
  for (const c of chars) {
    const i = s.indexOf(c);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

export interface Match {
  route: Route;
  params: Record<string, string | string[]>;
}

export function match(routes: Route[], pathname: string): Match | null {
  for (const r of routes) {
    const params = matchSegments(r.segments, pathname);
    if (params) return { route: r, params };
  }
  return null;
}

/** Build the URL for a set of params (used by the build to enumerate files). */
export function buildUrl(route: Route, params: Record<string, string | string[]>): string {
  const parts: string[] = [];
  for (const s of route.segments) {
    if (s.kind === 'static') parts.push(s.value);
    else {
      const v = params[s.value];
      if (s.kind === 'dynamic') {
        if (v == null || (Array.isArray(v) ? v.length !== 1 : String(v).includes('/'))) {
          throw new Error(`Param "${s.value}" must be a single path segment`);
        }
        parts.push(encodeURIComponent(String(Array.isArray(v) ? v[0] : v)));
      } else {
        const arr = Array.isArray(v) ? v : v == null ? [] : [String(v)];
        if (!arr.length && s.kind === 'catchAll') throw new Error(`Catch-all "${s.value}" needs at least one segment`);
        parts.push(...arr.flatMap((x) => String(x).split('/')).map((x) => encodeURIComponent(x)));
      }
    }
  }
  return '/' + parts.join('/');
}

export function outputFile(url: string, mode: 'page' | 'index'): string {
  const name = mode === 'page' ? 'page.html' : 'index.html';
  const p = trimSlashes(url);
  return p ? `${p}/${name}` : name;
}

/** Compiled table shipped to the optional client router (segments, not regexes). */
export function compileTable(routes: Route[], chunks: Record<string, string[]>): Array<[Segment[], string[], string, string[]]> {
  return routes.map((r) => [r.segments, r.params, r.pattern, chunks[r.pattern] ?? []]);
}
