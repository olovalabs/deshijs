---
title: "Template Syntax & AST"
description: "Complete guide to .deshi file syntax, JSX expressions, slots, attribute bindings, and AST nodes."
---

# Template Syntax & AST

A `.deshi` file is an HTML-superset template combining server-side JavaScript/TypeScript with compile-time scoped styles and JSX-compatible expressions.

## File Anatomy (.deshi)

A `.deshi` file is organized into four optional top-level sections:

```html
<!-- 1. SERVER SCRIPT (Runs at build time / dev SSR) -->
<script>
  import Header from './Header.deshi';
  const greeting = 'Welcome to Deshi';
</script>

<!-- 2. DOCUMENT HEAD CONTRIBUTION -->
<head>
  <title>{greeting}</title>
  <meta name="description" content="Built with 0JS Deshijs" />
</head>

<!-- 3. TEMPLATE MARKUP -->
<main>
  <Header title={greeting} />
  <p>Pure static HTML speed.</p>
</main>

<!-- 4. SCOPED STYLES -->
<style>
  main { max-width: 800px; margin: 0 auto; }
</style>
```

---

## Expressions & JSX

Anything enclosed in curly braces `{ ... }` is evaluated as JavaScript at build time. Standard expressions, operators, and method calls work as expected:

```html
<!-- Variable Interpolation -->
<h1>Hello {user.name}!</h1>

<!-- Ternary Conditionals -->
<p>Status: {isOnline ? 'Active' : 'Offline'}</p>

<!-- Full JSX inside Array Maps -->
<ul>
  {features.map((feat) => (
    <li class="item">
      <strong>{feat.title}:</strong> {feat.desc}
    </li>
  ))}
</ul>
```

---

## Attribute Bindings & Spread

Deshijs supports static strings, dynamic expressions, boolean flags, and spread attributes:

- **Dynamic Attributes**: `<a href={post.url} title={post.title}>Read</a>`
- **Boolean Attributes**: `<button disabled={isSubmitting}>Submit</button>` (omits attribute when false)
- **Object Spread**: `<input {...inputProps} />` (spreads all enumerable keys)
- **Style Objects**: `<div style={{ color: 'red', marginTop: '16px' }}></div>` (converts camelCase keys to kebab-case)

---

## The Slots System

Components can accept children through default and named slots:

### Component Definition (`Card.deshi`)
```html
<div class="card">
  <header>
    <slot name="header">
      <h3>Default Header</h3>
    </slot>
  </header>
  <div class="body">
    <slot />
  </div>
</div>
```

### Component Usage Site
```html
<Card>
  <span slot="header">Custom Card Header</span>
  <p>Main body content passed to default slot.</p>
</Card>
```

---

## Head Lifting

Any `<head>` block placed inside a page or component is lifted into the document's top-level `<head>` automatically during build. Allowed head elements include `<title>`, `<meta>`, `<link>`, and `<script>`.

---

## Fragments

When returning multiple sibling root elements without an extra wrapping DOM container, use `<Fragment>`:

```html
<Fragment>
  <dt>Term</dt>
  <dd>Definition description</dd>
</Fragment>
```

---

## AST Node Reference (types.ts)

In `packages/compiler/src/types.ts`, templates parse into a typed AST:

```ts
export type Node =
  | Root
  | Doctype
  | Element
  | Component
  | Text
  | Expression
  | Slot
  | Fragment
  | HeadBlock
  | Comment;

export interface Element {
  type: 'Element';
  name: string;
  attrs: Attr[];
  children: Node[];
  scoped: boolean;
  clientRoot: boolean;
  isDocHead?: boolean;
}

export interface Component {
  type: 'Component';
  ident: string;
  props: Attr[];
  slots: Record<string, Node[]>;
  clientStrategy?: 'load' | 'visible' | 'idle' | 'click' | 'media' | 'only';
  clientMedia?: string;
  clientOnly?: string;
}
```
