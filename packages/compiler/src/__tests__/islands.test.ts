import { describe, expect, it } from 'vitest';
import { islandInlineScript } from '../islands';
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

describe('island root stamping', () => {
  it('adds the island id to the root element', async () => {
    const html = await renderPage(ISLAND, `<Box client:load />`);
    expect(html).toContain('id="d-');
    expect(html).toContain('data-deshi-c=');
  });

  it('uses data-deshi-i when the root already has an id', async () => {
    const html = await renderPage(`<div id="keep">hi</div>\n<script client>root.textContent = 'x';</script>`, `<Box client:load />`);
    expect(html).toContain('id="keep"');
    expect(html).toContain('data-deshi-i="d-');
  });

  it('wraps output that has no root element', async () => {
    const html = await renderPage(`just text\n<script client>root.textContent = 'x';</script>`, `<Box client:load />`);
    expect(html).toContain('display:contents');
    expect(html).toMatch(/<div[^>]*id="d-[^"]*"[^>]*style="display:contents"/);
  });

  it('stamps nothing when the component is not an island', async () => {
    const html = await renderPage(`<div class="box">hi</div>`, `<Box />`);
    expect(html).not.toContain('data-deshi-c');
    expect(html).not.toContain('d-');
  });

  it('gives each usage on a page its own id', async () => {
    const html = await renderPage(ISLAND, `<Box client:load /><Box client:visible />`);
    const ids = [...html.matchAll(/id="(d-[^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('islandInlineScript', () => {
  it('emits a strategy-specific loader for visible/idle/media/load', () => {
    expect(islandInlineScript('i', '/c.js', 'visible')).toContain('IntersectionObserver');
    expect(islandInlineScript('i', '/c.js', 'idle')).toContain('requestIdleCallback');
    expect(islandInlineScript('i', '/c.js', 'media', '(max-width: 1px)')).toContain('matchMedia');
    expect(islandInlineScript('i', '/c.js', 'load')).toContain('import(');
  });

  it('requires a media query for client:media', () => {
    expect(() => islandInlineScript('i', '/c.js', 'media')).toThrow(/client:media/);
  });

  it('JSON-escapes the chunk src (no script-breakout injection)', () => {
    const evil = '/c.js"></script><script>alert(1)</script>';
    const out = islandInlineScript('i', evil, 'load');
    // The literal `</script>` must never appear — it is unicode-escaped.
    expect(out).not.toContain('</script><script>');
    expect(out).toContain('\\u003c/script\\u003e');
  });
});

describe('Astro parity: automatic props and directive validation', () => {
  it('automatically serializes standard component props into data-deshi-props for islands', async () => {
    const comp = `<script>const start = props.start; const step = props.step;</script>
<div class="box">{start}</div>
<script client>root.textContent = String(ctx.props.start);</script>`;
    const html = await renderPage(comp, `<Box start={42} step={5} client:load />`);
    expect(html).toContain('data-deshi-props="{&quot;start&quot;:42,&quot;step&quot;:5}"');
  });

  it('rejects client:click as an unknown directive (Astro parity)', async () => {
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
