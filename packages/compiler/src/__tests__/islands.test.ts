import { describe, expect, it } from 'vitest';
import { ISLAND_STYLES, directiveScript, islandPrescripts, renderIsland } from '../islands';
import { build } from '../build';
import { __clearCompileMemoForTests } from '../index';

const ISLAND = `<div class="box">hi</div>
<script client>root.textContent = 'x';</script>`;

async function renderPage(component: string, usage: string): Promise<string> {
  __clearCompileMemoForTests();
  const r = await build(
    {
      files: {
        'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
        'src/components/Box.deshi': component,
        'src/page.deshi': `<script>import Box from './components/Box.deshi';</script>\n${usage}`,
      },
    },
    { router: false, minify: false, appDir: 'src' },
  );
  const err = r.diagnostics.find((d) => d.severity === 'error');
  if (err) throw new Error(`${err.code} ${err.message}`);
  return r.pages[0].html;
}

describe('deshi-island wrapper markup (Astro contract)', () => {
  it('wraps the island in <deshi-island> with the Astro attribute set', async () => {
    const html = await renderPage(ISLAND, `<Box client:load />`);
    expect(html).toMatch(/<deshi-island [^>]*uid="[0-9a-f]+"/);
    expect(html).toContain('component-url="/_deshi/c/Box.');
    expect(html).toContain('component-export="default"');
    expect(html).toMatch(/renderer-url="\/_deshi\/c\/Box\.[0-9a-f]+\.js"/);
    expect(html).toContain('ssr');
    expect(html).toContain('client="load"');
    expect(html).toContain('opts="{&quot;name&quot;:&quot;Box&quot;,&quot;value&quot;:&quot;&quot;}"');
    expect(html).toContain('await-children');
    expect(html).toContain('<!--deshi:end-->');
    expect(html).toContain('</deshi-island>');
  });

  it('never stamps the component markup (user ids and multiple roots stay intact)', async () => {
    const comp = `<div id="keep">a</div><p id="also">b</p>
<script client>root.textContent = 'x';</script>`;
    const html = await renderPage(comp, `<Box client:load />`);
    expect(html).toContain('id="keep"');
    expect(html).toContain('id="also"');
    expect(html).not.toContain('data-deshi-c');
    expect(html).not.toContain('data-deshi-props');
    expect(html).not.toContain('data-deshi-i');
    // the ids are never duplicated
    const ids = [...html.matchAll(/id="(keep|also)"/g)];
    expect(ids).toHaveLength(2);
  });

  it('dedupes identical islands and uses distinct uids for distinct props (Astro)', async () => {
    const same = await renderPage(ISLAND, `<Box client:load /><Box client:load />`);
    const sameUids = [...same.matchAll(/uid="([0-9a-f]+)"/g)].map((m) => m[1]);
    expect(sameUids).toHaveLength(2);
    expect(sameUids[0]).toBe(sameUids[1]);

    // Astro's uid hashes component + props + markup only, so two usages that
    // differ solely in the hydration directive still share a uid.
    const byStrategy = await renderPage(ISLAND, `<Box client:load /><Box client:visible />`);
    const strategyUids = [...byStrategy.matchAll(/uid="([0-9a-f]+)"/g)].map((m) => m[1]);
    expect(strategyUids[0]).toBe(strategyUids[1]);

    const distinct = await renderPage(ISLAND, `<Box client:load /><Box client:load n={2} />`);
    const distinctUids = [...distinct.matchAll(/uid="([0-9a-f]+)"/g)].map((m) => m[1]);
    expect(distinctUids[0]).not.toBe(distinctUids[1]);
  });

  it('escapes props so a payload can never terminate the attribute early', async () => {
    const comp = `<script>const t = props.title;</script><div class="box">{t}</div>
<script client>void 0;</script>`;
    const html = await renderPage(comp, `<Box client:load title={'</deshi-island><" x="'} />`);
    const attr = html.match(/\sprops="([^"]*)"/)?.[1];
    expect(attr).toBeDefined();
    // Decode HTML entities, then JSON string escapes — the payload must survive
    // the round trip even though it contains `"`, `<` and `>`.
    const decoded = attr!
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\\"/g, '"');
    expect(decoded).toContain('</deshi-island><" x="');
    // the raw attribute text must contain no unescaped quote
    expect(attr).not.toContain('" x="');
  });

  it('does not wrap or emit anything for non-island components', async () => {
    const html = await renderPage(`<div class="box">hi</div>`, `<Box />`);
    expect(html).not.toContain('deshi-island');
    expect(html).not.toContain('deshi:end');
  });

  it('guarantees 0 bytes of client JS and no script tags when no client directives are used', async () => {
    __clearCompileMemoForTests();
    const r = await build(
      {
        files: {
          'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
          'src/components/Static.deshi': `<div>Static content</div>`,
          'src/page.deshi': `<script>import Static from './components/Static.deshi';</script>\n<Static />`,
        },
      },
      { router: false, minify: false, appDir: 'src' },
    );
    expect(r.ok).toBe(true);
    expect(r.pages[0].clients).toHaveLength(0);
    expect(r.pages[0].html).not.toContain('<script');
    expect(r.pages[0].html).not.toContain('modulepreload');
  });
});

