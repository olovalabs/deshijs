import { describe, expect, it } from 'vitest';
import { scanStartTag, duplicateAttrNames, planAttributes } from '../attrs';
import { compile, __clearCompileMemoForTests } from '../index';
import { build } from '../build';
import { walk, children, findNodes, cloneNodes } from '../ast/walk';
import {
  referencesIdentifier,
  propertyAccesses,
  staticValue,
  staticType,
  hasOpaquePropertyAccess,
  unresolvedIdentifiers,
} from '../ast/estree';
import { JsxParser, ACORN_OPTIONS } from '../expression';
import { printExpression, expressionCode } from '../ast/print';
import { prescan } from '../template';
import type { Attr, Expression, Node } from '../types';

/** Parse a bare JS expression (no surrounding braces). */
const js = (code: string) => JsxParser.parseExpressionAt(code, 0, ACORN_OPTIONS) as never;
/** Parse a statement and return the AST it produced. */
const stmt = (code: string) => (JsxParser.parse(code, ACORN_OPTIONS) as { body: unknown[] }).body;

/** A stand-in Expression node for exercising the planner in isolation. */
const fakeExpr = (code: string): Expression =>
  ({ type: 'Expression', ast: js(code), raw: code, src: code, start: 0, loc: { line: 1, column: 1, start: 0, end: code.length }, jsx: [] }) as never;

const plan = (attrs: Attr[], opts = {}) => planAttributes(attrs, { print: (e) => `(${e.src})`, ...opts });
const codeOf = (parts: Array<string | { code: string }>) =>
  parts.filter((p): p is { code: string } => typeof p !== 'string').map((p) => p.code);

describe('scanStartTag', () => {
  // the prescan masks expressions, which is what makes a tag well-formed here
  const mask = (src: string) => {
    const ctx = { file: 'f.deshi', source: src, components: new Set<string>(), scoped: false, usedComponents: new Set<string>(), usedSlots: new Set<string>() };
    return prescan(src, ctx, 'f.deshi').text;
  };
  const src = mask(`<div id="a" class='b c' data-x disabled {...spread} title="t">`);

  it('reads names, values and quoting', () => {
    const tag = scanStartTag(src, 0, src.length);
    expect(tag.name).toBe('div');
    expect(tag.attrs.map((a) => a.name).slice(0, 4)).toEqual(['id', 'class', 'data-x', 'disabled']);
    expect(tag.attrs[4].name).toMatch(/^x+$/);
    expect(tag.attrs[5].name).toBe('title');
    expect(tag.attrs[1].value).toBe('b c');
    expect(tag.attrs[1].quote).toBe("'");
    expect(tag.attrs[3].hasValue).toBe(false);
  });

  it('marks a masked spread attribute as having no real name', () => {
    const tag = scanStartTag(src, 0, src.length);
    expect(tag.attrs.filter((a) => a.masked)).toHaveLength(1);
  });

  it('detects self-closing syntax', () => {
    expect(scanStartTag('<Card />', 0, 9).selfClosing).toBe(true);
    expect(scanStartTag('<Card></Card>', 0, 13).selfClosing).toBe(false);
  });

  it('always makes progress, whatever the input', () => {
    for (const bad of ['<div a=1 / b=2>', '<div ==== >', '<div a=>', '<div a="unterminated']) {
      const tag = scanStartTag(bad, 0, bad.length);
      expect(Array.isArray(tag.attrs)).toBe(true);
    }
  });

  it('finds repeated attribute names', () => {
    const dup = `<div class="a" id="b" class="c">`;
    expect(duplicateAttrNames(scanStartTag(dup, 0, dup.length)).map((a) => a.name)).toEqual(['class']);
  });
});

