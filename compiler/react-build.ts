// React/TSX static renderer.
//
// Server .tsx modules are bundled for Node and rendered with ReactDOM's static
// renderer. React itself never reaches the browser for server components. Files
// named `*.client.tsx` are replaced by an island proxy in the server bundle and
// get an independent browser bundle only when an island is used by a page.
import { build as esbuild, type Loader, type Plugin } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CLIENT_ROUTER_SCRIPT } from './client-router';
import { formatHtml, minifyHtml } from './html';
import {
  buildUrl,
  compileTable,
  outputFile,
  scan,
  type Route,
} from './routes';
import { hashString, type Diagnostic } from './types';
import type { BuildOptions, BuildResult, OutFile, PageOutput, Project } from './build';

interface RenderState {
  clients: string[];
  preloads: string[];
}

interface ServerBundle {
  render(chain: string[], props: Record<string, unknown>): Promise<{ html: string; state: RenderState }>;
  getStaticParams(file: string): Promise<unknown>;
}

interface ClientAsset {
  hash: string;
  source: string;
  chunk: string;
  code: string;
}

const require = createRequire(import.meta.url);
const CLIENT_RE = /\.client\.(?:tsx|jsx)$/;
const MODULE_EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.json', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

function posix(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function dirname(file: string): string {
  const index = file.lastIndexOf('/');
  return index === -1 ? '' : file.slice(0, index);
}

function basename(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
}

function join(from: string, specifier: string): string {
  return posix(path.posix.normalize(path.posix.join(from, specifier)));
}

function loaderFor(file: string): Loader {
  if (file.endsWith('.tsx')) return 'tsx';
  if (file.endsWith('.ts')) return 'ts';
  if (file.endsWith('.jsx')) return 'jsx';
  if (file.endsWith('.json')) return 'json';
  if (file.endsWith('.css')) return 'css';
  return 'js';
}

function diagnostic(code: string, message: string, file = 'src', hint?: string): Diagnostic {
  return { code, message, file, line: 1, column: 1, frame: '', severity: 'error', hint };
}

function simpleHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function resolveProjectFile(files: Record<string, string>, specifier: string, importer = ''): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = 'src/' + specifier.slice(2);
  else if (specifier.startsWith('~/')) base = 'src/' + specifier.slice(2);
  else if (specifier.startsWith('/')) base = specifier.slice(1);
  else if (specifier.startsWith('.')) base = join(dirname(importer), specifier);
  else return null;

  for (const extension of MODULE_EXTENSIONS) {
    const candidate = posix(base + extension);
    if (Object.prototype.hasOwnProperty.call(files, candidate)) return candidate;
  }
  return null;
}

