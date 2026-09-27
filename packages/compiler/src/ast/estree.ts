// ESTree analysis toolkit.
//
// One scope-aware walker, one identifier resolver, one static-value evaluator —
// shared by scope checking, prop/attr analysis, dead-code queries and codegen.
// Passes ask questions about an expression tree; they never traverse ESTree by
// hand. (Template AST traversal lives in ./walk.ts.)
import type * as ESTree from 'acorn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'raw', 'parent']);

/** Depth-first ESTree walk with parent + field context. Return `false` to skip. */
export function walkEstree(
  root: AnyNode,
  visit: (node: AnyNode, parent: AnyNode | null, key: string) => unknown,
): void {
  const step = (node: AnyNode, parent: AnyNode | null, key: string): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) step(child, parent, key);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (visit(node, parent, key) === false) return;
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      step(node[k], node, k);
    }
  };
  step(root, null, '');
}

/** True when the expression tree contains a function/arrow/class boundary. */
export function isFunctionLike(node: AnyNode): boolean {
  return (
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionDeclaration'
  );
}

// ─── scope resolution ────────────────────────────────────────────────────────

export interface ScopeOptions {
  /** names that always resolve (`<script>` bindings, implicit bindings) */
  known: Iterable<string>;
}

export interface UnresolvedRef {
  name: string;
  node: AnyNode;
}

function patternNames(p: AnyNode, out: string[] = []): string[] {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier':
      out.push(p.name);
      break;
    case 'ObjectPattern':
      for (const prop of p.properties) {
        patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of p.elements) patternNames(el, out);
      break;
    case 'RestElement':
      patternNames(p.argument, out);
      break;
    case 'AssignmentPattern':
      patternNames(p.left, out);
      break;
  }
  return out;
}

/** Bound names of a statement list (var/let/const, function and class declarations). */
export function hoistedNames(body: AnyNode[]): string[] {
  const out: string[] = [];
  for (const s of body) {
    if (!s) continue;
    if (s.type === 'VariableDeclaration') {
      for (const d of s.declarations) patternNames(d.id, out);
    } else if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') {
      if (s.id) out.push(s.id.name);
    }
  }
  return out;
}

/**
 * Every identifier reference inside `node` that resolves to nothing, i.e. a
 * template expression using a name that is neither a `<script>` binding, an
 * implicit binding, nor a whitelisted global. Drives PF4010.
 */
export function unresolvedIdentifiers(root: AnyNode, opts: ScopeOptions): UnresolvedRef[] {
  const known = new Set(opts.known);
  const scopes: Array<Set<string>> = [];
  const out: UnresolvedRef[] = [];
  const resolves = (name: string) => known.has(name) || scopes.some((s) => s.has(name));

  const bind = (p: AnyNode, scope: Set<string>): void => {
    for (const n of patternNames(p)) scope.add(n);
    // default values inside a pattern are themselves expressions
    const defaults = (q: AnyNode) => {
      if (!q) return;
      if (q.type === 'AssignmentPattern') {
        step(q.right, q, 'right');
        defaults(q.left);
      } else if (q.type === 'ObjectPattern') {
        for (const pr of q.properties) {
          if (pr.computed) step(pr.key, pr, 'key');
          defaults(pr.type === 'RestElement' ? pr.argument : pr.value);
        }
      } else if (q.type === 'ArrayPattern') {
        for (const el of q.elements) defaults(el);
      } else if (q.type === 'RestElement') {
        defaults(q.argument);
      }
    };
    defaults(p);
  };

  const step = (node: AnyNode, parent: AnyNode | null, key: string): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) step(n, parent, key);
      return;
    }
    if (typeof node.type !== 'string') return;

    switch (node.type) {
      case 'Identifier': {
        if (parent && isNonReferencePosition(parent, key)) return;
        if (!resolves(node.name)) out.push({ name: node.name, node });
        return;
      }
      // JSX was already converted to Deshi template nodes before analysis runs;
      // the original JSX nodes are inert as far as identifier scoping goes.
      case 'JSXIdentifier':
      case 'JSXNamespacedName':
      case 'JSXText':
      case 'JSXEmptyExpression':
        return;
      case 'JSXElement': {
        for (const a of node.openingElement.attributes) {
          if (a.type === 'JSXSpreadAttribute') step(a.argument, a, 'argument');
          else if (a.value && a.value.type !== 'Literal') step(a.value, a, 'value');
        }
        step(node.children, node, 'children');
        return;
      }
      case 'JSXFragment':
        step(node.children, node, 'children');
        return;
    }

    if (isFunctionLike(node)) {
      const scope = new Set<string>();
      if (node.id && node.type === 'FunctionExpression') scope.add(node.id.name);
      scopes.push(scope);
      for (const p of node.params) bind(p, scope);
      if (node.body.type === 'BlockStatement') for (const n of hoistedNames(node.body.body)) scope.add(n);
      step(node.body, node, 'body');
      scopes.pop();
      return;
    }
    if (node.type === 'BlockStatement' || node.type === 'Program') {
      scopes.push(new Set(hoistedNames(node.body)));
      step(node.body, node, 'body');
      scopes.pop();
      return;
    }
    if (node.type === 'CatchClause') {
      const scope = new Set<string>();
      scopes.push(scope);
      if (node.param) bind(node.param, scope);
      step(node.body, node, 'body');
      scopes.pop();
      return;
    }
    if (
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement'
    ) {
      const scope = new Set<string>();
      scopes.push(scope);
      const init = node.type === 'ForStatement' ? node.init : node.left;
      if (init?.type === 'VariableDeclaration') {
        for (const d of init.declarations) {
          bind(d.id, scope);
          step(d.init, d, 'init');
        }
      } else {
        step(init, node, 'init');
      }
      if (node.type === 'ForStatement') {
        step(node.test, node, 'test');
        step(node.update, node, 'update');
      } else {
        step(node.right, node, 'right');
      }
      step(node.body, node, 'body');
      scopes.pop();
      return;
    }
    if (node.type === 'VariableDeclarator') {
      const scope = scopes[scopes.length - 1];
      if (scope) bind(node.id, scope);
      // the initializer runs before the binding is visible (TDZ)
      step(node.init, node, 'init');
      return;
    }
    if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
      const scope = new Set<string>();
      if (node.id) scope.add(node.id.name);
      scopes.push(scope);
      step(node.superClass, node, 'superClass');
      step(node.body, node, 'body');
      scopes.pop();
      return;
    }

    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      step(node[k], node, k);
    }
  };

  step(root, null, '');
  return out;
}

