import { describe, expect, it } from 'vitest';
import { build, type BuildResult } from '../build';
import { __clearCompileMemoForTests } from '../index';

async function diags(files: Record<string, string>): Promise<BuildResult> {
  __clearCompileMemoForTests();
  return build({ files }, { router: false, minify: false, appDir: 'src' });
}

const LAYOUT = `<html><head><title>t</title></head><body><slot /></body></html>`;
const CARD = `<div class="card">{props.title || 'untitled'} - <slot /></div>`;

describe('JSX <Tag /> parity tests', () => {
  it('supports lowercase-head member expression <props.Header />', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': CARD,
      'src/Container.deshi': `<script>
        import Card from './Card.deshi';
      </script>
      <props.Header title="from-props-header" />`,
      'src/page.deshi': `<script>
        import Card from './Card.deshi';
        import Container from './Container.deshi';
      </script>
      <Container Header={Card} />`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('from-props-header');
  });

  it('supports lowercase-head member expression <ui.Card />', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': CARD,
      'src/page.deshi': `<script>
        import Card from './Card.deshi';
        const ui = { Card };
      </script>
      <ui.Card title="from-ui-card" />`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('from-ui-card');
  });

  it('supports plain function component in <Tag />', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/page.deshi': `<script>
        const Badge = (p) => '<span class="badge">' + p.text + '</span>';
      </script>
      <Badge text="function-badge" />`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('<span class="badge">function-badge</span>');
  });

  it('supports JSX element passed as a prop value', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Wrapper.deshi': `<div class="wrap">{props.header}</div>`,
      'src/page.deshi': `<script>
        import Wrapper from './Wrapper.deshi';
      </script>
      <Wrapper header={<h1>Header JSX</h1>} />`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('<h1>Header JSX</h1>');
  });

  it('supports mixing spreads and explicit props with overrides', async () => {
    const res = await diags({
      'src/layout.deshi': LAYOUT,
      'src/Card.deshi': `<div class="card" id={props.id}>{props.title}</div>`,
      'src/page.deshi': `<script>
        import Card from './Card.deshi';
        const p1 = { id: 'old-id', title: 'old-title' };
        const p2 = { title: 'overridden-title' };
      </script>
      <Card id="new-id" {...p1} {...p2} />`,
    });
    expect(res.ok).toBe(true);
    expect(res.pages[0].html).toContain('id="old-id"');
    expect(res.pages[0].html).toContain('overridden-title');
  });
});
