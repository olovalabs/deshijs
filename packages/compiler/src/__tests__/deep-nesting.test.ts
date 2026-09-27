import { describe, expect, it } from 'vitest';
import { build } from '../build';
import { __clearCompileMemoForTests } from '../index';

describe('Deep component nesting and recursion', () => {
  it('renders a 100-level deeply nested component chain without issues', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
    };

    // Chain C1 -> C2 -> ... -> C100 -> Leaf
    for (let i = 1; i < 100; i++) {
      files[`src/components/C${i}.deshi`] = `<script>import Next from './C${i + 1}.deshi';</script><div class="level-${i}"><Next /></div>`;
    }
    files['src/components/C100.deshi'] = '<span class="leaf">Deepest Leaf</span>';
    files['src/page.deshi'] = `<script>import C1 from './components/C1.deshi';</script><main><C1 /></main>`;

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const html = res.pages[0].html;
    expect(html).toContain('class="level-1"');
    expect(html).toContain('class="level-99"');
    expect(html).toContain('Deepest Leaf');
  });

  it('renders deeply nested slots (100-deep Box wrappers)', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/Box.deshi': '<div class="box">[<slot />]</div>',
    };

    let inner = 'Target';
    for (let i = 0; i < 100; i++) {
      inner = `<Box>${inner}</Box>`;
    }
    files['src/page.deshi'] = `<script>import Box from './components/Box.deshi';</script>${inner}`;

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(res.pages[0].html).toContain('Target');
  });

  it('supports recursive self-referential components (e.g. Tree rendering Tree)', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/TreeNode.deshi': `<script>
import TreeNode from './TreeNode.deshi';
const node = props.node;
</script>
<li class="tree-node">
  <span class="label">{node.name}</span>
  {node.children && node.children.length ? (
    <ul class="children">
      {node.children.map(child => <TreeNode node={child} />)}
    </ul>
  ) : null}
</li>`,
      'src/page.deshi': `<script>
import TreeNode from './components/TreeNode.deshi';
const treeData = {
  name: 'Root',
  children: [
    {
      name: 'Folder 1',
      children: [
        {
          name: 'Folder 1.1',
          children: [
            { name: 'File 1.1.1' }
          ]
        }
      ]
    },
    { name: 'File 2' }
  ]
};
</script>
<ul class="root-tree">
  <TreeNode node={treeData} />
</ul>`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const html = res.pages[0].html;
    expect(html).toContain('Root');
    expect(html).toContain('Folder 1');
    expect(html).toContain('Folder 1.1');
    expect(html).toContain('File 1.1.1');
    expect(html).toContain('File 2');
  });

  it('supports mutual circular component imports (A -> B -> A)', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/CompA.deshi': `<script>
import CompB from './CompB.deshi';
const count = Number(props.count || 0);
</script>
<div class="comp-a">
  A: {count}
  {count > 0 ? <CompB count={count - 1} /> : <span>Done</span>}
</div>`,
      'src/components/CompB.deshi': `<script>
import CompA from './CompA.deshi';
const count = Number(props.count || 0);
</script>
<div class="comp-b">
  B: {count}
  {count > 0 ? <CompA count={count - 1} /> : <span>Done</span>}
</div>`,
      'src/page.deshi': `<script>
import CompA from './components/CompA.deshi';
</script>
<CompA count={4} />`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const html = res.pages[0].html;
    expect(html).toContain('class="comp-a"');
    expect(html).toContain('class="comp-b"');
    expect(html).toContain('Done');
  });

  it('enforces configurable maxDepth limit and reports PF4002 when exceeded', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
    };

    // Chain 25 levels deep
    for (let i = 1; i < 25; i++) {
      files[`src/components/L${i}.deshi`] = `<script>import Next from './L${i + 1}.deshi';</script><div><Next /></div>`;
    }
    files['src/components/L25.deshi'] = '<div>Bottom</div>';
    files['src/page.deshi'] = `<script>import L1 from './components/L1.deshi';</script><L1 />`;

    // With maxDepth: 10, it should fail with PF4002
    const failRes = await build({ files }, { appDir: 'src', maxDepth: 10 });
    expect(failRes.ok).toBe(false);
    expect(failRes.diagnostics.some((d) => d.message.includes('PF4002') && d.message.includes('deeper than 10'))).toBe(true);

    // With maxDepth: 30, it should succeed
    const passRes = await build({ files }, { appDir: 'src', maxDepth: 30 });
    expect(passRes.ok).toBe(true);
    expect(passRes.pages[0].html).toContain('Bottom');
  });
});

describe('Context API (React-like createContext / useContext)', () => {
  it('allows ancestor to setContext and deeply nested child to getContext without prop drilling', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/DeepChild.deshi': `<script>
import { getContext } from 'deshi';
const theme = getContext('theme');
const user = getContext('user');
</script>
<div class="deep-child">Theme is {theme}, User is {user.name}</div>`,
      'src/components/Middle.deshi': `<script>
import DeepChild from './DeepChild.deshi';
</script>
<div class="middle">
  <DeepChild />
</div>`,
      'src/components/Provider.deshi': `<script>
import { setContext } from 'deshi';
import Middle from './Middle.deshi';
setContext('theme', 'dark');
setContext('user', { name: 'Nazmul' });
</script>
<div class="provider">
  <Middle />
</div>`,
      'src/page.deshi': `<script>
import Provider from './components/Provider.deshi';
</script>
<Provider />`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const html = res.pages[0].html;
    expect(html).toContain('Theme is dark, User is Nazmul');
  });

  it('supports context passing through <slot />', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/ThemeProvider.deshi': `<script>
import { setContext } from 'deshi';
setContext('theme', props.theme || 'default');
</script>
<div class="theme-wrapper">
  <slot />
</div>`,
      'src/components/Consumer.deshi': `<script>
import { getContext } from 'deshi';
const theme = getContext('theme');
</script>
<span class="consumed">{theme}</span>`,
      'src/page.deshi': `<script>
import ThemeProvider from './components/ThemeProvider.deshi';
import Consumer from './components/Consumer.deshi';
</script>
<ThemeProvider theme="midnight-blue">
  <div>
    <Consumer />
  </div>
</ThemeProvider>`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(res.pages[0].html).toContain('<span class="consumed">midnight-blue</span>');
  });

  it('isolates context between sibling component subtrees and allows overrides', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/Box.deshi': `<script>
import { setContext } from 'deshi';
if (props.setTheme) {
  setContext('theme', props.setTheme);
}
</script>
<div class="box">
  <slot />
</div>`,
      'src/components/Label.deshi': `<script>
import { getContext } from 'deshi';
const theme = getContext('theme', 'fallback');
</script>
<span class="theme-label">{theme}</span>`,
      'src/page.deshi': `<script>
import Box from './components/Box.deshi';
import Label from './components/Label.deshi';
</script>
<Box setTheme="outer-dark">
  <Label />
  <Box setTheme="inner-light">
    <Label />
  </Box>
  <Label />
</Box>
<Label />`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const html = res.pages[0].html;
    // Outer Box label: outer-dark
    // Inner Box label: inner-light
    // Sibling label in Outer Box: outer-dark
    // Outside label: fallback
    expect(html).toContain('<span class="theme-label">outer-dark</span>');
    expect(html).toContain('<span class="theme-label">inner-light</span>');
    expect(html).toContain('<span class="theme-label">fallback</span>');
  });

  it('supports Astro.setContext and Astro.getContext', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/Parent.deshi': `<script>
Astro.setContext('greeting', 'Hello from Astro global');
</script>
<div><slot /></div>`,
      'src/components/Child.deshi': `<script>
const g = Astro.getContext('greeting');
</script>
<p>{g}</p>`,
      'src/page.deshi': `<script>
import Parent from './components/Parent.deshi';
import Child from './components/Child.deshi';
</script>
<Parent>
  <Child />
</Parent>`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(res.pages[0].html).toContain('<p>Hello from Astro global</p>');
  });
  it('supports Deshi.setContext and Deshi.getContext as primary brand global', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/Parent.deshi': `<script>
Deshi.setContext('appName', 'Deshi App');
</script>
<div><slot /></div>`,
      'src/components/Child.deshi': `<script>
const app = Deshi.getContext('appName');
</script>
<p>App: {app}</p>`,
      'src/page.deshi': `<script>
import Parent from './components/Parent.deshi';
import Child from './components/Child.deshi';
</script>
<Parent>
  <Child />
</Parent>`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(res.pages[0].html).toContain('<p>App: Deshi App</p>');
  });

  it('allows getContext in template expressions without scope error', async () => {
    __clearCompileMemoForTests();
    const files: Record<string, string> = {
      'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
      'src/components/Wrap.deshi': `<script>
setContext('color', 'cyan');
</script>
<div><slot /></div>`,
      'src/components/Text.deshi': `<span>{getContext('color')}</span>`,
      'src/page.deshi': `<script>
import Wrap from './components/Wrap.deshi';
import Text from './components/Text.deshi';
</script>
<Wrap>
  <Text />
</Wrap>`,
    };

    const res = await build({ files }, { appDir: 'src', router: false, minify: false });
    expect(res.ok).toBe(true);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(res.pages[0].html).toContain('<span>cyan</span>');
  });
});
