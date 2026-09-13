// In-browser equivalent of the @deshi/vite build orchestration (§6.3 / §6.5):
// compile every .html, evaluate render modules, enumerate URLs, render each URL,
// merge <head>, inject CSS / client bootstrap, write the output tree + manifest,
// and enforce the zero-JS gate.
import * as acorn from 'acorn';
import { transformSync } from 'esbuild';
import { compile, type CompileResult } from './index';
import { scopedCssUrl } from './css';
import { CLIENT_ROUTER_SCRIPT } from './client-router';
import { ISLANDS_RUNTIME } from './islands';
import { formatHtml, minifyHtml } from './html';
import { ACORN_OPTIONS, JsxParser } from './expression';
import {
  buildUrl,
  compileTable,
  match,
  outputFile,
  patternOf,
  parseSegment,
  isGroup,
  scan,
  type Route,
  type Segment,
} from './routes';
import {
  bindings as makeBindings,
  mergeHead,
  resetCache,
  runtime,
  cache,
  raw,
  type RenderCtx,
  type RenderModule,
  type SlotFns,
} from './runtime';
import { DeshiError, type Diagnostic } from './types';

export interface Project {
  /** file path (project-relative, e.g. "src/app/page.html") → source */
  files: Record<string, string>;
}

export interface BuildOptions {
  output?: 'page' | 'index';
  router?: boolean;
  css?: 'extract' | 'inline';
  site?: string;
  minify?: boolean;
  appDir?: string; // defaults to 'src' (or 'src/app' if present)
}

export interface PageOutput {
  url: string;
  pattern: string;
  sourceFile: string;
  outFile: string;
  html: string;
  previewHtml: string;
  bytes: number;
  ms: number;
  css: string[];
  clients: string[];
  params: Record<string, string | string[]>;
  notFound?: boolean;
}

export interface OutFile {
  path: string;
  content: string;
  kind: 'html' | 'css' | 'js' | 'json' | 'text';
}

export interface BuildResult {
  ok: boolean;
  pages: PageOutput[];
  files: OutFile[];
  diagnostics: Diagnostic[];
  compiled: Record<string, CompileResult>;
  routes: Route[];
  manifest: unknown;
  notes: string[];
  totalMs: number;
}

type ModuleNs = Record<string, unknown> & { default?: unknown; __deshi?: RenderModule['__deshi'] };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}
function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
}
function joinPath(dir: string, rel: string): string {
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function diag(code: string, message: string, file: string, severity: 'error' | 'warning' = 'error', hint?: string): Diagnostic {
  return { code, message, file, line: 1, column: 1, frame: '', severity, hint };
}

/** Evaluate a plain JS/TS helper module (src/lib/*.js|ts) — imports/exports rewritten via the ESTree. */
function jsModuleBody(source: string, file: string): string {
  let program: acorn.Program;
  let src = source;
  try {
    program = acorn.parse(source, ACORN_OPTIONS);
  } catch (e) {
    // TypeScript helper: strip types, then parse (same fallback as <script>).
    // All slicing below must use the stripped source the positions came from.
    try {
      src = transformSync(source, {
        loader: 'tsx',
        format: 'esm',
        tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      }).code;
      program = JsxParser.parse(src, ACORN_OPTIONS) as acorn.Program;
    } catch {
      throw new DeshiError(diag('PF4001', `${file}: ${(e as Error).message}`, file));
    }
  }
  const out: string[] = [];
  const exportsList: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const node of program.body as any[]) {
    if (node.type === 'ImportDeclaration') {
      const src = JSON.stringify(node.source.value);
      const def = node.specifiers.find((s: { type: string }) => s.type === 'ImportDefaultSpecifier');
      const ns = node.specifiers.find((s: { type: string }) => s.type === 'ImportNamespaceSpecifier');
      const named = node.specifiers.filter((s: { type: string }) => s.type === 'ImportSpecifier');
      if (def) out.push(`const ${def.local.name} = (await $import(${src})).default;`);
      if (ns) out.push(`const ${ns.local.name} = await $import(${src});`);
      if (named.length) {
        out.push(`const { ${named.map((s: { imported: { name: string }; local: { name: string } }) => `${s.imported.name}: ${s.local.name}`).join(', ')} } = await $import(${src});`);
      }
      if (!node.specifiers.length) out.push(`await $import(${src});`);
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        out.push(src.slice(node.declaration.start, node.declaration.end));
        const decl = node.declaration;
        if (decl.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier') exportsList.push(d.id.name);
        if (decl.id) exportsList.push(decl.id.name);
      }
      for (const s of node.specifiers ?? []) exportsList.push(`${s.exported.name}: ${s.local.name}`);
    } else if (node.type === 'ExportDefaultDeclaration') {
      out.push(`const __default = ${src.slice(node.declaration.start, node.declaration.end)};`);
      exportsList.push('default: __default');
    } else {
      out.push(src.slice(node.start, node.end));
    }
  }
  out.push(`return { ${exportsList.join(', ')} };`);
  return out.join('\n');
}

