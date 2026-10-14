import { beforeEach, describe, expect, it } from 'vitest';
import { build, type BuildOptions } from '../build';
import { compile, __clearCompileMemoForTests } from '../index';
import { slot } from '../runtime';

const layout = '<html><head><title>Test</title></head><body><slot /></body></html>';
const render = (source: string, extra: Record<string, string> = {}, options: BuildOptions = {}) => build({
  files: { 'src/layout.deshi': layout, 'src/page.deshi': source, ...extra },
}, { appDir: 'src', router: false, ...options });

beforeEach(__clearCompileMemoForTests);

describe('prototype-named slots', () => {
  it.each(['constructor', 'toString', '__proto__'])('renders the %s slot in HTML and JSX', async (name) => {
    const child = `<span slot="${name}">provided</span>`;
    for (const usage of [`<Card>${child}</Card>`, `{true && <Card>${child}</Card>}`]) {
      const result = await render(`<script>import Card from './Card.deshi';</script>${usage}`, {
        'src/Card.deshi': `<div><slot name="${name}">fallback</slot></div>`,
      });
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(result.pages[0]?.html).toContain('<div><span>provided</span></div>');
    }
  });

  it.each(['constructor', 'toString', '__proto__'])('uses fallback for an absent %s slot', async (name) => {
    expect(await slot({}, name, async () => 'fallback')).toBe('fallback');
  });
});

describe('compile cache source identity', () => {
  it('does not reuse output for distinct sources with the same 32-bit hash', () => {
    // Both inputs have FNV-1a hash 4be65180.
    const first = compile('<p>1xb90i3</p>', { file: 'src/collision.deshi' });
    const second = compile('<p>13ytnf9</p>', { file: 'src/collision.deshi' });
    expect(second.code).not.toBe(first.code);
    expect(second.code).toContain('<p>13ytnf9</p>');
  });
});

describe('raw-text code generation', () => {
  it.each([
    ['script', 'if (1 < 2 && true) console.log("&amp;", "<tag>");'],
    ['style', '.x::before{content:"<&amp;>"}'],
  ])('preserves inline %s contents verbatim', async (tag, content) => {
    const markup = `<${tag}>${content}</${tag}>`;
    const result = await render(`<div>${markup}</div>`, {}, { router: true });
    expect(result.ok).toBe(true);
    expect(result.pages[0]?.html).toContain(markup);
  });

  it('preserves JSON in document-head scripts', async () => {
    const markup = '<script type="application/ld+json">{"value":"<tag>&amp;"}</script>';
    const result = await render(`<html><head>${markup}</head><body>test</body></html>`, {}, { router: true });
    expect(result.ok).toBe(true);
    expect(result.pages[0]?.html).toContain(markup);
  });

  it('still escapes normal text and RCDATA elements', async () => {
    const result = await render('<p>&lt;tag&gt;&amp;</p><textarea>&lt;tag&gt;&amp;</textarea>');
    expect(result.ok).toBe(true);
    expect(result.pages[0]?.html).toContain('<p>&lt;tag&gt;&amp;</p>');
    expect(result.pages[0]?.html).toContain('<textarea>&lt;tag&gt;&amp;</textarea>');
  });
});

describe('empty attribute values', () => {
  it.each(['""', "''"])('passes %s as a string, not a boolean', async (empty) => {
    const result = await render(`<script>import Card from './Card.deshi';</script><Card title = ${empty} enabled />`, {
      'src/Card.deshi': '<p>{typeof props.title}:{JSON.stringify(props.title)}:{typeof props.enabled}</p>',
    });
    expect(result.ok).toBe(true);
    expect(result.pages[0]?.html).toContain('<p>string:"":boolean</p>');
  });

  it('preserves explicit empty element attributes alongside bare booleans', () => {
    const result = compile('<input value="" disabled>', { file: 'src/empty-attrs.deshi' });
    expect(result.ast.children).toMatchObject([{
      type: 'Element',
      attrs: [{ kind: 'static', name: 'value', value: '' }, { kind: 'boolean', name: 'disabled' }],
    }]);
  });
});