describe('prescripts (once per page, Astro render-instruction parity)', () => {
  it('emits the island style, the directive and the custom element once', async () => {
    const html = await renderPage(ISLAND, `<Box client:load /><Box client:idle />`);
    const count = (needle: string) => html.split(needle).length - 1;
    expect(count(ISLAND_STYLES)).toBe(1);
    expect(count("customElements.define('deshi-island'")).toBe(1);
    expect(count('window.dispatchEvent(new Event("deshi:load"))')).toBe(1);
    expect(count('window.dispatchEvent(new Event("deshi:idle"))')).toBe(1);
  });

  it('only ships the directives the page uses', async () => {
    const html = await renderPage(ISLAND, `<Box client:media="(max-width: 600px)" />`);
    expect(html).toContain('window.dispatchEvent(new Event("deshi:media"))');
    expect(html).not.toContain('deshi:visible');
    expect(html).not.toContain('deshi:idle');
    expect(html).not.toContain('deshi:load');
  });

  it('emits prescripts immediately before the first island (classic scripts)', async () => {
    const html = await renderPage(ISLAND, `<Box client:load />`);
    const styleAt = html.indexOf(ISLAND_STYLES);
    const islandAt = html.indexOf('<deshi-island');
    expect(styleAt).toBeGreaterThan(-1);
    expect(styleAt).toBeLessThan(islandAt);
    expect(html).toContain(`<style>${ISLAND_STYLES}</style>`);
  });
});

