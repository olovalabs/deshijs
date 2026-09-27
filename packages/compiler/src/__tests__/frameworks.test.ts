import { describe, expect, it } from 'vitest';
import { build } from '../build';
import { __clearCompileMemoForTests } from '../index';
import { detectFramework, generateFrameworkClientMount, serializeVNode } from '../frameworks';

describe('Multi-framework component detection & client chunk generation', () => {
  it('detects frameworks accurately by extension and content', () => {
    expect(detectFramework('src/components/Card.vue')).toBe('vue');
    expect(detectFramework('src/components/Button.svelte')).toBe('svelte');
    expect(detectFramework('src/components/Counter.jsx', "import { useState } from 'react';")).toBe('react');
    expect(detectFramework('src/components/PreactWidget.tsx', "import { h } from 'preact';")).toBe('preact');
  });

  it('generates React client hydration mount code', () => {
    const code = generateFrameworkClientMount('src/components/Counter.jsx', '');
    expect(code).toContain("import React from 'react';");
    expect(code).toContain("import { createRoot, hydrateRoot } from 'react-dom/client';");
    expect(code).toContain('export default function mount(root, ctx)');
    expect(code).toContain('hydrateRoot(root, el)');
  });

  it('generates Vue client hydration mount code', () => {
    const code = generateFrameworkClientMount('src/components/Widget.vue', '');
    expect(code).toContain("import { createSSRApp, createApp, h } from 'vue';");
    expect(code).toContain('export default function mount(root, ctx)');
    expect(code).toContain('app.mount(root)');
  });

  it('generates Svelte client hydration mount code', () => {
    const code = generateFrameworkClientMount('src/components/Button.svelte', '');
    expect(code).toContain("import * as Svelte from 'svelte';");
    expect(code).toContain('export default function mount(root, ctx)');
  });

  it('serializes standard VNode / JSX object trees to HTML', () => {
    const vnode = {
      type: 'div',
      props: {
        className: 'alert',
        id: 'box-1',
        children: [
          { type: 'h2', props: { children: 'Title' } },
          { type: 'p', props: { children: 'Description' } },
        ],
      },
    };
    expect(serializeVNode(vnode)).toBe('<div class="alert" id="box-1"><h2>Title</h2><p>Description</p></div>');
  });
});

describe('Multi-framework islands in Deshi templates', () => {
  it('renders a .jsx component statically with zero client JS when no client directive is present', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/StaticBanner.jsx': `
export default function StaticBanner(props) {
  return '<div class="banner">Banner: ' + (props.text || 'none') + '</div>';
}
`,
      'src/page.deshi': `
<script>
import StaticBanner from './components/StaticBanner.jsx';
</script>
<StaticBanner text="Welcome to Deshi" />
`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const page = res.pages[0];
    expect(page.html).toContain('<div class="banner">Banner: Welcome to Deshi</div>');
    // Zero-JS: no client chunks or script tags for static framework component
    expect(page.clients).toHaveLength(0);
    expect(page.html).not.toContain('<script');
  });

  it('hydrates a .jsx component as an island with client:load and emits client chunk', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/ReactCounter.jsx': `
export default function ReactCounter(props) {
  return '<button class="counter-btn">Count: ' + (props.initial || 0) + '</button>';
}
`,
      'src/page.deshi': `
<script>
import ReactCounter from './components/ReactCounter.jsx';
</script>
<ReactCounter initial={42} client:load />
`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const page = res.pages[0];
    // Island attributes stamped and wrapped with display:contents
    expect(page.html).toContain('style="display:contents"');
    expect(page.html).toContain('data-deshi-c=');
    expect(page.html).toContain('data-deshi-props="{&quot;initial&quot;:42}"');
    expect(page.html).toContain('Count: 42');
    // Hydration script emitted
    expect(page.html).toContain('import(');
    expect(page.html).toContain('/_deshi/c/ReactCounter.');

    // Client chunk emitted in output files
    const clientChunk = res.files.find((f) => f.path.startsWith('_deshi/c/ReactCounter.'));
    expect(clientChunk).toBeDefined();
    expect(clientChunk?.content).toContain("import React from 'react';");
  });

  it('resolves extension-less imports dynamically for framework components', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/Card.tsx': `
export default function Card(props) {
  return '<div class="card">' + props.title + '</div>';
}
`,
      'src/page.deshi': `
<script>
import Card from './components/Card';
</script>
<Card title="Dynamic Extensionless Import" />
`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(res.pages[0].html).toContain('Dynamic Extensionless Import');
  });

  it('supports client:only on framework components by skipping SSR and mounting in browser', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/ClientOnlyWidget.jsx': `
export default function ClientOnlyWidget() {
  return '<div>SSR text that should not appear</div>';
}
`,
      'src/page.deshi': `
<script>
import ClientOnlyWidget from './components/ClientOnlyWidget.jsx';
</script>
<ClientOnlyWidget client:only />
`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const html = res.pages[0].html;
    // SSR text is skipped
    expect(html).not.toContain('SSR text that should not appear');
    // But island container and hydration script are present
    expect(html).toContain('style="display:contents"');
    expect(html).toContain('data-deshi-c=');
    expect(html).toContain('/_deshi/c/ClientOnlyWidget.');
  });
});
