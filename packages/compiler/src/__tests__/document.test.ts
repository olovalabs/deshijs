import { describe, expect, it } from 'vitest';
import { compile } from '../index';
import { compileDocument, parseFrontmatter } from '../document';
import type { Component, Element, Expression, Node } from '../types';

function findAll(nodes: Node[], pred: (n: Node) => boolean, out: Node[] = []): Node[] {
  for (const n of nodes) {
    if (pred(n)) out.push(n);
    if (n.type === 'Element' || n.type === 'Fragment' || n.type === 'HeadBlock') findAll(n.children, pred, out);
    else if (n.type === 'Component') for (const s of Object.values(n.slots)) findAll(s, pred, out);
  }
  return out;
}

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter and returns the body', () => {
    const { data, body } = parseFrontmatter('---\ntitle: Hi\ncount: 3\non: true\ntags:\n  - a\n  - b\n---\n# Body\n');
    expect(data).toMatchObject({ title: 'Hi', count: 3, on: true, tags: ['a', 'b'] });
    expect(body).toContain('# Body');
  });

  it('returns the whole source when there is no fence', () => {
    expect(parseFrontmatter('# hi')).toEqual({ data: {}, body: '# hi' });
  });
});

describe('markdown (.md) → Deshi AST', () => {
  const src = `---
title: Hello
---

# Title

Some **bold** and a [link](/y).

- [x] done
- plain

\`\`\`ts
const x = { a: 1 };
\`\`\`
`;

  it('builds real Element nodes (no set:html)', () => {
    const res = compile(src, { file: 'src/about.md' });
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(res.code).not.toContain('set:html');

    const headings = findAll(res.ast.children, (n) => n.type === 'Element' && (n as Element).name === 'h1');
    expect(headings).toHaveLength(1);
    expect((headings[0] as Element).attrs).toContainEqual({ kind: 'static', name: 'id', value: 'title' });

    const lis = findAll(res.ast.children, (n) => n.type === 'Element' && (n as Element).name === 'li');
    expect(lis).toHaveLength(2);
    // tight list item: no wrapping <p>
    expect((lis[0] as Element).children.some((c) => c.type === 'Element' && (c as Element).name === 'p')).toBe(false);
  });

  it('keeps braces inside code literal (as text, not expressions)', () => {
    const res = compile(src, { file: 'src/about.md' });
    const exprs = findAll(res.ast.children, (n) => n.type === 'Expression');
    expect(exprs).toHaveLength(0);
    const code = findAll(res.ast.children, (n) => n.type === 'Element' && (n as Element).name === 'code');
    expect(JSON.stringify(code)).toContain('{ a: 1 }');
  });
});

describe('mdx (.mdx) → Deshi AST', () => {
  it('lifts ESM, resolves components and keeps expressions as AST nodes', () => {
    const src = `---
title: Guide
---

import Card from '../components/Card.deshi';

# Hi {frontmatter.title}

<Card title="Box">
  <p>Inner {1 + 2}</p>
</Card>

export async function getStaticParams() {
  return [{ slug: 'a' }];
}
`;
    const res = compile(src, { file: 'src/guide/page.mdx' });
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(res.meta.deps).toContain('../components/Card.deshi');
    expect(res.script.staticParams).toContain('getStaticParams');
    expect(res.evalBody).toContain('renderComponent(Card');

    const comps = findAll(res.ast.children, (n) => n.type === 'Component') as Component[];
    expect(comps).toHaveLength(1);
    expect(comps[0].ident).toBe('Card');

    const exprs = findAll(res.ast.children, (n) => n.type === 'Expression') as Expression[];
    expect(exprs.map((e) => e.raw)).toEqual(expect.arrayContaining(['frontmatter.title', '1 + 2']));
  });

  it('exposes frontmatter bindings and a frontmatter object', () => {
    const doc = compileDocument('---\ntitle: Hi\n---\n# x\n', 'src/a.md', { minify: false });
    expect(doc.script.bindings).toContain('title');
    expect(doc.script.bindings).toContain('frontmatter');
  });

  it('errors when a capitalized tag is not imported', () => {
    expect(() => compile('<Nope />\n', { file: 'src/b.mdx' })).toThrow(/PF4024/);
  });

  it('wraps in a layout when frontmatter.layout is set', () => {
    const res = compile('---\nlayout: "../layouts/A.deshi"\n---\n# Hi\n', {
      file: 'src/a.md',
      isLayout: false,
    });
    const comps = findAll(res.ast.children, (n) => n.type === 'Component') as Component[];
    expect(comps.map((c) => c.ident)).toContain('Layout');
  });
});
