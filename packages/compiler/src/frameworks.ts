import { escapeAttr, escapeHtml } from './runtime';

// Dynamic import helper for optional runtime peer dependencies (React, Preact, Vue, Svelte)
const dynamicImport = new Function('specifier', 'return import(specifier);') as (spec: string) => Promise<unknown>;

export type SupportedFramework = 'react' | 'preact' | 'vue' | 'svelte' | 'vanilla';

/** Detect target UI framework from file path and content. */
export function detectFramework(file: string, source: string = ''): SupportedFramework {
  const ext = file.split('.').pop()?.toLowerCase();
  if (ext === 'vue') return 'vue';
  if (ext === 'svelte') return 'svelte';
  if (ext === 'jsx' || ext === 'tsx') {
    if (source.includes('preact') || source.includes('from "preact"') || source.includes("from 'preact'")) {
      return 'preact';
    }
    return 'react';
  }
  return 'vanilla';
}

/** Serialize standard VNode / JSX object tree into static HTML. */
export function serializeVNode(vnode: unknown): string {
  if (vnode == null || typeof vnode === 'boolean') return '';
  if (typeof vnode === 'string' || typeof vnode === 'number' || typeof vnode === 'bigint') {
    return escapeHtml(String(vnode));
  }
  if (Array.isArray(vnode)) {
    return vnode.map(serializeVNode).join('');
  }
  if (typeof vnode === 'object') {
    const obj = vnode as Record<string, unknown>;
    // Standard VNode/JSX shape: { type, props: { children, ... } }
    if (obj.type) {
      const tag = typeof obj.type === 'string' ? obj.type : 'div';
      const props = (obj.props as Record<string, unknown>) || {};
      const attrs = Object.entries(props)
        .filter(([k]) => k !== 'children' && k !== 'key' && k !== 'ref')
        .map(([k, v]) => {
          if (v == null || v === false) return '';
          if (v === true) return ` ${k}`;
          const attrName = k === 'className' ? 'class' : k === 'htmlFor' ? 'for' : k;
          return ` ${attrName}="${escapeAttr(String(v))}"`;
        })
        .join('');
      const children = serializeVNode(props.children);
      return `<${tag}${attrs}>${children}</${tag}>`;
    }
  }
  return '';
}

/** Ensure a lightweight universal JSX runtime is active on globalThis for TSX/JSX execution. */
export function ensureJsxRuntime(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.React) {
    const jsxFactory = (type: unknown, props: unknown, ...children: unknown[]) => {
      const p = Object.assign({}, props) as Record<string, unknown>;
      if (children.length === 1) p.children = children[0];
      else if (children.length > 1) p.children = children;
      return { type, props: p };
    };
    g.React = { createElement: jsxFactory, Fragment: (p: { children?: unknown }) => p?.children };
  }
  if (!g.h) {
    g.h = (g.React as { createElement: unknown }).createElement;
  }
}

/**
 * Server-Side Render (SSR) a framework component at build time.
 * Dynamically resolves framework-specific SSR renderers if available.
 */
export async function renderFrameworkComponent(
  Comp: unknown,
  props: Record<string, unknown> = {},
  file?: string,
): Promise<string> {
  ensureJsxRuntime();
  // 1. Direct function execution (plain function, mock component, VNode returner)
  if (typeof Comp === 'function') {
    try {
      const res = await (Comp as (p: Record<string, unknown>) => unknown)(props);
      if (typeof res === 'string') {
        let interpolated = res;
        for (const [k, v] of Object.entries(props)) {
          const val = v == null ? '' : escapeHtml(String(v));
          interpolated = interpolated.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), val);
          interpolated = interpolated.replace(new RegExp(`{\\s*${k}\\s*}`, 'g'), val);
        }
        return interpolated;
      }
      if (res && typeof res === 'object') {
        const serialized = serializeVNode(res);
        if (serialized) return serialized;
      }
    } catch {
      // Continue to framework renderers
    }
  }

  // If component has a template property (e.g. Vue or Svelte SFC)
  if (Comp && typeof Comp === 'object' && 'template' in Comp && typeof (Comp as { template?: unknown }).template === 'string') {
    const rawTemplate = (Comp as { template: string }).template;
    let interpolated = rawTemplate;
    for (const [k, v] of Object.entries(props)) {
      const val = v == null ? '' : escapeHtml(String(v));
      interpolated = interpolated.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), val);
      interpolated = interpolated.replace(new RegExp(`{\\s*${k}\\s*}`, 'g'), val);
    }
    return interpolated;
  }

  // Framework libraries (react, vue, svelte) are optional peer dependencies installed
  // by consumers; static imports would crash when the framework is not installed.

  // 2. React SSR via react-dom/server
  try {
    const reactMod: unknown = await dynamicImport('react');
    const serverMod: unknown = await dynamicImport('react-dom/server');
    if (reactMod && typeof reactMod === 'object' && serverMod && typeof serverMod === 'object') {
      const createElement = 'createElement' in reactMod && typeof reactMod.createElement === 'function' ? reactMod.createElement : undefined;
      const renderToString = 'renderToString' in serverMod && typeof serverMod.renderToString === 'function' ? serverMod.renderToString : undefined;
      if (createElement && renderToString) {
        const el = createElement(Comp, props);
        return renderToString(el);
      }
    }
  } catch {}

  // 3. Preact SSR via preact-render-to-string
  try {
    const preactMod: unknown = await dynamicImport('preact');
    const serverMod: unknown = await dynamicImport('preact-render-to-string');
    if (preactMod && typeof preactMod === 'object' && serverMod && typeof serverMod === 'object') {
      const h = 'h' in preactMod && typeof preactMod.h === 'function' ? preactMod.h : undefined;
      const render = 'render' in serverMod && typeof serverMod.render === 'function' ? serverMod.render : undefined;
      if (h && render) {
        const el = h(Comp, props);
        return render(el);
      }
    }
  } catch {}

  // 4. Vue SSR via @vue/server-renderer
  try {
    const vueMod: unknown = await dynamicImport('vue');
    const serverMod: unknown = await dynamicImport('@vue/server-renderer');
    if (vueMod && typeof vueMod === 'object' && serverMod && typeof serverMod === 'object') {
      const createSSRApp = 'createSSRApp' in vueMod && typeof vueMod.createSSRApp === 'function' ? vueMod.createSSRApp : undefined;
      const h = 'h' in vueMod && typeof vueMod.h === 'function' ? vueMod.h : undefined;
      const renderToString = 'renderToString' in serverMod && typeof serverMod.renderToString === 'function' ? serverMod.renderToString : undefined;
      if (createSSRApp && h && renderToString) {
        const app = createSSRApp({ render: () => h(Comp, props) });
        return await renderToString(app);
      }
    }
  } catch {}

  // 5. Svelte SSR via svelte/server
  try {
    const svelteMod: unknown = await dynamicImport('svelte/server');
    if (svelteMod && typeof svelteMod === 'object' && 'render' in svelteMod && typeof svelteMod.render === 'function') {
      const result = svelteMod.render(Comp, { props });
      if (result && typeof result === 'object' && 'html' in result && typeof result.html === 'string') {
        return result.html;
      }
    }
  } catch {
    if (Comp && typeof Comp === 'object' && 'render' in Comp && typeof Comp.render === 'function') {
      try {
        const result = (Comp.render as (p: Record<string, unknown>) => { html: string })(props);
        return result.html;
      } catch {}
    }
  }

  // 6. Graceful island fallback container so client hydration takes over in the browser
  return `<div data-deshi-framework="${escapeAttr(file || 'component')}" style="display:contents"></div>`;
}
/**
 * Generates the client-side island chunk (/_deshi/c/<Component>.<hash>.js).
 *
 * Astro renderer contract: the chunk default-exports `(element) => (Component,
 * props, slots, { client }) => …` and every renderer gates on the `ssr`
 * attribute (`!element.hasAttribute('ssr')` → already hydrated). The component
 * and the framework runtime live in the same chunk so hooks/context share one
 * framework instance; build.ts bundles the chunk with esbuild when the
 * framework is installed, otherwise the import specifiers are left for Vite.
 */
