// Scoped style transform (css-tree). Appends `[data-deshi-<hash>]` to every compound
// selector, respecting :global(...), :root / :host, @keyframes names, and recursing
// into @media / @supports / nested at-rules.
import { parse, walk, generate, List, type CssNode, type Selector, type Rule, type WalkContext } from 'css-tree';
import { hashString } from './types';

export function scopeAttribute(hash: string): string {
  return `data-deshi-${hash}`;
}

/** Content-hashed URL for a file's scoped CSS (React-style import target). */
export function scopedCssUrl(scoped: string): string | null {
  return scoped ? `/_deshi/${hashString(scoped)}.css` : null;
}

function attributeNode(hash: string): CssNode {
  return {
    type: 'AttributeSelector',
    name: { type: 'Identifier', name: scopeAttribute(hash) },
    matcher: null,
    value: null,
    flags: null,
  };
}

function scopeSelector(selector: Selector, hash: string): void {
  const items = selector.children.toArray();
  const out: CssNode[] = [];
  let compound: CssNode[] = [];

  const flush = () => {
    if (!compound.length) return;
    const globalIdx = compound.findIndex((n) => n.type === 'PseudoClassSelector' && n.name === 'global');
    if (globalIdx >= 0) {
      // :global(.a.b) → unwrap the inner selector, no scoping attribute
      const g = compound[globalIdx] as { children: List<CssNode> | null };
      const inner = g.children?.first;
      const rest = compound.filter((_, i) => i !== globalIdx);
      if (inner && inner.type === 'SelectorList') {
        const first = inner.children.first as Selector | null;
        if (first) out.push(...first.children.toArray());
      } else if (inner && inner.type === 'Selector') {
        out.push(...inner.children.toArray());
      } else if (inner) {
        out.push(inner);
      }
      out.push(...rest);
      compound = [];
      return;
    }
    const onlyRootish =
      compound.length === 1 &&
      compound[0].type === 'PseudoClassSelector' &&
      (compound[0].name === 'root' || compound[0].name === 'host');
    if (onlyRootish) {
      out.push(...compound);
      compound = [];
      return;
    }
    // insert before the first pseudo (`.card:hover` → `.card[data-deshi-x]:hover`)
    const pseudoIdx = compound.findIndex((n) => n.type === 'PseudoElementSelector' || n.type === 'PseudoClassSelector');
    const insertAt = pseudoIdx === -1 ? compound.length : pseudoIdx;
    out.push(...compound.slice(0, insertAt), attributeNode(hash), ...compound.slice(insertAt));
    compound = [];
  };

  for (const n of items) {
    if (n.type === 'Combinator') {
      flush();
      out.push(n);
    } else {
      compound.push(n);
    }
  }
  flush();
  selector.children = new List<CssNode>().fromArray(out);
}

export function scopeCss(css: string, hash: string): string {
  const ast = parse(css, { positions: false, parseValue: false, parseAtrulePrelude: true });
  walk(ast, {
    visit: 'Rule',
    enter(this: WalkContext, node: Rule) {
      const atrule = this.atrule;
      if (atrule && /keyframes$/i.test(atrule.name)) return;
      if (node.prelude.type !== 'SelectorList') return;
      node.prelude.children.forEach((sel) => {
        if (sel.type === 'Selector') scopeSelector(sel, hash);
      });
    },
  });
  return generate(ast);
}

export function minifyCss(css: string): string {
  return generate(parse(css, { positions: false }));
}
