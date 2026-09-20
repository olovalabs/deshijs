import { describe, expect, it } from 'vitest';
import { generate } from '../codegen';
import { parseTemplate } from '../template';
import { emptyScript } from '../script';
import type { TemplateContext } from '../expression';

describe('generate', () => {
  const gen = (src: string) => {
    const ctx: TemplateContext = {
      file: 'src/page.deshi',
      source: src,
      components: new Set(),
      scoped: false,
      usedComponents: new Set(),
      usedSlots: new Set(),
    };
    const { root } = parseTemplate(src, ctx, { minify: false, isLayout: false });
    return generate({
      file: 'src/page.deshi',
      root,
      script: emptyScript(),
      hash: 'abcd1234',
      hasCss: false,
      hasClient: false,
      isLayout: false,
      isDocument: false,
      segment: null,
      cssUrl: null,
      slots: [],
      deps: [],
    });
  };

  it('emits escaped static markup', () => {
    const { esm } = gen('<div class="a">hi</div>');
    expect(esm).toContain('hi');
    expect(esm).toContain('render');
  });

  it('evaluates expressions through esc()', () => {
    const src = `<script>const n = 1;</script>\n<div>{n}</div>`;
    const ctx: TemplateContext = {
      file: 'src/page.deshi',
      source: src,
      components: new Set(),
      scoped: false,
      usedComponents: new Set(),
      usedSlots: new Set(),
    };
    const { root } = parseTemplate(src.replace(/<script>.*<\/script>\n/s, ''), ctx, {
      minify: false,
      isLayout: false,
    });
    const out = generate({
      file: 'src/page.deshi',
      root,
      script: { ...emptyScript(), body: 'const n = 1;' },
      hash: 'abcd1234',
      hasCss: false,
      hasClient: false,
      isLayout: false,
      isDocument: false,
      segment: null,
      cssUrl: null,
      slots: [],
      deps: [],
    });
    expect(out.esm).toContain('esc');
    expect(out.evalBody).toContain('const n = 1;');
  });

  it('emits render + meta for document layouts (no literal doctype)', () => {
    // codegen emits the `<!DOCTYPE html>` wrapper at *render* time via the
    // `htmlWrap` helper (see build.ts), not as a literal in the ESM — what
    // matters here is the slot marker + meta.
    const src = `<html><head><title>T</title></head><body><slot /></body></html>`;
    const ctx: TemplateContext = {
      file: 'src/layout.deshi',
      source: src,
      components: new Set(),
      scoped: false,
      usedComponents: new Set(),
      usedSlots: new Set(),
    };
    const { root } = parseTemplate(src, ctx, { minify: false, isLayout: true });
    const out = generate({
      file: 'src/layout.deshi',
      root,
      script: emptyScript(),
      hash: 'abcd1234',
      hasCss: false,
      hasClient: false,
      isLayout: true,
      isDocument: true,
      segment: null,
      cssUrl: null,
      slots: ['default', 'head'],
      deps: [],
    });
    expect(out.esm).toContain('deshi:head');
    expect(out.esm).toContain('"isDocument":true');
  });
});
