// ─── islands: Astro-parity client runtime + server-side markup ───────────────
//
// Server side (build time):
//   • renderIsland() wraps the SSR output in a <deshi-island> custom element —
//     the same contract as Astro's <astro-island> (uid, component-url,
//     component-export, renderer-url, props, ssr, client, opts, await-children).
//   • islandPrescripts() emits the once-per-page prescripts immediately before
//     the first island that needs them: the display:contents style, the
//     directive function, and the custom element definition. All classic
//     scripts, like Astro, so they run while the page is parsed.
//
// Client side (browser):
//   • the element loads component + renderer in parallel, hydrates top-down
//     (parent islands first), revives Astro-format props, hands slots to the
//     renderer, and fires deshi:hydrate / deshi:unmount / deshi:hydration-error.
//
// The directive bodies and the props revival are real functions in this repo
// and get inlined into the prescripts via toString(), so the browser runs
// exactly the code the unit tests exercise.

import type { ClientStrategy } from './types';
import { escapeAttr } from './escape';
import { hashString } from './types';
import { reviveProps } from './serialize';
import { transformSync } from 'esbuild';

/** Alias kept so `runtime.ts` can type its `strategy` param without a circular
 * *value* import (type-only). */
export type IslandStrategy = ClientStrategy;

/** Astro: astro-island,astro-slot,astro-static-slot{display:contents} */
export const ISLAND_STYLES = 'deshi-island,deshi-slot{display:contents}';

interface DirectiveOptions {
  name?: string;
  value?: unknown;
}

type DirectiveLoad = () => Promise<() => unknown>;

/** client:load — Astro runtime/client/load.ts. */
const loadDirective = async (load: DirectiveLoad): Promise<void> => {
  const hydrate = await load();
  await hydrate();
};

/** client:only — Astro runtime/client/only.ts. SSR is skipped at render time;
 * on the client it behaves exactly like load. */
const onlyDirective = async (load: DirectiveLoad): Promise<void> => {
  const hydrate = await load();
  await hydrate();
};

/** client:idle — Astro runtime/client/idle.ts. requestIdleCallback with the
 * optional `{ timeout }` value; setTimeout(200) fallback. No viewport gate. */
const idleDirective = (load: DirectiveLoad, options: DirectiveOptions): void => {
  const cb = async (): Promise<void> => {
    const hydrate = await load();
    await hydrate();
  };
  const rawOptions =
    typeof options.value === 'object' && options.value !== null
      ? (options.value as { timeout?: number })
      : undefined;
  const idleOptions: { timeout?: number } = { timeout: rawOptions?.timeout };
  if ('requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout?: number }) => void }).requestIdleCallback(
      cb,
      idleOptions,
    );
  } else {
    setTimeout(cb, idleOptions.timeout || 200);
  }
};

/** client:visible — Astro runtime/client/visible.ts. Observes the island's
 * children (the island itself is display:contents and never intersects) with
 * the optional `{ rootMargin }` value. */
const visibleDirective = (load: DirectiveLoad, options: DirectiveOptions, el: Element): void => {
  const cb = async (): Promise<void> => {
    const hydrate = await load();
    await hydrate();
  };
  const rawOptions =
    typeof options.value === 'object' && options.value !== null
      ? (options.value as { rootMargin?: string })
      : undefined;
  const ioOptions: IntersectionObserverInit = { rootMargin: rawOptions?.rootMargin };
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.disconnect();
      cb();
      break;
    }
  }, ioOptions);
  for (const child of Array.from(el.children)) io.observe(child);
};

/** client:media — Astro runtime/client/media.ts. Hydrates now when the query
 * matches, otherwise on the first change. */
const mediaDirective = (load: DirectiveLoad, options: DirectiveOptions): void => {
  const cb = async (): Promise<void> => {
    const hydrate = await load();
    await hydrate();
  };
  if (options.value) {
    const mql = matchMedia(String(options.value));
    if (mql.matches) cb();
    else mql.addEventListener('change', cb, { once: true });
  }
};

type DirectiveFn = (load: DirectiveLoad, options: DirectiveOptions, el: Element) => unknown;

const DIRECTIVES: Record<IslandStrategy, DirectiveFn> = {
  load: loadDirective,
  idle: idleDirective,
  visible: visibleDirective,
  media: mediaDirective,
  only: onlyDirective,
};

/** Minify a generated client script (Astro prebuild parity). Dev keeps the
 * source readable; production ships the compact form. */