describe('frontmatter block splitting', () => {
  it('keeps server frontmatter when a client script is present', () => {
    const result = compile('---\nconst title = "hello";\n---\n<script client>console.log(ctx.props)</script><p>{title}</p>', {
      file: 'src/Client.deshi',
    });
    expect(result.script.bindings).toContain('title');
    expect(result.client?.body).toContain('ctx.props');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'PF1004' }));
  });

  it.each(['<div>', '<script>not JavaScript</script>', '<html>'])('ignores HTML inside frontmatter strings: %s', (markup) => {
    const result = compile(`---\nconst title = ${JSON.stringify(markup)};\n---\n<p>{title}</p><style>p { color: red; }</style>`, {
      file: 'src/frontmatter.deshi',
    });
    expect(result.script.bindings).toContain('title');
    expect(result.css.scoped).toContain('data-deshi-');
    expect(result.meta.isDocument).toBe(false);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('expression boundaries', () => {
  it.each([
    ['(1 + 2)', '3'],
    ['(((1 + 2) * 3))', '9'],
    ['1 /* trailing } comment */', '1'],
    ['(1 + 2) // trailing comment\n', '3'],
    ['({ value: 7 }).value', '7'],
    ['(true && <span>ok</span>)', '<span>ok</span>'],
    ['('.repeat(100) + '1' + ')'.repeat(100), '1'],
  ])('renders a complete expression: %s', async (expression, expected) => {
    const result = await render(`<p>{${expression}}</p>`);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.pages[0]?.html).toContain(`<p>${expected}</p>`);
  });

  it('handles grouping and comments in dynamic attributes and spreads', async () => {
    const result = await render('<div title={(1 + 2) /* comment */} {...({ id: "ok" })}>test</div>');
    expect(result.ok).toBe(true);
    expect(result.pages[0]?.html).toContain('<div title="3" id="ok">test</div>');
  });

  it.each(['{(1}', '{1)}', '{1 2}', '{1 /* unterminated', '{'])('still rejects malformed input %s', (source) => {
    expect(() => compile(source, { file: 'src/invalid.deshi' })).toThrow(/PF1003|PF4001/);
  });
});

describe('compile cache dependency validation', () => {
  it('refreshes diagnostics when an imported component changes between builds', async () => {
    const source = '<script>import Card from "./Card.deshi";</script><Card />';
    const card = (optional: boolean) => `<script>const props = defineProps<{ title${optional ? '?' : ''}: string }>();</script><p>{props.title}</p>`;
    const first = await render(source, { 'src/Card.deshi': card(true) });
    expect(first.ok).toBe(true);
    const second = await render(source, { 'src/Card.deshi': card(false) });
    expect(second.diagnostics).toContainEqual(expect.objectContaining({ code: 'PF4031' }));
    expect(second.ok).toBe(false);
    const third = await render(source, { 'src/Card.deshi': card(true) });
    expect(third.ok).toBe(true);
  });

  it('rechecks even when the same resolver function returns updated metadata', () => {
    const source = '<script>import Card from "./Card.deshi";</script><Card />';
    let requiredSlots: string[] = [];
    const resolveComponent = () => ({
      file: 'src/Card.deshi', slots: ['footer'], requiredSlots,
      dynamicSlots: false, contract: null, reads: [], opaque: false, client: false,
    });
    const options = { file: 'src/page.deshi', resolveComponent };
    expect(compile(source, options).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    requiredSlots = ['footer'];
    expect(compile(source, options).diagnostics).toContainEqual(expect.objectContaining({ code: 'PF4040' }));
  });
});

describe('function-scoped var declarations', () => {
  it.each([
    'if (true) { var n = 7; } return n;',
    'for (var n = 0; n < 7; n++) {} return n;',
    'try { var { n } = { n: 7 }; } catch (e) {} return n;',
    'if (false) { var n = 7; } return typeof n;',
  ])('resolves var outside its declaring block: %s', async (body) => {
    const result = await render(`<p>{(() => { ${body} })()}</p>`);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.pages[0]?.html).toContain(body.includes('typeof') ? '<p>undefined</p>' : '<p>7</p>');
  });

  it('exposes script-level var declarations nested in control flow', async () => {
    const result = await render('<script>if (true) { var n = 7; }</script><p>{n}</p>');
    expect(result.ok).toBe(true);
    expect(result.pages[0]?.html).toContain('<p>7</p>');
  });

  it.each([
    'if (true) { let n = 7; } return n;',
    'if (true) { const n = 7; } return n;',
    'function inner() { var n = 7; } return n;',
    'const inner = () => { var n = 7; }; return n;',
    'class Inner { static { var n = 7; } } return n;',
  ])('does not leak block or nested-function bindings: %s', (body) => {
    expect(() => compile(`<p>{(() => { ${body} })()}</p>`, { file: 'src/scope.deshi' })).toThrow(/PF4010/);
  });
});

describe('unclosed frontmatter fences', () => {
  it('reports the fence and does not emit the server text as HTML', () => {
    const result = compile('---\nconst x = 1;', { file: 'edge.deshi' });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PF1001',
      severity: 'error',
      message: expect.stringContaining('frontmatter'),
    }));
    expect(result.script.bindings).toContain('x');
    expect(result.code).toContain('const x = 1');
    expect(result.code).not.toContain('$o += "---');
    expect(result.ast.children).toEqual([]);
  });

  it('keeps markup after an unclosed fence out of the template', () => {
    const result = compile('---\nconst x = 1;\n<p>secret</p>', { file: 'edge.deshi' });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'PF1001' }));
    const text = JSON.stringify(result.ast);
    expect(text).not.toContain('secret');
  });

  it.each(['---\nconst x = 1;\n---\n<p>{x}</p>', '  ---\nconst x = 1;\n---\n<p>{x}</p>'])(
    'still accepts a closed fence: %j',
    async (source) => {
      const result = await render(source);
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(result.pages[0]?.html).toContain('<p>1</p>');
    },
  );
});

describe('deep HTML nesting', () => {
  it('compiles thousands of nested elements without overflowing the stack', () => {
    // Node 22 overflows near 2_000 nested elements. This host's recursive
    // conversion overflows near 15_000. Stay above both.
    const depth = 16_000;
    const html = '<div>'.repeat(depth) + 'leaf' + '</div>'.repeat(depth);
    const result = compile(html, { file: 'deep.deshi' });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.code).toContain(html);
  });
});

describe('empty input smoke tests', () => {
  it.each(['', ' \n\t'])('compiles empty or whitespace-only source %j', (source) => {
    const result = compile(source, { file: 'src/empty.deshi' });
    expect(result.diagnostics).toEqual([]);
    expect(result.ast.children).toEqual([]);
    expect(result.code).toContain('export default render');
  });
});
