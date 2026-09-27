// Prop contracts — the type-level half of component analysis.
//
// A component can declare its props once, in TypeScript, and the compiler then
// checks every usage in the project against that declaration:
//
//     interface CardProps {
//       title: string
//       count?: number
//       tags?: string[]
//     }
//     const props = defineProps<CardProps>()
//
// The `<script>` body is type-stripped by esbuild before the rest of the
// compiler sees it, so the contract has to be read out of the *original* source.
// That needs a small type reader: enough of the TypeScript grammar to describe
// props, and no more. It parses syntax only — it never infers types from values.

/** The prop types the checks distinguish. `Simple` is expanded so the union
 *  stays a real discriminated union (narrowing on `kind` then just works). */
export type SimpleKind =
  | 'string' | 'number' | 'boolean' | 'bigint' | 'symbol'
  | 'any' | 'unknown' | 'never' | 'void' | 'null' | 'undefined'
  | 'date' | 'function' | 'object' | 'error';

type Simple = { [K in SimpleKind]: { kind: K } }[SimpleKind];

export type PropType =
  | Simple
  | { kind: 'array'; of: PropType }
  | { kind: 'tuple'; of: PropType[] }
  | { kind: 'union'; of: PropType[] }
  | { kind: 'shape'; members: Record<string, PropType> }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'ref'; name: string };

export interface PropSpec {
  name: string;
  type: PropType;
  optional: boolean;
  /** offset of the member in the file, for diagnostics */
  offset: number;
  /** the member carries a default (`count?: number` with `= 0`) */
  hasDefault: boolean;
}

export interface PropContract {
  /** declaration order, which is also the order suggestions are ranked in */
  order: string[];
  props: Record<string, PropSpec>;
  /** name of the interface / type alias the contract came from, if any */
  via: string | null;
  /** offset of the `defineProps` call */
  offset: number;
}

// ─── type syntax ────────────────────────────────────────────────────────────

type TypeNode =
  | { k: 'name'; name: string; pos: number }
  | { k: 'array'; of: TypeNode; pos: number }
  | { k: 'tuple'; of: TypeNode[]; pos: number }
  | { k: 'union'; of: TypeNode[]; pos: number }
  | { k: 'intersection'; pos: number }
  | { k: 'object'; members: TypeMember[]; dict?: TypeNode; pos: number }
  | { k: 'fn'; ret: TypeNode; pos: number }
  | { k: 'literal'; value: string | number | boolean; pos: number }
  | { k: 'paren'; of: TypeNode; pos: number }
  | { k: 'unknown'; pos: number };

interface TypeMember {
  name: string;
  optional: boolean;
  rest: boolean;
  call: boolean;
  type: TypeNode;
  pos: number;
  hasDefault: boolean;
}

const PRIMITIVES: Record<string, SimpleKind> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  bigint: 'bigint',
  symbol: 'symbol',
  any: 'any',
  unknown: 'unknown',
  never: 'never',
  void: 'void',
  null: 'null',
  undefined: 'undefined',
  object: 'object',
  date: 'date',
  error: 'error',
  function: 'function',
  regexp: 'object',
};

/** Cursor over a type annotation. */
class TypeReader {
  pos = 0;
  constructor(readonly src: string, from = 0) {
    this.pos = from;
  }

  ws(): void {
    for (;;) {
      while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
      if (this.src.startsWith('//', this.pos)) {
        const nl = this.src.indexOf('\n', this.pos);
        this.pos = nl === -1 ? this.src.length : nl + 1;
        continue;
      }
      if (this.src.startsWith('/*', this.pos)) {
        const close = this.src.indexOf('*/', this.pos);
        this.pos = close === -1 ? this.src.length : close + 2;
        continue;
      }
      return;
    }
  }

  eof(): boolean {
    this.ws();
    return this.pos >= this.src.length;
  }

  peek(): string {
    this.ws();
    return this.src[this.pos] ?? '';
  }

  eat(ch: string): boolean {
    this.ws();
    if (this.src[this.pos] === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  ident(): string {
    this.ws();
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.src.slice(this.pos));
    if (!m) return '';
    this.pos += m[0].length;
    return m[0];
  }

  /** `<…>` type arguments, bracket aware. */
  typeArgs(): string[] {
    if (this.peek() !== '<') return [];
    this.pos++;
    const out: string[] = [];
    let depth = 0;
    let start = this.pos;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
      else if (c === '>' || c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) {
        out.push(this.src.slice(start, this.pos));
        start = this.pos + 1;
      }
      this.pos++;
    }
    out.push(this.src.slice(start, this.pos));
    if (this.src[this.pos] === '>') this.pos++;
    return out.map((s) => s.trim()).filter(Boolean);
  }