function islandRuntimeSource(): string {
  // Props stay in an escaped data attribute; executable bootstrap code contains
  // only compiler-owned island ids, chunk URLs, and hydration strategies.
  return `
    import * as React from 'react';
    let current = null;
    export function setIslandState(next) { current = next; }
    function boot(id, chunk, strategy, media) {
      const root = 'const r=document.getElementById(' + JSON.stringify(id) + ');if(!r)return;';
      const hydrate = 'if(r.dataset.deshiHydrated)return Promise.resolve();r.dataset.deshiHydrated="1";return import(' + JSON.stringify(chunk) + ').then(m=>{let p={};try{p=JSON.parse(r.getAttribute("data-deshi-props")||"{}")}catch(e){}if(m&&typeof m.default==="function")return m.default(r,{props:p,url:location.href})})';
      let body;
      if (strategy === 'visible') body = root + 'const run=()=>{' + hydrate + '};if(!("IntersectionObserver"in window))run();else{const o=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){o.disconnect();run();break}});o.observe(r)}';
      else if (strategy === 'idle') body = root + 'const run=()=>{' + hydrate + '};const idle=()=>"requestIdleCallback"in window?requestIdleCallback(run,{timeout:2e3}):setTimeout(run,200);if(!("IntersectionObserver"in window))idle();else{const o=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){o.disconnect();idle();break}});o.observe(r)}';
      else if (strategy === 'media') body = root + 'const run=()=>{' + hydrate + '};const q=' + JSON.stringify(media || '') + ';if(!q||!("matchMedia"in window))run();else{const mq=matchMedia(q);if(mq.matches)run();else mq.addEventListener("change",function h(){if(mq.matches){mq.removeEventListener("change",h);run()}})}';
      else if (strategy === 'click') body = root + 'r.addEventListener("click",function(e){if(r.dataset.deshiHydrated)return;const t=e.target;(async()=>{' + hydrate + '})().then(()=>{t&&t.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}))})},true)';
      else body = root + hydrate;
      return '(async()=>{' + body + '})()';
    }
    export function createIsland(Component, source, hash, chunk) {
      function DeshiReactIsland(allProps) {
        if (!current) throw new Error('A .client.tsx component can only render inside the Deshi static renderer.');
        const props = { ...allProps };
        const rawStrategy = props.client;
        const media = typeof props.media === 'string' ? props.media : '';
        delete props.client;
        delete props.media;
        const strategy = typeof rawStrategy === 'string' ? rawStrategy : 'load';
        if (!['load','visible','idle','click','media','only'].includes(strategy)) {
          throw new Error('Unknown island strategy "' + strategy + '" in ' + source);
        }
        if (props.children !== undefined) {
          throw new Error('Children cannot cross a .client.tsx island boundary; pass JSON-serializable props instead.');
        }
        let payload;
        try { payload = JSON.stringify(props); }
        catch { throw new Error('Props passed to ' + source + ' must be JSON-serializable.'); }
        current.clients.add(hash);
        const id = 'd-' + hash + '-' + (++current.count);
        if (strategy === 'load' || strategy === 'only') current.preloads.add(chunk);
        const child = strategy === 'only' ? null : React.createElement(Component, props);
        return React.createElement(React.Fragment, null,
          React.createElement('div', {
            id,
            'data-deshi-island': hash,
            'data-deshi-props': payload,
          }, child),
          React.createElement('script', {
            type: 'module',
            dangerouslySetInnerHTML: { __html: boot(id, chunk, strategy, media) },
          }),
        );
      }
      DeshiReactIsland.displayName = 'Island(' + (Component.displayName || Component.name || 'Component') + ')';
      return DeshiReactIsland;
    }
  `;
}

