---
title: "Configuration Reference"
description: "Complete reference for deshi.config.ts options, schema, defineConfig helper, and configuration loading."
---

# Configuration Reference

Configure your Deshijs application via `deshi.config.ts` (or `.js`, `.mjs`). Options follow Astro conventions and merge cleanly with inline Vite options.

## defineConfig Helper

Use `defineConfig()` from `deshijs/config` for full TypeScript autocompletion and JSDoc hints:

```ts
import { defineConfig } from 'deshijs/config';

export default defineConfig({
  site: 'https://deshijs.dev',
  base: '/',
  output: 'static',
  trailingSlash: 'ignore',
  appDir: 'src',
  outDir: 'dist',
  router: true,
  css: 'inline',
  minify: true,
  experimental: {
    viewTransitions: true,
    contentCollections: true,
  },
});
```

---

## Core Options

### `site: string` (Optional)
Your production URL, e.g. `'https://example.com'`. Used to generate `sitemap.xml` and `robots.txt` during static builds.

### `base: string` (Default: `'/'`)
Base deployment path. Use `'/docs/'` if hosting under a subpath or on GitHub Pages.

### `output: 'static' | 'hybrid' | 'server'` (Default: `'static'`)
Determines the build target. In `'static'` mode, all routes are pre-rendered into HTML files.

### `trailingSlash: 'never' | 'always' | 'ignore'` (Default: `'ignore'`)
Controls whether emitted URL links and router updates strip or enforce trailing slashes.

---

## Build & CSS Options

### `css: 'inline' | 'extract'` (Default: `'inline'`)
`'inline'` injects critical component CSS directly into `<style>` in HTML. `'extract'` writes separate `/_deshi/<hash>.css` stylesheet files.

### `minify: boolean` (Default: `true`)
Minifies emitted HTML markup and scoped CSS blocks during production builds.

### `build.assetsPrefix: string`
Optional CDN prefix for island JavaScript bundles and extracted CSS assets, e.g. `'https://cdn.example.com/'`.

---

## Router & Prefetch Options

```ts
router: {
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover', // 'hover' | 'viewport' | 'tap'
  }
}
```

Enables the 1KB client router. You can configure hover prefetching or viewport-based prefetching.

---

## Redirects

Configure client or static server redirects:

```ts
redirects: {
  '/v1-docs': '/docs',
  '/legacy': { destination: '/new', status: 301 },
}
```

---

## Experimental Flags

- `experimental.viewTransitions`: Enables browser-native View Transitions API integration for smooth morphing animations.
- `experimental.contentCollections`: Enables schema-validated collections from `src/content/config.ts`.
