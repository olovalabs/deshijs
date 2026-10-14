// The one traversal primitive for the Deshi AST.
//
// Every pass (scope analysis, prop/attr analysis, head merging, codegen, the
// manifest) walks the tree through `walk()` instead of hand-rolling a recursion.
// Adding a node type therefore requires touching this file only — which is what
// keeps "everything is AST based" true as the grammar grows.
import type { Attr, Component, Element, Expression, Fragment, HeadBlock, Node, Root, Slot } from '../types';

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
 * Children are read through `children()`. The walk keeps its own stack:
 * a recursive walk overflows the host stack on a few thousand nested elements
 * (Node 22 fails near 2,000).
 */
export function walk(root: Node | Node[], visit: (node: Node, info: VisitInfo) => unknown): void {
  const roots = Array.isArray(root) ? root : [root];
  interface Frame {
    node: Node;
    parent: Node | null;
    key: ChildKey;
    index: number;
    kids: ChildRef[] | null;
    childIndex: number;
  }
  const stack: Frame[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ node: roots[i], parent: null, key: 'children', index: i, kids: null, childIndex: 0 });
  }
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.kids === null) {
      if (visit(frame.node, { parent: frame.parent, key: frame.key, index: frame.index }) === false) {
        stack.pop();
        continue;
      }
      frame.kids = children(frame.node);
    }
    if (frame.childIndex >= frame.kids.length) {
      stack.pop();
      continue;
    }
    const ref = frame.kids[frame.childIndex++];
    stack.push({
      node: ref.node,
      parent: frame.node,
      key: ref.key,
      index: ref.index,
      kids: null,
      childIndex: 0,
    });
  }
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

function shallowClone(node: Node): Node {
  switch (node.type) {
    case 'Root':
      return { ...node, children: [] };
    case 'Element':
      return { ...node, attrs: node.attrs.map(cloneAttr), children: [] };
    case 'Fragment':
      return { ...node, children: [] };
    case 'HeadBlock':
      return { ...node, children: [] };
    case 'Slot':
      return { ...node, fallback: [] };
    case 'Component': {
      const slots: Record<string, Node[]> = Object.create(null);
      for (const k of Object.keys(node.slots)) slots[k] = [];
      return { ...node, props: node.props.map(cloneAttr), slots };
    }
    case 'Expression':
      return {
        ...node,
        jsx: node.jsx.map((j) => ({ start: j.start, end: j.end, nodes: [] })),
      };
    default:
      return { ...node };
  }
}

/** Where each child of `orig` is appended on `copy`. */
function childPlacements(orig: Node, copy: Node): Array<{ node: Node; place: (cloned: Node) => void }> {
  switch (orig.type) {
    case 'Root':
    case 'Element':
    case 'Fragment':
    case 'HeadBlock': {
      const list = (copy as Root | Element | Fragment | HeadBlock).children;
      return orig.children.map((node) => ({ node, place: (cloned) => list.push(cloned) }));
    }
    case 'Slot': {
      const list = (copy as Slot).fallback;
      return orig.fallback.map((node) => ({ node, place: (cloned) => list.push(cloned) }));
    }
    case 'Component': {
      const slots = (copy as Component).slots;
      const out: Array<{ node: Node; place: (cloned: Node) => void }> = [];
      for (const [k, list] of Object.entries(orig.slots)) {
        const dest = slots[k];
        for (const node of list) out.push({ node, place: (cloned) => dest.push(cloned) });
      }
      return out;
    }
    case 'Expression': {
      const jsx = (copy as Expression).jsx;
      const out: Array<{ node: Node; place: (cloned: Node) => void }> = [];
      orig.jsx.forEach((slot, ji) => {
        for (const node of slot.nodes) out.push({ node, place: (cloned) => jsx[ji].nodes.push(cloned) });
      });
      return out;
    }
    default:
      return [];
  }
}

export function cloneNode(node: Node): Node {
  const copy = shallowClone(node);
  interface Frame {
    orig: Node;
    pending: Array<{ node: Node; place: (cloned: Node) => void }>;
    index: number;
  }
  const stack: Frame[] = [{ orig: node, pending: childPlacements(node, copy), index: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.pending.length) {
      stack.pop();
      continue;
    }
    const next = frame.pending[frame.index++];
    const child = shallowClone(next.node);
    next.place(child);
    stack.push({ orig: next.node, pending: childPlacements(next.node, child), index: 0 });
  }
  return copy;
}

function cloneAttr(a: Attr): Attr {
  return 'expr' in a ? ({ ...a, expr: a.expr } as Attr) : ({ ...a } as Attr);
}