describe('directive semantics (Astro parity)', () => {
  const dev = (strategy: Parameters<typeof directiveScript>[0]) => directiveScript(strategy, true);

  it('client:idle uses requestIdleCallback with no viewport gate', () => {
    const script = dev('idle');
    expect(script).toContain('requestIdleCallback');
    expect(script).not.toContain('IntersectionObserver');
    expect(script).toContain('timeout');
  });

  it('client:load and client:only hydrate immediately', () => {
    for (const strategy of ['load', 'only'] as const) {
      const script = dev(strategy);
      expect(script).toContain('const hydrate = await load()');
      expect(script).not.toContain('IntersectionObserver');
      expect(script).not.toContain('requestIdleCallback');
    }
  });

  it('client:visible observes the island children and honours rootMargin', () => {
    const script = dev('visible');
    expect(script).toContain('el.children');
    expect(script).toContain('rootMargin');
    expect(script).toContain('io.disconnect()');
    expect(script).not.toContain('requestIdleCallback');
  });

  it('client:media uses matchMedia with a one-shot change listener', () => {
    const script = dev('media');
    expect(script).toContain('matchMedia');
    expect(script).toMatch(/addEventListener\(["']change["'],\s*cb,\s*\{ once: true \}\)/);
    expect(script).toContain('mql.matches');
  });

  it('ships a minified directive in production builds', () => {
    const script = directiveScript('idle');
    expect(script).toContain('requestIdleCallback');
    expect(script).not.toContain('\n');
  });

  it('the custom element hydrates top-down and retries failed imports', () => {
    const state = { islandStyle: false, islandRuntime: false, islandDirectives: new Set<string>() };
    const prescripts = islandPrescripts(state, 'load', true);
    expect(prescripts).toContain("closest('deshi-island[ssr]')");
    expect(prescripts).toContain("addEventListener('deshi:hydrate'");
    expect(prescripts).toContain('importWithRetry');
    expect(prescripts).toContain('deshi-retry');
    expect(prescripts).toContain("dispatchEvent(new CustomEvent('deshi:hydrate'))");
    expect(prescripts).toContain("'deshi:unmount'");
    expect(prescripts).toContain("'deshi:hydration-error'");
    expect(prescripts).toContain('await-children');
  });

  it('renders the wrapper without children/await-children when the island has no HTML', () => {
    const html = renderIsland({
      uid: 'abc',
      componentUrl: '/_deshi/c/X.1.js',
      rendererUrl: '/_deshi/c/X.1.js',
      componentExport: 'default',
      props: '{}',
      opts: '{"name":"X","value":""}',
      client: 'only',
      html: '',
    });
    expect(html).toBe(
      '<deshi-island uid="abc" component-url="/_deshi/c/X.1.js" component-export="default" renderer-url="/_deshi/c/X.1.js" props="{}" ssr client="only" opts="{&quot;name&quot;:&quot;X&quot;,&quot;value&quot;:&quot;&quot;}"></deshi-island>',
    );
  });
});

describe('client:only (Astro parity)', () => {
  it('skips SSR of the component and renders only the fallback slot', async () => {
    const comp = `<div class="never">SSR text</div>
<slot name="fallback" />
<script client>root.textContent = 'x';</script>`;
    const html = await renderPage(comp, `<Box client:only><p slot="fallback">loading…</p></Box>`);
    expect(html).not.toContain('SSR text');
    expect(html).toContain('loading…');
    expect(html).toContain('client="only"');
    expect(html).toContain('component-url="/_deshi/c/Box.');
  });

  it('renders an empty island (no await-children) without a fallback', async () => {
    const comp = `<div class="never">SSR text</div>
<script client>root.textContent = 'x';</script>`;
    const html = await renderPage(comp, `<Box client:only />`);
    expect(html).not.toContain('SSR text');
    expect(html).not.toMatch(/<deshi-island[^>]*await-children/);
    expect(html).toContain('client="only"');
  });
});

describe('props serialization into the island', () => {
  it('serializes standard props in the Astro tuple format', async () => {
    const comp = `<script>const start = props.start; const when = props.when;</script>
<div class="box">{start}</div>
<script client>root.textContent = String(ctx.props.start);</script>`;
    const html = await renderPage(comp, `<Box start={42} step={5} when={new Date(0)} client:load />`);
    expect(html).toContain('props="{&quot;start&quot;:[0,42],&quot;step&quot;:[0,5],&quot;when&quot;:[3,&quot;1970-01-01T00:00:00.000Z&quot;]}');
  });

  it('client:props overrides the usage props', async () => {
    const comp = `<div class="box">{props.n}</div>
<script client>root.textContent = String(ctx.props.n);</script>`;
    const html = await renderPage(comp, `<Box n={1} client:props={{ n: 2 }} client:load />`);
    expect(html).toContain('&quot;n&quot;:[0,2]');
    expect(html).not.toContain('&quot;n&quot;:[0,1]');
  });

  it('evaluates client:media expressions instead of serializing source text', async () => {
    __clearCompileMemoForTests();
    const r = await build(
      {
        files: {
          'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
          'src/components/Box.deshi': ISLAND,
          'src/page.deshi': `<script>import Box from './components/Box.deshi'; const q = '(max-width: 700px)';</script>\n<Box client:media={q} />`,
        },
      },
      { router: false, minify: false, appDir: 'src' },
    );
    const err = r.diagnostics.find((d) => d.severity === 'error');
    if (err) throw new Error(`${err.code} ${err.message}`);
    expect(r.pages[0].html).toContain('opts="{&quot;name&quot;:&quot;Box&quot;,&quot;value&quot;:&quot;(max-width: 700px)&quot;}"');
  });

  it('passes client:idle / client:visible option objects through opts', async () => {
    const idle = await renderPage(ISLAND, `<Box client:idle={{ timeout: 500 }} />`);
    expect(idle).toContain('opts="{&quot;name&quot;:&quot;Box&quot;,&quot;value&quot;:{&quot;timeout&quot;:500}}"');
    const visible = await renderPage(ISLAND, `<Box client:visible={{ rootMargin: '200px' }} />`);
    expect(visible).toContain('opts="{&quot;name&quot;:&quot;Box&quot;,&quot;value&quot;:{&quot;rootMargin&quot;:&quot;200px&quot;}}"');
  });
});

describe('directive validation (PF4026)', () => {
  it('rejects unknown directives (Astro parity)', async () => {
    __clearCompileMemoForTests();
    const r = await build(
      {
        files: {
          'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
          'src/components/Box.deshi': ISLAND,
          'src/page.deshi': `<script>import Box from './components/Box.deshi';</script>\n<Box client:click />`,
        },
      },
      { router: false, minify: false, appDir: 'src' },
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === 'PF4026' && d.message.includes('client:click'))).toBe(true);
  });

  it('rejects two hydration strategies on one usage', async () => {
    __clearCompileMemoForTests();
    const r = await build(
      {
        files: {
          'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
          'src/components/Box.deshi': ISLAND,
          'src/page.deshi': `<script>import Box from './components/Box.deshi';</script>\n<Box client:load client:visible />`,
        },
      },
      { router: false, minify: false, appDir: 'src' },
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === 'PF4026' && d.message.includes('Two hydration strategies'))).toBe(true);
  });

  it('requires a media query for client:media', async () => {
    __clearCompileMemoForTests();
    const r = await build(
      {
        files: {
          'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
          'src/components/Box.deshi': ISLAND,
          'src/page.deshi': `<script>import Box from './components/Box.deshi';</script>\n<Box client:media />`,
        },
      },
      { router: false, minify: false, appDir: 'src' },
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === 'PF4026' && d.message.includes('client:media'))).toBe(true);
  });

  it('rejects client:* on plain elements', async () => {
    __clearCompileMemoForTests();
    const r = await build(
      {
        files: {
          'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
          'src/page.deshi': `<div client:load>hi</div>`,
        },
      },
      { router: false, minify: false, appDir: 'src' },
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === 'PF4026' && d.message.includes('not <div>'))).toBe(true);
  });
});