  parse(): TypeNode {
    const start = this.pos;
    const first = this.parseOperand();
    this.ws();
    if (this.src.startsWith('|', this.pos)) {
      const of = [first];
      while (this.eat('|')) of.push(this.parseOperand());
      return { k: 'union', of, pos: start };
    }
    if (this.src.startsWith('&', this.pos)) {
      // intersections are not modelled precisely; treat as "anything goes"
      while (this.eat('&')) this.parseOperand();
      return { k: 'intersection', pos: start };
    }
    return first;
  }

  parseOperand(): TypeNode {
    this.ws();
    const pos = this.pos;
    const c = this.src[this.pos];

    if (c === '(') {
      // `(a: T) => U` or a parenthesised type — decided by what follows the `)`
      const close = this.matchBracket('(', ')');
      if (close !== -1) {
        let j = close + 1;
        while (j < this.src.length && /\s/.test(this.src[j])) j++;
        if (this.src.startsWith('=>', j)) {
          this.pos = j + 2;
          return { k: 'fn', ret: this.parse(), pos };
        }
        this.pos++;
        const of = this.parse();
        this.eat(')');
        return { k: 'paren', of, pos };
      }
    }
    if (c === '{') return this.parseObject();
    if (c === '[') {
      // tuple
      const close = this.matchBracket('[', ']');
      this.pos = close === -1 ? this.src.length : close + 1;
      const body = close === -1 ? '' : this.src.slice(pos + 1, close);
      const of = body
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseTypeText(s, pos));
      return { k: 'tuple', of, pos };
    }
    if (c === '"' || c === "'") {
      const quote = c;
      this.pos++;
      let value = '';
      while (this.pos < this.src.length && this.src[this.pos] !== quote) value += this.src[this.pos++];
      this.pos++;
      return { k: 'literal', value, pos };
    }
    if (/[-0-9]/.test(c)) {
      const m = /^-?\d+(\.\d+)?/.exec(this.src.slice(this.pos));
      this.pos += m ? m[0].length : 1;
      return { k: 'literal', value: m ? Number(m[0]) : 0, pos };
    }

    const name = this.ident();
    if (!name) {
      this.pos++;
      return { k: 'unknown', pos };
    }
    if (name === 'new') return this.parseOperand();
    if (name === 'readonly') {
      this.eat('[');
      return this.parseOperand();
    }
    if (name === 'keyof' || name === 'typeof' || name === 'infer' || name === 'extends') {
      // modifiers we do not model — consume the operand and widen
      if (name === 'typeof') this.parseOperand();
      else this.parse();
      return { k: 'name', name: 'unknown', pos };
    }
    this.ws();
    if (this.src.startsWith('=>', this.pos)) {
      this.pos += 2;
      return { k: 'fn', ret: this.parse(), pos };
    }
    this.ws();
    if (this.src[this.pos] === '[' && this.src[this.pos + 1] === ']') {
      this.pos += 2;
      return { k: 'array', of: { k: 'name', name, pos }, pos };
    }
    if (name === 'Array' || name === 'ReadonlyArray') {
      const args = this.typeArgs();
      if (args.length === 1) return { k: 'array', of: parseTypeText(args[0], pos), pos };
    }
    if (name === 'Record' || name === 'Partial' || name === 'Required' || name === 'Readonly' || name === 'Pick' || name === 'Omit') {
      const args = this.typeArgs();
      if (name === 'Record' && args.length === 2) {
        return { k: 'object', members: [], dict: parseTypeText(args[1], pos), pos };
      }
      if (args.length >= 1) return { k: 'name', name, pos };
    }
    if (name === 'Promise' || name === 'Set' || name === 'Map') {
      const args = this.typeArgs();
      if (name === 'Promise' && args.length === 1) return parseTypeText(args[0], pos);
      if (name === 'Set' && args.length === 1) return { k: 'array', of: parseTypeText(args[0], pos), pos };
      if (args.length) return { k: 'name', name: 'object', pos };
    }
    return { k: 'name', name, pos };
  }

  /** Index of the bracket closing the one at `this.pos`, or -1. */
  matchBracket(open: string, close: string): number {
    let depth = 0;
    for (let i = this.pos; i < this.src.length; i++) {
      const c = this.src[i];
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return i;
      } else if (c === '`') {
        const end = this.src.indexOf('`', i + 1);
        i = end === -1 ? this.src.length : end;
      } else if (c === '"' || c === "'") {
        const end = this.src.indexOf(c, i + 1);
        i = end === -1 ? this.src.length : end;
      }
    }
    return -1;
  }

  parseObject(): TypeNode {
    const pos = this.pos;
    const close = this.matchBracket('{', '}');
    const body = close === -1 ? this.src.slice(pos + 1) : this.src.slice(pos + 1, close);
    this.pos = close === -1 ? this.src.length : close + 1;
    return { k: 'object', members: parseMembers(body, pos), pos };
  }
}

