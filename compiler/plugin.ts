import type { Plugin, ViteDevServer, PreviewServer, ResolvedConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compile } from './index';
import { scopedCssUrl } from './css';
import { build as buildSite, buildToDisk, type BuildResult } from './build';
import { hashString } from './types';
import { CLIENT_ROUTER_SCRIPT } from './client-router';
import { ISLANDS_RUNTIME } from './islands';
import { loadConfig, mergeConfig, defaultConfig } from './config';

// Virtual per-file CSS served through Vite's pipeline (postcss, HMR):
// codegen emits `import "/_deshi/<hash>.css"` per CSS-having file (React-style),
// resolveId/load below serve the text, and vite:css transforms it like any CSS.
const deshiCss = new Map<string, string>();
const deshiClientJs = new Map<string, string>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DeshiPluginOptions {
  appDir?: string;
  site?: string;
  base?: string;
  outDir?: string;
  trailingSlash?: 'never' | 'always' | 'ignore';
  minify?: boolean;
  router?: boolean | { prefetch?: boolean };
  css?: 'extract' | 'inline';
  experimental?: { viewTransitions?: boolean };
}

export function deshi(options: DeshiPluginOptions = {}): Plugin {
  const virtualRuntimeId = 'virtual:deshi/runtime';
  const resolvedVirtualRuntimeId = '\0' + virtualRuntimeId;
  const virtualEntryId = 'virtual:deshi-entry';
  const resolvedVirtualEntryId = '\0' + virtualEntryId;
  const enableRouter = options.router ?? true;

  let config: ResolvedConfig | undefined;
  let cachedBuild: { fp: string; result: BuildResult } | null = null;

  // Cached merged config (file + inline options)
  let deshiConfig: any = null;
  async function getDeshiConfig(root: string) {
    if (deshiConfig) return deshiConfig;
    const fileCfg = await loadConfig(root);
    deshiConfig = mergeConfig(mergeConfig(defaultConfig as any, fileCfg), options as any);
    return deshiConfig;
  }

  return {
    name: 'vite-plugin-deshi',
    async config(cfg, env) {
      const root = cfg.root || process.cwd();
      const dc = await getDeshiConfig(root);
      return {
        build: {
          rollupOptions: {
            input: virtualEntryId,
          },
        },
        base: dc.base ?? cfg.base,
      };
    },
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    // Astro-like HMR: CSS-only changes hot-update without full reload, .deshi template changes do full-reload
    async handleHotUpdate(ctx) {
      if (ctx.file.endsWith('.deshi') || ctx.file.endsWith('.md')) {
        cachedBuild = null;
        // invalidate the module that produced the CSS so Vite's pipeline updates
        // the actual HMR fullReload is done by the watcher below — we just clear cache
        ctx.server.ws.send({ type: 'full-reload' });
        return [];
      }
      return undefined;
    },
    resolveId(id) {
      if (id === virtualEntryId) {
        return resolvedVirtualEntryId;
      }
      if (id === 'deshi:content' || id === 'deshi/content') {
        return '\0virtual:deshi/content';
      }
      if (id === 'deshi:config' || id === 'virtual:deshi/config') {
        return '\0virtual:deshi/config';
      }
      if (id === 'deshi/runtime' || id === virtualRuntimeId) {
        return resolvedVirtualRuntimeId;
      }
      if (id.includes('_deshi/router') || id === '/_deshi/router.4f1a9c2e.js') {
        return '\0virtual:_deshi/router.js';
      }
      if (id === '/_deshi/islands.js' || id.endsWith('/_deshi/islands.js')) {
        return '\0virtual:_deshi/islands.js';
      }
      // Per-file CSS (ends in .css so vite:css transforms it).
      if (/^\/_deshi\/[^/]+\.css$/.test(id.split('?')[0]) || id.split('?')[0].startsWith('/_deshi/c/')) {
        return id;
      }
      return null;
    },
    async load(id) {
      if (id === resolvedVirtualEntryId) {
        return 'export default {};';
      }
      if (id === '\0virtual:deshi/content') {
        return `export * from '${path.resolve(__dirname, './content').replace(/\\/g, '/')}'; export { getCollection, defineCollection } from '${path.resolve(__dirname, './content').replace(/\\/g, '/')}';`;
      }
      if (id === '\0virtual:deshi/config') {
        const dc = deshiConfig ?? defaultConfig;
        return `export default ${JSON.stringify(dc)}; export const config = ${JSON.stringify(dc)};`;
      }
      if (id === resolvedVirtualRuntimeId) {
        return `export * from '${path.resolve(__dirname, './runtime').replace(/\\/g, '/')}';`;
      }
      if (id === '\0virtual:_deshi/router.js') {
        return CLIENT_ROUTER_SCRIPT;
      }
      if (id === '\0virtual:_deshi/islands.js') {
        return ISLANDS_RUNTIME;
      }
      {
        const clean = id.split('?')[0];
        if (/^\/_deshi\/[^/]+\.css$/.test(clean)) {
          const css = deshiCss.get(clean);
          if (css !== undefined) return css;
        }
        if (clean.startsWith('/_deshi/c/') && deshiClientJs.has(clean)) {
          return deshiClientJs.get(clean)!;
        }
      }
      return null;
    },
    async transform(code, id) {
      const cleanId = id.split('?')[0];
      if (cleanId.endsWith('.deshi') || cleanId.endsWith('.md')) {
        const result = compile(code, {
          file: cleanId,
          minify: options.minify ?? false,
          runtimeImport: virtualRuntimeId,
        });
        const errors = result.diagnostics.filter((d) => d.severity === 'error');
        if (errors.length > 0) {
          const msg = errors.map((e) => `[Deshi ${e.code}] ${e.message} at ${e.file}:${e.line}:${e.column}\n${e.frame}`).join('\n\n');
          const err: any = new Error(msg);
          err.frame = errors[0]?.frame;
          err.loc = { file: errors[0]?.file, line: errors[0]?.line, column: errors[0]?.column };
          throw err;
        }
        const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
        for (const w of warnings) this.warn(`[Deshi ${w.code}] ${w.message} at ${w.file}:${w.line}:${w.column}`);
        // Feed the virtual CSS registry so direct .deshi module imports
        // (React-style island authoring) resolve their side-effect CSS import.
        const cssUrl = scopedCssUrl(result.css.scoped);
        if (cssUrl) deshiCss.set(cssUrl, result.css.scoped);
        return {
          code: result.code,
          map: null,
        };
      }
      return null;
    },
    configureServer(server: ViteDevServer) {
      // .deshi sources live outside Vite's module graph in dev (pages are
      // rendered to HTML strings), so edits would otherwise go unnoticed.
      server.watcher.on('change', (file) => {
        if (/\.(deshi|html|md|js|ts)$/.test(file)) {
          cachedBuild = null;
          server.ws.send({ type: 'full-reload' });
        }
      });
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '/';
        const qIndex = rawUrl.indexOf('?');
        const url = qIndex === -1 ? rawUrl.split('#')[0] : rawUrl.slice(0, qIndex);
        const qs = qIndex === -1 ? '' : rawUrl.slice(qIndex);
        if (url.length > 1 && url.endsWith('/')) {
          res.statusCode = 308;
          res.setHeader('Location', url.slice(0, -1) + qs);
          res.end();
          return;
        }

        // Serve client SPA router script
        if (url === '/_deshi/router.4f1a9c2e.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.statusCode = 200;
          res.end(CLIENT_ROUTER_SCRIPT);
          return;
        }
        if (url === '/_deshi/islands.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.statusCode = 200;
          res.end(ISLANDS_RUNTIME);
          return;
        }

        // Per-file CSS through Vite's pipeline (postcss, url rebasing), served
        // as text/css so <link> stylesheets apply. Vite's default JS-module
        // form only works for JS `import`s, so request `?direct` internally —
        // page markup stays identical between dev and prod.
        if (url.startsWith('/_deshi/c/') && deshiClientJs.has(url)) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.statusCode = 200;
          res.end(deshiClientJs.get(url)!);
          return;
        }

        if (/^\/_deshi\/[^/]+\.css$/.test(url)) {
          try {
            const t = await server.transformRequest(url + '?direct');
            if (t && typeof t.code === 'string') {
              res.setHeader('Content-Type', 'text/css; charset=utf-8');
              res.statusCode = 200;
              res.end(t.code);
              return;
            }
          } catch {
            // fall through to the raw registry below
          }
          const raw = deshiCss.get(url);
          if (raw !== undefined) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.statusCode = 200;
            res.end(raw);
            return;
          }
          return next();
        }

        if (url.startsWith('/@') || url.startsWith('/node_modules') || (url.includes('.') && !url.endsWith('.html'))) {
          return next();
        }

        try {
          const root = server.config.root || process.cwd();
          const appDir = path.resolve(root, options.appDir ?? 'src');
          if (!fs.existsSync(appDir)) return next();

          const readFilesRecursively = (dir: string, base: string = ''): Record<string, string> => {
            const out: Record<string, string> = {};
            for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, item.name);
              const rel = base ? `${base}/${item.name}` : item.name;
              if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== 'compiler') {
                Object.assign(out, readFilesRecursively(full, rel));
              } else if (item.isFile() && (item.name.endsWith('.deshi') || item.name.endsWith('.html') || item.name.endsWith('.md') || item.name.endsWith('.ts') || item.name.endsWith('.js'))) {
                out[`src/${rel}`] = fs.readFileSync(full, 'utf-8');
              }
            }
            return out;
          };

          const projectFiles = readFilesRecursively(appDir);
          let fp = '';
          for (const k of Object.keys(projectFiles).sort()) fp += k + '\0' + hashString(projectFiles[k]);
          fp = hashString(fp);
          let result: BuildResult;
          if (cachedBuild && cachedBuild.fp === fp) {
            result = cachedBuild.result;
          } else {
            const dcDev = deshiConfig ?? await getDeshiConfig(root);
            result = await buildSite(
              { files: projectFiles },
              {
                output: (dcDev as any).output === 'static' ? 'index' : (dcDev as any).output ?? 'index',
                router: (dcDev as any).router ?? enableRouter,
                css: (dcDev as any).css ?? options.css ?? 'inline',
                minify: false,
                appDir: (dcDev as any).appDir ?? 'src',
                site: (dcDev as any).site,
              } as any
            );
            cachedBuild = { fp, result };
          }

          // Refresh the virtual CSS registry (dev serves per-file CSS through
          // Vite's pipeline) and drop Vite's cached transform for changed files.
          for (const f of result.files) {
            if (f.kind === 'js' && ('/' + f.path).startsWith('/_deshi/c/')) {
              deshiClientJs.set('/' + f.path, f.content);
            }
            if (f.kind !== 'css') continue;
            const url = '/' + f.path;
            if (deshiCss.get(url) !== f.content) {
              deshiCss.set(url, f.content);
              // Drop Vite's cached transform (covers plain + ?direct module ids).
              server.moduleGraph.urlToModuleMap.forEach((mod, key) => {
                if (key === url || key.startsWith(url + '?')) server.moduleGraph.invalidateModule(mod);
              });
            }
          }

          const cleanUrl = url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
          const matchedPage =
            result.pages.find((p) => p.url === cleanUrl) ||
            result.pages.find((p) => p.url === cleanUrl + '/') ||
            (cleanUrl === '' || cleanUrl === '/' ? result.pages.find((p) => p.url === '/') : undefined);

          if (matchedPage) {
            const html = await server.transformIndexHtml(url, matchedPage.html);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.statusCode = 200;
            res.end(html);
            return;
          }

          const notFoundPage = result.pages.find((p) => p.notFound);
          if (notFoundPage) {
            const html = await server.transformIndexHtml(url, notFoundPage.html);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.statusCode = 404;
            res.end(html);
            return;
          }
          next();
        } catch (e) {
          next(e);
        }
      });
    },
    configurePreviewServer(server: PreviewServer) {
      // vite preview SPA-falls-back extensionless routes to index.html, so
      // /about would serve the home page. Resolve routes from dist/ instead:
      // /about → about/index.html (index mode) / about.html / about/page.html.
      const previewHandler = (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s?: string | Buffer) => void }, next: () => void) => {
        const rawUrl = req.url || '/';
        const qIndex = rawUrl.indexOf('?');
        const url = qIndex === -1 ? rawUrl.split('#')[0] : rawUrl.slice(0, qIndex);
        const qs = qIndex === -1 ? '' : rawUrl.slice(qIndex);
        if (url.length > 1 && url.endsWith('/')) {
          res.statusCode = 308;
          res.setHeader('Location', url.slice(0, -1) + qs);
          res.end();
          return;
        }
        if (url.includes('.')) return next(); // real files: sirv handles them
        const root = config?.root || process.cwd();
        const base = path.resolve(root, config?.build?.outDir || 'dist');
        const clean = url;
        for (const cand of [path.join(base, clean, 'index.html'), base + clean + '.html', path.join(base, clean, 'page.html')]) {
          if (!cand.startsWith(base)) continue;
          try {
            if (fs.statSync(cand).isFile()) {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.statusCode = 200;
              res.end(fs.readFileSync(cand));
              return;
            }
          } catch {
            // miss — try next candidate
          }
        }
        const nf = path.join(base, '404.html');
        try {
          if (fs.statSync(nf).isFile()) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.statusCode = 404;
            res.end(fs.readFileSync(nf));
            return;
          }
        } catch {
          // no 404 page — fall through to sirv
        }
        next();
      };
      server.middlewares.stack.unshift({ route: '', handle: previewHandler });
    },
    async closeBundle() {
      const root = config?.root || process.cwd();
      const dc = await getDeshiConfig(root);
      const outDir = (dc as any).outDir || config?.build?.outDir || 'dist';
      const fullOutDir = path.resolve(root, outDir);

      // Perform SSG build into dist/ — merges vite config + deshi.config.ts + plugin options
      await buildToDisk(
        root,
        {
          output: (dc as any).output === 'static' ? 'index' : (dc as any).output ?? 'index',
          router: (dc as any).router ?? enableRouter,
          css: (dc as any).css ?? options.css ?? 'inline',
          minify: (dc as any).minify ?? options.minify ?? true,
          appDir: (dc as any).appDir ?? options.appDir ?? 'src',
          site: (dc as any).site,
        } as any,
        outDir
      );

      // Clean up any virtual entry JS chunk from rollup
      if (fs.existsSync(fullOutDir)) {
        for (const item of fs.readdirSync(fullOutDir)) {
          if (item.endsWith('.js') && (item.includes('deshi-entry') || item.startsWith('_') || item.includes('chunk'))) {
            try {
              fs.unlinkSync(path.join(fullOutDir, item));
            } catch {
              // ignore
            }
          }
        }
        const assetsDir = path.join(fullOutDir, 'assets');
        if (fs.existsSync(assetsDir)) {
          for (const item of fs.readdirSync(assetsDir)) {
            if (item.includes('deshi-entry') || item.includes('_virtual')) {
              try {
                fs.unlinkSync(path.join(assetsDir, item));
              } catch {}
            }
          }
          if (fs.readdirSync(assetsDir).length === 0) {
            try {
              fs.rmdirSync(assetsDir);
            } catch {}
          }
        }
      }
    },
  };
}

export const deshiPlugin = deshi;
export default deshi;