/** Identifiers that are only *read* (not `x.y`, not an object key, not a label). */
function isNonReferencePosition(parent: AnyNode, key: string): boolean {
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return true;
  if (
    (parent.type === 'Property' ||
      parent.type === 'MethodDefinition' ||
      parent.type === 'PropertyDefinition') &&
    key === 'key' &&
    !parent.computed
  ) {
    return true;
  }
  if (key === 'label') return true;
  if (parent.type === 'MetaProperty') return true;
  return false;
}

/** True when the subtree reads the identifier `name` as a value. */
export function referencesIdentifier(root: AnyNode, name: string): boolean {
  let hit = false;
  walkEstree(root, (node, parent, key) => {
    if (hit) return false;
    if (node.type === 'Identifier' && node.name === name && !(parent && isNonReferencePosition(parent, key))) {
      hit = true;
      return false;
    }
    return true;
  });
  return hit;
}

/** Every identifier read in the subtree, as a set (keys and labels excluded). */
export function readIdentifiers(root: AnyNode): Set<string> {
  const out = new Set<string>();
  walkEstree(root, (node, parent, key) => {
    if (node.type === 'Identifier' && !(parent && isNonReferencePosition(parent, key))) {
      out.add(node.name);
    }
  });
  return out;
}

/**
 * True when `<obj>` is used in a way static analysis cannot follow: a computed
 * member access with a non-literal key (`props[key]`), or the object itself
 * being passed around (`f(props)`, `{...props}`). When this is true, inferred
 * prop/slot information is incomplete and completeness warnings are suppressed.
 */
export function hasOpaquePropertyAccess(root: AnyNode, obj: string): boolean {
  let opaque = false;
  walkEstree(root, (node, parent, key) => {
    if (opaque) return false;
    if (node.type === 'MemberExpression' && node.object?.type === 'Identifier' && node.object.name === obj) {
      if (node.computed && !(node.property.type === 'Literal' && typeof node.property.value === 'string')) {
        opaque = true;
        return false;
      }
      return true;
    }
    if (node.type === 'Identifier' && node.name === obj) {
      // a plain `props.x` read is fine; anything else is opaque
      if (parent?.type === 'MemberExpression' && key === 'object') return true;
      if (parent?.type === 'VariableDeclarator' && key === 'init' && parent.id.type !== 'Identifier') return true;
      if (parent?.type === 'Property' && key === 'value' && parent.shorthand) return true;
      // binding positions are writes, not reads
      if (parent?.type === 'VariableDeclarator' && key === 'id') return true;
      if (parent?.type === 'FunctionDeclaration' && key === 'id') return true;
      if ((parent?.type === 'ArrowFunctionExpression' || parent?.type === 'FunctionExpression') && (key === 'id' || key === 'params')) return true;
      if (parent?.type === 'ClassDeclaration' && key === 'id') return true;
      if (parent?.type === 'Property' && key === 'key' && !parent.computed) return true;
      opaque = true;
      return false;
    }
    return true;
  });
  return opaque;
}

// ─── property access (props.* inference) ─────────────────────────────────────