describe('slots and nesting', () => {
  it('wraps island slots in deshi-slot so the client can read them', async () => {
    const comp = `<div class="wrap"><slot /></div>
<script client>root.textContent = 'x';</script>`;
    const html = await renderPage(comp, `<Box client:load><span class="inner">hello</span></Box>`);
    expect(html).toMatch(/<deshi-slot name="default">\s*<span class="inner">hello<\/span>\s*<\/deshi-slot>/);
  });

  it('nests islands inside islands with their own uids', async () => {
    __clearCompileMemoForTests();
    const r = await build(
      {
        files: {
          'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
          'src/components/Outer.deshi': `<div class="outer"><slot /></div>
<script client>void 0;</script>`,
          'src/components/Inner.deshi': ISLAND,
          'src/page.deshi': `<script>import Outer from './components/Outer.deshi'; import Inner from './components/Inner.deshi';</script>\n<Outer client:load><Inner client:visible /></Outer>`,
        },
      },
      { router: false, minify: false, appDir: 'src' },
    );
    const err = r.diagnostics.find((d) => d.severity === 'error');
    if (err) throw new Error(`${err.code} ${err.message}`);
    const html = r.pages[0].html;
    expect(html).toContain('client="load"');
    expect(html).toContain('client="visible"');
    const outerAt = html.indexOf('client="load"');
    const innerAt = html.indexOf('client="visible"');
    expect(outerAt).toBeLessThan(innerAt);
  });
});
