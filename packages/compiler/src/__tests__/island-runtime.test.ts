// Executes the generated `deshi-island` client runtime (the exact code that is
// inlined into the page prescripts) against a minimal DOM shim, so the hydrate
// lifecycle — parallel imports, props revival, the `ssr` gate, top-down
// nesting and the directive timing — is covered for real, not just as strings.
import { describe, expect, it, beforeEach } from 'vitest';
import { directiveScript, islandPrescripts } from '../islands';

// ─── minimal DOM shim ────────────────────────────────────────────────────────
const COMMENT_NODE = 8;

class StubNode {
  nodeType = 1;
  childNodes: StubNode[] = [];
  parentElement: StubHTMLElement | null = null;
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
}

class StubHTMLElement extends StubNode {
  tagName: string;
  attributes = new Map<string, string>();
  isConnected = false;
  private listeners = new Map<string, Array<(e: any) => void>>();
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase();
  }
  hasAttribute(n: string) {
    return this.attributes.has(n);
  }
  getAttribute(n: string) {
    return this.attributes.has(n) ? this.attributes.get(n)! : null;
  }
  setAttribute(n: string, v: unknown) {
    this.attributes.set(n, String(v));
  }
  removeAttribute(n: string) {
    this.attributes.delete(n);
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1) as StubHTMLElement[];
  }
  appendChild<T extends StubNode>(c: T): T {
    c.parentElement = this;
    (c as unknown as StubHTMLElement).isConnected = this.isConnected;
    this.childNodes.push(c);
    return c;
  }
  addEventListener(type: string, fn: (e: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: (e: any) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  dispatchEvent(e: any) {
    e.target = this;
    for (const el of [this, ...(e.bubbles ? ancestors(this) : [])]) {
      for (const fn of el.listeners.get(e.type) ?? []) fn(e);
    }
    return !e.defaultPrevented;
  }
  private matches(sel: string): boolean {
    const m = sel.trim().match(/^([a-zA-Z-]*)(\[([^\]=]+)(?:="?([^"\]]*)"?)?\])?$/);
    if (!m) return false;
    const [, tag, , attr, val] = m;
    if (tag && tag.toUpperCase() !== this.tagName) return false;
    if (attr && (!this.attributes.has(attr) || (val !== undefined && this.attributes.get(attr) !== val))) return false;
    return true;
  }
  private descendants(out: StubHTMLElement[] = []): StubHTMLElement[] {
    for (const c of this.children) out.push(c, ...c.descendants());
    return out;
  }
  querySelectorAll(sel: string) {
    return this.descendants().filter((el) => el.matches(sel));
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  closest(sel: string): StubHTMLElement | null {
    let el: StubHTMLElement | null = this;
    while (el) {
      if (el.matches(sel)) return el;
      el = el.parentElement;
    }
    return null;
  }
}

function ancestors(el: StubHTMLElement): StubHTMLElement[] {
  const out: StubHTMLElement[] = [];
  let p = el.parentElement;
  while (p) {
    out.push(p);
    p = p.parentElement;
  }
  return out;
}

class StubEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  composed: boolean;
  detail: unknown;
  defaultPrevented = false;
  constructor(type: string, init: any = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
    this.detail = init.detail;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
}

interface Harness {
  define: (attrs: Record<string, string>, children?: StubHTMLElement[]) => any;
  imports: string[];
  moduleFor: (url: string, mod: unknown) => void;
  idleQueue: Array<{ cb: () => void; opts: any }>;
  observers: Array<{ cb: (entries: any[]) => void; observed: unknown[]; disconnected: boolean }>;
  mediaListeners: Array<{ query: string; fn: () => void }>;
  setMediaMatches: (query: string) => void;
}

function createHarness(): Harness {
  const registry = new Map<string, any>();
  const listeners = new Map<string, Array<(e: any) => void>>();
  const documentStub = {
    readyState: 'complete',
    baseURI: 'http://localhost/',
    addEventListener(type: string, fn: (e: any) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: (e: any) => void) {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
    dispatchEvent(e: any) {
      for (const fn of listeners.get(e.type) ?? []) fn(e);
      return true;
    },
  };
  const idleQueue: Harness['idleQueue'] = [];
  const observers: Harness['observers'] = [];
  const mediaListeners: Harness['mediaListeners'] = [];
  const matched = new Set<string>();
  const modules = new Map<string, unknown>();
  const self = { Deshi: undefined as any };
  const sandbox = {
    self,
    window: {
      addEventListener: () => {},
      dispatchEvent: () => true,
      requestIdleCallback: (cb: () => void, opts: any) => idleQueue.push({ cb, opts }),
    },
    document: documentStub,
    HTMLElement: StubHTMLElement,
    customElements: {
      get: (name: string) => registry.get(name),
      define: (name: string, cls: any) => registry.set(name, cls),
    },
    Node: { COMMENT_NODE },
    Event: StubEvent,
    CustomEvent: StubEvent,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      cb: (entries: any[]) => void;
      observed: unknown[] = [];
      disconnected = false;
      constructor(cb: (entries: any[]) => void) {
        this.cb = cb;
        observers.push(this);
      }
      observe(el: unknown) {
        this.observed.push(el);
      }
      disconnect() {
        this.disconnected = true;
      }
    },
    matchMedia: (query: string) => ({
      matches: matched.has(query),
      addEventListener: (_t: string, fn: () => void) => mediaListeners.push({ query, fn }),
    }),
    location: { href: 'http://localhost/counter' },
    console,
  };
  const keys = Object.keys(sandbox);
  const run = (code: string) => new Function(...keys, code)(...keys.map((k) => (sandbox as any)[k]));

  // register the built-in directives the way the page prescripts do
  for (const strategy of ['load', 'idle', 'visible', 'media', 'only'] as const) {
    run(directiveScript(strategy, true));
  }
  // the last prescript is the element definition; the element script calls bare
  // import(), so swap in the stub module registry
  const prescripts = islandPrescripts({ islandStyle: false, islandRuntime: false, islandDirectives: new Set() }, 'load', true);
  const elementScript = prescripts.slice(prescripts.lastIndexOf('<script>') + 8, prescripts.lastIndexOf('</script>'));
  run(elementScript.replace(/\bimport\(/g, '__import('));

  const imports: string[] = [];
  Object.assign(globalThis, {
    __import: async (url: string) => {
      imports.push(url);
      const mod = modules.get(url);
      if (!mod) throw new Error('no stub module for ' + url);
      return mod;
    },
  });

  return {
    define(attrs, children = []) {
      const cls = registry.get('deshi-island');
      const el = new cls() as StubHTMLElement;
      el.tagName = 'DESHI-ISLAND';
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      el.isConnected = true;
      for (const c of children) el.appendChild(c);
      return el;
    },
    imports,
    moduleFor(url, mod) {
      modules.set(url, mod);
    },
    idleQueue,
    observers,
    mediaListeners,
    setMediaMatches(query) {
      matched.add(query);
    },
  };
}

async function tick(ms = 10) {
  await new Promise((r) => setTimeout(r, ms));
}

/** A renderer module in the real chunk shape: `(element) => (Component, props, slots, {client})`. */
function rendererModule(record: Array<{ element: unknown; props: any; client: string }>) {
  return {
    default: (element: any) => (Component: any, props: any, slots: any, ctx: any) => {
      if (!element.hasAttribute('ssr')) return;
      record.push({ element, props, client: ctx?.client });
    },
  };
}

const islandAttrs = (over: Record<string, string> = {}) => ({
  uid: 'test',
  'component-url': '/_deshi/c/Box.1.js',
  'renderer-url': '/_deshi/c/Box.1.js',
  'component-export': 'default',
  props: '{"n":[0,1]}',
  ssr: '',
  client: 'load',
  opts: '{"name":"Box","value":""}',
  ...over,
});

describe('deshi-island client runtime', () => {
  let h: Harness;
  let calls: Array<{ element: unknown; props: any; client: string }>;

  beforeEach(() => {
    h = createHarness();
    calls = [];
    h.moduleFor('/_deshi/c/Box.1.js', rendererModule(calls));
  });

  it('client:load imports the chunk, revives props, hydrates and removes ssr', async () => {
    const island = h.define(islandAttrs({ props: '{"n":[0,1],"when":[3,"2024-03-01T12:00:00.000Z"],"missing":[0]}' }));
    const hydrated: string[] = [];
    island.addEventListener('deshi:hydrate', () => hydrated.push('hydrated'));
    island.connectedCallback();
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].element).toBe(island);
    expect(calls[0].props.n).toBe(1);
    expect(calls[0].props.when).toBeInstanceOf(Date);
    expect('missing' in calls[0].props).toBe(true);
    expect(calls[0].client).toBe('load');
    expect(island.hasAttribute('ssr')).toBe(false);
    expect(hydrated).toEqual(['hydrated']);
    expect(h.imports).toContain('/_deshi/c/Box.1.js');
  });

  it('never re-runs the renderer once ssr has been removed (Astro idempotence gate)', async () => {
    const island = h.define(islandAttrs());
    island.connectedCallback();
    await tick();
    expect(calls).toHaveLength(1);
    island.removeAttribute('ssr');
    island.attributeChangedCallback();
    await tick();
    expect(calls).toHaveLength(1);
  });

  it('hydrates nested islands top-down', async () => {
    const child = h.define(islandAttrs({ uid: 'child' }));
    const parent = h.define(islandAttrs({ uid: 'parent' }), [child]);
    child.connectedCallback();
    await tick(30);
    expect(calls).toHaveLength(0);

    const order: string[] = [];
    parent.addEventListener('deshi:hydrate', () => order.push('parent'));
    parent.connectedCallback();
    await tick(30);
    expect(calls.map((c) => c.element)).toEqual([parent, child]);
    expect(order).toEqual(['parent']);
  });

  it('client:visible observes the island children and waits for intersection', async () => {
    const island = h.define(islandAttrs({ client: 'visible' }), [new StubHTMLElement('div')]);
    island.connectedCallback();
    await tick(20);
    expect(calls).toHaveLength(0);
    const io = h.observers[h.observers.length - 1];
    expect(io.observed).toHaveLength(1);
    io.cb([{ isIntersecting: false }]);
    await tick(10);
    expect(calls).toHaveLength(0);
    io.cb([{ isIntersecting: true }]);
    await tick(10);
    expect(calls).toHaveLength(1);
    expect(io.disconnected).toBe(true);
  });

  it('client:idle goes straight through requestIdleCallback (no viewport gate)', async () => {
    const island = h.define(islandAttrs({ client: 'idle', opts: '{"name":"Box","value":{"timeout":500}}' }));
    island.connectedCallback();
    await tick(20);
    expect(h.observers).toHaveLength(0);
    expect(h.idleQueue).toHaveLength(1);
    expect(h.idleQueue[0].opts).toEqual({ timeout: 500 });
    expect(calls).toHaveLength(0);
    h.idleQueue[0].cb();
    await tick(10);
    expect(calls).toHaveLength(1);
  });

  it('client:media only hydrates once the query matches', async () => {
    const island = h.define(islandAttrs({ client: 'media', opts: '{"name":"Box","value":"(max-width: 600px)"}' }));
    island.connectedCallback();
    await tick(20);
    expect(calls).toHaveLength(0);
    expect(h.mediaListeners).toHaveLength(1);
    expect(h.mediaListeners[0].query).toBe('(max-width: 600px)');
    h.mediaListeners[0].fn();
    await tick(10);
    expect(calls).toHaveLength(1);
  });

  it('client:media hydrates immediately when the query already matches', async () => {
    h.setMediaMatches('(max-width: 600px)');
    const island = h.define(islandAttrs({ client: 'media', opts: '{"name":"Box","value":"(max-width: 600px)"}' }));
    island.connectedCallback();
    await tick(20);
    expect(calls).toHaveLength(1);
  });
});
