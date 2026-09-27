// Attribute analysis + code planning.
//
// Attributes are the part of a template that decides both *correctness* and
// *output size*, so they get one module instead of string juggling in codegen:
//
//   • `scanStartTag` reads a start tag straight from the source at offsets the
//     HTML parser already reported, which makes repeat attributes detectable
//     (the HTML spec silently drops them) without any offset bookkeeping.
//   • `planAttributes` folds the special attributes — `class` + `class:list`,
//     `style` + `define:vars`, spreads, the island root markers — into exactly
//     one static string and one dynamic object, so nothing is ever emitted
//     twice (the historical `class` + `class:list` bug) and a fully static
//     element costs zero runtime work.
import type { Attr, Expression } from './types';
import { escapeAttr } from './runtime';
import { scopeAttribute } from './css';

// ─── start-tag scanning ─────────────────────────────────────────────────────

export interface ScannedAttr {
  name: string;
  /** offset of the attribute name */
  nameStart: number;
  /** offset just past the attribute (name + `=` + value) */
  end: number;
  hasValue: boolean;
  /** quote character, or '' when the value was unquoted */
  quote: string;
  /** raw value text, unquoted and unescaped of the surrounding quotes */
  value: string;
  /** offset where the value starts (after `=`) */
  valueStart: number;
  valueEnd: number;
  /**
   * True when the attribute *name* is really a masked `{…}` expression — a
   * spread, whose "name" is the mask filler. Such an entry has no real name and
   * must be ignored by name-based rules. A masked *value* is ordinary (that is
   * what an expression attribute looks like) and leaves this false.
   */
  masked: boolean;
}