describe('planAttributes', () => {
  it('keeps fully static attributes literal with no runtime call', () => {
    const p = plan([
      { kind: 'static', name: 'class', value: 'a b' },
      { kind: 'static', name: 'id', value: 'x' },
      { kind: 'boolean', name: 'disabled' },
    ]);
    expect(p.parts).toEqual([' class="a b" id="x" disabled']);
  });

  it('merges class and class:list into one entry (no duplicate key)', () => {
    const p = plan([
      { kind: 'static', name: 'class', value: 'base' },
      { kind: 'classList', expr: fakeExpr('active') },
    ]);
    expect(codeOf(p.parts)).toEqual(['attrs({ "class": cls(["base", (active)]) })']);
  });

  it('merges style and define:vars into one entry', () => {
    const p = plan([
      { kind: 'static', name: 'style', value: 'color:red;' },
      { kind: 'defineVars', expr: fakeExpr('vars') },
    ]);
    expect(codeOf(p.parts)[0]).toContain('sty(["color:red", Object.fromEntries');
  });

  it('merges a dynamic class with class:list', () => {
    const p = plan([
      { kind: 'classList', expr: fakeExpr('a') },
      { kind: 'dynamic', name: 'class', expr: fakeExpr('b') },
    ]);
    expect(codeOf(p.parts)[0]).toBe('attrs({ "class": cls([(a), (b)]) })');
  });

  it('preserves source order across literal and dynamic runs', () => {
    const p = plan([
      { kind: 'dynamic', name: 'href', expr: fakeExpr('u') },
      { kind: 'static', name: 'class', value: 'c' },
      { kind: 'dynamic', name: 'title', expr: fakeExpr('t') },
    ]);
    expect(p.parts).toEqual([
      { code: 'attrs({ "href": (u) })' },
      ' class="c"',
      { code: 'attrs({ "title": (t) })' },
    ]);
  });

  it('shares one call across consecutive dynamic attributes', () => {
    const p = plan([
      { kind: 'dynamic', name: 'a', expr: fakeExpr('a') },
      { kind: 'dynamic', name: 'b', expr: fakeExpr('b') },
    ]);
    expect(p.parts).toHaveLength(1);
  });

  it('lets an explicit attribute win over a spread', () => {
    const p = plan([
      { kind: 'spread', expr: fakeExpr('rest') },
      { kind: 'static', name: 'title', value: 'x' },
    ]);
    expect(codeOf(p.parts)[0]).toBe('attrs({ ...(rest), "title": "x" })');
  });

  it('emits the scope attribute separately, last', () => {
    const p = plan([{ kind: 'static', name: 'id', value: 'x' }], { scopeAttr: 'data-deshi-abc' });
    expect(p.parts).toEqual([' id="x"']);
    expect(p.scopeAttr).toBe('data-deshi-abc');
  });
});

describe('ast/walk', () => {
  const buildAst = () => {
    __clearCompileMemoForTests();
    return compile(
      `<script>\nimport Card from './Card.deshi';\nconst list = [1];\n</script>\n<div><Card a={1}><span slot="s">x</span></Card>{list.map((i) => <b>{i}</b>)}</div>`,
      { file: 'src/w.deshi' },
    ).ast;
  };

  it('reaches every node, including slots and jsx', () => {
    const types = findNodes(buildAst(), () => true).map((n) => n.type);
    expect(types).toContain('Component');
    expect(types).toContain('Element');
    expect(types).toContain('Text');
    expect(types).toContain('Expression');
  });

  it('reports the parent field each node was reached through', () => {
    const seen: string[] = [];
    walk(buildAst(), (n, info) => {
      seen.push(`${n.type}:${info.key}`);
    });
    expect(seen).toContain('Component:children');
    expect(seen).toContain('Element:slots');
    expect(seen).toContain('Element:jsx');
  });

  it('can skip a subtree', () => {
    const seen: string[] = [];
    walk(buildAst(), (n) => {
      seen.push(n.type);
      if (n.type === 'Component') return false;
    });
    // the <b> inside the jsx expression is still reached; nothing inside the component is
    expect(seen).toContain('Element');
    expect(seen.filter((t) => t === 'Element').length).toBeLessThan(5);
  });

  it('clones structurally', () => {
    const r = buildAst();
    const copy = cloneNodes(r.children);
    expect(copy.map((n) => n.type)).toEqual(r.children.map((n) => n.type));
    expect(copy[0]).not.toBe(r.children[0]);
    expect((copy[0] as { children: Node[] }).children).not.toBe((r.children[0] as { children: Node[] }).children);
  });

  it('children() is the single source of traversal truth', () => {
    const r = buildAst();
    const direct = children(r).length;
    let counted = 0;
    walk(r, () => {
      counted++;
    });
    expect(direct).toBeLessThan(counted);
  });
});