function minifyJs(code: string): string {
  try {
    return transformSync(code, { minify: true, target: 'es2020', loader: 'js' }).code.trim();
  } catch {
    return code;
  }
}

/** Astro's directive-bundle contract: register the directive on the global and
 * tell the page it is available. Classic script text. */
export function directiveScript(strategy: IslandStrategy, dev = false): string {
  const script = `(self.Deshi||(self.Deshi={}))[${JSON.stringify(strategy)}]=${DIRECTIVES[strategy].toString()};window.dispatchEvent(new Event(${JSON.stringify(`deshi:${strategy}`)}));`;
  return dev ? script : minifyJs(script);
}

/** The `deshi-island` custom element — port of Astro's runtime/server/astro-island.ts. */
function islandElementScript(dev: boolean): string {
  const code = `(() => {
if (customElements.get('deshi-island')) return;
const reviveProps = ${reviveProps.toString()};
const FORBIDDEN_COMPONENT_EXPORT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
class DeshiIsland extends HTMLElement {
  static observedAttributes = ['props'];
  disconnectedCallback() {
    document.removeEventListener('deshi:after-swap', this.unmount);
    document.addEventListener('deshi:after-swap', this.unmount, { once: true });
  }
  connectedCallback() {
    if (!this.hasAttribute('await-children') || document.readyState === 'interactive' || document.readyState === 'complete') {
      this.childrenConnectedCallback();
      return;
    }
    const onConnected = () => {
      document.removeEventListener('DOMContentLoaded', onConnected);
      mo.disconnect();
      this.childrenConnectedCallback();
    };
    const mo = new MutationObserver(() => {
      const last = this.lastChild;
      if (last && last.nodeType === Node.COMMENT_NODE && last.nodeValue === 'deshi:end') {
        last.remove();
        onConnected();
      }
    });
    mo.observe(this, { childList: true });
    document.addEventListener('DOMContentLoaded', onConnected);
  }
  async childrenConnectedCallback() {
    const beforeHydrationUrl = this.getAttribute('before-hydration-url');
    if (beforeHydrationUrl) await import(beforeHydrationUrl);
    this.start();
  }
  getRetryImportUrl(url) {
    const parsed = new URL(url, document.baseURI);
    parsed.searchParams.set('deshi-retry', Date.now().toString());
    return parsed.toString();
  }
  async importWithRetry(url) {
    try {
      return await import(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return import(this.getRetryImportUrl(url));
    }
  }
  handleHydrationError(error) {
    const componentUrl = this.getAttribute('component-url');
    const event = new CustomEvent('deshi:hydration-error', {
      cancelable: true,
      bubbles: true,
      composed: true,
      detail: { error, componentUrl },
    });
    const shouldLogError = this.dispatchEvent(event);
    if (shouldLogError) console.error('[deshi-island] Error hydrating ' + componentUrl, error);
  }
  async start() {
    const opts = JSON.parse(this.getAttribute('opts'));
    const directive = this.getAttribute('client');
    const registry = self.Deshi;
    if (registry === undefined || registry[directive] === undefined) {
      window.addEventListener('deshi:' + directive, () => this.start(), { once: true });
      return;
    }
    try {
      await registry[directive](async () => {
        const rendererUrl = this.getAttribute('renderer-url');
        try {
          const [componentModule, rendererModule] = await Promise.all([
            this.importWithRetry(this.getAttribute('component-url')),
            rendererUrl ? this.importWithRetry(rendererUrl) : Promise.resolve({ default: () => () => {} }),
          ]);
          const componentExport = this.getAttribute('component-export') || 'default';
          if (!componentExport.includes('.')) {
            if (FORBIDDEN_COMPONENT_EXPORT_KEYS.has(componentExport)) {
              throw new Error('Invalid component export path: ' + componentExport);
            }
            this.Component = componentModule[componentExport];
          } else {
            this.Component = componentModule;
            for (const part of componentExport.split('.')) {
              if (
                FORBIDDEN_COMPONENT_EXPORT_KEYS.has(part) ||
                !this.Component ||
                (typeof this.Component !== 'object' && typeof this.Component !== 'function') ||
                !Object.hasOwn(this.Component, part)
              ) {
                throw new Error('Invalid component export path: ' + componentExport);
              }
              this.Component = this.Component[part];
            }
          }
          this.hydrator = rendererModule.default;
          return this.hydrate;
        } catch (error) {
          this.handleHydrationError(error);
          return () => {};
        }
      }, opts, this);
    } catch (error) {
      this.handleHydrationError(error);
    }
  }
  hydrate = async () => {
    if (!this.hydrator) return;
    if (!this.isConnected) return;
    const parentSsrIsland = this.parentElement && this.parentElement.closest('deshi-island[ssr]');
    if (parentSsrIsland) {
      parentSsrIsland.addEventListener('deshi:hydrate', this.hydrate, { once: true });
      return;
    }
    const slots = {};
    const templates = this.querySelectorAll('template[data-deshi-template]');
    for (const template of templates) {
      const closest = template.closest(this.tagName);
      if (!closest || !closest.isSameNode(this)) continue;
      slots[template.getAttribute('data-deshi-template') || 'default'] = template.innerHTML;
      template.remove();
    }
    const slotted = this.querySelectorAll('deshi-slot');
    for (const slot of slotted) {
      const closest = slot.closest(this.tagName);
      if (!closest || !closest.isSameNode(this)) continue;
      slots[slot.getAttribute('name') || 'default'] = slot.innerHTML;
    }
    let props;
    try {
      props = this.hasAttribute('props') ? reviveProps(JSON.parse(this.getAttribute('props'))) : {};
    } catch (error) {
      let componentName = this.getAttribute('component-url') || '<unknown>';
      const componentExport = this.getAttribute('component-export');
      if (componentExport) componentName += ' (export ' + componentExport + ')';
      console.error('[deshi-island] Error parsing props for component ' + componentName, this.getAttribute('props'), error);
      throw error;
    }
    const hydrator = this.hydrator(this);
    await hydrator(this.Component, props, slots, { client: this.getAttribute('client') });
    this.removeAttribute('ssr');
    this.dispatchEvent(new CustomEvent('deshi:hydrate'));
  };
  attributeChangedCallback() {
    this.hydrate();
  }
  unmount = () => {
    if (!this.isConnected) this.dispatchEvent(new CustomEvent('deshi:unmount'));
  };
}
customElements.define('deshi-island', DeshiIsland);
})();`;
  return dev ? code : minifyJs(code);
}

