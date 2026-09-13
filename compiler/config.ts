// Deshi config — Astro parity. Loaded from `deshi.config.{ts,js,mjs,cjs}` if present,
// otherwise defaults are used. `defineConfig` is the user-facing helper that also
// provides type hints via JSDoc.

export type OutputMode = 'static' | 'hybrid' | 'server';
export type TrailingSlash = 'never' | 'always' | 'ignore';

export interface DeshiImageConfig {
  domains?: string[];
  remotePatterns?: Array<{ protocol?: string; hostname: string; port?: string; pathname?: string }>;
}

export interface DeshiMarkdownConfig {
  shikiConfig?: { theme?: string; wrap?: boolean };
  remarkPlugins?: unknown[];
  rehypePlugins?: unknown[];
  gfm?: boolean;
}

export interface DeshiPrefetchConfig {
  prefetchAll?: boolean;
  defaultStrategy?: 'hover' | 'viewport' | 'tap' | false;
}

export interface DeshiViteConfig {
  plugins?: unknown[];
}

export interface DeshiRouteConfig {
  pattern: string;
  redirect?: string | { destination: string; status?: number };
  prerender?: boolean;
}

export interface DeshiConfig {
  site?: string;
  base?: string;
  output?: OutputMode | 'page' | 'index';
  trailingSlash?: TrailingSlash;
  appDir?: string; // defaults to `src`
  outDir?: string; // defaults to `dist`
  build?: {
    assetsPrefix?: string;
    inlineStylesheets?: 'always' | 'auto' | 'never';
  };
  router?: boolean | { prefetch?: DeshiPrefetchConfig | boolean };
  css?: 'extract' | 'inline';
  minify?: boolean;
  markdown?: DeshiMarkdownConfig;
  image?: DeshiImageConfig;
  redirects?: Record<string, string | { destination: string; status?: number }>;
  integrations?: Array<{ name: string; hooks?: Record<string, (...args: any[]) => unknown> }>;
  vite?: unknown;
  experimental?: {
    viewTransitions?: boolean;
    contentCollections?: boolean;
  };
}

export function defineConfig(config: DeshiConfig): DeshiConfig {
  return config;
}

// Defaults mirror Astro's `astro.config.mjs` defaults where applicable,
// plus the tiny deshi defaults (`src/app` auto-detection stays in build.ts).
export const defaultConfig: Required<Pick<DeshiConfig, 'output' | 'trailingSlash' | 'appDir' | 'outDir' | 'router' | 'css' | 'minify'>> & DeshiConfig = {
  output: 'static',
  trailingSlash: 'ignore',
  appDir: 'src',
  outDir: 'dist',
  router: true,
  css: 'inline',
  minify: true,
  site: undefined as unknown as string,
  base: '/',
  build: { assetsPrefix: undefined as unknown as string, inlineStylesheets: 'auto' },
  markdown: { gfm: true },
  image: {},
  redirects: {},
  integrations: [],
  vite: {},
  experimental: { viewTransitions: false, contentCollections: true },
};

/** Shallow merge — enough for a vite plugin; deep-merges `build` + `experimental`. */
export function mergeConfig(base: DeshiConfig, patch: DeshiConfig): DeshiConfig {
  return {
    ...base,
    ...patch,
    build: { ...base.build, ...patch.build },
    experimental: { ...base.experimental, ...patch.experimental } as any,
    markdown: { ...base.markdown, ...patch.markdown } as any,
  };
}

/** Normalize `output` that still uses the old `"page"|"index"` vocabulary. */
export function normalizeOutput(output: DeshiConfig['output']): 'static' | 'page' | 'index' {
  if (output === 'page' || output === 'index') return output;
  return 'static';
}

/** Load `deshi.config.*` if present — best-effort, never throws. */
export async function loadConfig(root: string): Promise<DeshiConfig> {
  const fs = await import('fs');
  const path = await import('path');
  const url = await import('url');
  const candidates = ['deshi.config.ts', 'deshi.config.js', 'deshi.config.mjs', 'deshi.config.cjs'];
  for (const name of candidates) {
    const full = path.resolve(root, name);
    if (!fs.existsSync(full)) continue;
    try {
      const mod = await import(url.pathToFileURL(full).href);
      const cfg: DeshiConfig = mod.default ?? mod;
      if (cfg && typeof cfg === 'object') return cfg;
    } catch {
      // fall through to defaults — diagnostics are surfaced by the plugin
    }
  }
  return {};
}
