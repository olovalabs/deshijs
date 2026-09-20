// Transform pass (g) — scope analysis. Every identifier in every expression must
// resolve to a <script> binding, an implicit binding, an expression-local binding
// (params / block declarations) or a whitelisted global. Otherwise → PF4010.
import { fail, type Expression, type Node } from './types';
import { patternNames } from './script';
import { walkNodes } from './template';

export const IMPLICIT_BINDINGS = ['props', 'slots', 'params', 'url', 'route', 'env', 'Astro'];
export const GLOBALS_WHITELIST = [
  'JSON', 'Math', 'Date', 'Intl', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'encodeURIComponent', 'decodeURIComponent', 'URL', 'URLSearchParams',
  'console', 'undefined', 'NaN', 'Infinity', 'Astro',
  // Astro-like globals: fetch, Response etc for SSR
  'fetch', 'Response', 'Request', 'Headers',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

function isFunction(n: AnyNode): boolean {
  return n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration';
}

function hoistedNames(body: AnyNode[]): string[] {
  const out: string[] = [];
  for (const s of body) {
    if (s.type === 'VariableDeclaration') for (const d of s.declarations) patternNames(d.id, out);
    else if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') if (s.id) out.push(s.id.name);
  }
  return out;
}

export function analyzeExpression(expr: Expression, known: Set<string>, file: string, source: string): void {
  const scopes: Array<Set<string>> = [];
  const resolves = (name: string) => known.has(name) || scopes.some((s) => s.has(name));

  const walkPattern = (p: AnyNode, scope: Set<string>) => {
    for (const n of patternNames(p)) scope.add(n);
    // default values inside patterns are expressions
    const visitDefaults = (q: AnyNode) => {
      if (!q) return;
      if (q.type === 'AssignmentPattern') { walk(q.right, q, 'right'); visitDefaults(q.left); }
      else if (q.type === 'ObjectPattern') for (const pr of q.properties) { if (pr.computed) walk(pr.key, pr, 'key'); visitDefaults(pr.type === 'RestElement' ? pr.argument : pr.value); }
      else if (q.type === 'ArrayPattern') for (const el of q.elements) visitDefaults(el);
      else if (q.type === 'RestElement') visitDefaults(q.argument);
    };
    visitDefaults(p);
  };

  const walk = (node: AnyNode, parent: AnyNode, key: string) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, parent, key); return; }
    if (typeof node.type !== 'string') return;

    switch (node.type) {
      case 'Identifier': {
        if (parent) {
          if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
          if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) return;
          if (key === 'label') return;
          if (parent.type === 'MetaProperty') return;
        }
        if (!resolves(node.name)) {
          fail('PF4010', `"${node.name}" is not defined — template expressions can only use <script> bindings, implicit bindings (${IMPLICIT_BINDINGS.join(', ')}) or whitelisted globals`, file, source, node.start,
            `Declare "const ${node.name} = …" in the <script> block or import it.`);
        }
        return;
      }
      case 'JSXIdentifier':
      case 'JSXNamespacedName':
      case 'JSXText':
      case 'JSXEmptyExpression':
        return;
      case 'JSXElement': {
        for (const a of node.openingElement.attributes) {
          if (a.type === 'JSXSpreadAttribute') walk(a.argument, a, 'argument');
          else if (a.value && a.value.type !== 'Literal') walk(a.value, a, 'value');
        }
        walk(node.children, node, 'children');
        return;
      }
      case 'JSXFragment':
        walk(node.children, node, 'children');
        return;
    }

    if (isFunction(node)) {
      const scope = new Set<string>();
      if (node.id && node.type === 'FunctionExpression') scope.add(node.id.name);
      scopes.push(scope);
      for (const p of node.params) walkPattern(p, scope);
      if (node.body.type === 'BlockStatement') for (const n of hoistedNames(node.body.body)) scope.add(n);
      walk(node.body, node, 'body');
      scopes.pop();
      return;
    }
    if (node.type === 'BlockStatement' || node.type === 'Program') {
      scopes.push(new Set(hoistedNames(node.body)));
      walk(node.body, node, 'body');
      scopes.pop();
      return;
    }
    if (node.type === 'CatchClause') {
      const scope = new Set<string>();
      scopes.push(scope);
      if (node.param) walkPattern(node.param, scope);
      walk(node.body, node, 'body');
      scopes.pop();
      return;
    }
    if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const scope = new Set<string>();
      scopes.push(scope);
      const init = node.type === 'ForStatement' ? node.init : node.left;
      if (init?.type === 'VariableDeclaration') for (const d of init.declarations) { walkPattern(d.id, scope); walk(d.init, d, 'init'); }
      else walk(init, node, 'init');
      if (node.type === 'ForStatement') { walk(node.test, node, 'test'); walk(node.update, node, 'update'); }
      else walk(node.right, node, 'right');
      walk(node.body, node, 'body');
      scopes.pop();
      return;
    }
    if (node.type === 'VariableDeclarator') {
      const scope = scopes[scopes.length - 1];
      if (scope) walkPattern(node.id, scope);
      // init is evaluated before the binding is visible (TDZ semantics)
      walk(node.init, node, 'init');
      return;
    }
    if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
      const scope = new Set<string>();
      if (node.id) scope.add(node.id.name);
      scopes.push(scope);
      walk(node.superClass, node, 'superClass');
      walk(node.body, node, 'body');
      scopes.pop();
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      walk(node[k], node, k);
    }
  };

  walk(expr.ast, null, '');
}

export function analyzeTemplateScope(nodes: Node[], bindings: string[], file: string, source: string): void {
  const known = new Set<string>([...bindings, ...IMPLICIT_BINDINGS, ...GLOBALS_WHITELIST]);
  const seen = new Set<Expression>();

  const markSubExprsSeen = (expr: Expression) => {
    for (const j of expr.jsx) {
      walkNodes(j.nodes, (sub) => {
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
  walkNodes(nodes, (n) => {
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