describe('ast/estree', () => {
  it('detects identifier references', () => {
    expect(referencesIdentifier(js('a + params.b'), 'params')).toBe(true);
    expect(referencesIdentifier(js('a + params.b'), 'slug')).toBe(false);
    expect(referencesIdentifier(js('params'), 'params')).toBe(true);
  });

  it('does not treat member keys or labels as references', () => {
    expect(referencesIdentifier(js('o.params'), 'params')).toBe(false);
    expect(referencesIdentifier(js('(() => { const o = { params: 1 }; return o })()'), 'params')).toBe(false);
  });

  it('collects prop accesses including destructuring', () => {
    expect(propertyAccesses(js('props.a + props["b"]'), 'props').map((x) => x.name)).toEqual(['a', 'b']);
    const [d] = stmt('const { x, y: z } = props;');
    expect(propertyAccesses(d, 'props').map((v) => v.name)).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('flags opaque prop access but not plain reads', () => {
    expect(hasOpaquePropertyAccess(js('props.a'), 'props')).toBe(false);
    expect(hasOpaquePropertyAccess(stmt('const { a } = props;')[0], 'props')).toBe(false);
    expect(hasOpaquePropertyAccess(js('props[k]'), 'props')).toBe(true);
    expect(hasOpaquePropertyAccess(js('f(props)'), 'props')).toBe(true);
    // aliasing hides the reads, so the analysis must assume the worst
    expect(hasOpaquePropertyAccess(stmt('const p = props; p.a')[0], 'props')).toBe(true);
  });

  it('folds only provable constants', () => {
    expect(staticType(staticValue(js('1')))).toBe('number');
    expect(staticType(staticValue(js('{a: 1}')))).toBe('object');
    expect(staticType(staticValue(js('[1, 2]')))).toBe('array');
    expect(staticType(staticValue(js('`x${y}`')))).toBe(null);
    expect(staticType(staticValue(js('f()')))).toBe(null);
  });

  it('resolves scopes, so a shadowed name is not unresolved', () => {
    const known = new Set(['props']);
    expect(unresolvedIdentifiers(js('props.a'), { known })).toHaveLength(0);
    expect(unresolvedIdentifiers(js('nope'), { known })[0].name).toBe('nope');
    expect(unresolvedIdentifiers(js('(() => { const nope = 1; return nope })()'), { known })).toHaveLength(0);
    expect(unresolvedIdentifiers(js('(() => nope)()'), { known })[0].name).toBe('nope');
  });
});

describe('ast/print', () => {
  const firstExpr = (file: string, src: string): Expression => {
    __clearCompileMemoForTests();
    const res = compile(src, { file });
    return findNodes(res.ast, (n: Node) => n.type === 'Expression')[0] as never as Expression;
  };

  it('returns the parser-exact source when there is no JSX', () => {
    const e = firstExpr('src/p.deshi', `<script>const a=1,b=2,c=3</script>\n<div>{a ? b : c}</div>`);
    expect(printExpression(e, () => 'X')).toBe('a ? b : c');
    expect(expressionCode(e)).toBe('a ? b : c');
  });

  it('replaces a JSX range and keeps the surrounding JS', () => {
    const e = firstExpr('src/p2.deshi', `<script>const f=(x)=>x</script>\n<div>{f(<b>hi</b>)}</div>`);
    expect(printExpression(e, () => 'RENDERED')).toBe('f(RENDERED)');
  });

  it('replaces several JSX ranges in one expression', () => {
    const e = firstExpr('src/p3.deshi', `<script>const a=1,b=2</script>\n<div>{a ? <i/> : <u/>}</div>`);
    expect(printExpression(e, () => 'R')).toBe('a ? R : R');
  });
});

describe('component attribute names keep their case', () => {
  const files = (usage: string) => ({
    'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
    'src/components/Box.deshi': `<div>{props.showIcon ? 'y' : 'n'}{props.someValue}</div>`,
    'src/page.deshi': `<script>import Box from './components/Box.deshi';</script>\n${usage}`,
  });

  it('passes camelCase props through unchanged', async () => {
    __clearCompileMemoForTests();
    const r = await build({ files: files(`<Box showIcon someValue="v" />`) }, { router: false, minify: false });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(r.pages[0].html).toContain('y');
    expect(r.pages[0].html).toContain('v');
  });

  it('still normalises names on plain elements', () => {
    __clearCompileMemoForTests();
    const res = compile(`<div dataFoo="1" myBar="2"></div>`, { file: 'src/case.deshi' });
    expect(res.code).toContain('datafoo=');
    expect(res.code).toContain('mybar=');
  });
});

describe('class and style merging keeps both values', () => {
  const render = async (body: string) => {
    __clearCompileMemoForTests();
    const r = await build(
      {
        files: {
          'src/layout.deshi': `<html><head><title>t</title></head><body><slot /></body></html>`,
          'src/page.deshi': `<script>const on = true;</script>\n${body}`,
        },
      },
      { router: false, minify: false },
    );
    const err = r.diagnostics.find((d) => d.severity === 'error');
    if (err) throw new Error(`${err.code} ${err.message}`);
    return r.pages[0].html;
  };

  it('keeps the static class alongside class:list', async () => {
    expect(await render(`<div class="base" class:list={{ on }}>x</div>`)).toContain('class="base on"');
  });

  it('keeps the static style alongside define:vars', async () => {
    const html = await render(`<div style="color:red" define:vars={{ on }}>x</div>`);
    expect(html).toContain('color:red');
    expect(html).toContain('--on:true');
  });
});
