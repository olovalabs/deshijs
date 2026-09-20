# deshijs

Compiler and [Vite](https://vite.dev) plugin for `.deshi` — a Zero-JS static
site generator. Compiles routes to plain static HTML; islands opt into client
JS with `client:*` directives.

- **Zero-JS by default** — pages without islands ship no client JavaScript.
- **Native Vite integration** — `.deshi` files are transformed by the plugin, so
  HMR, `src/public/` assets, and CSS all flow through Vite.
- **Scoped CSS** with no runtime — `<style>` blocks are scoped at compile time.
- **Markdown & MDX support** (`.md`, `.mdx`) — first-class routing with frontmatter bindings, GFM, Shiki build-time syntax highlighting, and native `.deshi` component & island embedding.

## Install

```bash
bun add deshijs vite
# or
npm install deshijs vite
```

`vite` is an optional peer dependency — it's only needed if you use the plugin.

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import deshi from 'deshijs/vite';

export default defineConfig({
  plugins: [deshi({ router: true })],
  appType: 'mpa',
});
```

```ts
// deshi.config.ts
import { defineConfig } from 'deshijs/config';

export default defineConfig({
  site: 'https://example.com',
  base: '/',
  output: 'static',
  trailingSlash: 'ignore',
  appDir: 'src',
  outDir: 'dist',
  router: true,
  css: 'inline',
  experimental: {
    viewTransitions: false,
    contentCollections: true,
  },
});
```

Then:

```bash
bunx vite dev      # dev server with on-the-fly compilation + HMR
bunx vite build    # emits static HTML into dist/
bunx vite preview  # serves the built dist/
```

### Plugin options

`deshi(options)` accepts `appDir`, `site`, `base`, `outDir`, `trailingSlash`,
`minify`, `router`, `css`, and `experimental`. Inline options are merged on top
of `deshi.config.*` and the built-in defaults.

## Entry points

| Import | Exports |
| --- | --- |
| `deshi` | `compile()`, `astToJson()`, `DeshiError`, `ERROR_CATALOG`, AST + diagnostic types |
| `deshi/vite` | the Vite plugin — `deshi()` (also `deshiPlugin` and a default export) |
| `deshi/config` | `defineConfig()`, `loadConfig()`, `mergeConfig()`, `defaultConfig` |
| `deshi/runtime` | render-time helpers used by compiled modules |
| `deshi/content` | `defineCollection()`, `getCollection()`, `loadCollections()`, `z` |
| `deshi/client-directives` | types only — ambient JSX types for `client:*` / `transition:*` |

The directive types are types-only. Opt in with a triple-slash reference:

```ts
// env.d.ts
/// <reference types="deshi/client-directives" />
```

## Project layout

```text
src/
├── layout.deshi            # root layout (wraps every route)
├── page.deshi              # "/" route
├── not-found.deshi         # 404
├── about/page.deshi        # /about
├── docs/overview.md        # /docs/overview (Markdown with GFM & Shiki)
├── guide/page.mdx          # /guide (MDX with components & islands)
├── blog/[slug]/page.deshi  # dynamic route (needs getStaticParams())
├── components/Counter.deshi
└── public/                 # copied verbatim to dist/ (favicon, robots.txt, ...)
```

A `.deshi` file is a template plus optional block-level tags:

```deshi
<script>
  // server-only: runs at build time, never ships to the browser
  import Counter from './components/Counter.deshi';
  const title = 'Hello';
</script>

<head>
  <title>{title}</title>
</head>

<h1>{title}</h1>
<Counter client:visible client:props={{ start: 0 }} />

<style>
  /* scoped to this file automatically */
  h1 { color: tomato; }
</style>
```

- `<script>` — build-time code (imports, data, `getStaticParams()`).
- `<script client>` — the browser island body; only emitted if an island hydrates.
- `<style>` scoped by default; `<style global>` and `<style is:inline>` escape scoping.
- Hydration directives: `client:load`, `client:visible`, `client:idle`,
  `client:click`, `client:media="(max-width: 600px)"`, `client:only`.
- Attribute directives: `set:html`, `set:text`, `class:list`, `define:vars`,
  `transition:*`.

## Markdown & MDX Support

Deshijs natively supports `.md` and `.mdx` files alongside `.deshi` routes with zero-config file-system routing.

### Markdown (`.md`)

- **YAML Frontmatter**: Parsed at build time into bindings (`title`, `description`, `frontmatter.*`).
- **GitHub Flavored Markdown (GFM)**: Built-in tables, task lists, and auto-slugged heading IDs.
- **Build-Time Highlighting (Shiki)**: Code fences are highlighted at build time — zero JavaScript shipped to the client.
- **Custom Layouts**: Wrap your content in a layout via frontmatter (`layout: "../layouts/ArticleLayout.deshi"`).

### MDX (`.mdx`)

`.mdx` brings full component interactivity to Markdown documents:

- **Embed `.deshi` Components**: Import and render components directly inside Markdown content.
- **Interactive Client Islands**: Use `client:*` hydration directives (`client:visible`, `client:load`, etc.) inside `.mdx`.
- **Dynamic Expressions**: Embed JS expressions `{frontmatter.title}` directly in markup.
- **Dynamic Routing**: Export `getStaticParams()` from `.mdx` files for data-driven routes.

```mdx
---
title: Getting Started with Deshijs
description: Quickstart guide
layout: ../layouts/GuideLayout.deshi
---

import Counter from '../components/Counter.deshi';
import Callout from '../components/Callout.deshi';

# {frontmatter.title}

Welcome to Deshijs! Interactive islands work seamlessly in MDX:

<Counter client:visible client:props={{ start: 0 }} />

<Callout type="tip">
  This is a static component rendered directly inside MDX.
</Callout>

export async function getStaticParams() {
  return [{ slug: 'intro' }, { slug: 'advanced' }];
}
```

## Programmatic API

```ts
import { compile } from 'deshi';

const result = compile(source, { file: 'src/page.deshi' });
result.code;         // ESM render module
result.css;          // { scoped, global, hash }
result.diagnostics;  // { code, severity, message, file, line, column, frame }
result.meta;         // slots, deps, hasCss, hasClient, bindings, ...
```

## Output

`vite build` writes static HTML into `outDir` (default `dist/`), plus:

- `.deshi/manifest.json` — the route/page/CSS/island manifest.
- `sitemap.xml` and `robots.txt` when `site` is configured.
- `_deshi/` — per-island JS chunks and (with `router: true`) the client router.

## Publishing

```bash
cd packages/compiler
bun run build     # also runs automatically via prepublishOnly
bun publish
```

The package ships `dist/` (bundled ESM + `.d.ts`), `client-directives.d.ts`,
and this README. It is ESM-only and requires Node >= 18.
