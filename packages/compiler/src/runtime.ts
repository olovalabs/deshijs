// deshi/runtime — helpers imported by every compiled render module.
// These run at build time (Node) — never in the browser of a Deshi site.
import { parseFragment, serializeOuter, type DefaultTreeAdapterTypes as P5 } from 'parse5';
import { AsyncLocalStorage } from 'node:async_hooks';
import { islandInlineScript, type IslandStrategy } from './islands';
import { splitFilename } from './filetype';
import { DESHI_VERSION } from './types';

export class Raw {
  constructor(public html: string) {}
  toString(): string {
    return this.html;
  }
}

export const raw = (s: unknown): Raw => new Raw(s == null ? '' : String(s));

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape an interpolated value for text position. Raw / arrays / promises aware. */
export async function esc(v: unknown): Promise<string> {
  v = await v;
  if (v == null || typeof v === 'boolean') return '';
  if (v instanceof Raw) return v.html;
  if (Array.isArray(v)) return (await Promise.all(v.map(esc))).join('');
  if (typeof v === 'function') {
    throw new Error('PF4011: A function was interpolated into the template. Call it, or interpolate its result.');
  }
  return escapeHtml(String(v));
}

/** set:html — unescaped inner HTML. */
export async function unsafe(v: unknown): Promise<string> {
  v = await v;
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.html;
  return String(v);
}

export function cls(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(cls).filter(Boolean).join(' ');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, on]) => !!on)
      .map(([k]) => k)
      .join(' ');
  }
  return String(v);
}

const kebab = (k: string) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));

/**
 * Render a style value. Accepts a string, an object, or an array of either —
 * arrays are how `style` + `define:vars` (and repeated `style` attributes) are
 * merged into one declaration list.
 */
export function sty(v: unknown): string {
  if (v == null || v === false || v === '') return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v
      .map(sty)
      .filter(Boolean)
      .join(';');
  }
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val != null && val !== false && val !== '')
      .map(([k, val]) => `${kebab(k)}:${String(val)}`)
      .join(';');
  }
  return String(v);
}

export function attrs(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, raw] of Object.entries(obj)) {
    let v = raw;
    if (k === 'class') v = cls(v) || false;
    else if (k === 'style') v = sty(v) || false;
    if (v === false || v == null) continue;
    if (v === true) {
      parts.push(' ' + k);
      continue;
    }
    parts.push(` ${k}="${escapeAttr(String(v))}"`);
  }
  return parts.join('');
}

// ─── render context ────────────────────────────────────────────────────────────

export interface HeadEntry {
  html: string;
  depth: number;
  tail?: boolean;
}

export interface RenderCtx {
  params: Record<string, string | string[]>;
  url: URL;
  route: { pattern: string; file: string };
  env: Record<string, string>;
  head: HeadEntry[];
  css: Set<string>;
  clients: Set<string>;
  used: Set<string>;
  depth: number;
  maxDepth?: number;
  segments: boolean;
  islands: number;
  /** modulepreload hrefs for client:load islands only */
  preloads: Set<string>;
}

export interface Bindings {
  props: Record<string, unknown>;
  slots: Record<string, true>;
  params: Record<string, string | string[]>;
  url: URL;
  route: { pattern: string; file: string };
  env: Record<string, string>;
  setContext: <T = unknown>(key: unknown, value: T) => void;
  getContext: <T = unknown>(key: unknown, fallback?: T) => T | undefined;
  hasContext: (key: unknown) => boolean;
  Deshi: {
    props: Record<string, unknown>;
    params: Record<string, string | string[]>;
    url: URL;
    request: { url: string; headers: Headers };
    site?: URL;
    generator: string;
    slots: Record<string, true>;
    setContext: <T = unknown>(key: unknown, value: T) => void;
    getContext: <T = unknown>(key: unknown, fallback?: T) => T | undefined;
    hasContext: (key: unknown) => boolean;
  };
  Astro: {
    props: Record<string, unknown>;
    params: Record<string, string | string[]>;
    url: URL;
    request: { url: string; headers: Headers };
    site?: URL;
    generator: string;
    slots: Record<string, true>;
    setContext: <T = unknown>(key: unknown, value: T) => void;
    getContext: <T = unknown>(key: unknown, fallback?: T) => T | undefined;
    hasContext: (key: unknown) => boolean;
  };
}

export type SlotFns = Record<string, () => Promise<string>>;

