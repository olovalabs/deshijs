import { describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../build';
import { compile, __clearCompileMemoForTests } from '../index';
import { collectTypeDeclarations, contractFromSite, findDefineProps, parseTypeText, resolveType } from '../tsprops';

async function diags(files: Record<string, string>, appDir = 'src'): Promise<BuildResult> {
  __clearCompileMemoForTests();
  return build({ files }, { router: false, minify: false, appDir });
}

const LAYOUT = `<html><head><title>t</title></head><body><slot /></body></html>`;

describe('defineProps contract extraction', () => {
  it('reads an interface declaration', async () => {
    const code = `interface CardProps { title: string; count?: number; tags?: string[] }\nconst props = defineProps<CardProps>()`;
    const scope = collectTypeDeclarations(code);
    const [site] = findDefineProps(code);
    const c = contractFromSite(code, site, scope)!;
    expect(c.order).toEqual(['title', 'count', 'tags']);
    expect(c.via).toBe('CardProps');
    expect(c.props.title.optional).toBe(false);
    expect(c.props.count.optional).toBe(true);
    expect(c.props.tags.type).toEqual({ kind: 'array', of: { kind: 'string' } });
  });

  it('reads an inline type literal and a type alias', async () => {
    const inline = `const props = defineProps<{ a: number; b?: boolean }>()`;
    const scope = collectTypeDeclarations(inline);
    const c = contractFromSite(inline, findDefineProps(inline)[0], scope)!;
    expect(c.order).toEqual(['a', 'b']);

    const alias = `type P = { x: string }\nconst props = defineProps<P>()`;
    const c2 = contractFromSite(alias, findDefineProps(alias)[0], collectTypeDeclarations(alias))!;
    expect(c2.order).toEqual(['x']);
  });

  it('reads the plain-JS schema form', async () => {
    const code = `const props = defineProps({ title: String, count: Number, onPick: Function })`;
    const c = contractFromSite(code, findDefineProps(code)[0], {})!;
    expect(c.order).toEqual(['title', 'count', 'onPick']);
    expect(c.props.count.type).toEqual({ kind: 'number' });
  });

  it('finds the local binding name', async () => {
    const code = `const p = defineProps<{ a: string }>()`;
    expect(findDefineProps(code)[0].local).toBe('p');
  });

  it('erases the call from the emitted body', async () => {
    const res = compile(`<script>\ninterface P { a: string }\nconst props = defineProps<P>();\n</script>\n<div>{props.a}</div>`, {
      file: 'src/c.deshi',
    });
    expect(res.script.contract?.order).toEqual(['a']);
    expect(res.script.body).not.toContain('defineProps');
    expect(res.meta.propReads).toEqual(['a']);
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('keeps a differently named binding working', async () => {
    const res = compile(`<script>\nconst p = defineProps({ a: String });\n</script>\n<div>{p.a}</div>`, {
      file: 'src/c2.deshi',
    });
    expect(res.script.body).toContain('const p = props;');
    expect(res.meta.propReads).toEqual(['a']);
  });

  it('resolves nested and union types', async () => {
    const scope = { Inner: [{ name: 'z', optional: false, rest: false, call: false, pos: 0, hasDefault: false, type: parseTypeText('string[]') }] };
    expect(resolveType(parseTypeText('string | number | undefined'), scope, 0)).toEqual({
      kind: 'union',
      of: [{ kind: 'string' }, { kind: 'number' }],
    });
    expect(resolveType(parseTypeText('Array<number>'), scope, 0)).toEqual({ kind: 'array', of: { kind: 'number' } });
    expect(resolveType(parseTypeText('Record<string, number>'), scope, 0)).toEqual({
      kind: 'shape',
      members: { '[key]': { kind: 'number' } },
    });
    expect(resolveType(parseTypeText('(a: string) => void'), scope, 0)).toEqual({ kind: 'function' });
    expect(resolveType(parseTypeText('Inner'), scope, 0)).toEqual({ kind: 'shape', members: { z: { kind: 'array', of: { kind: 'string' } } } });
  });
});

describe('component prop checking (PF4030-4040)', () => {
  const card = `<script>
interface CardProps {
  title: string
  count?: number
  tone?: 'note' | 'tip'
}
const props = defineProps<CardProps>();
</script>
<div><h2>{props.title}</h2><slot /><slot name="footer" /></div>`;

  const withPage = (page: string, extraScript = '') => ({
    'src/layout.deshi': LAYOUT,
    'src/components/Card.deshi': card,
    'src/page.deshi': `<script>import Card from './components/Card.deshi';${extraScript}</script>\n${page}`,
  });

  it('accepts a valid usage', async () => {
    const r = await diags(withPage(`<Card title="hi" count={2} tone="tip">body</Card>`));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('rejects an unknown prop and suggests the intended one', async () => {
    const r = await diags(withPage(`<Card tite="hi" />`));
    const d = r.diagnostics.find((x) => x.code === 'PF4030');
    expect(d?.severity).toBe('error');
    expect(d?.message).toContain('has no prop "tite"');
    expect(d?.hint).toContain('Did you mean "title"');
  });

  it('rejects a missing required prop', async () => {
    const r = await diags(withPage(`<Card count={1} />`));
    const d = r.diagnostics.find((x) => x.code === 'PF4031');
    expect(d?.message).toContain('requires the prop "title"');
  });

  it('does not require props when the usage spreads', async () => {
    const r = await diags(withPage(`<Card {...rest} />`, `\nconst rest = { title: 'x' };`));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('rejects a statically wrong prop type', async () => {
    const r = await diags(withPage(`<Card title="a" count="2" />`));
    const d = r.diagnostics.find((x) => x.code === 'PF4032');
    expect(d?.message).toContain('expects number but got a string');
    expect(d?.hint).toContain('name={value}');
  });

  it('rejects a value outside a literal union', async () => {
    const r = await diags(withPage(`<Card title="a" tone="warning" />`));
    const d = r.diagnostics.find((x) => x.code === 'PF4032');
    expect(d?.message).toContain('"note" | "tip"');
  });

  it('rejects an unknown slot', async () => {
    const r = await diags(withPage(`<Card title="a"><span slot="aside">x</span></Card>`));
    const d = r.diagnostics.find((x) => x.code === 'PF4033');
    expect(d?.message).toContain('has no slot named "aside"');
    expect(d?.hint).toContain('"footer"');
  });

  it('accepts a declared slot and warns about a missing required one', async () => {
    const ok = await diags(withPage(`<Card title="a"><span slot="footer">f</span></Card>`));
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);

    const missing = await diags(withPage(`<Card title="a">body</Card>`));
    const w = missing.diagnostics.find((x) => x.code === 'PF4040');
    expect(w?.severity).toBe('warning');
    expect(w?.message).toContain('"footer"');
  });

  it('warns about a declared prop that is never read', async () => {
    const r = await diags({
      'src/layout.deshi': LAYOUT,
      'src/components/Card.deshi': `<script>
interface P { title: string; unused: string }
const props = defineProps<P>();
</script>
<h2>{props.title}</h2>`,
      'src/page.deshi': `<script>import Card from './components/Card.deshi';</script>\n<Card title="a" />`,
    });
    const w = r.diagnostics.find((x) => x.code === 'PF4034');
    expect(w?.severity).toBe('warning');
    expect(w?.message).toContain('"unused"');
    // the offset must point into the file, not at the <script> body
    expect(w?.line).toBe(2);
  });

  it('rejects element directives on a component', async () => {
    const r = await diags(withPage(`<Card title="a" set:html={markup} />`, `\nconst markup = '<b>x</b>';`));
    const d = r.diagnostics.find((x) => x.code === 'PF4039');
    expect(d?.message).toContain('element directive');
  });

  it('warns about a React-style prop', async () => {
    const r = await diags(withPage(`<Card title="a" onClick={handler} />`, `\nconst handler = () => {};`));
    expect(r.diagnostics.find((x) => x.code === 'PF4038')?.severity).toBe('warning');
  });

  it('checks client:props against the contract', async () => {
    const island = `<script>
interface P { step: number }
const props = defineProps<P>();
</script>
<div><slot /></div>
<script client>root.textContent = String(ctx.props.step);</script>`;
    const files = {
      'src/layout.deshi': LAYOUT,
      'src/components/Counter.deshi': island,
      'src/page.deshi': `<script>import Counter from './components/Counter.deshi';</script>\n<Counter client:load client:props={{ stp: 1, extra: true }} />`,
    };
    const r = await diags(files);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain('PF4031');
    expect(codes).toContain('PF4036');
  });

  it('warns when client:props carries a function', async () => {
    const island = `<script>const props = defineProps({ step: Number });</script>
<div><slot /></div>
<script client>root.textContent = 'x';</script>`;
    const r = await diags({
      'src/layout.deshi': LAYOUT,
      'src/components/Counter.deshi': island,
      'src/page.deshi': `<script>import Counter from './components/Counter.deshi';</script>\n<Counter client:load client:props={{ step: () => 1 }} />`,
    });
    expect(r.diagnostics.find((d) => d.code === 'PF4035')?.severity).toBe('warning');
  });

  it('leaves undeclared components alone', async () => {
    const r = await diags({
      'src/layout.deshi': LAYOUT,
      'src/components/Card.deshi': `<script>const t = props.title;</script>\n<div>{t}</div>`,
      'src/page.deshi': `<script>import Card from './components/Card.deshi';</script>\n<Card whatever="1" other="2" />`,
    });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(r.compiled['src/components/Card.deshi'].meta.propReads).toEqual(['title']);
  });

  it('suppresses completeness checks when props are read opaquely', async () => {
    const r = await diags({
      'src/layout.deshi': LAYOUT,
      'src/components/Card.deshi': `<script>const k = 'title';\nconst v = props[k];</script>\n<div>{v}</div>`,
      'src/page.deshi': `<script>import Card from './components/Card.deshi';</script>\n<Card title="a" />`,
    });
    expect(r.compiled['src/components/Card.deshi'].meta.propReadsOpaque).toBe(true);
    expect(r.diagnostics.filter((d) => d.code === 'PF4034')).toHaveLength(0);
  });

  it('resolves components from a nested directory', async () => {
    const r = await diags({
      'src/layout.deshi': LAYOUT,
      'src/ui/Card.deshi': card,
      'src/page.deshi': `<script>import Card from './ui/Card.deshi';</script>\n<Card nope="x" title="a" />`,
    });
    expect(r.diagnostics.find((d) => d.code === 'PF4030')?.message).toContain('nope');
  });

  it('checks component usages inside markdown/MDX', async () => {
    const r = await diags({
      'src/layout.deshi': LAYOUT,
      'src/components/Card.deshi': card,
      'src/post.mdx': `import Card from './components/Card.deshi';\n\n<Card tite="x" />\n`,
    });
    expect(r.diagnostics.find((d) => d.code === 'PF4030')?.file).toContain('post.mdx');
  });
});
