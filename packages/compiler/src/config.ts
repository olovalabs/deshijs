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

/** Shallow merge — enough for a vite plugin; deep-merges `build`, `experimental`, `markdown` and `vite`. */
export function mergeConfig(base: DeshiConfig, patch: DeshiConfig): DeshiConfig {
  const mergedVite =
    base.vite && patch.vite && typeof base.vite === 'object' && typeof patch.vite === 'object'
      ? { ...(base.vite as Record<string, unknown>), ...(patch.vite as Record<string, unknown>) }
      : (patch.vite ?? base.vite);
  return {
    ...base,
    ...patch,
    build: { ...base.build, ...patch.build },
    experimental: { ...base.experimental, ...patch.experimental } as DeshiConfig['experimental'],
    markdown: { ...base.markdown, ...patch.markdown } as DeshiConfig['markdown'],
    vite: mergedVite,
  };
}

/** Normalize `output` — accepts the legacy `"page"|"index"` vocabulary. */
export function normalizeOutput(output: DeshiConfig['output']): 'static' | 'hybrid' | 'server' | 'page' | 'index' {
  if (output === 'page' || output === 'index' || output === 'hybrid' || output === 'server') return output;
  return 'static';
}

/** Load `deshi.config.*` if present — best-effort, never throws.
 * Uses dynamic `import()` so it works in ESM with no `require` hack and no
 * top-level `await import('fs')` churn. `.ts` configs are bundled via esbuild. */
export async function loadConfig(root: string): Promise<DeshiConfig> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const candidates = ['deshi.config.ts', 'deshi.config.js', 'deshi.config.mjs', 'deshi.config.cjs'];
  for (const name of candidates) {
    const full = path.resolve(root, name);
    try {
      if (!fs.existsSync(full)) continue;
    } catch {
      continue;
    }
    try {
      const mod = await import(url.pathToFileURL(full).href);
      const cfg: DeshiConfig = mod.default ?? mod;
      if (cfg && typeof cfg === 'object') return cfg;
    } catch {
      try {
        const esbuild = await import('esbuild');
        const res = await esbuild.build({
          entryPoints: [full],
          bundle: true,
          platform: 'node',
          format: 'esm',
          write: false,
          // The bundle is re-imported from a `data:` URL, which cannot resolve
          // bare specifiers — so `deshi/*` (e.g. defineConfig) is inlined while
          // every other package stays external.
          plugins: [
            {
              name: 'deshi-config-externals',
              setup(build) {
                build.onResolve({ filter: /.*/ }, (args) => {
                  const spec = args.path;
                  const isPath = spec.startsWith('.') || spec.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(spec);
                  if (isPath) return;
                  if (spec === 'deshi' || spec.startsWith('deshi/') || spec === 'deshijs' || spec.startsWith('deshijs/')) return;
                  return { path: spec, external: true };
                });
              },
            },
          ],
        });
        const code = res.outputFiles?.[0]?.text;
        if (code) {
          const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
          const mod = await import(dataUrl);
          const cfg: DeshiConfig = mod.default ?? mod;
          if (cfg && typeof cfg === 'object') return cfg;
        }
      } catch {
        // fall through to defaults — diagnostics are surfaced by the plugin
      }
    }
  }
  return {};
}
