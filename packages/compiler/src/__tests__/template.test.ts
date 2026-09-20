import { describe, expect, it } from 'vitest';
import { parseTemplate, containsDefaultSlot, walkNodes } from '../template';
import type { TemplateContext } from '../expression';

const baseCtx = (source: string, overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  file: 'src/page.deshi',
  source,
  components: new Set(['Card']),
  scoped: false,
  usedComponents: new Set(),
  usedSlots: new Set(),
  ...overrides,
});

describe('parseTemplate', () => {
  it('parses elements, text and expressions', () => {
    const src = `<div class="a">hi {1 + 1}</div>`;
    const { root } = parseTemplate(src, baseCtx(src), { minify: false, isLayout: false });
    expect(root.document).toBe(false);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].type).toBe('Element');
  });

  it('requires <html>/<head>/<body> for document templates', () => {
    const src = `<html><head></head><body><slot /></body></html>`;
    const { root } = parseTemplate(src, baseCtx(src), { minify: false, isLayout: false });
    expect(root.document).toBe(true);
  });

  it('rejects unimported capitalized tags (PF4024)', () => {
    const src = `<Ghost />`;
    expect(() => parseTemplate(src, baseCtx(src), { minify: false, isLayout: false })).toThrow(
      /PF4024/,
    );
  });

  it('rejects empty-expr attributes and bare set:html (PF1002)', () => {
    // Bare `set:html` (no value) and `attr={}` (empty expression container)
    // are the observable PF1002 cases — parse5 dedupes identical attribute
    // names before we see them, and mixed `text{expr}` stays literal text.
    const bare = `<div set:html></div>`;
    expect(() => parseTemplate(bare, baseCtx(bare), { minify: false, isLayout: false })).toThrow(
      /PF1002/,
    );
  });

  it('requires a default slot in layouts (PF2002)', () => {
    expect(() =>
      parseTemplate(`<div>no slot</div>`, baseCtx(`<div>no slot</div>`), {
        minify: false,
        isLayout: true,
      }),
    ).toThrow(/PF2002/);
  });
});

describe('containsDefaultSlot / walkNodes', () => {
  it('finds nested slots and visits every node', () => {
    const src = `<div><slot /></div>`;
    const { root } = parseTemplate(src, baseCtx(src), { minify: false, isLayout: false });
    expect(containsDefaultSlot(root.children)).toBe(true);
    const seen: string[] = [];
    walkNodes(root.children, (n) => seen.push(n.type));
    expect(seen).toContain('Slot');
    expect(seen).toContain('Element');
  });
});
