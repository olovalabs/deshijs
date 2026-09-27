// Component props & attributes analysis — the CPA pass.
//
// A component usage is checked against the *declaration* of the component it
// names, never against a guess:
//
//   1. the component file is compiled first, yielding its declared prop
//      contract (`defineProps<Props>()`), the slots it renders, and the props it
//      actually reads;
//   2. every usage is then validated against that information — unknown prop,
//      missing required prop, provably wrong value kind, unknown slot, missing
//      required slot — each with a source location and a fix hint.
//
// A component that declares nothing is still useful: its prop *reads* are
// inferred, which turns "you passed a prop nobody reads" into a warning.

import type { Attr, Component, Loc, Node, Root } from './types';
import { walk } from './ast/walk';
import { hasOpaquePropertyAccess, propertyAccesses, staticType, staticValue } from './ast/estree';
import { describeType, type PropContract, type PropType } from './tsprops';

/** What one compiled component file tells the compiler about its interface. */
export interface ComponentInfo {
  /** project-relative path of the component */
  file: string;
  /** every slot name the component renders (`default` included) */
  slots: string[];
  /** slots it renders without fallback, i.e. the ones a usage must provide */
  requiredSlots: string[];
  /** true when a slot name is computed, so slot checks are skipped */
  dynamicSlots: boolean;
  /** the declared contract, or null when the component declares none */
  contract: PropContract | null;
  /** `props.x` names the component reads */
  reads: string[];
  /** true when props are accessed in a way static analysis cannot follow */
  opaque: boolean;
  /** the component has a `<script client>` block */
  client: boolean;
}

/** Resolves an imported component (by its local name) to its interface. */
export type ComponentResolver = (ident: string, fromFile: string) => ComponentInfo | null;

/** The parts of a `CompileResult` a resolver needs. */
export interface CompiledFileLike {
  script: { imports: Array<{ source: string; specifiers: Array<{ local: string }> }> };
  meta: {
    slots: string[];
    requiredSlots: string[];
    dynamicSlots: boolean;
    contract: PropContract | null;
    propReads: string[];
    propReadsOpaque: boolean;
    hasClient: boolean;
  };
}

/**
 * Build a resolver over an already-compiled project. The build compiles every
 * file first, then checks usages against these interfaces — which is what lets
 * a component's *declaration* police its call sites.
 */
export function resolverFromCompiled(
  compiled: Record<string, CompiledFileLike>,
  resolvePath: (specifier: string, fromFile: string) => string,
): ComponentResolver {
  const interfaces = new Map<string, ComponentInfo>();
  for (const [file, res] of Object.entries(compiled)) {
    interfaces.set(file, {
      file,
      slots: res.meta.slots,
      requiredSlots: res.meta.requiredSlots,
      dynamicSlots: res.meta.dynamicSlots,
      contract: res.meta.contract,
      reads: res.meta.propReads,
      opaque: res.meta.propReadsOpaque,
      client: res.meta.hasClient,
    });
  }
  return (ident, fromFile) => {
    const owner = compiled[fromFile];
    const imp = owner?.script.imports.find((i) => i.specifiers.some((s) => s.local === ident));
    if (!imp) return null;
    return interfaces.get(resolvePath(imp.source, fromFile)) ?? null;
  };
}

export interface PropIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  hint?: string;
  loc: Loc;
}

const MAX_SUGGESTION_DISTANCE = 3;

