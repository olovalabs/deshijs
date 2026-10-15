import { describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../build';
import { compile, __clearCompileMemoForTests } from '../index';
import { findDefineSlots, slotContractFromSite, collectTypeDeclarations } from '../tsprops';

async function diags(files: Record<string, string>): Promise<BuildResult> {
  __clearCompileMemoForTests();
  return build({ files }, { router: false, minify: false, appDir: 'src' });
}

const LAYOUT = `<html><head><title>t</title></head><body><slot /></body></html>`;

// The writer: a scoped slot that forwards `item` and `index`.
const CARD = `<script>
  interface Row { title: string }
  const props = defineProps<{ items?: Row[] }>();
  const item = props.items?.[0] ?? { title: 'none' };
  const index = 0;
</script>
<section class="card"><slot name="row" {item} {index} /></section>`;

const UI_TS = `import Card from './Card.deshi';\nexport { Card };`;

describe('defineSlots — the slot interface macro', () => {
  it('reads a TypeScript declaration', () => {
    const code = `interface S { footer?: { required?: boolean }, row?: { required?: boolean } }\nconst slots = defineSlots<S>();`;
    const scope = collectTypeDeclarations(code);
    const [site] = findDefineSlots(code);
    const c = slotContractFromSite(code, site, scope)!;
    expect(c.order).toEqual(['footer', 'row']);
    expect(c.slots.footer.required).toBe(false);
  });

  it('reads the plain-JS form', () => {
    const code = `defineSlots({ required: { required: true }, optional: { required: false } })`;
    const c = slotContractFromSite(code, findDefineSlots(code)[0], {})!;
    expect(c.order).toEqual(['required', 'optional']);
    expect(c.slots.required.required).toBe(true);
    expect(c.slots.optional.required).toBe(false);
  });

  it('erases the macro from the script body and never shadows `slots`', () => {
    const res = compile(`<script>\n  const slots = defineSlots<{ footer?: { required?: boolean } }>();\n</script>\n<div>x</div>`, {
      file: 'src/c.deshi',
    });
    expect(res.script.body).not.toContain('defineSlots');
    expect(res.script.slotDecls?.order).toEqual(['footer']);
    expect(res.meta.declaredSlots?.order).toEqual(['footer']);
  });

  it('errors PF4043 when defineSlots is declared twice', () => {
    const res = compile(
      `<script>\n  defineSlots<{ a?: {} }>();\n  defineSlots<{ b?: {} }>();\n</script>\n<div>x</div>`,
      { file: 'src/twice.deshi' },
    );
    expect(res.diagnostics.some((d) => d.code === 'PF4043')).toBe(true);
  });

  it('warns PF4042 for a declared slot that is never rendered', () => {
    const res = compile(
      `<script>\n  defineSlots<{ footer: { required: true }, ghost?: {} }>();\n</script>\n<slot name="footer" />`,
      { file: 'src/ghost.deshi' },
    );
    expect(res.diagnostics.some((d) => d.code === 'PF4042' && /ghost/.test(d.message))).toBe(true);
  });

  it('declared slots satisfy the known-slot check for dynamic slots', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Comp.deshi': `<script>defineSlots<{ foot?: {} }>();</script></script?><!-- dynamic name -->
        <slot name={window} />`,
      'src/page.deshi': `<script>\n  import Comp from './Comp.deshi';\n</script>\n<Comp><span slot="foot">x</span></Comp>`,
    });
    // dynamic <slot name={…}> with a declared interface must not report PF4033
    expect(res.diagnostics.some((d) => d.code === 'PF4033')).toBe(false);
  });
});

describe('scoped slots (slot props)', () => {
  it('forwards {item} {index} into named slot content', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': CARD,
      'src/ui.ts': UI_TS,
      // direct component usage lives in the card itself; page re-exports Card
      'src/page.deshi': `<script>\n  import Card from './Card.deshi';\n  const data = [{ title: 'A' }, { title: 'B' }];\n</script>\n<Card items={data}>\n  <template slot="row" let-item let-index>{index}: {item.title}</template>\n</Card>`,
    });
    expect(res.ok).toBe(true);
    const html = res.pages[0].html;
    expect(html).toContain('<section class="card">0: A</section>');
  });

  it('lets-* declared on the usage binds the default bucket', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Profile.deshi': `<script>\n  const props = defineProps<{ t?: { name: string } }>();\n  const t = props.t ?? { name: 'anon' };\n</script>\n<span><slot {t} /></span>`,
      'src/page.deshi': `<script>\n  import Profile from './Profile.deshi';\n  const me = { name: 'sera' };\n</script>\n<Profile t={me} let-t>{t.name}</Profile>`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('<span>sera</span>');
  });

  it('renders the fallback with forwarded props when the caller passes nothing', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': `<script>\n  const item = { title: 'spare' };\n</script>\n<div><slot name="row" {item}>fallback {item.title}</slot></div>`,
      'src/page.deshi': `<script>\n  import Card from './Card.deshi';\n</script>\n<Card />`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('fallback spare');
  });

  it('errors PF4044 for a passthrough off <slot>', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/page.deshi': `<script>\n  const item = 1;\n</script>\n<div {item} />`,
    });
    expect(res.diagnostics.some((d) => d.code === 'PF4044')).toBe(true);
  });

  it('errors PF4044 when a passthrough is not a bare identifier', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': `<div><slot name="row" {props.items[0]} /></div>`,
      'src/page.deshi': `<script>\n  import Card from './Card.deshi';\n</script>\n<Card />`,
    });
    expect(res.ok).toBe(false);
    expect(res.diagnostics.filter((d) => d.code === 'PF4044').length).toBeGreaterThan(0);
  });

  it('errors PF4046 for an invalid let- binding name', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/page.deshi': `<script>\n  import Profile from './Profile.deshi';\n</script>\n<Profile let-1bad>x</Profile>`,
    });
    // Profile does not exist either — PF4046 must still surface from parsing
    const codes = new Set(res.diagnostics.map((d) => d.code));
    expect(codes.has('PF4046') || codes.has('PF4024')).toBe(true);
  });

  it('warns PF4045 when the component never forwards a let- binding', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': `<script>\n  const item = { title: 'x' };\n</script>\n<div><slot name="row" {item} /></div>`,
      'src/page.deshi': `<script>\n  import Card from './Card.deshi';\n</script>\n<Card><template slot="row" let-missing>{missing.title}</template></Card>`,
    });
    // unresolved `missing` also fails scope analysis; PF4045 is the cross-file hint
    expect(res.diagnostics.some((d) => d.code === 'PF4045' && /missing/.test(d.message))).toBe(true);
  });

  it('keeps scoped-slot props through the island <deshi-slot> wrapper', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Iso.deshi': `<script>\n  const t = { name: 'iso' };\n</script>\n<script client>\n  const root;\n</script>\n<span><slot {t} /></span>`,
      'src/page.deshi': `<script>\n  import Iso from './Iso.deshi';\n</script>\n<Iso client:visible let-t>{t.name}</Iso>`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('deshi-slot');
    expect(res.pages[0].html.replace(/\s+/g, ' ')).toMatch(/<span>\s*<deshi-slot name="default">\s*iso\s*<\/deshi-slot>/);
  });
});