/** Per-page island emission state (lives on RenderCtx). */
export interface IslandState {
  islandStyle: boolean;
  islandRuntime: boolean;
  islandDirectives: Set<string>;
}

/** Prescripts for the first island that needs them: style once, directive once
 * per strategy, custom element once — Astro render-instruction parity. */
export function islandPrescripts(state: IslandState, strategy: IslandStrategy, dev = false): string {
  let out = '';
  if (!state.islandStyle) {
    state.islandStyle = true;
    out += `<style>${ISLAND_STYLES}</style>`;
  }
  if (!state.islandDirectives.has(strategy)) {
    state.islandDirectives.add(strategy);
    out += `<script>${directiveScript(strategy, dev)}</script>`;
  }
  if (!state.islandRuntime) {
    state.islandRuntime = true;
    out += `<script>${islandElementScript(dev)}</script>`;
  }
  return out;
}

/** Astro dedupes identical islands by hashing component + props + markup. */
export function islandUid(parts: string[]): string {
  return hashString(parts.join('\u0000'));
}

export interface IslandMarkup {
  uid: string;
  componentUrl: string;
  componentExport?: string;
  rendererUrl?: string;
  /** serialized props JSON (unescaped — escaping happens here) */
  props: string;
  /** serialized opts JSON (unescaped — escaping happens here) */
  opts: string;
  client: IslandStrategy;
  html: string;
}

/** `<deshi-island>` wrapper — same attribute set and escaping as Astro. */
export function renderIsland(i: IslandMarkup): string {
  const hasChildren = i.html.length > 0;
  const attrs: string[] = [`uid="${escapeAttr(i.uid)}"`, `component-url="${escapeAttr(i.componentUrl)}"`];
  if (i.componentExport) attrs.push(`component-export="${escapeAttr(i.componentExport)}"`);
  if (i.rendererUrl) attrs.push(`renderer-url="${escapeAttr(i.rendererUrl)}"`);
  attrs.push(
    `props="${escapeAttr(i.props)}"`,
    'ssr',
    `client="${escapeAttr(i.client)}"`,
    `opts="${escapeAttr(i.opts)}"`,
  );
  if (hasChildren) attrs.push('await-children');
  const children = hasChildren ? `${i.html}<!--deshi:end-->` : '';
  return `<deshi-island ${attrs.join(' ')}>${children}</deshi-island>`;
}
