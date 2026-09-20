# Deshi

A compiler-based SSG framework for `.deshi` files, inspired by Astro. It ships
pure static HTML with **0 bytes of client JS** by default; islands opt in with
`client:*` directives.

This repository is a monorepo:

```text
├── packages/
│   └── compiler/        # `deshi` — compiler + Vite plugin (publishable to npm)
├── examples/
│   └── playground/      # example site that installs `deshi` and uses it with Vite
├── tsconfig.base.json   # shared TypeScript options
└── package.json         # private Bun workspace root
```

## Requirements

- [Bun](https://bun.sh) >= 1.4 (package manager + script runner)
- Node >= 18 (the published package targets Node)

## Setup

```bash
bun install
bun run build          # builds `deshi` (packages/compiler/dist) then the example site
```

`deshi`'s `exports` point at its built `dist/`, so the compiler must be built
before the example can run. `bun run dev` and `bun run build` do that for you.

## Root scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Build `deshi`, then start the example's Vite dev server |
| `bun run build` | Build `deshi`, then static-build the example site |
| `bun run preview` | Serve the example's built `dist/` |
| `bun run build:compiler` | Bundle `packages/compiler` into `packages/compiler/dist` |
| `bun run test` | Run the compiler test suite |
| `bun run test:watch` | Same, in watch mode |
| `bun run typecheck` | Typecheck every workspace |

Each script delegates to a workspace with `bun run --filter <workspace> <script>`,
so you can also run things from inside a package directory (`cd packages/compiler && bun run build`).

## Using the compiler

See [packages/compiler/README.md](./packages/compiler/README.md). The short version:

```bash
bun add deshi vite
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import deshi from 'deshi/vite';

export default defineConfig({
  plugins: [deshi({ router: true })],
  appType: 'mpa',
});
```

```ts
// deshi.config.ts
import { defineConfig } from 'deshi/config';

export default defineConfig({
  site: 'https://example.com',
  output: 'static',
});
```

## The example site

`examples/playground` is a full demo — file-system routes, dynamic `[slug]`
params via `getStaticParams()`, markdown + MDX pages (with Shiki build-time
highlighting and MDX components), content collections, scoped
CSS, and per-usage island hydration (`client:click`, `client:visible`,
`client:idle`). It depends on `deshi` through the workspace
(`"deshi": "workspace:*"`) exactly like an external consumer would, so it
doubles as an integration test of the published package surface.
