---
title: "Scoped Styling & CSS"
description: "In-depth guide to Deshijs compile-time scoped CSS, FNV-1a hashing, define:vars, Tailwind CSS v4, and instant HMR."
---

# Scoped Styling & CSS

Deshijs features zero-runtime, compile-time scoped CSS. Every `<style>` block is scoped strictly to its component using deterministic 32-bit FNV-1a hashing with full support for CSS variables, preprocessors, and instant HMR.

## How CSS Scoping Works (css.ts)

In `packages/compiler/src/css.ts`, the stylesheet is parsed into an AST via `css-tree`. An 8-character FNV-1a hash is generated from the component's file path. The attribute `[data-deshi-<hash>]` is attached to every compound selector:

```css
/* Input CSS inside <style> */
button.btn { background: blue; }
.card:hover { transform: translateY(-2px); }
.badge::after { content: ''; }

/* Output Scoped CSS (Zero Runtime overhead) */
button.btn[data-deshi-35c21378] { background: blue; }
.card[data-deshi-35c21378]:hover { transform: translateY(-2px); }
.badge[data-deshi-35c21378]::after { content: ''; }
```

> **Smart Pseudo-Positioning**: The compiler automatically inserts the scoping attribute *before* pseudo-classes and pseudo-elements (e.g. `.btn[data-deshi-x]:hover` instead of `.btn:hover[data-deshi-x]`).

---

## Escaping Scoping (:global & global)

When you need styles to bleed into child components, markdown articles, or document roots:

### 1. The :global(...) Selector
```css
:global(body) { margin: 0; background: #000; }
.article :global(h2) { font-size: 1.5rem; }
```

### 2. `<style global>` or `<style is:global>`
```html
<style global>
  /* Entire stylesheet is emitted globally into the document */
  * { box-sizing: border-box; }
</style>
```

### 3. `<style is:inline>`
```html
<style is:inline>
  /* Astro parity: injected raw without minification or scoping */
</style>
```

---

## Dynamic CSS with define:vars

You can bind component props or script variables directly into CSS custom properties:

```html
<script>
  const accent = props.accent || '#3b82f6';
</script>

<div class="badge">Accent Badge</div>

<style define:vars={{ accent }}>
  .badge {
    color: var(--accent);
    border: 1px solid var(--accent);
  }
</style>
```

---

## Inline style Objects

In addition to standard CSS strings, the `style` attribute accepts JavaScript objects with automatic kebab-case key conversion:

```html
<div style={{
  backgroundColor: '#18181b',
  borderTopWidth: '2px',
  '--custom-var': 42
}}></div>
```

---

## Preprocessors & Tailwind CSS v4

Deshijs integrates with Vite's CSS transformation pipeline:
- `<style lang="scss">` / `<style lang="less">`: Routed directly to Vite's preprocessor plugins.
- **Tailwind CSS v4**: Works via Vite's `@tailwindcss/vite` plugin or standalone Tailwind CLI auto-compilation.

---

## CSS Extraction Modes

Configured via `css` option in `deshi.config.ts`:
- `css: 'inline'` (Default): Critical CSS is injected directly into each page's `<head>` in a `<style>` block. Zero extra HTTP requests on first load.
- `css: 'extract'`: Emits content-hashed `/_deshi/<hash>.css` stylesheets linked via `<link rel="stylesheet">`. Ideal for long-term browser cacheability.

---

## Sub-50ms CSS HMR (vite.ts)

In `packages/compiler/src/vite.ts`, the compiler compares the previous compilation with the incoming edit. If only CSS changed, it bypasses DOM re-rendering and sends a targeted `css-update` WebSocket payload:

```js
server.ws.send({ type: 'update', updates: [{ type: 'css-update', path: cssUrl }] });
```

Styles reload instantaneously in your browser without restarting video players, losing form state, or triggering full page reloads.
