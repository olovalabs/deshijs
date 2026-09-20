---
title: "Vite Plugin & Build Pipeline"
description: "Detailed guide to the Deshijs Vite plugin, virtual modules, dev server SSR, and production build orchestration."
---

# Vite Plugin & Build Pipeline

The Deshijs Vite plugin provides on-the-fly SSR compilation during local development, dual HMR for sub-50ms styling updates, and comprehensive static site build generation.

## Plugin Configuration

Import the plugin from `deshijs/vite` into `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import deshi from 'deshijs/vite';

export default defineConfig({
  plugins: [
    deshi({
      router: true,      // Enable 1KB SPA client router
      css: 'inline',      // 'inline' | 'extract'
      minify: true,       // Minify output HTML
      appDir: 'src',       // Application source folder
      outDir: 'dist',      // Build destination
    }),
  ],
  appType: 'mpa',
});
```

---

## Virtual Module System

In `packages/compiler/src/vite.ts`, the plugin registers virtual IDs:

- `virtual:deshi/runtime`: Provides the server runtime helpers (`esc`, `unsafe`, `cls`, `renderComponent`).
- `/_deshi/<hash>.css`: Virtual stylesheet served through Vite's pipeline, allowing PostCSS, autoprefixer, and CSS HMR.
- `/_deshi/c/<Component>.<hash>.js`: Dedicated island chunk containing the component's `<script client>` logic.

---

## Dev Server Architecture

When running `bunx vite dev`, the plugin configures middleware that matches incoming HTTP requests to source files on the fly. It compiles the route, evaluates the render tree in memory, and returns fresh HTML instantly without writing files to disk.

---

## Dual HMR Pipeline

The plugin differentiates between CSS edits and template/script edits:

### CSS Edit Detected
The plugin invalidates the virtual CSS module and emits a targeted `css-update` WebSocket event. Scoped styles refresh in under 20ms without page reloads.

### Markup / Script Edit
The plugin invalidates the compiled memo cache and triggers a fast page re-evaluation, sending a full page reload or router update.

---

## Production Build Output (dist/)

Running `bunx vite build` produces:

```
dist/
├── index.html                 # Pre-rendered home page
├── about/index.html           # Pre-rendered about page
├── blog/
│   ├── post-1/index.html      # Generated via getStaticParams
│   └── post-2/index.html
├── 404.html                   # Custom not-found error page
├── sitemap.xml                # Automatic XML sitemap
├── robots.txt                 # Search engine directives
├── .deshi/manifest.json       # Page, CSS, and island route manifest
└── _deshi/
    ├── router.4f1a9c2e.js     # 1KB client router (if enabled)
    └── c/Counter.d81f02a1.js  # Hydrated island chunk
```