export async function build(project: Project, options: BuildOptions = {}): Promise<BuildResult> {
  const opts = {
    output: options.output ?? ('index' as const),
    router: options.router ?? true,
    css: options.css ?? ('inline' as const),
    minify: options.minify ?? true,
    site: options.site,
    appDir: options.appDir,
  };
  const t0 = performance.now();
  resetCache();
  const diagnostics: Diagnostic[] = [];
  const compiled: Record<string, CompileResult> = {};
  const modules = new Map<string, ModuleNs>();
  const loading = new Set<string>();
  const notes: string[] = [];
  const files = project.files;
  const appDir = (opts.appDir ?? (Object.keys(files).some((f) => f.startsWith('src/app/')) ? 'src/app' : 'src')).replace(/\/$/, '');

  const appFiles = Object.keys(files)
    .filter((f) => f.startsWith(appDir + '/'))
    .map((f) => f.slice(appDir.length + 1));
  const scanned = scan(appFiles);
  diagnostics.push(...scanned.diagnostics.map((d) => ({ ...d, file: `${appDir}/${d.file}` })));

  const layoutPattern = (rel: string): string => {
    const segs: Segment[] = [];
    for (const dir of dirname(rel).split('/').filter(Boolean)) {
      if (isGroup(dir)) continue;
      const s = parseSegment(dir);
      if (!('error' in s)) segs.push(s);
    }
    return patternOf(segs);
  };

  const getCompiled = (file: string): CompileResult => {
    if (compiled[file]) return compiled[file];
    const source = files[file];
    if (source === undefined) throw new DeshiError(diag('PF4004', `Component file not found: ${file}`, file));
    const rel = file.startsWith(appDir + '/') ? file.slice(appDir.length + 1) : null;
    const isLayout = rel ? /(^|\/)(layout|template)\.(deshi|html)$/.test(rel) : false;
    const res = compile(source, {
      file,
      minify: opts.minify,
      isLayout,
      segment: opts.router && isLayout && rel ? layoutPattern(rel) : null,
    });
    compiled[file] = res;
    diagnostics.push(...res.diagnostics);
    return res;
  };

  const resolve = (spec: string, from: string): string => {
    if (spec.startsWith('~/')) {
      const base = 'src/' + spec.slice(2);
      for (const cand of [base, base + '.js', base + '.ts', base + '.deshi', base + '.html', base + '.md', base + '/index.js']) if (files[cand] !== undefined) return cand;
      return base;
    }
    if (spec.startsWith('./') || spec.startsWith('../')) return joinPath(dirname(from), spec);
    return spec;
  };

  const importModule = async (spec: string, from: string): Promise<ModuleNs> => {
    if (spec === 'deshi') return { cache, raw, defineConfig: (c: unknown) => c };
    const file = resolve(spec, from);
    if (modules.has(file)) return modules.get(file)!;
    if (loading.has(file)) throw new DeshiError(diag('PF4003', `Import cycle: ${from} → ${file}`, from));
    if (files[file] === undefined) {
      const code = (file.endsWith('.deshi') || file.endsWith('.html') || file.endsWith('.md')) ? 'PF4004' : 'PF5002';
      throw new DeshiError(diag(code, `Cannot resolve "${spec}" from ${from} (${file} not found)`, from));
    }
    loading.add(file);
    try {
      const $import = (s: string) => importModule(s, file);
      let ns: ModuleNs;
      if (file.endsWith('.deshi') || file.endsWith('.html') || file.endsWith('.md')) {
        const res = getCompiled(file);
        const fn = new AsyncFunction('$rt', '$import', res.evalBody);
        ns = (await fn(runtime, $import)) as ModuleNs;
      } else {
        const fn = new AsyncFunction('$import', jsModuleBody(files[file], file));
        ns = (await fn($import)) as ModuleNs;
      }
      modules.set(file, ns);
      return ns;
    } finally {
      loading.delete(file);
    }
  };

  const loadRender = async (file: string): Promise<RenderModule> => {
    const ext = file.endsWith('.deshi') ? '.deshi' : file.endsWith('.html') ? '.html' : file.endsWith('.md') ? '.md' : '';
    const rel = ext ? './' + basename(file) + ext : './' + basename(file);
    const ns = await importModule(rel, dirname(file) + '/x');
    return ns.default as RenderModule;
  };

  const toDiag = (e: unknown, file: string, code: string): Diagnostic => {
    if (e instanceof DeshiError) return e.toDiagnostic();
    const err = e as Error;
    return diag(code, `${err?.message ?? String(e)}`, file, 'error', 'Runtime errors inside <script> bodies map back to the source line via source maps.');
  };

  // Compile every component/page file up front so that diagnostics cover unused files too.
  for (const f of Object.keys(files)) {
    if (!f.endsWith('.html') && !f.endsWith('.deshi') && !f.endsWith('.md')) continue;
    try {
      getCompiled(f);
    } catch (e) {
      diagnostics.push(toDiag(e, f, 'PF4001'));
    }
  }

  const cssByHash: Record<string, { scoped: string; global: string; file: string; url: string | null }> = {};
  const clientByHash: Record<string, { code: string; body: string; file: string; chunk: string }> = {};
  for (const [f, res] of Object.entries(compiled)) {
    if (res.meta.hasCss) cssByHash[res.meta.hash] = { scoped: res.css.scoped, global: res.css.global, file: f, url: scopedCssUrl(res.css.scoped) };
    if (res.client) clientByHash[res.meta.hash] = { code: res.client.code, body: res.client.body, file: f, chunk: `/_deshi/c/${basename(f)}.${res.meta.hash}.js` };
  }

  // Split CSS (Astro-style): one shared global bundle for all <style global>
  // blocks + one immutable file per scoped owner. Filenames are content-hashed
  // so layout CSS is downloaded once and shared across pages.
  const globalText = Object.values(cssByHash)
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((c) => c.global)
    .join('');
  const globalName = `/_deshi/global.${simpleHash(globalText)}.css`;

  const pages: PageOutput[] = [];
  const routes = scanned.routes;
  const rootLayout = scanned.rootLayout ? `${appDir}/${scanned.rootLayout}` : null;
  const origin = opts.site ?? 'http://localhost';

  // Static chunk table per route (deps graph from compiler meta), used by the router table.
  const routeChunks: Record<string, string[]> = {};
  const collectClients = (file: string, seen: Set<string>, acc: Set<string>) => {
    if (seen.has(file)) return;
    seen.add(file);
    const res = compiled[file];
    if (!res) return;
    if (res.meta.hasClient) acc.add(clientByHash[res.meta.hash]?.chunk ?? '');
    for (const dep of res.meta.deps) collectClients(resolve(dep, file), seen, acc);
  };
  for (const r of routes) {
    const acc = new Set<string>();
    for (const f of [...r.layouts, r.file]) collectClients(`${appDir}/${f}`, new Set(), acc);
    routeChunks[r.pattern] = [...acc].filter(Boolean);
  }

  const renderUrl = async (
    url: string,
    chain: string[],
    pattern: string,
    params: Record<string, string | string[]>,
    notFound = false,
  ): Promise<PageOutput> => {
    const start = performance.now();
    const ctx: RenderCtx = {
      params,
      url: new URL(url, origin),
      route: { pattern, file: chain[chain.length - 1] },
      env: { MODE: 'production', BASE_URL: '/', PROD: 'true' },
      head: [],
      css: new Set(),
      clients: new Set(),
      used: new Set(),
      depth: 0,
      segments: opts.router,
      islands: 0,
      preloads: new Set<string>(),
    };
    const run = async (i: number): Promise<string> => {
      const file = chain[i];
      const mod = await loadRender(file);
      ctx.used.add(file);
      if (mod.__deshi.css) ctx.css.add(mod.__deshi.hash);
      const slotFns: SlotFns = {};
      if (i < chain.length - 1) {
        slotFns.default = async () => {
          ctx.depth++;
          try {
            return await run(i + 1);
          } finally {
            ctx.depth--;
          }
        };
      }
      return mod(makeBindings(ctx, {}, slotFns), slotFns, ctx);
    };

    let html = await run(0);

    // head
    let head = mergeHead(ctx.head);
    const cssText = [...ctx.css].map((h) => (cssByHash[h]?.scoped ?? '') + (cssByHash[h]?.global ?? '')).join('');
    let previewHead = head;
    if (opts.css === 'extract' && (globalText || cssText)) {
      // Global bundle first, then only the scoped files this page uses.
      if (globalText) head += `<link rel="stylesheet" href="${globalName}">`;
      for (const h of ctx.css) {
        const u = cssByHash[h]?.url;
        if (u) head += `<link rel="stylesheet" href="${u}">`;
      }
      if (cssText) previewHead += `<style>${cssText}</style>`;
    } else if (cssText) {
      head += `<style>${cssText}</style>`;
      previewHead += `<style>${cssText}</style>`;
    }
    for (const href of ctx.preloads) {
      head += `<link rel="modulepreload" href="${href}">`;
    }
    if (opts.router) {
      const tags = `<script type="application/json" id="deshi-routes">${JSON.stringify(compileTable(routes, routeChunks))}</script><script type="module" src="/_deshi/router.4f1a9c2e.js"></script>`;
      head += tags;
    }

    let tail = '';
    let previewTail = '';
    if (ctx.islands > 0) {
      tail = `<script type="module" src="/_deshi/islands.js"></script>`;
      previewTail = `<script type="module" src="/_deshi/islands.js"></script>`;
    }
    previewTail += PREVIEW_NAV_SCRIPT;

    const marker = '<!--deshi:head-->';
    const mi = html.indexOf(marker);
    const inject = (h: string, t: string) => {
      let out = mi === -1 ? html : html.slice(0, mi) + h + html.slice(mi + marker.length);
      if (t) {
        const bi = out.lastIndexOf('</body>');
        out = bi === -1 ? out + t : out.slice(0, bi) + t + out.slice(bi);
      }
      return out;
    };
    const finalHtml = inject(head, tail);
    const previewHtml = inject(previewHead, previewTail);
    html = opts.minify ? minifyHtml(finalHtml) : formatHtml(finalHtml);

    return {
      url,
      pattern,
      sourceFile: chain[chain.length - 1],
      outFile: notFound ? '404.html' : outputFile(url, opts.output),
      html,
      previewHtml,
      bytes: new TextEncoder().encode(html).length,
      ms: Math.round((performance.now() - start) * 10) / 10,
      css: [...ctx.css],
      clients: [...ctx.clients],
      params,
      notFound,
    };
  };

  if (rootLayout && files[rootLayout] !== undefined) {
    for (const route of routes) {
      const pageFile = `${appDir}/${route.file}`;
      const chain = [...route.layouts.map((l) => `${appDir}/${l}`), pageFile];
      let urls: Array<{ url: string; params: Record<string, string | string[]> }> = [];
      try {
        if (route.dynamic) {
          const ext = pageFile.endsWith('.deshi')
            ? '.deshi'
            : pageFile.endsWith('.html')
              ? '.html'
              : pageFile.endsWith('.md')
                ? '.md'
                : '';
          const rel = ext ? './' + basename(pageFile) + ext : './' + basename(pageFile);
          const ns = await importModule(rel, dirname(pageFile) + '/x');
          const gsp = (ns.getStaticParams ?? ns.getStaticPaths) as undefined | (() => unknown);
          if (typeof gsp !== 'function') {
            diagnostics.push(diag('PF3001', `${route.pattern} is a dynamic route: ${pageFile} must export getStaticParams() — alias getStaticPaths also accepted (Astro parity)`, pageFile, 'error', 'export async function getStaticParams() { return [{ slug: "hello" }]; }'));
            continue;
          }
          let list: unknown;
          try {
            list = await gsp();
          } catch (e) {
            diagnostics.push({ ...toDiag(e, pageFile, 'PF3004'), code: 'PF3004', message: `getStaticParams() threw: ${(e as Error).message}` });
            continue;
          }
          if (!Array.isArray(list) || list.some((p) => !p || typeof p !== 'object')) {
            diagnostics.push(diag('PF3002', `getStaticParams() in ${pageFile} must return an array of objects`, pageFile));
            continue;
          }
          const seen = new Set<string>();
          for (const p of list as Record<string, unknown>[]) {
            for (const name of route.params) {
              const v = p[name];
              const seg = route.segments.find((s) => s.value === name && s.kind !== 'static')!;
              const okShape =
                seg.kind === 'dynamic' ? typeof v === 'string' && v.length > 0
                : seg.kind === 'catchAll' ? Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')
                : v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
              if (!okShape) {
                diagnostics.push(diag('PF3002', `getStaticParams() in ${pageFile}: param "${name}" has the wrong shape (${JSON.stringify(v)}) for segment ${route.pattern}`, pageFile));
              }
            }
            const url = buildUrl(route, p as Record<string, string | string[]>);
            if (seen.has(url)) continue;
            seen.add(url);
            urls.push({ url, params: p as Record<string, string | string[]> });
          }
        } else {
          urls = [{ url: route.pattern, params: {} }];
        }
        for (const { url, params } of urls) {
          try {
            pages.push(await renderUrl(url, chain, route.pattern, params));
          } catch (e) {
            diagnostics.push(toDiag(e, pageFile, 'PF3003'));
          }
        }
      } catch (e) {
        diagnostics.push(toDiag(e, pageFile, 'PF3003'));
      }
    }

    // 404
    if (scanned.notFound) {
      try {
        pages.push(await renderUrl('/404', [rootLayout, `${appDir}/${scanned.notFound}`], '/404', {}, true));
      } catch (e) {
        diagnostics.push(toDiag(e, `${appDir}/${scanned.notFound}`, 'PF3003'));
      }
    }
  }

  // zero-JS gate (C2)
  if (!opts.router) {
    for (const p of pages) {
      if (p.clients.length) continue;
      if (p.html.toLowerCase().includes('<script')) {
        diagnostics.push(diag('PF5001', `${p.outFile} contains a <script> tag but no component in its render tree has a <script client> block (zero-JS mode)`, p.sourceFile, 'error', 'Move browser code into a <script client> block, or enable the router.'));
      }
    }
  }

  // output tree
  const out: OutFile[] = [];
  for (const p of pages) out.push({ path: p.outFile, content: p.html, kind: 'html' });
  const usedCss = new Set<string>();
  if (opts.css === 'extract') {
    // One shared global bundle + one file per scoped owner actually used.
    if (globalText) {
      usedCss.add(globalName);
      out.push({ path: globalName.slice(1), content: globalText, kind: 'css' });
    }
    for (const p of pages) {
      for (const h of p.css) {
        const c = cssByHash[h];
        if (c?.url && !usedCss.has(c.url)) {
          usedCss.add(c.url);
          out.push({ path: c.url.slice(1), content: c.scoped, kind: 'css' });
        }
      }
    }
  }
  const usedClient = new Set<string>();
  for (const p of pages) for (const h of p.clients) usedClient.add(h);
  for (const [h, c] of Object.entries(clientByHash)) {
    if (usedClient.has(h)) out.push({ path: c.chunk.slice(1), content: c.code, kind: 'js' });
  }
  if (usedClient.size) out.push({ path: '_deshi/islands.js', content: ISLANDS_RUNTIME, kind: 'js' });
  if (opts.router) out.push({ path: '_deshi/router.4f1a9c2e.js', content: CLIENT_ROUTER_SCRIPT, kind: 'js' });

  if (opts.output === 'page') {
    const staticPages = pages.filter((p) => !p.notFound);
    out.push({
      path: '_redirects',
      kind: 'text',
      content: ['# Deshi output:"page" — serve /about from /about/page.html (Netlify / Cloudflare Pages)', ...staticPages.map((p) => `${p.url}  /${p.outFile}  200`), '/*  /404.html  404'].join('\n'),
    });
    out.push({
      path: 'vercel.json',
      kind: 'json',
      content: JSON.stringify({ rewrites: staticPages.map((p) => ({ source: p.url, destination: '/' + p.outFile })), trailingSlash: false }, null, 2),
    });
    out.push({
      path: 'nginx.conf',
      kind: 'text',
      content: ['# Deshi output:"page"', 'location / {', '  try_files $uri $uri/page.html =404;', '  error_page 404 /404.html;', '}'].join('\n'),
    });
    notes.push('output:"page" mirrors the source tree (about/page.html). Host rewrite files (_redirects, vercel.json, nginx.conf) were emitted so /about serves /about/page.html; `deshi preview` honors them.');
  }
  if (opts.site) {
    const urls = pages.filter((p) => !p.notFound).map((p) => `  <url><loc>${opts.site!.replace(/\/$/, '')}${p.url === '/' ? '/' : p.url}</loc></url>`);
    out.push({ path: 'sitemap.xml', kind: 'text', content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>` });
    out.push({ path: 'robots.txt', kind: 'text', content: `User-agent: *\nAllow: /\nSitemap: ${opts.site.replace(/\/$/, '')}/sitemap.xml` });
  }
  // Astro-like endpoints: if any route file is a bare .js/.ts endpoint, it was compiled as an html page
  // but with json content-type hint — emit .json beside the html for API compat (e.g. /api/hello → /api/hello.json)
  for (const r of routes) {
    if (r.file.endsWith('.js') || r.file.endsWith('.ts')) {
      const epPages = pages.filter(p=>p.sourceFile.endsWith('.js')||p.sourceFile.endsWith('.ts'));
      for (const pg of epPages) {
        // duplicate handling: endpoint pages already emit html; add json mirror
        const jsonPath = pg.outFile.replace(/\.html$/, '.json');
        if (!out.some(o=>o.path===jsonPath)) out.push({ path: jsonPath, content: pg.html, kind: 'json' });
      }
    }
  }
  for (const f of Object.keys(files)) {
    if (f.startsWith('src/public/')) out.push({ path: f.slice('src/public/'.length), content: files[f], kind: 'text' });
  }

  const manifest = {
    version: 1,
    output: opts.output,
    router: opts.router,
    routes: routes.map((r) => ({
      pattern: r.pattern,
      file: `${appDir}/${r.file}`,
      layouts: r.layouts.map((l) => `${appDir}/${l}`),
      params: r.params,
      pages: pages.filter((p) => p.pattern === r.pattern).map((p) => ({ url: p.url, file: p.outFile, params: p.params, css: p.css, clients: p.clients })),
    })),
    notFound: pages.find((p) => p.notFound)?.outFile ?? null,
    globalCss: globalText ? globalName : null,
    css: Object.fromEntries(Object.entries(cssByHash).map(([h, c]) => [h, { file: c.file, bytes: c.scoped.length + c.global.length, url: c.url }])),
    client: Object.fromEntries(Object.entries(clientByHash).map(([h, c]) => [h, { file: c.file, chunk: c.chunk }])),
  };
  out.push({ path: '.deshi/manifest.json', content: JSON.stringify(manifest, null, 2), kind: 'json' });

  const seenDiag = new Set<string>();
  const uniqueDiagnostics = diagnostics.filter((d) => {
    const key = `${d.code}|${d.file}|${d.line}|${d.column}|${d.message}`;
    if (seenDiag.has(key)) return false;
    seenDiag.add(key);
    return true;
  });
  const errors = uniqueDiagnostics.filter((d) => d.severity === 'error');
  return {
    ok: errors.length === 0,
    pages,
    files: out,
    diagnostics: uniqueDiagnostics,
    compiled,
    routes,
    manifest,
    notes,
    totalMs: Math.round(performance.now() - t0),
  };
}

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

/** Playground-only: lets links inside the preview iframe drive the URL selector. */
const PREVIEW_NAV_SCRIPT = `<script data-deshi-playground>document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a'):null;if(!a)return;var h=a.getAttribute('href');if(!h||h.indexOf('/')!==0)return;e.preventDefault();parent.postMessage({deshiNavigate:h},'*');});</script>`;

export { match };

export async function buildToDisk(
  projectRoot: string = process.cwd(),
  options: BuildOptions = {},
  outDir: string = 'dist'
): Promise<BuildResult> {
  const fs = await import('fs');
  const path = await import('path');

  const appDir = options.appDir ?? 'src';
  const fullAppDir = path.resolve(projectRoot, appDir);

  const readDirRecursive = (dir: string, base: string = ''): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!fs.existsSync(dir)) return out;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      const rel = base ? `${base}/${item.name}` : item.name;
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
        Object.assign(out, readDirRecursive(full, rel));
      } else if (
        item.isFile() &&
        (item.name.endsWith('.deshi') ||
          item.name.endsWith('.html') ||
          item.name.endsWith('.md') ||
          item.name.endsWith('.ts') ||
          item.name.endsWith('.js'))
      ) {
        out[`${appDir}/${rel}`] = fs.readFileSync(full, 'utf-8');
      }
    }
    return out;
  };

  const files = readDirRecursive(fullAppDir);
  const result = await build(
    { files },
    {
      output: options.output ?? 'index',
      router: options.router ?? true,
      css: options.css ?? 'inline',
      minify: options.minify ?? true,
      appDir,
    }
  );

  const fullOutDir = path.resolve(projectRoot, outDir);
  if (!fs.existsSync(fullOutDir)) {
    fs.mkdirSync(fullOutDir, { recursive: true });
  }

  for (const f of result.files) {
    const dest = path.join(fullOutDir, f.path);
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.writeFileSync(dest, f.content, 'utf-8');
  }

  return result;
}