/** Members of an object type literal body (without the braces). */
function parseMembers(body: string, base: number): TypeMember[] {
  const out: TypeMember[] = [];
  const r = new TypeReader(body, 0);
  while (!r.eof()) {
    const memberPos = base + 1 + r.pos;
    r.eat(';');
    r.eat(',');
    if (r.eof()) break;
    r.ws();
    if (r.src[r.pos] === '(') {
      // method signature `(a: T): R` — recorded, but not a named prop
      const close = r.matchBracket('(', ')');
      r.pos = close === -1 ? r.src.length : close + 1;
      r.eat(':');
      r.parse();
      r.eat(';');
      r.eat(',');
      continue;
    }
    let name = '';
    let optional = false;
    let rest = false;
    let call = false;
    let typeStart = r.pos;
    if (r.src[r.pos] === '[') {
      // index signature `[key: string]: T` — recorded, but not a named prop
      const close = r.matchBracket('[', ']');
      r.pos = close === -1 ? r.src.length : close + 1;
      r.eat(':');
      r.parse();
      r.eat(';');
      r.eat(',');
      continue;
    }
    if (r.src.startsWith('...', r.pos)) {
      rest = true;
      r.pos += 3;
    }
    if (r.src[r.pos] === '"' || r.src[r.pos] === "'") {
      const q = r.src[r.pos];
      r.pos++;
      name = '';
      while (r.pos < r.src.length && r.src[r.pos] !== q) name += r.src[r.pos++];
      r.pos++;
    } else if (r.src.startsWith('readonly', r.pos)) {
      r.pos += 7;
    }
    if (!name) name = r.ident();
    if (r.src[r.pos] === '?') {
      optional = true;
      r.pos++;
    }
    if (r.src[r.pos] === '(') {
      const close = r.matchBracket('(', ')');
      r.pos = close === -1 ? r.src.length : close + 1;
      r.eat(':');
      r.parse();
      call = true;
    } else if (r.eat(':')) {
      r.ws();
      typeStart = r.pos;
      r.parse();
    }
    if (!name) {
      r.pos++;
      continue;
    }
    let hasDefault = false;
    r.ws();
    if (r.src[r.pos] === '=') {
      hasDefault = true;
      r.pos++;
      // consume the default expression up to the next separator at depth 0
      let depth = 0;
      while (r.pos < r.src.length) {
        const c = r.src[r.pos];
        if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
        else if (c === ')' || c === ']' || c === '}' || c === '>') {
          if (depth === 0) break;
          depth--;
        } else if ((c === ';' || c === ',' || c === '\n') && depth === 0) break;
        r.pos++;
      }
    }
    out.push({
      name,
      optional,
      rest,
      call,
      type: parseTypeText(body.slice(typeStart, Math.max(typeStart, r.pos))),
      pos: memberPos,
      hasDefault,
    });
  }
  return out;
}

/** Parse a standalone type expression (already sliced out of the source). */
export function parseTypeText(text: string, base = 0, to?: number): TypeNode {
  const src = to === undefined ? text : text.slice(0, to - base);
  const r = new TypeReader(src, 0);
  try {
    return r.parse();
  } catch {
    return { k: 'unknown', pos: base };
  }
}

export type TypeScope = Record<string, TypeMember[]>;