/** Closest declared name, when one is close enough to be a typo. */
function suggest(name: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestScore = MAX_SUGGESTION_DISTANCE + 1;
  for (const c of candidates) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  return bestScore <= MAX_SUGGESTION_DISTANCE ? best : null;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// ─── value kinds ────────────────────────────────────────────────────────────

export type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'unknown';

/** The statically provable kind of a passed prop, or `unknown`. */
export function attrValueKind(a: Attr): ValueKind {
  switch (a.kind) {
    case 'static':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'dynamic': {
      const t = staticType(staticValue(a.expr.ast));
      return t ?? 'unknown';
    }
    default:
      return 'unknown';
  }
}

const KIND_LABEL: Record<Exclude<ValueKind, 'unknown'>, string> = {
  string: 'a string',
  number: 'a number',
  boolean: 'a boolean',
  null: 'null',
  array: 'an array',
  object: 'an object',
};

/** Does a declared prop type accept this value kind? Unknown kinds are allowed. */
export function accepts(type: PropType, kind: ValueKind): boolean {
  if (kind === 'unknown') return true;
  switch (type.kind) {
    case 'any':
    case 'unknown':
      return true;
    case 'union':
      return type.of.some((t) => accepts(t, kind));
    case 'array':
      return kind === 'array' || kind === 'string';
    case 'tuple':
      return kind === 'array';
    case 'object':
      return kind === 'object' || kind === 'array';
    case 'function':
      return true;
    case 'ref':
      return true;
    case 'null':
    case 'undefined':
      return kind === 'null';
    case 'literal':
      return false; // resolved by the caller, which has the value
    default:
      return type.kind === kind;
  }
}

// ─── the pass ───────────────────────────────────────────────────────────────

export interface CheckContext {
  file: string;
  resolve: ComponentResolver;
}

/**
 * Validate every component usage in a compiled file against the declarations of
 * the components it names.
 */
export function checkComponentUsages(root: Root, ctx: CheckContext): PropIssue[] {
  const issues: PropIssue[] = [];
  walk(root.children, (n) => {
    if (n.type !== 'Component') return;
    issues.push(...checkUsage(n, ctx));
  });
  return issues;
}

function checkUsage(node: Component, ctx: CheckContext): PropIssue[] {
  const issues: PropIssue[] = [];
  const info = ctx.resolve(node.ident, ctx.file);
  const at = node.loc;

  // ── directives that are only meaningful on components ──
  for (const a of node.props) {
    if (a.kind === 'setHtml' || a.kind === 'setText' || a.kind === 'classList' || a.kind === 'defineVars') {
      const name = 'name' in a ? a.name : '';
      issues.push({
        code: 'PF4039',
        severity: 'error',
        message: `"${name}" is an element directive and cannot be used on <${node.ident}>`,
        hint: 'Set it on an element inside the component instead.',
        loc: 'expr' in a ? a.expr.loc : at,
      });
    }
    if ((a.kind === 'static' || a.kind === 'boolean' || a.kind === 'dynamic') && /^on[A-Z]/.test(a.name)) {
      issues.push({
        code: 'PF4038',
        severity: 'warning',
        message: `"${a.name}" looks like a React event handler, which Deshi does not ship`,
        hint: 'Add a <script client> block and bind the listener there.',
        loc: at,
      });
    }
  }

  // `client:props` must survive JSON, and must match the contract when there is one
  if (node.clientProps) issues.push(...checkClientProps(node, info, node.clientProps.loc));

  if (!info) return issues;

  const contract = info.contract;
  const hasSpread = node.props.some((a) => a.kind === 'spread');

  // ── props ──
  if (contract && !hasSpread) {
    for (const a of node.props) {
      const name = 'name' in a ? a.name : '';
      if (!name) continue;
      const spec = contract.props[name];
      if (!spec) {
        const guess = suggest(name, contract.order);
        issues.push({
          code: 'PF4030',
          severity: 'error',
          message: `<${node.ident}> has no prop "${name}"`,
          hint: guess
            ? `Did you mean "${guess}"? Declared props: ${contract.order.join(', ')}.`
            : `Declared props: ${contract.order.join(', ')}.`,
          loc: at,
        });
        continue;
      }
      const kind = attrValueKind(a);
      if (kind === 'unknown') continue;
      if (!valueMatches(spec.type, a, kind)) {
        issues.push({
          code: 'PF4032',
          severity: 'error',
          message: `Prop "${name}" of <${node.ident}> expects ${describeType(spec.type)} but got ${KIND_LABEL[kind as Exclude<ValueKind, 'unknown'>] ?? 'another type'}`,
          hint:
            kind === 'string'
              ? 'HTML attribute values are always strings — pass an expression: name={value}.'
              : undefined,
          loc: 'expr' in a ? a.expr.loc : at,
        });
      }
    }
    for (const name of contract.order) {
      const spec = contract.props[name];
      if (spec.optional || spec.hasDefault) continue;
      if (node.props.some((a) => ('name' in a ? a.name : '') === name)) continue;
      issues.push({
        code: 'PF4031',
        severity: 'error',
        message: `<${node.ident}> requires the prop "${name}" (${describeType(spec.type)})`,
        hint: `Add ${name}={…} to the <${node.ident}> usage.`,
        loc: at,
      });
    }
  }

  // ── slots ──
  if (!info.dynamicSlots) {
    for (const name of Object.keys(node.slots)) {
      if (name === 'default') continue;
      if (info.slots.includes(name)) continue;
      issues.push({
        code: 'PF4033',
        severity: 'error',
        message: `<${node.ident}> has no slot named "${name}"`,
        hint: `Slots it renders: ${info.slots.map((s) => `"${s}"`).join(', ')}.`,
        loc: at,
      });
    }
    for (const name of info.requiredSlots) {
      if (name === 'default') continue;
      if (node.slots[name] && node.slots[name].length) continue;
      issues.push({
        code: 'PF4040',
        severity: 'warning',
        message: `<${node.ident}> renders <slot name="${name}" /> with no fallback, and this usage provides no "${name}" slot`,
        loc: at,
      });
    }
  }

  return issues;
}

/**
 * Does the passed attribute satisfy the declared type?
 *
 * Literal types are compared by value; unions of literals are compared against
 * the *set*, and a union of any other types falls back to the kind check. When
 * nothing can be proven, the value is accepted.
 */
function valueMatches(type: PropType, a: Attr, kind: ValueKind): boolean {
  if (type.kind === 'literal') return literalMatches(type.value, a);
  if (type.kind === 'union') {
    return type.of.some((t) => (t.kind === 'literal' ? literalMatches(t.value, a) : accepts(t, kind)));
  }
  return accepts(type, kind);
}

function literalMatches(lit: string | number | boolean, a: Attr): boolean {
  if (a.kind === 'boolean') return lit === true;
  if (a.kind === 'static') return typeof lit === 'string' && lit === a.value;
  if (a.kind === 'dynamic') {
    const v = staticValue(a.expr.ast);
    if (v.kind !== 'value') return true;
    return v.value === lit;
  }
  return true;
}

function checkClientProps(node: Component, info: ComponentInfo | null, loc: Loc): PropIssue[] {
  const issues: PropIssue[] = [];
  const ast = node.clientProps!.ast;
  if (containsFunction(ast)) {
    issues.push({
      code: 'PF4035',
      severity: 'warning',
      message: 'client:props is serialized to JSON for the browser, so functions and class instances will not survive',
      hint: 'Pass plain data, and handle events inside the component\'s <script client> block.',
      loc,
    });
  }
  if (!info?.contract) return issues;
  // a statically known object literal can be checked key by key
  const v = staticValue(ast);
  if (v.kind !== 'object') return issues;
  for (const [key, value] of Object.entries(v.object)) {
    const spec = info.contract.props[key];
    if (!spec) {
      issues.push({
        code: 'PF4036',
        severity: 'warning',
        message: `client:props passes "${key}", which <${node.ident}> does not declare`,
        loc,
      });
      continue;
    }
    const kind = staticType(value);
    if (kind && !accepts(spec.type, kind)) {
      issues.push({
        code: 'PF4032',
        severity: 'warning',
        message: `client:props "${key}" of <${node.ident}> expects ${describeType(spec.type)} but got ${KIND_LABEL[kind as Exclude<ValueKind, 'unknown'>] ?? 'another type'}`,
        loc,
      });
    }
  }
  return issues;
}

/** True when the expression builds or contains a function value. */
function containsFunction(ast: unknown): boolean {
  let hit = false;
  const step = (n: unknown): void => {
    if (hit || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) step(c);
      return;
    }
    const node = n as { type?: string };
    if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' || node.type === 'ClassExpression') {
      hit = true;
      return;
    }
    for (const k of Object.keys(n as Record<string, unknown>)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      step((n as Record<string, unknown>)[k]);
    }
  };
  step(ast);
  return hit;
}

