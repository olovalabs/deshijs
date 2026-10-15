// Scoped style transform (css-tree). Appends `[data-deshi-<hash>]` to every compound
// selector, respecting :global(...), :root / :host, @keyframes names, and recursing
// into @media / @supports / nested at-rules.
//
// `optimizeCss` delegates the *compiler-generated* CSS to Lightning CSS when it
// is installed (a far stronger optimizer than css-tree: color/value shortening,
// dead-rule removal, safe transforms), and falls back to css-tree otherwise. The
// dependency is optional so the compiler still works without a native binary.
// Author inline `<style>` text keeps the tolerant `minifyCss` path instead.
import { createRequire } from 'node:module';
import { parse, walk, generate, List, type CssNode, type Selector, type Rule, type WalkContext } from 'css-tree';
import { hashString } from './types';

// ─── Lightning CSS (optional) ────────────────────────────────────────────────

interface LightningCss {
  transform(options: {
    filename?: string;
    code: Uint8Array;
    minify?: boolean;
    targets?: unknown;
    errorRecovery?: boolean;
  }): { code: Uint8Array };
}

let lightning: LightningCss | null | undefined;

/** Load Lightning CSS on demand. Returns null when it is not installed. */
export function loadLightningCss(): LightningCss | null {
  if (lightning !== undefined) return lightning;
  try {
    const require = createRequire(import.meta.url);
    lightning = require('lightningcss') as LightningCss;
  } catch {
    lightning = null;
  }
  return lightning;
}

/** Test hook — forget the cached Lightning CSS module lookup. */
export function __resetCssOptimizerForTests(): void {
  lightning = undefined;
}

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
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(css, {
      positions: false,
      parseValue: false,
      parseAtrulePrelude: false,
      onParseError: () => {},
    } as Parameters<typeof parse>[1]);
  } catch {
    // Invalid CSS must not kill the build — leave it untouched so the
    // browser / Vite pipeline can report it with a proper location.
    return css;
  }
  try {
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
  } catch {
    return css;
  }
}

export function minifyCss(css: string): string {
  try {
    return generate(parse(css, { positions: false }));
  } catch {
    return css.trim();
  }
}

/**
 * Aggressively optimize compiler-generated CSS (scoped/global style blocks).
 * Uses Lightning CSS when installed — shorter values, dead-rule removal — and
 * falls back to the css-tree `minifyCss` pass otherwise.
 *
 * Author inline `<style>` text is deliberately routed through `minifyCss`
 * instead, so raw markup keeps its original bytes.
 */
export function optimizeCss(css: string): string {
  const trimmed = css.trim();
  if (!trimmed) return '';
  const lc = loadLightningCss();
  if (lc) {
    try {
      return lc.transform({ filename: 'deshi.css', code: Buffer.from(css), minify: true }).code.toString();
    } catch {
      // Invalid or unsupported CSS — fall back to the tolerant css-tree pass.
    }
  }
  return minifyCss(css);
}

/**
 * Minify a bare declaration list, e.g. the value of a `style="…"` attribute.
 * Falls back to css-tree, then to the trimmed input when nothing can parse it.
 */
export function minifyDeclarationList(decls: string): string {
  const trimmed = decls.trim();
  if (!trimmed) return '';
  const lc = loadLightningCss();
  if (lc) {
    try {
      // Lightning CSS optimizes rules, not declaration lists — wrap the list in
      // a throwaway rule and unwrap the (minified) body afterwards.
      const out = lc
        .transform({ filename: 'inline.css', code: Buffer.from(`*{${trimmed}}`), minify: true })
        .code.toString();
      const m = /^\*\{([\s\S]*)\}$/.exec(out.trim());
      if (m) return m[1];
    } catch {
      // fall through
    }
  }
  try {
    return generate(parse(trimmed, { positions: false, context: 'declarationList' } as Parameters<typeof parse>[1]));
  } catch {
    return trimmed;
  }
}
