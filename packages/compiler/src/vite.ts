import type { Plugin, ViteDevServer, PreviewServer, ResolvedConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compile } from './index';
import { build as buildSite, buildToDisk, type BuildResult } from './build';
import { hashString } from './types';
import { CLIENT_ROUTER_SCRIPT } from './client-router';
import { loadConfig, mergeConfig, defaultConfig } from './config';
import { isCodeFile, isSourceFile } from './filetype';
import { prepareHighlight } from './highlight';

// Virtual per-file CSS served through Vite's pipeline (postcss, HMR):
// codegen emits `import "/_deshi/<hash>.css"` per CSS-having file (React-style),
// resolveId/load below serve the text, and vite:css transforms it like any CSS.
const deshiCss = new Map<string, string>();
const deshiClientJs = new Map<string, string>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * True for ids Vite generates itself, which must never be compiled as Deshi
 * source. The important case is the HTML proxy: Vite lifts inline
 * `<script type="module">` out of HTML into `/index.html?html-proxy&index=0.js`.
 * Stripping the query would leave `index.html` — a source extension — so we'd
 * try to parse the island's JavaScript as a template (PF4001).
 */
export function isViteInternalId(id: string): boolean {
  if (id.startsWith('\0')) return true;
  const q = id.indexOf('?');
  if (q === -1) return false;
  return id
    .slice(q + 1)
    .split('&')
    .some(
      (part) =>
        part.includes('html-proxy') ||
        part.startsWith('raw') ||
        part.startsWith('url') ||
        /\.(js|ts|mjs|cjs|jsx|tsx)$/.test(part),
    );
}

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
  const lastCompile = new Map<string, { evalBody: string; clientBody: string; css: string; hasCss: boolean; hash: string }>();

  function toPosix(p: string): string {
    return p.replace(/\\/g, '/');
  }

  function isDeshiSource(file: string): boolean {
    return isSourceFile(file);
  }

  function cssOnlyChange(
    prev: { evalBody: string; clientBody: string; css: string; hasCss: boolean } | undefined,
    next: { evalBody: string; clientBody: string; css: string; hasCss: boolean },
  ): boolean {
    if (!prev) return false;
    if (!prev.hasCss || !next.hasCss) return false;
    if (prev.evalBody !== next.evalBody) return false;
    if (prev.clientBody !== next.clientBody) return false;
    return prev.css !== next.css;
  }

  function sendCssUpdate(server: ViteDevServer, cssUrl: string, css: string) {
    deshiCss.set(cssUrl, css);
    server.moduleGraph.urlToModuleMap.forEach((mod, key) => {
      if (key === cssUrl || key.startsWith(cssUrl + '?')) server.moduleGraph.invalidateModule(mod);
    });
    server.ws.send({
      type: 'update',
      updates: [
        {
          type: 'css-update',
          path: cssUrl,
          acceptedPath: cssUrl,
          timestamp: Date.now(),
        },
      ],
    });
  }

  // Cached merged config (file + inline options)
  let deshiConfig: any = null;
  // Shiki options resolved from config; null = highlighting disabled.
  let highlightOpts: { theme?: string; langs?: string[] } | null = null;
  async function getDeshiConfig(root: string) {
    if (deshiConfig) return deshiConfig;
    const fileCfg = await loadConfig(root);
    deshiConfig = mergeConfig(mergeConfig(defaultConfig as any, fileCfg), options as any);
    return deshiConfig;
  }

  function highlightOptions(dc: any): { theme?: string; langs?: string[] } | null {
    const s = dc?.markdown?.shikiConfig;
    if (s && s.enabled === false) return null;
    return { theme: s?.theme ?? 'github-dark', langs: s?.langs ?? [] };
  }

  return {
    name: 'vite-plugin-deshi',
    async config(cfg, env) {
      const root = cfg.root || process.cwd();
      const dc = await getDeshiConfig(root);
      // Load Shiki once up front so the synchronous document layer can highlight.
      highlightOpts = highlightOptions(dc);
      if (highlightOpts) await prepareHighlight(highlightOpts);
      return {
        build: {
          rollupOptions: {
            input: virtualEntryId,
          },
        },
        base: dc.base ?? cfg.base,
        // Astro parity: src/public/ is served at / and copied to dist/.
        // Without this, /favicon.ico falls through to the SPA fallback
        // and downloads "/" HTML on every page (browser auto-requests it).
        publicDir: cfg.publicDir ?? 'src/public',
      };
    },
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    // Vite HMR: CSS-only .deshi edits update <link> sheets; template/script edits full-reload.
    async handleHotUpdate(ctx) {
      if (!isDeshiSource(ctx.file)) return undefined;
      cachedBuild = null;
      const root = ctx.server.config.root || process.cwd();
      const rel = toPosix(path.relative(root, ctx.file));
      const source = await ctx.read();
      try {
        const result = compile(source, {
          file: rel,
          minify: false,
          runtimeImport: virtualRuntimeId,
          stableCssUrl: true,
        });
        const css = `${result.css.scoped}\n${result.css.global}`.trim();
        const snap = {
          evalBody: result.evalBody,
          clientBody: result.client?.body ?? '',
          css,
          hasCss: result.meta.hasCss,
          hash: result.meta.hash,
        };
        const prev = lastCompile.get(rel);
        lastCompile.set(rel, snap);
        const cssUrl = `/_deshi/${result.meta.hash}.css`;
        if (cssOnlyChange(prev, snap)) {
          sendCssUpdate(ctx.server, cssUrl, css);
          return [];
        }
      } catch {
        // compile error — fall through to full reload so the overlay/page refreshes
      }
      ctx.server.ws.send({ type: 'full-reload' });
      return [];
    },
    resolveId(id) {
      if (id === virtualEntryId) {
        return resolvedVirtualEntryId;
      }
      if (id === 'deshi:content' || id === 'deshi/content' || id === 'deshijs:content' || id === 'deshijs/content') {
        return '\0virtual:deshi/content';
      }
      if (id === 'deshi:config' || id === 'virtual:deshi/config' || id === 'deshijs:config' || id === 'virtual:deshijs/config') {
        return '\0virtual:deshi/config';
      }
      if (id === 'deshi/runtime' || id === 'deshijs/runtime' || id === virtualRuntimeId || id === 'virtual:deshijs/runtime') {
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
      // Never compile Vite's own virtual modules (e.g. the HTML proxy that
      // carries an inline island <script> extracted from generated HTML).
      if (isViteInternalId(id)) return null;
      if (isSourceFile(cleanId)) {
        const result = compile(code, {
          file: cleanId,
          minify: options.minify ?? false,
          runtimeImport: virtualRuntimeId,
          stableCssUrl: true,
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
        const cssUrl = `/_deshi/${result.meta.hash}.css`;
        if (result.meta.hasCss) deshiCss.set(cssUrl, `${result.css.scoped}\n${result.css.global}`.trim());
        return {
          code: result.code,
          map: null,
        };
      }
      return null;
    },
    configureServer(server: ViteDevServer) {
      // Route add/remove is not a CSS patch — rebuild the page graph.
      const reloadTree = (file: string) => {
        if (!isDeshiSource(file)) return;
        cachedBuild = null;
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reloadTree);
      server.watcher.on('unlink', reloadTree);
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '/';
        const qIndex = rawUrl.indexOf('?');
        const url = qIndex === -1 ? rawUrl.split('#')[0] : rawUrl.slice(0, qIndex);
        const qs = qIndex === -1 ? '' : rawUrl.slice(qIndex);
        // Collapse `//` and decode defensively so route matching sees one
        // canonical path (prevents `/about//` vs `/about` double evaluation).
        let cleanUrl = url.replace(/\/{2,}/g, '/');
        try {
          cleanUrl = decodeURI(cleanUrl);
        } catch {
          /* keep raw — downstream match() handles it as-is */
        }
        if (cleanUrl.length > 1 && cleanUrl.endsWith('/')) {
          res.statusCode = 308;
          res.setHeader('Location', cleanUrl.slice(0, -1) + qs);
          res.end();
          return;
        }

        // Never let the SPA fallback answer favicon requests with HTML.
        // Browsers auto-request /favicon.ico on every navigation when no
        // <link rel="icon"> exists — that HTML-blob download is the bug.
        if (cleanUrl === '/favicon.ico' || cleanUrl === '/favicon.svg') {
          const root = server.config.root || process.cwd();
          for (const cand of [
            path.join(root, 'src/public/favicon.svg'),
            path.join(root, 'src/public/favicon.ico'),
            path.join(root, 'public/favicon.svg'),
            path.join(root, 'public/favicon.ico'),
          ]) {
            try {
              if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
                const isSvg = cand.endsWith('.svg');
                res.setHeader('Content-Type', isSvg ? 'image/svg+xml' : 'image/x-icon');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.statusCode = 200;
                res.end(fs.readFileSync(cand));
                return;
              }
            } catch {
              // try next candidate
            }
          }
          // No file on disk — 204 stops the browser retrying + stops the
          // HTML fallback from being parsed as an icon on every page.
          res.statusCode = 204;
          res.end();
          return;
        }

        // Serve client SPA router script
        if (cleanUrl === '/_deshi/router.4f1a9c2e.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.statusCode = 200;
          res.end(CLIENT_ROUTER_SCRIPT);
          return;
        }
        // Per-file CSS through Vite's pipeline (postcss, url rebasing), served
        // as text/css so <link> stylesheets apply. Vite's default JS-module
        // form only works for JS `import`s, so request `?direct` internally —
        // page markup stays identical between dev and prod.
        if (cleanUrl.startsWith('/_deshi/c/') && deshiClientJs.has(cleanUrl)) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.statusCode = 200;
          res.end(deshiClientJs.get(cleanUrl)!);
          return;
        }

        if (/^\/_deshi\/[^/]+\.css$/.test(cleanUrl)) {
          try {
            const t = await server.transformRequest(cleanUrl + '?direct');
            if (t && typeof t.code === 'string') {
              res.setHeader('Content-Type', 'text/css; charset=utf-8');
              res.statusCode = 200;
              res.end(t.code);
              return;
            }
          } catch {
            // fall through to the raw registry below
          }
          const raw = deshiCss.get(cleanUrl);
          if (raw !== undefined) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.statusCode = 200;
            res.end(raw);
            return;
          }
          return next();
        }

        if (cleanUrl.startsWith('/@') || cleanUrl.startsWith('/node_modules') || (cleanUrl.includes('.') && !cleanUrl.endsWith('.html'))) {
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
              } else if (item.isFile() && (isSourceFile(item.name) || isCodeFile(item.name))) {
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
                // Extract + stable URLs so Vite can HMR styles without a document reload.
                css: 'extract',
                stableCssUrl: true,
                minify: false,
                appDir: (dcDev as any).appDir ?? 'src',
                site: (dcDev as any).site,
                highlight: highlightOpts ?? undefined,
              } as any
            );
            cachedBuild = { fp, result };
            for (const [f, res] of Object.entries(result.compiled)) {
              lastCompile.set(f, {
                evalBody: res.evalBody,
                clientBody: res.client?.body ?? '',
                css: `${res.css.scoped}\n${res.css.global}`.trim(),
                hasCss: res.meta.hasCss,
                hash: res.meta.hash,
              });
            }
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
        // Defensive: never let `/%2e%2e/...` or NUL bytes escape `base`.
        let clean = url;
        try {
          clean = decodeURI(clean);
        } catch {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }
        if (clean.includes('\0') || /(^|\/)\.\.(\/|$)/.test(clean)) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }
        clean = clean.replace(/\/{2,}/g, '/');
        // Same guard as dev: /favicon.* must never hit the HTML fallback.
        if (clean === '/favicon.ico' || clean === '/favicon.svg') {
          const root = config?.root || process.cwd();
          const outDir = config?.build?.outDir || 'dist';
          for (const cand of ['favicon.svg', 'favicon.ico']) {
            try {
              const f = path.join(path.resolve(root, outDir), cand);
              if (f.startsWith(path.resolve(root, outDir)) && fs.statSync(f).isFile()) {
                res.setHeader('Content-Type', cand.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.statusCode = 200;
                res.end(fs.readFileSync(f));
                return;
              }
            } catch {
              // miss — try next candidate
            }
          }
          res.statusCode = 204;
          res.end();
          return;
        }
        if (clean.length > 1 && clean.endsWith('/')) {
          res.statusCode = 308;
          res.setHeader('Location', clean.slice(0, -1) + qs);
          res.end();
          return;
        }
        if (clean.includes('.')) return next(); // real files: sirv handles them
        const root = config?.root || process.cwd();
        const base = path.resolve(root, config?.build?.outDir || 'dist');
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
          highlight: highlightOpts ?? undefined,
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
