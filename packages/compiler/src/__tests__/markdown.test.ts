import { describe, expect, it } from 'vitest';
import { parseFrontmatter, markdownToHtml, markdownToDeshi } from '../markdown';

describe('parseFrontmatter', () => {
  it('parses scalars and leaves body intact', () => {
    const { data, body } = parseFrontmatter('---\ntitle: Hi\ncount: 3\non: true\n---\n# body');
    expect(data).toMatchObject({ title: 'Hi', count: 3, on: true });
    expect(body).toContain('# body');
  });

  it('returns the whole source when there is no fence', () => {
    expect(parseFrontmatter('# hi')).toEqual({ data: {}, body: '# hi' });
  });
});

describe('markdownToHtml', () => {
  it('renders headings (with slugged ids), bold, links and lists', () => {
    const html = markdownToHtml('# Title\n\nHello **bold** and [x](/y)\n\n- a\n- b\n');
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="/y">x</a>');
    expect(html).toContain('<ul>');
  });

  it('renders fenced code, pipe tables and task lists', () => {
    // GFM tables need a `|` separator row; single-column tables use the
    // fully-piped form `| h |\n| --- |\n| c |`.
    const html = markdownToHtml(
      '```js\nconst a = 1;\n```\n\n| h |\n| --- |\n| c |\n\n- [x] done\n',
    );
    expect(html).toContain('<pre>');
    expect(html).toContain('<table>');
    expect(html).toContain('checked');
  });

  it('escapes raw HTML before applying inline rules', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).not.toContain('<script>');
  });
});

describe('markdownToDeshi', () => {
  it('turns frontmatter into script bindings + article shell', () => {
    const deshi = markdownToDeshi('---\ntitle: T\n---\n# Hi\n');
    expect(deshi).toContain('const title');
    expect(deshi).toContain('set:html');
  });
});
