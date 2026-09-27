// Transform pass (g) — scope analysis. Every identifier in every expression must
// resolve to a `<script>` binding, an implicit binding, an expression-local
// binding (params / block declarations) or a whitelisted global. Otherwise →
// PF4010.
//
// The resolution itself lives in `ast/estree.ts`, which is also what prop
// analysis and dead-code queries use; this module only decides the vocabulary.
import { fail, type Expression, type Node } from './types';
import { walk } from './ast/walk';
import { unresolvedIdentifiers } from './ast/estree';

export const IMPLICIT_BINDINGS = ['props', 'slots', 'params', 'url', 'route', 'env', 'Astro'];
export const GLOBALS_WHITELIST = [
  'JSON', 'Math', 'Date', 'Intl', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'encodeURIComponent', 'decodeURIComponent', 'URL', 'URLSearchParams',
  'console', 'undefined', 'NaN', 'Infinity', 'Astro',
  // Astro-like globals: fetch, Response etc for SSR
  'fetch', 'Response', 'Request', 'Headers',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
];

export function analyzeExpression(expr: Expression, known: Set<string>, file: string, source: string): void {
  for (const ref of unresolvedIdentifiers(expr.ast, { known })) {
    fail(
      'PF4010',
      `"${ref.name}" is not defined — template expressions can only use <script> bindings, implicit bindings (${IMPLICIT_BINDINGS.join(', ')}) or whitelisted globals`,
      file,
      source,
      ref.node.start,
      `Declare "const ${ref.name} = …" in the <script> block or import it.`,
    );
  }
}

export function analyzeTemplateScope(nodes: Node[], bindings: string[], file: string, source: string): void {
  const known = new Set<string>([...bindings, ...IMPLICIT_BINDINGS, ...GLOBALS_WHITELIST]);
  const seen = new Set<Expression>();

  /** Expressions nested inside a JSX run are checked via their own node. */
  const markSubExprsSeen = (expr: Expression) => {
    for (const j of expr.jsx) {
      walk(j.nodes, (sub) => {
        if (sub.type === 'Expression') {
          seen.add(sub);
          markSubExprsSeen(sub);
        } else if (sub.type === 'Element') {
          for (const a of sub.attrs) if ('expr' in a) seen.add(a.expr);
        } else if (sub.type === 'Component') {
          for (const a of sub.props) if ('expr' in a) seen.add(a.expr);
          if (sub.clientProps) seen.add(sub.clientProps);
        }
      });
    }
  };

  const check = (e: Expression) => {
    if (seen.has(e)) return;
    seen.add(e);
    analyzeExpression(e, known, file, source);
    markSubExprsSeen(e);
  };

  walk(nodes, (n) => {
    if (n.type === 'Expression') {
      check(n);
    } else if (n.type === 'Element') {
      for (const a of n.attrs) if ('expr' in a) check(a.expr);
    } else if (n.type === 'Component') {
      for (const a of n.props) if ('expr' in a) check(a.expr);
      if (n.clientProps) check(n.clientProps);
    }
  });
}