export interface RenderModule {
  (
    bindings: Bindings,
    slotFns: SlotFns,
    ctx: RenderCtx,
    clientProps?: string,
    island?: { id: string },
  ): Promise<string>;
  __deshi: ComponentMeta;
}

export interface ComponentMeta {
  file: string;
  hash: string;
  slots: string[];
  deps: string[];
  css: boolean;
  client: boolean;
  isLayout: boolean;
  isDocument: boolean;
}

const contextStorage = new AsyncLocalStorage<Map<unknown, unknown>>();

/**
 * Set a context value for the current component subtree (React/Svelte-style).
 * Any child or descendant component, or slot rendered inside this subtree, can read it via `getContext()`.
 */
export function setContext<T = unknown>(key: unknown, value: T): void {
  const store = contextStorage.getStore();
  if (store) {
    store.set(key, value);
  }
}

/**
 * Retrieve a context value set by an ancestor component.
 */
export function getContext<T = unknown>(key: unknown, fallback?: T): T | undefined {
  const store = contextStorage.getStore();
  if (!store || !store.has(key)) return fallback;
  return store.get(key) as T;
}

/**
 * Check whether a context key has been set in the current component subtree.
 */
export function hasContext(key: unknown): boolean {
  const store = contextStorage.getStore();
  return !!store && store.has(key);
}

/**
 * Run a render callback within an isolated context store.
 */
export function runWithContext<R>(store: Map<unknown, unknown>, fn: () => R): R {
  return contextStorage.run(store, fn);
}

export function bindings(ctx: RenderCtx, props: Record<string, unknown>, slotFns: SlotFns): Bindings {
  const slots: Record<string, true> = {};
  for (const k of Object.keys(slotFns)) slots[k] = true;
  const Astro = {
    props,
    params: ctx.params,
    url: ctx.url,
    request: { url: ctx.url.href, headers: new Headers() },
    site: ctx.url ? new URL(ctx.url.origin) : undefined,
    generator: 'Deshi ' + DESHI_VERSION,
    slots,
    setContext,
    getContext,
    hasContext,
  };
  const Deshi = Astro;
  return {
    props,
    slots,
    params: ctx.params,
    url: ctx.url,
    route: ctx.route,
    env: ctx.env,
    setContext,
    getContext,
    hasContext,
    Deshi,
    Astro,
  } as Bindings;
}

export async function slot(fns: SlotFns, name: string, fallback?: () => Promise<string>): Promise<string> {
  const fn = fns[name];
  if (fn) return await fn();
  if (fallback) return await fallback();
  return '';
}

const ISLAND_STRATEGIES = new Set(['load', 'visible', 'idle', 'click', 'media', 'only']);

function componentBaseName(file: string): string {
  return splitFilename(file).stem;
}

export async function renderComponent(
  Comp: RenderModule,
  props: Record<string, unknown>,
  slotFns: SlotFns,
  ctx: RenderCtx,
  clientProps?: unknown,
  strategy?: IslandStrategy | string,
  media?: string,
  only?: string,
): Promise<string> {
  const meta = Comp.__deshi;
  if (!meta) throw new Error('renderComponent: not a compiled Deshi component');
  const maxDepth = ctx.maxDepth ?? 500;
  if (ctx.depth > maxDepth) {
    throw new Error(`PF4002: Component nesting deeper than ${maxDepth} (${meta.file})`);
  }
  if (meta.css) ctx.css.add(meta.hash);
  ctx.used.add(meta.file);
  const island = !!strategy && ISLAND_STRATEGIES.has(strategy);
  // client:only without <script client> is allowed — it's client-only, skip SSR check
  const isOnly = strategy === 'only';
  if (island && !isOnly) {
    if (!meta.client) {
      throw new Error(
        `PF4026: client:${strategy} on ${meta.file} but the component has no <script client> block`,
      );
    }
    ctx.clients.add(meta.hash);
    ctx.islands++;
  } else if (isOnly) {
    ctx.islands++;
  }
  ctx.depth++;
  try {
    let cp: string | undefined;
    if (island) {
      try {
        cp = JSON.stringify(clientProps === undefined ? {} : clientProps);
      } catch {
        throw new Error('PF4026: client:props must be JSON-serializable');
      }
    }
    // The island id is decided here and stamped by the compiled module, so the
    // rendered HTML is never re-parsed to attach it.
    const marker = island || isOnly ? { id: `d-${meta.hash}-${ctx.islands}` } : undefined;
    const parentStore = contextStorage.getStore();
    const componentStore = new Map<unknown, unknown>(parentStore);
    const html = await contextStorage.run(componentStore, () =>
      Comp(bindings(ctx, props, slotFns), slotFns, ctx, cp, marker)
    );
    if (!marker) return html;
    const name = componentBaseName(meta.file);
    const src = `/_deshi/c/${name}.${meta.hash}.js`;
    if (strategy === 'load' || strategy === 'only') ctx.preloads.add(src);
    const nid = marker.id;
    if (isOnly && !html.trim()) {
      return `<div id="${escapeAttr(nid)}" style="display:contents" data-deshi-c="${escapeAttr(meta.hash)}" data-deshi-props="${escapeAttr(cp ?? '{}')}"></div>` + islandInlineScript(nid, src, strategy as IslandStrategy, media);
    }
    return html + islandInlineScript(nid, src, strategy as IslandStrategy, media);
  } finally {
    ctx.depth--;
  }
}