export interface ScannedTag {
  name: string;
  nameStart: number;
  end: number;
  selfClosing: boolean;
  attrs: ScannedAttr[];
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;
const TAG_END = /[\s>/]/;
/** A name made only of the prescan's mask filler. */
const MASKED_NAME = /^x{2,}$/;

/**
 * Read the attributes of the start tag occupying `[from, to)` of `src`, where
 * `to` is the offset just past the closing `>`.
 *
 * Feed this the *masked* template (expressions blanked to same-width filler):
 * masking is what makes an unquoted expression value well-formed here, so this
 * scanner never has to reason about braces, quotes or `>` inside a value. Every
 * iteration is guaranteed to consume at least one character.
 */
export function scanStartTag(src: string, from: number, to: number): ScannedTag {
  let i = from;
  if (src[i] === '<') i++;
  const nameStart = i;
  while (i < to && NAME_CHAR.test(src[i])) i++;
  const name = src.slice(nameStart, i);
  const attrs: ScannedAttr[] = [];
  let selfClosing = false;

  const skipSpace = () => {
    while (i < to && /\s/.test(src[i])) i++;
  };
  const skipToBoundary = () => {
    // a malformed run: consume it whole, always making progress
    do {
      i++;
    } while (i < to && !TAG_END.test(src[i]));
  };

  while (i < to) {
    skipSpace();
    if (i >= to) break;
    if (src[i] === '>') break;
    if (src[i] === '/' && src[i + 1] === '>') {
      selfClosing = true;
      i += 2;
      break;
    }
    if (!NAME_START.test(src[i])) {
      skipToBoundary();
      continue;
    }
    const attrNameStart = i;
    while (i < to && NAME_CHAR.test(src[i])) i++;
    const attrName = src.slice(attrNameStart, i);
    let j = i;
    while (j < to && /[ \t]/.test(src[j])) j++;
    if (src[j] !== '=') {
      attrs.push({
        name: attrName, nameStart: attrNameStart, end: i, hasValue: false,
        quote: '', value: '', valueStart: i, valueEnd: i, masked: MASKED_NAME.test(attrName),
      });
      continue;
    }
    j++;
    while (j < to && /\s/.test(src[j])) j++;
    const quote = src[j] === '"' || src[j] === "'" ? src[j] : '';
    let value: string;
    let valueStart: number;
    let valueEnd: number;
    if (quote) {
      valueStart = j + 1;
      const close = src.indexOf(quote, valueStart);
      valueEnd = close === -1 || close > to ? to : close;
      value = src.slice(valueStart, valueEnd);
      i = Math.min(to, valueEnd + 1);
    } else {
      valueStart = j;
      while (j < to && !TAG_END.test(src[j])) j++;
      valueEnd = j;
      value = src.slice(valueStart, valueEnd);
      i = j;
    }
    attrs.push({
      name: attrName, nameStart: attrNameStart, end: i, hasValue: true, quote,
      value, valueStart, valueEnd, masked: MASKED_NAME.test(attrName),
    });
  }

  return { name, nameStart, end: i, selfClosing, attrs };
}

/** Attribute names that occur more than once in one start tag. */
export function duplicateAttrNames(tag: ScannedTag): ScannedAttr[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  const out: ScannedAttr[] = [];
  for (const a of tag.attrs) {
    if (a.masked) continue;
    const key = a.name.toLowerCase();
    if (seen.has(key)) {
      if (dups.has(key)) continue;
      dups.add(key);
      out.push(a);
      continue;
    }
    seen.add(key);
  }
  return out;
}

// ─── planning ───────────────────────────────────────────────────────────────

/** One dynamic run: a single `attrs({…})` call. */
export interface Dynamic {
  code: string;
}

export interface AttrPlan {
  /**
   * The start tag's attribute text, in *source order*. A plain string is
   * literal text baked into the output; a `Dynamic` is one `attrs({…})` call.
   * Consecutive dynamic attributes share a call, so a tag costs at most one
   * runtime call and static attributes cost nothing.
   */
  parts: Array<string | Dynamic>;
  /** scoped-style attribute, emitted last so it trails the tag */
  scopeAttr?: string;
}

export interface PlanOptions {
  /** print an expression as JS (injected to avoid a codegen ↔ attrs cycle) */
  print: (expr: Expression) => string;
  /** scoped-style attribute to append, when the element is scoped */
  scopeAttr?: string;
  /**
   * Island markers for the root element of a component that hydrates. The
   * element receives the island id plus `data-deshi-c` / `data-deshi-props`,
   * all absent when the render has no island (a server-only render).
   */
  island?: { hash: string } | null;
}

interface Entry {
  name: string;
  code: string;
}

/**
 * Fold attributes into ordered literal/dynamic parts.
 *
 * Merging rules that used to be lost to duplicate object keys:
 *   `class="a" class:list={b}` → one `class` entry: `cls(["a", b])`
 *   `style="…" define:vars={v}` → one `style` entry: `sty(["…", {"--k": v}])`
 *   `<Comp {...rest} title="x" />` → explicit attributes win over the spread
 */
export function planAttributes(attrs: Attr[], opts: PlanOptions): AttrPlan {
  const { print } = opts;
  const parts: Array<string | Dynamic> = [];
  let pending = '';
  let scopeAttr: string | undefined;
  /** dynamic entries waiting to be emitted as one `attrs({…})` call */
  let run: Entry[] = [];

  const lit = (s: string): void => {
    if (s) pending += s;
  };
  const flush = (): void => {
    if (pending) {
      parts.push(pending);
      pending = '';
    }
  };
  const addEntry = (name: string, code: string): void => {
    run.push({ name, code });
  };
  /** Close the current dynamic run, so following literals stay in order. */
  const closeRun = (): void => {
    if (!run.length) return;
    flush();
    const body = run.map((e) => (e.name === '...' ? `...${e.code}` : `${JSON.stringify(e.name)}: ${e.code}`));
    parts.push({ code: `attrs({ ${body.join(', ')} })` });
    run = [];
  };

  // Merged `class` / `style` need every part before they can be emitted, so they
  // are collected up front and then placed where their first part appeared.
  // A *lone static* value stays literal — no runtime call, no bytes.
  const classParts: string[] = [];
  const styleParts: string[] = [];
  let classStatics = 0;
  let styleStatics = 0;
  for (const a of attrs) {
    switch (a.kind) {
      case 'static':
        if (a.name === 'class') {
          classParts.push(JSON.stringify(a.value));
          classStatics++;
        } else if (a.name === 'style') {
          styleParts.push(JSON.stringify(a.value.replace(/;\s*$/, '')));
          styleStatics++;
        }
        break;
      case 'classList':
        classParts.push(print(a.expr));
        break;
      case 'dynamic':
        if (a.name === 'class') classParts.push(print(a.expr));
        else if (a.name === 'style') styleParts.push(styOf(print(a.expr)));
        break;
      case 'defineVars':
        // `{ brand: '#f0f' }` → `{ "--brand": "#f0f" }` so `sty()` can merge it
        styleParts.push(`Object.fromEntries(Object.entries(${print(a.expr)}).map(([k,v])=>["--"+k,v]))`);
        break;
    }
  }
  const classCode = classParts.length === 1 ? `cls(${classParts[0]})` : `cls([${classParts.join(', ')}])`;
  const styleCode = styleParts.length === 1 ? `sty(${styleParts[0]})` : `sty([${styleParts.join(', ')}])`;
  const classMerged = classParts.length > 0 && !(classStatics === 1 && classParts.length === 1);
  const styleMerged = styleParts.length > 0 && !(styleStatics === 1 && styleParts.length === 1);
  // a spread makes every later attribute share its object, so explicit
  // attributes keep winning over the spread
  const hasSpread = attrs.some((a) => a.kind === 'spread');
  let classDone = !classMerged;
  let styleDone = !styleMerged;
  const emitClass = (): void => {
    if (classDone) return;
    classDone = true;
    addEntry('class', classCode);
  };
  const emitStyle = (): void => {
    if (styleDone) return;
    styleDone = true;
    addEntry('style', styleCode);
  };

  for (const a of attrs) {
    switch (a.kind) {
      case 'static':
        if (a.name === 'class') {
          if (classMerged) emitClass();
          else if (!hasSpread) {
            closeRun();
            lit(` class="${escapeAttr(a.value)}"`);
          } else {
            addEntry('class', JSON.stringify(a.value));
          }
          continue;
        }
        if (a.name === 'style') {
          if (styleMerged) emitStyle();
          else if (!hasSpread) {
            closeRun();
            lit(` style="${escapeAttr(a.value)}"`);
          } else {
            addEntry('style', JSON.stringify(a.value.replace(/;\s*$/, '')));
          }
          continue;
        }
        if (!hasSpread) closeRun();
        if (hasSpread) addEntry(a.name, JSON.stringify(a.value));
        else lit(` ${a.name}="${escapeAttr(a.value)}"`);
        continue;
      case 'boolean':
        if (!hasSpread) closeRun();
        if (hasSpread) addEntry(a.name, 'true');
        else lit(` ${a.name}`);
        continue;
      case 'classList':
        emitClass();
        continue;
      case 'defineVars':
        emitStyle();
        continue;
      case 'dynamic':
        if (a.name === 'class') {
          emitClass();
          continue;
        }
        if (a.name === 'style') {
          emitStyle();
          continue;
        }
        addEntry(a.name, print(a.expr));
        continue;
      case 'transition':
        if (typeof a.value === 'string') {
          if (!hasSpread) closeRun();
          if (hasSpread) addEntry(a.name, a.value === '' ? 'true' : JSON.stringify(a.value));
          else if (a.value === '') lit(` ${a.name}`);
          else lit(` ${a.name}="${escapeAttr(a.value)}"`);
        } else {
          addEntry(a.name, print(a.value));
        }
        continue;
      case 'setHtml':
      case 'setText':
        continue;
      case 'spread':
        addEntry('...', print(a.expr));
        continue;
    }
  }
  emitClass();
  emitStyle();

  if (opts.island) {
    const { hash } = opts.island;
    // Never clobber a user id: fall back to `data-deshi-i`, which the boot
    // script looks up as well. Markers and attributes stay in one attrs() call.
    const hasId = attrs.some((a) => 'name' in a && (a as { name: string }).name === 'id');
    const marker = hasId ? 'data-deshi-i' : 'id';
    addEntry(
      '...',
      `$island ? { ${JSON.stringify(marker)}: $island.id, "data-deshi-c": ${JSON.stringify(hash)}, "data-deshi-props": $cp } : {}`,
    );
  }
  if (opts.scopeAttr) scopeAttr = opts.scopeAttr;
  closeRun();
  flush();
  return { parts, scopeAttr };
}

function styOf(code: string): string {
  return `sty(${code})`;
}

/**
 * The props object for a component usage: `{ "title": …, "class": cls([…]) }`.
 *
 * Same merging as `planAttributes`, but the result is an *object* rather than
 * rendered attribute text, so everything lands in one literal (an object cannot
 * interleave literal and dynamic runs). A component prop must not lose its
 * `class` to a duplicate key either.
 */
export function planPropsObject(attrs: Attr[], opts: { print: (expr: Expression) => string }): string {
  const { print } = opts;
  const entries: string[] = [];
  const classParts: string[] = [];
  const styleParts: string[] = [];
  let classStatics = 0;
  let styleStatics = 0;

  for (const a of attrs) {
    switch (a.kind) {
      case 'static':
        if (a.name === 'class') {
          classParts.push(JSON.stringify(a.value));
          classStatics++;
        } else if (a.name === 'style') {
          styleParts.push(JSON.stringify(a.value.replace(/;\s*$/, '')));
          styleStatics++;
        } else {
          entries.push(`${JSON.stringify(a.name)}: ${JSON.stringify(a.value)}`);
        }
        break;
      case 'boolean':
        entries.push(`${JSON.stringify(a.name)}: true`);
        break;
      case 'classList':
        classParts.push(print(a.expr));
        break;
      case 'defineVars':
        styleParts.push(`Object.fromEntries(Object.entries(${print(a.expr)}).map(([k,v])=>["--"+k,v]))`);
        break;
      case 'dynamic':
        if (a.name === 'class') classParts.push(print(a.expr));
        else if (a.name === 'style') styleParts.push(styOf(print(a.expr)));
        else entries.push(`${JSON.stringify(a.name)}: ${print(a.expr)}`);
        break;
      case 'transition':
        entries.push(
          typeof a.value === 'string'
            ? `${JSON.stringify(a.name)}: ${a.value === '' ? 'true' : JSON.stringify(a.value)}`
            : `${JSON.stringify(a.name)}: ${print(a.value)}`,
        );
        break;
      case 'spread':
        entries.push(`...${print(a.expr)}`);
        break;
      case 'setHtml':
      case 'setText':
        break;
    }
  }
  if (classParts.length && !(classStatics === 1 && classParts.length === 1)) {
    entries.push(`"class": ${classParts.length === 1 ? `cls(${classParts[0]})` : `cls([${classParts.join(', ')}])`}`);
  }
  if (styleParts.length && !(styleStatics === 1 && styleParts.length === 1)) {
    entries.push(`"style": ${styleParts.length === 1 ? `sty(${styleParts[0]})` : `sty([${styleParts.join(', ')}])`}`);
  }
  return `{ ${entries.join(', ')} }`;
}