function projectPlugin(files: Record<string, string>, mode: 'server' | 'client'): Plugin {
  return {
    name: `deshi-react-${mode}`,
    setup(build) {
      if (mode === 'server') {
        build.onResolve({ filter: /^deshi:react-server-runtime$/ }, () => ({
          path: 'deshi:react-server-runtime',
          namespace: 'deshi-react-runtime',
        }));
        build.onLoad({ filter: /.*/, namespace: 'deshi-react-runtime' }, () => ({
          contents: islandRuntimeSource(),
          loader: 'js',
        }));
      }

      build.onResolve({ filter: /^project:/ }, (args) => ({
        path: posix(args.path.slice('project:'.length)),
        namespace: 'deshi-project',
      }));

      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace !== 'deshi-project') return undefined;
        if (args.path.startsWith('deshi:')) return undefined;
        const resolved = resolveProjectFile(files, args.path, args.importer);
        if (resolved) {
          if (mode === 'server' && CLIENT_RE.test(resolved)) {
            return { path: resolved, namespace: 'deshi-island-proxy' };
          }
          return { path: resolved, namespace: 'deshi-project' };
        }
        // Bare imports originate in an in-memory namespace, so esbuild has no
        // physical resolve directory. Resolve packages from the framework root.
        if (!args.path.startsWith('.') && !args.path.startsWith('/')) {
          try {
            return { path: require.resolve(args.path) };
          } catch {
            return undefined;
          }
        }
        return undefined;
      });

      build.onResolve({ filter: /^[^./].*/ }, (args) => {
        if (args.namespace !== 'deshi-react-runtime' && args.namespace !== 'deshi-island-proxy') return undefined;
        if (args.path.startsWith('deshi:')) return undefined;
        try {
          return { path: require.resolve(args.path) };
        } catch {
          return undefined;
        }
      });

      build.onLoad({ filter: /.*/, namespace: 'deshi-island-proxy' }, (args) => {
        const source = posix(args.path);
        const hash = hashString(source);
        const chunk = `/_deshi/islands/${basename(source)}.${hash}.js`;
        return {
          contents: `
            import Component from ${JSON.stringify(`project:${source}`)};
            import { createIsland } from 'deshi:react-server-runtime';
            export default createIsland(Component, ${JSON.stringify(source)}, ${JSON.stringify(hash)}, ${JSON.stringify(chunk)});
          `,
          loader: 'js',
        };
      });

      build.onLoad({ filter: /.*/, namespace: 'deshi-project' }, (args) => {
        const source = files[posix(args.path)];
        if (source === undefined) return null;
        // CSS is collected and injected by the static builder. The server and
        // island JavaScript bundles only need the side-effect import erased.
        if (args.path.endsWith('.css')) return { contents: '', loader: 'js' };
        return { contents: source, loader: loaderFor(args.path), resolveDir: '/' + dirname(posix(args.path)) };
      });
    },
  };
}