export function generateFrameworkIslandChunk(file: string, source: string = ''): string {
  const fw = detectFramework(file, source);
  const spec = JSON.stringify('/' + file.replace(/^\//, ''));

  switch (fw) {
    case 'vue':
      return `// deshi island chunk for ${file}
import { createSSRApp, createApp, h } from 'vue';
import Component from ${spec};

const appMap = new WeakMap();

export default function islandRenderer(element) {
  return function ($Component, props, slots, ctx) {
    if (!element.hasAttribute('ssr')) return;
    const isOnly = ctx && ctx.client === 'only';
    let app = appMap.get(element);
    if (!app) {
      const bootstrap = isOnly ? createApp : createSSRApp;
      app = bootstrap({ render: () => h(Component, props) });
      appMap.set(element, app);
      app.mount(element, !isOnly);
      element.addEventListener('deshi:unmount', () => app.unmount(), { once: true });
    }
  };
}
`;

    case 'svelte':
      return `// deshi island chunk for ${file}
import * as Svelte from 'svelte';
import Component from ${spec};

export default function islandRenderer(element) {
  return function ($Component, props, slots, ctx) {
    if (!element.hasAttribute('ssr')) return;
    const isOnly = ctx && ctx.client === 'only';
    let instance;
    if (isOnly) {
      instance = typeof Svelte.mount === 'function'
        ? Svelte.mount(Component, { target: element, props })
        : new Component({ target: element, props });
    } else {
      instance = typeof Svelte.hydrate === 'function'
        ? Svelte.hydrate(Component, { target: element, props })
        : new Component({ target: element, props, hydrate: true });
    }
    element.addEventListener('deshi:unmount', () => {
      if (instance && typeof instance.$destroy === 'function') instance.$destroy();
      else if (instance && typeof Svelte.unmount === 'function') Svelte.unmount(instance);
    }, { once: true });
  };
}
`;

    case 'preact':
      return `// deshi island chunk for ${file}
import { h, hydrate, render } from 'preact';
import Component from ${spec};

export default function islandRenderer(element) {
  return function ($Component, props, slots, ctx) {
    if (!element.hasAttribute('ssr')) return;
    const child = h(Component, props);
    if (ctx && ctx.client === 'only') {
      element.innerHTML = '';
      render(child, element);
    } else {
      hydrate(child, element);
    }
    element.addEventListener('deshi:unmount', () => render(null, element), { once: true });
  };
}
`;

    case 'react':
    default:
      return `// deshi island chunk for ${file}
import { createElement, startTransition } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import Component from ${spec};

const rootMap = new WeakMap();

export default function islandRenderer(element) {
  return function ($Component, props, slots, ctx) {
    if (!element.hasAttribute('ssr')) return;
    const node = createElement(Component, props);
    const isOnly = ctx && ctx.client === 'only';
    let root = rootMap.get(element);
    if (!root) {
      root = isOnly ? createRoot(element) : hydrateRoot(element, node);
      rootMap.set(element, root);
      element.addEventListener('deshi:unmount', () => root.unmount(), { once: true });
    }
    startTransition(() => root.render(node));
  };
}
`;
  }
}
