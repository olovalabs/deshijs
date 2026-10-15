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
<Counter start={0} client:visible />

<style>
  /* scoped to this file automatically */
  h1 { color: tomato; }
</style>
```

- `<script>` — build-time code (imports, data, `getStaticParams()`).
- `<script client>` — the browser island body; only emitted if an island hydrates.
- `<style>` scoped by default; `<style global>` and `<style is:inline>` escape scoping.
- Hydration directives: `client:load`, `client:visible`, `client:idle`,
  `client:media="(max-width: 600px)"`, `client:only`.
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

<Counter start={0} client:visible />

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
result.meta;         // slots, deps, hasCss, hasClient, bindings, propReads, contract
```

## Component props

A component can declare its props, and the compiler then checks every usage in
the project against that declaration — names, types, literal unions and slots:

```deshi
<script>
  interface CardProps {
    title: string
    count?: number
    tone?: 'note' | 'tip'
  }
  const props = defineProps<CardProps>();
</script>

<h2>{props.title}</h2>
<slot />
<slot name="footer" />
```

```deshi
<Card title="Hello" tone="tip">body</Card>
<!-- <Card tite="Hello" />      → PF4030 unknown prop, with a suggestion
     <Card count={1} />         → PF4031 missing required prop
     <Card title="x" count="2"/→ PF4032 string where number was declared
     <Card><span slot="aside"/> → PF4033 unknown slot -->
```

`defineProps` is a compile-time macro: it never runs, and `props` is the implicit
binding every `<script>` body already has. A plain-JavaScript form works too —
`defineProps({ title: String, count: Number })`. Checks only fire when a value's
type is provable, a spread suppresses the completeness checks, and a component
that declares nothing is never reported for unknown props.

## Component slots

### Declared slots — `defineSlots<T>()`

Declare a component's slot interface once; the compiler checks every usage
against it (unknown named slot → PF4033, missing required slot → PF4040), even
when the component renders its slots through a dynamic `name={…}`:

```deshi
<script>
  defineSlots<{ footer?: { required?: boolean }, row: { required: true } }>();
</script>
<slot name="row" /> <slot name="footer" />
```

A plain `defineSlots({ footer: { required: true } })` works too. A declared
slot that never renders is a PF4042 warning; declaring `defineSlots` twice is
PF4043.

### Scoped slots — props forwarded into slot content

A `<slot>` can pass bindings back to the caller; the callers binds them with
`let-*` on a slot wrapper (or, for the default slot, on the component usage
itself). The wrapper itself disappears from the output:

```deshi
<Card items={rows}>
  <template slot="row" let-item let-index>{index}: {item.title}</template>
</Card>

<Card let-t>{t.name}</Card>            <!-- default scoped slot -->
```

```deshi
<!-- Card.deshi -->
<slot name="row" {item} {index} />     <!-- forwards bindings, bare identifiers -->
```

Only the wrapper's own `let-*` names are in scope inside that content — no
implicit leakage. A `let-*` the component never forwards is a PF4045 warning;
a passthrough that is not a bare identifier is PF4044.

### Control flow — plain JSX

There are no looping or conditional directives. Lists, conditionals and chains
are written exactly like JSX, as expressions — `{rows.map((row, i) => …)}`,
`{cond && …}` and ternaries:

```deshi
<ul>
  {rows.map((row, i) => <li key={i}>{i}: {row.title}</li>)}
</ul>
{showFlag ? <Flag on /> : null}
{
  n > 10 ? <p>lots</p>
  : n > 0 ? <span>some</span>
  : <span>none</span>
}
```

Branch bodies may contain components, islands and nested expressions — all of
it renders at build time with no extra client JS.

### Dynamic component tags

A capitalized tag is a component when it resolves in scope — not only when it
was imported. That covers member tags, aliasing, and registries:

```deshi
<script>
  import * as UI from './ui.ts';
  import Card from './Card.deshi';
  const Tag = Card;
  const renderBanner = UI.Banner; // whatever the namespace holds (PF4041 if missing)
</script>

<UI.Card title="hi" />   <!-- member-expression tag -->
<Tag title="ho" />       <!-- script-bound tag -->
```

Contracts are unknown for such tags at compile time, so prop checks are
skipped for them.

## Architecture

Everything is AST-based, from source text to output:

| Stage | Module | What it does |
| --- | --- | --- |
| Block split | `blocks.ts` | lifts `<script>` / `<style>` / `---` fences with parse5's tokenizer |
| Prescan | `template.ts` | records every `{ … }` expression by offset and masks it, so parse5's source locations *are* original offsets — no offset map, no placeholder tokens |
| Parse | `template.ts` | parse5 builds the tree; nodes and expressions are joined by AST offsets |
| Scope | `scope.ts`, `ast/estree.ts` | identifier resolution over a real scope chain |
| Props | `props.ts`, `tsprops.ts` | contract extraction and per-usage checking |
| Attributes | `attrs.ts` | attribute analysis and the start-tag code plan |
| Codegen | `codegen.ts`, `ast/print.ts` | expressions printed from the AST; attributes planned, not concatenated |
| Islands | `runtime.ts`, `islands.ts`, `serialize.ts` | `<deshi-island>` wrapper + Astro-parity prescripts, directives, props encoding and hydrate lifecycle |

`ast/walk.ts` is the single traversal primitive; `ast/estree.ts` is the single
ESTree toolkit. Adding a node type touches one file.


## Output

`vite build` writes static HTML into `outDir` (default `dist/`), plus:

- `.deshi/manifest.json` — the route/page/CSS/island manifest.
- `sitemap.xml` and `robots.txt` when `site` is configured.
- `_deshi/` — per-island JS chunks and (with `router: true`) the client router.

### Build output optimization

Every production build is passed through a compile-time optimizer (`optimizeHtml`,
`optimizeCss`, `optimizeJs`, all exported from `deshijs`):

- **HTML** — comments are stripped (hydration markers, conditional comments and
  SSI are kept), redundant attributes (`type="text/javascript"` on `<script>`,
  `type="text/css"` on `<style>`/`<link>`) and empty `class`/`style` attributes
  are removed, `class` whitespace is collapsed, and `style="…"` declarations are
  minified.
- **CSS** — compiler-generated `<style>` blocks (scoped and global) are minified
  with [Lightning CSS](https://lightningcss.dev) when it is installed, which
  shortens values (`#ffffff` → `#fff`, `0.5` → `.5`) and drops dead rules. The
  dependency is optional; the compiler falls back to a css-tree minifier
  automatically. Author inline `<style>` stays byte-for-byte intact.
- **JS** — island chunks are bundled and minified with esbuild; inline scripts
  keep their original bytes unless you opt in.

Author `<script is:inline>` / inline `<style>` text is never rewritten, matching
Astro's `is:inline` contract.

Set `build.dropConsole: true` (or pass `dropConsole` to the plugin) to also strip
`console.*` calls and `debugger` statements from island chunks and inline scripts.

## Publishing

```bash
cd packages/compiler
bun run build     # also runs automatically via prepublishOnly
bun publish
```

The package ships `dist/` (bundled ESM + `.d.ts`), `client-directives.d.ts`,
and this README. It is ESM-only and requires Node >= 18.
