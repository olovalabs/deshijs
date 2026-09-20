---
title: Deshijs Compiler & Framework Documentation
description: Complete documentation for Deshijs, a Zero-JS static site generator and modern compiler with islands architecture.
---

# Deshijs Compiler & Framework

Deshijs is a high-performance, Zero-JS static site generator and modern compiler for `.deshi` and `.md` templates. It compiles to pure static HTML by default and hydrates interactive islands on-demand using fine-grained client directives.

---

## Why Deshijs?

Modern web frameworks often ship megabytes of JavaScript just to render static documentation, marketing sites, and content blogs. Deshijs flips this paradigm by making client JavaScript **strictly opt-in**:

- **0KB JavaScript by Default**: Pages without interactive islands emit zero client JS. No hydration tax, 100/100 Lighthouse performance.
- **Instant Vite HMR**: Co-located styles and templates update in under 20ms over WebSockets without losing page state or triggering full refreshes.
- **Islands Architecture**: Hydrate only what needs interactivity using `client:load`, `client:visible`, `client:idle`, or `client:click`.
- **First-Class Markdown Support**: Put `.md` files directly in your routes directory. Frontmatter turns into bindings and layouts wrap content seamlessly.

---

## Core Architecture Pillars

1. **Compile-Time Scoped CSS**: Every `<style>` block is parsed with `css-tree` and scoped using a stable 32-bit FNV-1a hash: `[data-deshi-<hash>]`. Zero CSS-in-JS runtime overhead. Unscoped styles can escape via `<style global>` or `:global(...)`.
2. **File-System Routing with Nested Layouts**: App Router-style conventions: `page.deshi`, `page.md`, `layout.deshi`, `not-found.deshi`, `[param]`, `[...catchAll]`, and `(routeGroups)`. Layouts nest down the route hierarchy.
3. **Astro Parity & Directives**: Familiar syntax: `set:html`, `set:text`, `class:list`, `define:vars`, `transition:*` for View Transitions, and global `Astro.*` runtime parity (`Astro.props`, `Astro.params`, `Astro.url`, `Astro.redirect`).
4. **Ultra-lightweight SPA Client Router**: ~1KB client router providing instant transitions via `<main>` DOM morphing, link prefetching on hover, and automatic scoped style synchronization.

---

## Installation

Install the compiler package and Vite:

```bash
# Using Bun (Recommended)
bun add deshijs vite

# Or using pnpm / npm
pnpm add deshijs vite
```

---

## Project Structure

A standard Deshijs application uses a clean, intuitive layout:

```text
my-deshi-app/
├── src/
│   ├── layout.deshi            # Root layout (wraps all pages with <html> and <body>)
│   ├── page.deshi              # Home route ("/")
│   ├── not-found.deshi         # 404 handler
│   ├── about/
│   │   └── page.deshi          # Static route ("/about")
│   ├── docs/
│   │   ├── layout.deshi        # Nested layout for docs
│   │   ├── page.md             # Docs overview ("/docs")
│   │   └── routing.md          # Markdown doc ("/docs/routing")
│   ├── blog/
│   │   └── [slug]/
│   │       └── page.deshi      # Dynamic route (uses getStaticParams())
│   ├── components/
│   │   ├── Header.deshi        # Static component (0JS)
│   │   └── Counter.deshi       # Interactive island (has <script client>)
│   └── public/                 # Static assets copied verbatim
├── deshi.config.ts             # Deshi framework configuration
├── vite.config.ts              # Vite integration plugin
└── package.json
```

---

## Minimal Example

### 1. Configure Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import deshi from 'deshijs/vite';

export default defineConfig({
  plugins: [deshi({ router: true })],
  appType: 'mpa',
});
```

### 2. Create Root Layout

```html
<!-- src/layout.deshi -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Deshi Site</title>
</head>
<body class="bg-black text-white">
  <header>
    <a href="/">Home</a>
    <a href="/docs">Docs</a>
  </header>
  <main>
    <slot />
  </main>
</body>
</html>
```

### 3. Create Home Page

```html
<!-- src/page.deshi -->
<script>
  import Counter from './components/Counter.deshi';
  const siteTitle = "Welcome to Deshijs";
</script>

<div class="hero">
  <h1>{siteTitle}</h1>
  <p>Static by default, dynamic when you need it.</p>
  
  <!-- Interactive Island -->
  <Counter initialCount={5} client:visible />
</div>

<style>
  .hero {
    text-align: center;
    padding: 4rem 1rem;
  }
  h1 {
    font-size: 2.5rem;
    color: #a3e635;
  }
</style>
```

### 4. Create an Interactive Island

```html
<!-- src/components/Counter.deshi -->
<script client>
  let count = props.initialCount || 0;
  const countEl = root.querySelector('[data-count]');
  const btn = root.querySelector('button');

  btn.addEventListener('click', () => {
    count++;
    countEl.textContent = count;
  });
</script>

<div class="counter-box">
  <span>Count: <strong data-count>{props.initialCount || 0}</strong></span>
  <button type="button">+ Increment</button>
</div>

<style>
  .counter-box {
    display: inline-flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    border: 1px solid #27272a;
    border-radius: 8px;
    background: #18181b;
  }
  button {
    background: #a3e635;
    color: #000;
    font-weight: 600;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
  }
</style>
```

---

## Build & Dev Commands

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

Run development server with instant HMR:

```bash
bun run dev
```

Generate static production build in `dist/`:

```bash
bun run build
```

---

## Next Steps

Explore the full documentation topics:

- [Architecture & Pipeline](/docs/architecture) — AST stages, codegen, and HTML emission.
- [Template Syntax](/docs/template-syntax) — Expressions, conditionals, loops, and slot mechanics.
- [Islands Architecture](/docs/islands) — Fine-grained client directives (`client:load`, `client:visible`, etc.).
- [Directives](/docs/directives) — `set:html`, `set:text`, `class:list`, `define:vars`, and View Transitions.
- [File-Based Routing](/docs/routing) — Dynamic routes, catch-all segments, and route groups.
- [Static Params](/docs/static-params) — Generating static paths at build time.
- [Markdown Support](/docs/markdown) — Frontmatter, tables, heading IDs, and layout injection.
- [Diagnostic Catalog](/docs/error-catalog) — Complete list of PF1001–PF6001 compiler diagnostics.