export function headPush(ctx: RenderCtx, html: string, tail = false): void {
  ctx.head.push({ html, depth: ctx.depth, tail });
}

// ─── head merging ──────────────────────────────────────────────────────────────

function headKey(el: P5.Element): string | null {
  const attr = (n: string) => el.attrs.find((a) => a.name === n)?.value;
  switch (el.nodeName) {
    case 'title':
      return 'title';
    case 'meta':
      if (attr('charset') !== undefined) return 'meta:charset';
      if (attr('name')) return `meta:name:${attr('name')}`;
      if (attr('property')) return `meta:property:${attr('property')}`;
      if (attr('http-equiv')) return `meta:http-equiv:${attr('http-equiv')}`;
      return null;
    case 'link':
      return attr('rel') === 'canonical' ? 'link:canonical' : null;
    default:
      return null;
  }
}

/** Deepest wins for keyed nodes; everything else appended in tree order, deduped. */
export function mergeHead(entries: HeadEntry[]): string {
  interface Item { key: string | null; html: string; depth: number; tail: boolean }
  const items: Item[] = [];
  const keyed = new Map<string, Item>();
  const seen = new Set<string>();
  const ordered = [...entries.filter((e) => !e.tail), ...entries.filter((e) => e.tail)];
  for (const entry of ordered) {
    const frag = parseFragment(entry.html);
    for (const n of frag.childNodes) {
      if (n.nodeName === '#text') continue;
      const html = serializeOuter(n);
      if (n.nodeName === '#comment') {
        items.push({ key: null, html, depth: entry.depth, tail: !!entry.tail });
        continue;
      }
      const key = headKey(n as P5.Element);
      if (key) {
        const existing = keyed.get(key);
        if (existing) {
          if (entry.depth >= existing.depth) existing.html = html;
          continue;
        }
        const item: Item = { key, html, depth: entry.depth, tail: !!entry.tail };
        keyed.set(key, item);
        items.push(item);
      } else {
        if (seen.has(html)) continue;
        seen.add(html);
        items.push({ key: null, html, depth: entry.depth, tail: !!entry.tail });
      }
    }
  }
  return items.map((i) => i.html).join('');
}

// ─── cache() ───────────────────────────────────────────────────────────────────

let cacheEpoch = 0;
export function resetCache(): void {
  cacheEpoch++;
}

/** Memoize a data function for the duration of one build (or one dev request). */
export function cache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let epoch = -1;
  const store = new Map<string, R>();
  return (...args: A) => {
    if (epoch !== cacheEpoch) {
      store.clear();
      epoch = cacheEpoch;
    }
    // JSON.stringify throws on circular args and collides on `undefined` vs
    // missing — fall back to a non-cached call instead of crashing the build.
    let key: string;
    try {
      key = JSON.stringify(args) ?? 'null';
    } catch {
      return fn(...args);
    }
    if (store.has(key)) return store.get(key) as R;
    const v = fn(...args);
    store.set(key, v);
    return v;
  };
}

export const runtime = {
  esc,
  unsafe,
  attrs,
  cls,
  sty,
  raw,
  Raw,
  slot,
  renderComponent,
  headPush,
  cache,
  setContext,
  getContext,
  hasContext,
  runWithContext,
};
export type Runtime = typeof runtime;