async function makeServerBundle(files: Record<string, string>, moduleFiles: string[]): Promise<ServerBundle> {
  const imports = moduleFiles.map((file, index) => `import * as M${index} from ${JSON.stringify(`project:${file}`)};`).join('\n');
  const entries = moduleFiles.map((file, index) => `${JSON.stringify(file)}: M${index}`).join(',\n');
  const entry = `
    import * as React from 'react';
    import { renderToString } from 'react-dom/server';
    import { setIslandState } from 'deshi:react-server-runtime';
    ${imports}
    const modules = { ${entries} };
    export async function render(chain, props) {
      const state = { clients: new Set(), preloads: new Set(), count: 0 };
      setIslandState(state);
      try {
        const page = modules[chain[chain.length - 1]];
        if (!page || typeof page.default !== 'function') throw new Error(chain[chain.length - 1] + ' must default-export a React component.');
        let tree = React.createElement(page.default, props);
        for (let i = chain.length - 2; i >= 0; i--) {
          const layout = modules[chain[i]];
          if (!layout || typeof layout.default !== 'function') throw new Error(chain[i] + ' must default-export a React component.');
          tree = React.createElement(layout.default, props, tree);
        }
        return {
          // Unlike renderToStaticMarkup, renderToString produces markup that
          // React can hydrate at a *.client.tsx island boundary.
          html: renderToString(tree),
          state: { clients: [...state.clients], preloads: [...state.preloads] },
        };
      } finally {
        setIslandState(null);
      }
    }
    export async function getStaticParams(file) {
      const mod = modules[file];
      const get = mod && (mod.getStaticParams || mod.getStaticPaths);
      return typeof get === 'function' ? await get() : undefined;
    }
  `;

  const result = await esbuild({
    stdin: { contents: entry, loader: 'ts', resolveDir: process.cwd(), sourcefile: 'deshi-react-entry.ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    plugins: [projectPlugin(files, 'server')],
  });
  const code = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? result.outputFiles[0]?.text;
  if (!code) throw new Error('The React server bundle was empty.');
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = new Function('module', 'exports', 'require', '__filename', '__dirname', code);
  evaluate(module, module.exports, require, path.join(process.cwd(), '.deshi-react-server.cjs'), process.cwd());
  return module.exports as unknown as ServerBundle;
}

async function makeClientAsset(files: Record<string, string>, source: string, minify: boolean): Promise<ClientAsset> {
  const hash = hashString(source);
  const chunk = `/_deshi/islands/${basename(source)}.${hash}.js`;
  const entry = `
    import * as React from 'react';
    import { createRoot, hydrateRoot } from 'react-dom/client';
    import Component from ${JSON.stringify(`project:${source}`)};
    export default function mount(root, context) {
      const element = React.createElement(Component, context && context.props ? context.props : {});
      if (root.hasChildNodes()) hydrateRoot(root, element);
      else createRoot(root).render(element);
    }
  `;
  const result = await esbuild({
    stdin: { contents: entry, loader: 'tsx', resolveDir: process.cwd(), sourcefile: `${basename(source)}.island.tsx` },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2020',
    jsx: 'automatic',
    write: false,
    minify,
    define: { 'process.env.NODE_ENV': minify ? '"production"' : '"development"' },
    logLevel: 'silent',
    plugins: [projectPlugin(files, 'client')],
  });
  const code = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? result.outputFiles[0]?.text;
  if (!code) throw new Error(`The island bundle for ${source} was empty.`);
  return { hash, source, chunk, code };
}

function injectHead(html: string, head: string): string {
  const index = html.toLowerCase().lastIndexOf('</head>');
  if (index === -1) return head + html;
  return html.slice(0, index) + head + html.slice(index);
}

function ensureDocument(html: string): string {
  const trimmed = html.trim();
  return /^<!doctype/i.test(trimmed) ? trimmed : '<!doctype html>' + trimmed;
}

function shapeIsValid(route: Route, params: Record<string, unknown>): string | null {
  for (const name of route.params) {
    const value = params[name];
    const segment = route.segments.find((item) => item.value === name && item.kind !== 'static')!;
    const valid =
      segment.kind === 'dynamic' ? typeof value === 'string' && value.length > 0
      : segment.kind === 'catchAll' ? Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')
      : value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
    if (!valid) return name;
  }
  return null;
}

export function isReactProject(files: Record<string, string>, appDir?: string): boolean {
  const dir = (appDir ?? (Object.keys(files).some((file) => file.startsWith('src/app/')) ? 'src/app' : 'src')).replace(/\/$/, '');
  return Object.keys(files).some((file) => file.startsWith(dir + '/') && /(?:^|\/)(?:page|index|layout|template|not-found)\.tsx$/.test(file));
}

export async function buildReactSite(project: Project, options: BuildOptions = {}): Promise<BuildResult> {
  const started = performance.now();
  const files = project.files;
  const appDir = (options.appDir ?? (Object.keys(files).some((file) => file.startsWith('src/app/')) ? 'src/app' : 'src')).replace(/\/$/, '');
  const output = options.output ?? 'index';
  const minify = options.minify ?? true;
  const router = options.router ?? false;
  const cssMode = options.css ?? 'inline';
  const diagnostics: Diagnostic[] = [];
  const notes: string[] = [];
  const appFiles = Object.keys(files).filter((file) => file.startsWith(appDir + '/')).map((file) => file.slice(appDir.length + 1));
  const scanned = scan(appFiles);
  diagnostics.push(...scanned.diagnostics.map((item) => ({ ...item, file: `${appDir}/${item.file}` })));

  const moduleFiles = new Set<string>();
  for (const route of scanned.routes) {
    moduleFiles.add(`${appDir}/${route.file}`);
    for (const layout of route.layouts) moduleFiles.add(`${appDir}/${layout}`);
  }
  if (scanned.notFound) moduleFiles.add(`${appDir}/${scanned.notFound}`);

  let server: ServerBundle;
  const clientAssets = new Map<string, ClientAsset>();
  try {
    server = await makeServerBundle(files, [...moduleFiles]);
    for (const source of Object.keys(files).filter((file) => CLIENT_RE.test(file))) {
      const asset = await makeClientAsset(files, source, minify);
      clientAssets.set(asset.hash, asset);
    }
  } catch (error) {
    diagnostics.push(diagnostic('PF6001', (error as Error).message, appDir, 'Check the TSX syntax and imports reported by esbuild.'));
    return {
      ok: false,
      pages: [],
      files: [],
      diagnostics,
      compiled: {},
      routes: scanned.routes,
      manifest: {},
      notes,
      totalMs: Math.round(performance.now() - started),
    };
  }

  const cssText = Object.keys(files)
    .filter((file) => file.startsWith(appDir + '/') && file.endsWith('.css'))
    .sort()
    .map((file) => files[file])
    .join('\n');
  const cssHash = simpleHash(cssText);
  const cssUrl = `/_deshi/app.${cssHash}.css`;
  const origin = options.site ?? 'http://localhost';
  const pages: PageOutput[] = [];

  const renderPage = async (
    url: string,
    route: Route,
    chain: string[],
    params: Record<string, string | string[]>,
    notFound = false,
  ): Promise<void> => {
    const pageStart = performance.now();
    try {
      const rendered = await server.render(chain, {
        params,
        url: new URL(url, origin),
        route: { pattern: route.pattern, file: chain[chain.length - 1] },
        env: { MODE: 'production', BASE_URL: '/', PROD: true },
      });
      let html = ensureDocument(rendered.html);
      let head = '';
      if (cssText) {
        head += cssMode === 'extract'
          ? `<link rel="stylesheet" href="${cssUrl}">`
          : `<style data-deshi-css>${cssText}</style>`;
      }
      for (const preload of rendered.state.preloads) head += `<link rel="modulepreload" href="${preload}">`;
      if (router) {
        head += `<script type="application/json" id="deshi-routes">${JSON.stringify(compileTable(scanned.routes, {}))}</script>`;
        head += '<script type="module" src="/_deshi/router.4f1a9c2e.js"></script>';
      }
      html = injectHead(html, head);
      // Reformatting inserts whitespace text nodes and generic HTML minifiers
      // can rewrite text. Either operation breaks React hydration inside an
      // island, so preserve React's exact server markup on island pages.
      if (rendered.state.clients.length === 0) {
        html = minify ? minifyHtml(html) : formatHtml(html);
      }
      pages.push({
        url,
        pattern: route.pattern,
        sourceFile: chain[chain.length - 1],
        outFile: notFound ? '404.html' : outputFile(url, output),
        html,
        previewHtml: html,
        bytes: new TextEncoder().encode(html).length,
        ms: Math.round((performance.now() - pageStart) * 10) / 10,
        css: cssText ? [cssHash] : [],
        clients: rendered.state.clients,
        params,
        notFound,
      });
    } catch (error) {
      diagnostics.push(diagnostic('PF6002', (error as Error).message, chain[chain.length - 1]));
    }
  };

  if (scanned.rootLayout) {
    for (const route of scanned.routes) {
      const pageFile = `${appDir}/${route.file}`;
      const chain = [...route.layouts.map((layout) => `${appDir}/${layout}`), pageFile];
      let entries: Array<{ url: string; params: Record<string, string | string[]> }> = [];
      if (route.dynamic) {
        let list: unknown;
        try {
          list = await server.getStaticParams(pageFile);
        } catch (error) {
          diagnostics.push(diagnostic('PF3004', `getStaticParams() threw: ${(error as Error).message}`, pageFile));
          continue;
        }
        if (!Array.isArray(list)) {
          diagnostics.push(diagnostic('PF3001', `${route.pattern} must export getStaticParams() returning an array of params.`, pageFile));
          continue;
        }
        const seen = new Set<string>();
        for (const item of list) {
          if (!item || typeof item !== 'object') {
            diagnostics.push(diagnostic('PF3002', `getStaticParams() in ${pageFile} must return an array of objects.`, pageFile));
            continue;
          }
          const params = item as Record<string, string | string[]>;
          const invalid = shapeIsValid(route, params);
          if (invalid) {
            diagnostics.push(diagnostic('PF3002', `Param "${invalid}" has the wrong shape for ${route.pattern}.`, pageFile));
            continue;
          }
          const url = buildUrl(route, params);
          if (!seen.has(url)) {
            seen.add(url);
            entries.push({ url, params });
          }
        }
      } else {
        entries = [{ url: route.pattern, params: {} }];
      }
      for (const entry of entries) await renderPage(entry.url, route, chain, entry.params);
    }

    if (scanned.notFound) {
      const notFoundFile = `${appDir}/${scanned.notFound}`;
      const fakeRoute: Route = {
        pattern: '/404', regexSource: '^\\/404$', regex: /^\/404$/, params: [], segments: [],
        file: scanned.notFound, layouts: [scanned.rootLayout], priority: [], dynamic: false,
      };
      await renderPage('/404', fakeRoute, [`${appDir}/${scanned.rootLayout}`, notFoundFile], {}, true);
    }
  }

  if (!router) {
    for (const page of pages) {
      if (page.clients.length === 0 && /<script\b/i.test(page.html)) {
        diagnostics.push(diagnostic('PF5001', `${page.outFile} contains browser JavaScript outside a .client.tsx island.`, page.sourceFile, 'Move browser behavior into a separate *.client.tsx component.'));
      }
    }
  }

  const out: OutFile[] = pages.map((page) => ({ path: page.outFile, content: page.html, kind: 'html' }));
  if (cssText && cssMode === 'extract') out.push({ path: cssUrl.slice(1), content: cssText, kind: 'css' });
  const usedClients = new Set(pages.flatMap((page) => page.clients));
  for (const hash of usedClients) {
    const asset = clientAssets.get(hash);
    if (asset) out.push({ path: asset.chunk.slice(1), content: asset.code, kind: 'js' });
  }
  if (router) out.push({ path: '_deshi/router.4f1a9c2e.js', content: CLIENT_ROUTER_SCRIPT, kind: 'js' });

  if (output === 'page') {
    const staticPages = pages.filter((page) => !page.notFound);
    out.push({
      path: '_redirects',
      kind: 'text',
      content: [...staticPages.map((page) => `${page.url}  /${page.outFile}  200`), '/*  /404.html  404'].join('\n'),
    });
  }
  if (options.site) {
    const site = options.site.replace(/\/$/, '');
    const urls = pages.filter((page) => !page.notFound).map((page) => `  <url><loc>${site}${page.url === '/' ? '/' : page.url}</loc></url>`);
    out.push({ path: 'sitemap.xml', kind: 'text', content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>` });
    out.push({ path: 'robots.txt', kind: 'text', content: `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml` });
  }
  for (const file of Object.keys(files)) {
    if (file.startsWith('src/public/')) out.push({ path: file.slice('src/public/'.length), content: files[file], kind: 'text' });
  }

  const manifest = {
    version: 2,
    renderer: 'react-static',
    output,
    router,
    routes: scanned.routes.map((route) => ({
      pattern: route.pattern,
      file: `${appDir}/${route.file}`,
      layouts: route.layouts.map((layout) => `${appDir}/${layout}`),
      pages: pages.filter((page) => page.pattern === route.pattern).map((page) => ({
        url: page.url, file: page.outFile, params: page.params, clients: page.clients,
      })),
    })),
    islands: Object.fromEntries([...clientAssets].map(([hash, asset]) => [hash, { source: asset.source, chunk: asset.chunk }])),
  };
  out.push({ path: '.deshi/manifest.json', content: JSON.stringify(manifest, null, 2), kind: 'json' });

  const errors = diagnostics.filter((item) => item.severity === 'error');
  return {
    ok: errors.length === 0,
    pages,
    files: out,
    diagnostics,
    compiled: {},
    routes: scanned.routes,
    manifest,
    notes,
    totalMs: Math.round(performance.now() - started),
  };
}
