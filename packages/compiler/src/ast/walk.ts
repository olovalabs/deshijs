// The one traversal primitive for the Deshi AST.
//
// Every pass (scope analysis, prop/attr analysis, head merging, codegen, the
// manifest) walks the tree through `walk()` instead of hand-rolling a recursion.
// Adding a node type therefore requires touching this file only — which is what
// keeps "everything is AST based" true as the grammar grows.
import type { Attr, Node } from '../types';

/** The parent field a child node was reached through. */
export type ChildKey = 'children' | 'slots' | 'fallback' | 'jsx';

export interface VisitInfo {
  parent: Node | null;
  /** field of the parent that holds this node */
  key: ChildKey;
  /** 0-based position within that field */
  index: number;
}

export interface ChildRef {
  node: Node;
  key: ChildKey;
  index: number;
}

/** Every attribute expression of an element/component, in source order. */
export function attrExprs(attrs: Attr[]): Array<{ attr: Attr; expr: Extract<Attr, { expr: unknown }>['expr'] }> {
  const out: Array<{ attr: Attr; expr: Extract<Attr, { expr: unknown }>['expr'] }> = [];
  for (const attr of attrs) {
    if ('expr' in attr) out.push({ attr, expr: attr.expr });
  }
  return out;
}

/** Immediate child nodes of `node`, in document order. */
export function children(node: Node): ChildRef[] {
  const out: ChildRef[] = [];
  const push = (key: ChildKey, list: Node[] | undefined) => {
    if (!list) return;
    list.forEach((n, index) => out.push({ node: n, key, index }));
  };
  switch (node.type) {
    case 'Root':
    case 'Element':
    case 'Fragment':
    case 'HeadBlock':
      push('children', node.children);
      return out;
    case 'Component':
      for (const list of Object.values(node.slots)) {
        if (Array.isArray(list)) list.forEach((n, index) => out.push({ node: n, key: 'slots', index }));
      }
      return out;
    case 'Slot':
      push('fallback', node.fallback);
      return out;
    case 'Expression':
      for (const slot of node.jsx) {
        slot.nodes.forEach((n, index) => out.push({ node: n, key: 'jsx', index }));
      }
      return out;
    case 'Text':
    case 'Comment':
    case 'Doctype':
      return out;
  }
}

/**
 * Depth-first walk. `visit` may return `false` to skip a node's children.
 * Children are read through `children()`, so this never recurses on its own.
 */
export function walk(root: Node | Node[], visit: (node: Node, info: VisitInfo) => unknown): void {
  const roots = Array.isArray(root) ? root : [root];
  const visitOne = (node: Node, parent: Node | null, key: ChildKey, index: number): void => {
    if (visit(node, { parent, key, index }) === false) return;
    for (const ref of children(node)) visitOne(ref.node, node, ref.key, ref.index);
  };
  for (const [i, n] of roots.entries()) visitOne(n, null, 'children', i);
}

/** Visit every node of a node list. Kept for the existing pass signatures. */
export function walkNodes(nodes: Node[], visit: (node: Node, info: VisitInfo) => unknown): void {
  walk(nodes, visit);
}

/** Depth-first search for the first matching node. */
export function findNode(root: Node | Node[], pred: (node: Node) => boolean): Node | undefined {
  let found: Node | undefined;
  walk(root, (n) => {
    if (found) return false;
    if (pred(n)) {
      found = n;
      return false;
    }
    return true;
  });
  return found;
}

/** Every node matching `pred`, in document order. */
export function findNodes(root: Node | Node[], pred: (node: Node) => boolean): Node[] {
  const out: Node[] = [];
  walk(root, (n) => {
    if (pred(n)) out.push(n);
  });
  return out;
}

export function someNode(root: Node | Node[], pred: (node: Node) => boolean): boolean {
  return findNode(root, pred) !== undefined;
}

/** True when any descendant (or `root` itself) matches `pred`. */
export function hasDescendant(root: Node | Node[], pred: (node: Node) => boolean): boolean {
  let hit = false;
  walk(root, (n) => {
    if (hit) return false;
    if (pred(n)) {
      hit = true;
      return false;
    }
    return true;
  });
  return hit;
}

/**
 * Structural clone. Expressions keep their parsed ESTree by reference (the tree
 * is treated as immutable), so a clone is cheap and safe to mutate elsewhere.
 */
export function cloneNodes(nodes: Node[]): Node[] {
  return nodes.map(cloneNode);
}

export function cloneNode(node: Node): Node {
  switch (node.type) {
    case 'Root':
      return { ...node, children: cloneNodes(node.children) };
    case 'Element':
      return { ...node, attrs: node.attrs.map(cloneAttr), children: cloneNodes(node.children) };
    case 'Fragment':
      return { ...node, children: cloneNodes(node.children) };
    case 'HeadBlock':
      return { ...node, children: cloneNodes(node.children) };
    case 'Slot':
      return { ...node, fallback: cloneNodes(node.fallback) };
    case 'Component': {
      const slots: Record<string, Node[]> = {};
      for (const [k, v] of Object.entries(node.slots)) slots[k] = cloneNodes(v);
      return { ...node, props: node.props.map(cloneAttr), slots };
    }
    case 'Expression':
      return {
        ...node,
        jsx: node.jsx.map((j) => ({ start: j.start, end: j.end, nodes: cloneNodes(j.nodes) })),
      };
    default:
      return { ...node };
  }
}

function cloneAttr(a: Attr): Attr {
  return 'expr' in a ? ({ ...a, expr: a.expr } as Attr) : ({ ...a } as Attr);
}