/**
 * Props a file reads off `props`, from both its `<script>` body and its
 * template. This is what makes an undeclared component's surface knowable.
 * `aliases` covers `const p = defineProps()` bindings.
 */
export function collectPropReads(
  root: Root,
  programBody: unknown[],
  aliases: string[] = ['props'],
): { reads: string[]; opaque: boolean } {
  const names = new Set<string>();
  let opaque = false;

  const fromExpr = (ast: unknown): void => {
    for (const alias of aliases) {
      for (const a of propertyAccesses(ast, alias)) names.add(a.name);
      if (hasOpaquePropertyAccess(ast, alias)) opaque = true;
    }
  };

  for (const stmt of programBody) fromExpr(stmt);
  walk(root.children, (n: Node) => {
    if (n.type === 'Expression') {
      fromExpr(n.ast);
      return;
    }
    if (n.type === 'Element') {
      for (const a of n.attrs) if ('expr' in a) fromExpr(a.expr.ast);
      return;
    }
    if (n.type === 'Component') {
      for (const a of n.props) if ('expr' in a) fromExpr(a.expr.ast);
      if (n.clientProps) fromExpr(n.clientProps.ast);
    }
  });

  return { reads: [...names], opaque };
}

/** Declared props the component never reads — dead contract surface. */
export function unusedDeclaredProps(info: ComponentInfo): string[] {
  if (!info.contract || info.opaque) return [];
  return info.contract.order.filter((name) => !info.reads.includes(name));
}