/** Collapse a parsed type into the small model the checks work with. */
export function resolveType(node: TypeNode, scope: TypeScope, depth: number): PropType {
  if (depth > 6) return { kind: 'any' };
  switch (node.k) {
    case 'paren':
      return resolveType(node.of, scope, depth);
    case 'literal':
      return { kind: 'literal', value: node.value };
    case 'array':
      return { kind: 'array', of: resolveType(node.of, scope, depth + 1) };
    case 'tuple':
      return { kind: 'tuple', of: node.of.map((n) => resolveType(n, scope, depth + 1)) };
    case 'union': {
      const of: PropType[] = [];
      for (const n of node.of) {
        const t = resolveType(n, scope, depth + 1);
        // `T | undefined` / `T | null` is the optional form, not a union member
        if (t.kind === 'undefined' || t.kind === 'null') continue;
        of.push(t);
      }
      if (!of.length) return { kind: 'undefined' };
      const flat: PropType[] = [];
      for (const t of of) {
        if (t.kind === 'union') flat.push(...t.of);
        else flat.push(t);
      }
      const unique = new Map(flat.map((t) => [JSON.stringify(t), t]));
      if (unique.size === 1) return [...unique.values()][0];
      return { kind: 'union', of: [...unique.values()] };
    }
    case 'intersection':
      return { kind: 'any' };
    case 'fn':
      return { kind: 'function' };
    case 'object': {
      const members: Record<string, PropType> = {};
      if (node.dict) members['[key]'] = resolveType(node.dict, scope, depth + 1);
      for (const m of node.members) {
        if (m.rest || m.call) continue;
        members[m.name] = resolveType(m.type, scope, depth + 1);
      }
      return { kind: 'shape', members };
    }
    case 'name': {
      const prim = PRIMITIVES[node.name];
      if (prim) return { kind: prim } as PropType;
      const decl = scope[node.name];
      if (decl) return { kind: 'shape', members: membersToTypes(decl, scope, depth + 1) };
      return { kind: 'ref', name: node.name };
    }
    case 'unknown':
      return { kind: 'any' };
  }
}

function membersToTypes(members: TypeMember[], scope: TypeScope, depth: number): Record<string, PropType> {
  const out: Record<string, PropType> = {};
  for (const m of members) {
    if (m.rest || m.call) continue;
    out[m.name] = resolveType(m.type, scope, depth);
  }
  return out;
}

// ─── extraction from a `<script>` body ──────────────────────────────────────

/** `interface Foo { … }` and `type Foo = { … }` declarations in `code`. */
export function collectTypeDeclarations(code: string): TypeScope {
  const scope: TypeScope = {};
  const re = /(?:^|[\s;}])(?:export\s+)?(interface|type)\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*(?:=\s*)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const braceAt = m.index + m[0].length - 1;
    const close = matchBrace(code, braceAt);
    if (close === -1) continue;
    const members = parseMembers(code.slice(braceAt + 1, close), braceAt);
    if (members.length) scope[m[2]] = members;
    re.lastIndex = close;
  }
  return scope;
}

function matchBrace(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    } else if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i);
      i = end === -1 ? src.length : end + 1;
    } else if (c === '`') {
      const end = src.indexOf('`', i + 1);
      i = end === -1 ? src.length : end;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      i = end === -1 ? src.length : end;
    }
  }
  return -1;
}

export interface DefinePropsSite {
  /** offset of the `defineProps` identifier */
  at: number;
  /** the type argument text, when written as `defineProps<T>()` */
  typeText: string | null;
  /** the argument text, when written as `defineProps({ … })` */
  argText: string | null;
  /** local name the result is bound to (`const props = …`) */
  local: string | null;
  /** end offset of the whole call */
  end: number;
}

/** Locate every `defineProps(…)` / `defineProps<T>(…)` call in a script body. */
export function findDefineProps(code: string): DefinePropsSite[] {
  const out: DefinePropsSite[] = [];
  const re = /\bdefineProps\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const at = m.index;
    let i = at + m[0].length;
    let typeText: string | null = null;
    // skip whitespace
    const ws = (): void => {
      while (i < code.length && /\s/.test(code[i])) i++;
    };
    ws();
    if (code[i] === '<') {
      let depth = 0;
      const start = ++i;
      while (i < code.length) {
        const c = code[i];
        if (c === '<') depth++;
        else if (c === '>') {
          if (depth === 0) break;
          depth--;
        }
        i++;
      }
      typeText = code.slice(start, i);
      if (code[i] === '>') i++;
      ws();
    }
    let argText: string | null = null;
    if (code[i] === '(') {
      const close = matchBracketFrom(code, i, '(', ')');
      argText = code.slice(i + 1, close === -1 ? code.length : close);
      i = close === -1 ? code.length : close + 1;
    }
    const local = boundNameBefore(code, at);
    out.push({ at, typeText, argText, local, end: i });
    re.lastIndex = i;
  }
  return out;
}

