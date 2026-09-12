// @deshi/compiler/runtime — helpers imported by every compiled render module.
// These run at build time (Node) — never in the browser of a Deshi site.
import { parseFragment, serializeOuter, type DefaultTreeAdapterTypes as P5 } from 'parse5';

export class Raw {
  constructor(public html: string) {}
  toString(): string {
    return this.html;
  }
}

export const raw = (s: unknown): Raw => new Raw(s == null ? '' : String(s));

export function escapeHtml(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c;
  }
  return out;
}

export function escapeAttr(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c;
  }
  return out;
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

export function sty(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val != null && val !== false && val !== '')
      .map(([k, val]) => `${kebab(k)}:${String(val)}`)
      .join(';');
  }
  return String(v);
}

export function attrs(obj: Record<string, unknown>): string {
  let out = '';
  for (const [k, raw] of Object.entries(obj)) {
    let v = raw;
    if (k === 'class') v = cls(v) || false;
    else if (k === 'style') v = sty(v) || false;
    if (v === false || v == null) continue;
    if (v === true) {
      out += ' ' + k;
      continue;
    }
    out += ` ${k}="${escapeAttr(String(v))}"`;
  }
  return out;
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
  segments: boolean;
}

export interface Bindings {
  props: Record<string, unknown>;
  slots: Record<string, true>;
  params: Record<string, string | string[]>;
  url: URL;
  route: { pattern: string; file: string };
  env: Record<string, string>;
}

export type SlotFns = Record<string, () => Promise<string>>;

export interface RenderModule {
  (bindings: Bindings, slotFns: SlotFns, ctx: RenderCtx, clientProps?: string): Promise<string>;
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

export function bindings(ctx: RenderCtx, props: Record<string, unknown>, slotFns: SlotFns): Bindings {
  const slots: Record<string, true> = {};
  for (const k of Object.keys(slotFns)) slots[k] = true;
  return { props, slots, params: ctx.params, url: ctx.url, route: ctx.route, env: ctx.env };
}

export async function slot(fns: SlotFns, name: string, fallback?: () => Promise<string>): Promise<string> {
  const fn = fns[name];
  if (fn) return await fn();
  if (fallback) return await fallback();
  return '';
}

export async function renderComponent(
  Comp: RenderModule,
  props: Record<string, unknown>,
  slotFns: SlotFns,
  ctx: RenderCtx,
  clientProps?: unknown,
): Promise<string> {
  const meta = Comp.__deshi;
  if (!meta) throw new Error('renderComponent: not a compiled Deshi component');
  if (ctx.depth > 50) {
    throw new Error(`PF4002: Component nesting deeper than 50 (${meta.file})`);
  }
  if (meta.css) ctx.css.add(meta.hash);
  if (meta.client) ctx.clients.add(meta.hash);
  ctx.used.add(meta.file);
  ctx.depth++;
  try {
    return await Comp(bindings(ctx, props, slotFns), slotFns, ctx, clientProps === undefined ? undefined : JSON.stringify(clientProps));
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
    const key = JSON.stringify(args);
    if (store.has(key)) return store.get(key) as R;
    const v = fn(...args);
    store.set(key, v);
    return v;
  };
}

export const runtime = { esc, unsafe, attrs, cls, sty, raw, Raw, slot, renderComponent, headPush, cache };
export type Runtime = typeof runtime;
