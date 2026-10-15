import { describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../build';
import { __clearCompileMemoForTests } from '../index';

async function diags(files: Record<string, string>): Promise<BuildResult> {
  __clearCompileMemoForTests();
  return build({ files }, { router: false, minify: false, appDir: 'src' });
}

const LAYOUT = `<html><head><title>t</title></head><body><slot /></body></html>`;

const CARD = `<div class="card">{props.title}</div>`;

// `UI.Card` is the compiled component reachable through a namespace import head.
const UI_TS = `import Card from './Card.deshi';\nexport { Card };`;

const UI_PAGE = `<script>\n  import * as UI from './ui.ts';\n</script>\n<UI.Card title="hi" />`;

describe('dynamic and member component tags', () => {
  it('renders a template-level member tag <UI.Card>', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': CARD,
      'src/ui.ts': UI_TS,
      'src/page.deshi': UI_PAGE,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('class="card"');
    expect(res.pages[0].html).toContain('hi');
  });

  it('renders a member tag inside a JSX expression', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': CARD,
      'src/ui.ts': UI_TS,
      'src/page.deshi': `<script>
        import * as UI from './ui.ts';
        const items = ['a', 'b'];
      </script>
      {items.map((it) => <UI.Card title={it} />)}`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html.match(/class="card"/g)?.length).toBe(2);
  });

  it('renders a script-bound tag <Tag /> and skips contract checks', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': CARD,
      'src/ui.ts': UI_TS,
      'src/page.deshi': `<script>
        import * as UI from './ui.ts';
        const Tag = UI.Card;
      </script>
      <Tag title="bound" totally-unknown="x" />`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('bound');
  });

  it('errors PF4041 when a member tag resolves to nothing', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/page.deshi': `<Not.Bound t="1" />`,
    });
    const hit = res.diagnostics.find((d) => d.code === 'PF4041');
    expect(hit).toBeTruthy();
    expect(hit!.message).toContain('Not.Bound');
  });

  it('errors PF4024 for an unknown plain capitalized tag', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/page.deshi': `<Unknown t="1" />`,
    });
    expect(res.diagnostics.some((d) => d.code === 'PF4024')).toBe(true);
  });

  it('survives template-level case for <UI.Card> (parse5 lowercases)', async () => {
    // Lowercase soup vs original casing — originalTagName slices the source,
    // so a dotted tag keeps its case and is still a component.
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': CARD,
      'src/ui.ts': UI_TS,
      'src/page.deshi': `<script>\n  import * as UI from './ui.ts';\n</script>\n<UI.Card title="c" />`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('<div class="card">c</div>');
  });
});