export interface PropAccess {
  name: string;
  /** true when read through optional chaining or a nested fallback */
  optional: boolean;
}

/**
 * Every `<obj>.<name>` read in the subtree, including destructuring
 * (`const { a, b: c } = obj`, `const [x] = obj`). This is how a component's
 * *actual* prop surface is inferred when it does not declare one.
 */
export function propertyAccesses(root: AnyNode, obj: string): PropAccess[] {
  const out: PropAccess[] = [];
  const seen = new Set<string>();
  const add = (name: string, optional = false) => {
    const key = name + ' ' + String(optional);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, optional });
  };

  const readPattern = (pattern: AnyNode): void => {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier':
        return; // the whole object was bound, not destructured
      case 'AssignmentPattern':
        return readPattern(pattern.left);
      case 'RestElement':
        return readPattern(pattern.argument);
      case 'ObjectPattern':
        for (const prop of pattern.properties) {
          if (prop.type === 'RestElement') return readPattern(prop.argument);
          const name = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value);
          add(name);
          readPattern(prop.value);
        }
        return;
      case 'ArrayPattern':
        for (const el of pattern.elements) readPattern(el);
        return;
    }
  };

  walkEstree(root, (node, parent, key) => {
    if (node.type === 'MemberExpression' && node.object?.type === 'Identifier' && node.object.name === obj) {
      if (node.computed) {
        if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
          add(node.property.value);
        }
      } else if (node.property.type === 'Identifier') {
        add(node.property.name, !!node.optional);
      }
      // still descend: `props.a.b` implies a read of `props.a`
      return true;
    }
    // `const { a } = props` / `const [a] = props`
    if (
      node.type === 'VariableDeclarator' &&
      node.init?.type === 'Identifier' &&
      node.init.name === obj &&
      node.id.type !== 'Identifier'
    ) {
      readPattern(node.id);
    }
    // `function f({ a }) {}` called with props is unknowable; only direct params count
    void parent;
    void key;
    return true;
  });

  return out;
}

// ─── static evaluation ───────────────────────────────────────────────────────

export type StaticValue =
  | { kind: 'value'; known: true; value: string | number | boolean | null | undefined }
  | { kind: 'array'; known: true; array: StaticValue[] }
  | { kind: 'object'; known: true; object: Record<string, StaticValue> }
  | { kind: 'unknown'; known: false };

const UNKNOWN: StaticValue = { kind: 'unknown', known: false };

/**
 * Best-effort constant folding for prop checks. Only *provably* constant
 * shapes resolve, so a check that fires is always sound.
 */
export function staticValue(node: AnyNode): StaticValue {
  if (!node) return UNKNOWN;
  switch (node.type) {
    case 'Literal':
      return { kind: 'value', known: true, value: node.value as string | number | boolean | null };
    case 'TemplateLiteral':
      if (node.expressions.length) return UNKNOWN;
      return {
        kind: 'value',
        known: true,
        value: node.quasis.map((q: AnyNode) => q.value.cooked ?? '').join(''),
      };
    case 'UnaryExpression': {
      const arg = staticValue(node.argument);
      if (arg.kind !== 'value') return UNKNOWN;
      const v = arg.value;
      if (node.operator === '-' && typeof v === 'number') return { kind: 'value', known: true, value: -v };
      if (node.operator === '!') return { kind: 'value', known: true, value: !v };
      if (node.operator === '+' && typeof v === 'string') return { kind: 'value', known: true, value: +v };
      return UNKNOWN;
    }
    case 'ArrayExpression': {
      const items: StaticValue[] = node.elements.map((e: AnyNode) => staticValue(e));
      return items.some((i) => !i.known) ? UNKNOWN : { kind: 'array', known: true, array: items };
    }
    case 'ObjectExpression': {
      const obj: Record<string, StaticValue> = {};
      for (const prop of node.properties) {
        if (prop.type !== 'Property' || prop.computed) return UNKNOWN;
        const key = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value);
        const v = staticValue(prop.value);
        if (!v.known) return UNKNOWN;
        obj[key] = v;
      }
      return { kind: 'object', known: true, object: obj };
    }
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return staticValue(node.expression);
    default:
      return UNKNOWN;
  }
}

/** `typeof`-style bucket for a resolved static value, or null when unknown. */
export function staticType(v: StaticValue): 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | null {
  if (v.kind === 'array') return 'array';
  if (v.kind === 'object') return 'object';
  if (v.kind !== 'value') return null;
  const value = v.value;
  if (value === null) return 'null';
  if (value === undefined) return null;
  return typeof value as 'string' | 'number' | 'boolean';
}

// ─── misc queries ────────────────────────────────────────────────────────────

/** All top-level bindings of a program body (re-exported for script analysis). */
export function declaredNames(body: ESTree.Program['body']): string[] {
  return hoistedNames(body as AnyNode[]);
}