function boundNameBefore(code: string, at: number): string | null {
  const head = code.slice(0, at);
  const m = /(?:^|[\s;{}])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:await\s*)?$/.exec(head);
  return m ? m[1] : null;
}

function matchBracketFrom(src: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    } else if (c === '`') {
      const end = src.indexOf('`', i + 1);
      i = end === -1 ? src.length : end;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      i = end === -1 ? src.length : end;
    }
  }
  return -1;
}

/** Build a contract from a `defineProps` site. */
export function contractFromSite(code: string, site: DefinePropsSite, scope: TypeScope): PropContract | null {
  const props: Record<string, PropSpec> = {};
  const order: string[] = [];
  let via: string | null = null;

  if (site.typeText) {
    let node = parseTypeText(site.typeText);
    if (node.k === 'name') {
      via = node.name;
      const members = scope[node.name];
      if (!members) return null;
      node = { k: 'object', members, pos: site.at };
    }
    const members: TypeMember[] = node.k === 'object' ? node.members : [];
    for (const m of members) {
      if (m.rest || m.call) continue;
      props[m.name] = {
        name: m.name,
        type: resolveType(m.type, scope, 0),
        optional: m.optional,
        offset: site.at + (m.pos - site.at),
        hasDefault: m.hasDefault,
      };
      order.push(m.name);
    }
  } else if (site.argText && site.argText.trim()) {
    // JS form: defineProps({ title: String, count: Number })
    for (const [name, kind] of objectSchema(site.argText)) {
      props[name] = { name, type: kind, optional: false, offset: site.at, hasDefault: false };
      order.push(name);
    }
  }

  if (!order.length) return null;
  return { order, props, via, offset: site.at };
}

const SCHEMA_CTORS: Record<string, PropType['kind']> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Object: 'object',
  Array: 'array',
  Function: 'function',
  Date: 'date',
  Error: 'error',
};

/** `{ title: String }` → prop names and their kinds. */
function objectSchema(argText: string): Array<[string, PropType]> {
  const out: Array<[string, PropType]> = [];
  // a conservative scan: `name: Ctor` pairs, plus `name: { type: Ctor }`
  const re = /(?:^|[,{\s])(['"]?)([A-Za-z_$][\w$]*)\1\s*:\s*(?:typeof\s+)?([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(argText))) {
    const [, , name, ctor] = m;
    const kind = SCHEMA_CTORS[ctor];
    if (!kind) continue;
    out.push([name, { kind } as PropType]);
  }
  // nested `{ type: String }` shape, e.g. { title: { type: String, required: false } }
  if (!out.length) {
    const nested = /(?:^|[,{\s])(['"]?)([A-Za-z_$][\w$]*)\1\s*:\s*\{([^{}]*)\}/g;
    while ((m = nested.exec(argText))) {
      const tm = /\btype\s*:\s*([A-Za-z_$][\w$]*)/.exec(m[3]);
      if (!tm) continue;
      const kind = SCHEMA_CTORS[tm[1]];
      if (kind) out.push([m[2], { kind } as PropType]);
    }
  }
  return out;
}

/** Human-readable type, for diagnostics. */
export function describeType(t: PropType): string {
  switch (t.kind) {
    case 'array':
      return `${describeType(t.of)}[]`;
    case 'tuple':
      return `[${t.of.map(describeType).join(', ')}]`;
    case 'union':
      return t.of.map(describeType).join(' | ');
    case 'shape': {
      const keys = Object.keys(t.members);
      const only = keys.length === 1 ? t.members[keys[0]] : null;
      if (keys.length === 1 && keys[0] === '[key]') return 'Record<string, ' + describeType(only!) + '>';
      return '{ ' + keys.slice(0, 4).join(', ') + (keys.length > 4 ? ', …' : '') + ' }';
    }
    case 'literal':
      return typeof t.value === 'string' ? JSON.stringify(t.value) : String(t.value);
    case 'ref':
      return t.name;
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    default:
      return t.kind;
  }
}
