import type { Plugin, ViteDevServer, PreviewServer, ResolvedConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compile } from './index';
import { scopedCssUrl } from './css';
import { build as buildSite, buildToDisk } from './build';
import { CLIENT_ROUTER_SCRIPT } from './client-router';

// Virtual per-file CSS served through Vite's pipeline (postcss, HMR):
// codegen emits `import "/_deshi/<hash>.css"` per CSS-having file (React-style),
// resolveId/load below serve the text, and vite:css transforms it like any CSS.
const deshiCss = new Map<string, string>();
const deshiClientJs = new Map<string, string>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DeshiPluginOptions {
  appDir?: string;
  minify?: boolean;
  router?: boolean;
  css?: 'extract' | 'inline';
}

export function deshi(options: DeshiPluginOptions = {}): Plugin {
  const virtualRuntimeId = 'virtual:deshi/runtime';
  const resolvedVirtualRuntimeId = '\0' + virtualRuntimeId;
  const virtualEntryId = 'virtual:deshi-entry';
  const resolvedVirtualEntryId = '\0' + virtualEntryId;
  const enableRouter = options.router ?? true;

  let config: ResolvedConfig | undefined;

  return {
    name: 'vite-plugin-deshi',
    config() {
      return {
        build: {
          rollupOptions: {
            input: virtualEntryId,
          },
        },
      };
    },
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    resolveId(id) {
      if (id === virtualEntryId) {
        return resolvedVirtualEntryId;
      }
      if (id === 'deshi/runtime' || id === virtualRuntimeId) {
        return resolvedVirtualRuntimeId;
      }
      if (id.includes('_deshi/router') || id === '/_deshi/router.4f1a9c2e.js') {
        return '\0virtual:_deshi/router.js';
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
      if (id === resolvedVirtualRuntimeId) {
        return `export * from '${path.resolve(__dirname, './runtime').replace(/\\/g, '/')}';`;
      }
      if (id === '\0virtual:_deshi/router.js') {
        return CLIENT_ROUTER_SCRIPT;
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
      if (cleanId.endsWith('.deshi')) {
        const result = compile(code, {
          file: cleanId,
          minify: options.minify ?? false,
          runtimeImport: virtualRuntimeId,
        });
        const errors = result.diagnostics.filter((d) => d.severity === 'error');
        if (errors.length > 0) {
          throw new Error(
            errors.map((e) => `[Deshi ${e.code}] ${e.message} at ${e.file}:${e.line}:${e.column}`).join('\n')
          );
        }
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
        if (file.endsWith('.deshi')) server.ws.send({ type: 'full-reload' });
      });
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || '/';

        // Serve client SPA router script
        if (url === '/_deshi/router.4f1a9c2e.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.statusCode = 200;
          res.end(CLIENT_ROUTER_SCRIPT);
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
              } else if (item.isFile() && (item.name.endsWith('.deshi') || item.name.endsWith('.html') || item.name.endsWith('.ts') || item.name.endsWith('.js'))) {
                out[`src/${rel}`] = fs.readFileSync(full, 'utf-8');
              }
            }
            return out;
          };

          const projectFiles = readFilesRecursively(appDir);
          const result = await buildSite(
            { files: projectFiles },
            {
              output: 'index',
              router: enableRouter,
              css: options.css ?? 'inline',
              minify: false,
              appDir: 'src',
            }
          );

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
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || '/';
        if (url.includes('.')) return next(); // real files: sirv handles them
        const root = config?.root || process.cwd();
        const base = path.resolve(root, config?.build?.outDir || 'dist');
        const clean = url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
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
      });
    },
    async closeBundle() {
      const root = config?.root || process.cwd();
      const outDir = config?.build?.outDir || 'dist';
      const fullOutDir = path.resolve(root, outDir);

      // Perform SSG build into dist/
      await buildToDisk(
        root,
        {
          output: 'index',
          router: enableRouter,
          css: options.css ?? 'inline',
          minify: options.minify ?? true,
          appDir: options.appDir ?? 'src',
        },
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
