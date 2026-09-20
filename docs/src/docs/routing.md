---
title: "File-Based Routing"
description: "Complete guide to Deshijs file-based routing, dynamic segments, catch-all routes, route groups, and nested layouts."
---

# File-Based Routing

Deshijs uses an intuitive, directory-driven routing engine. Every file in your `src/` directory maps directly to a URL route with support for dynamic parameters, nested layouts, and route groups.

## Route Segment Types

Routes are defined by file and folder naming in `src/`:

| File Pattern | Resolved URL | Segment Kind |
| --- | --- | --- |
| `src/page.deshi` | `/` | Index Route |
| `src/about/page.deshi` (or `src/about.md`) | `/about` | Static Segment |
| `src/blog/[slug]/page.deshi` | `/blog/:slug` | Dynamic Segment |
| `src/docs/[...slug]/page.deshi` | `/docs/*` | Catch-All Segment |
| `src/shop/[[...slug]]/page.deshi` | `/shop` or `/shop/*` | Optional Catch-All |
| `src/(marketing)/pricing/page.deshi` | `/pricing` | Route Group (Omitted) |

---

## Dynamic & Catch-All Routes

Enclose a folder name in brackets to capture dynamic URL parameters:

### `[slug]` (Single Segment)
- File: `src/posts/[id]/page.deshi`
- Matches: `/posts/1` or `/posts/hello`
- Captured as: `params.id = "hello"`

### `[...slug]` (Catch-All)
- File: `src/docs/[...slug]/page.deshi`
- Matches: `/docs/a`, `/docs/a/b`, and `/docs/a/b/c`
- Captured as: `params.slug = "a/b/c"`

### `[[...slug]]` (Optional Catch-All)
- File: `src/shop/[[...slug]]/page.deshi`
- Matches: `/shop` (empty slug) and `/shop/shoes/nike`

---

## Route Groups `(group)`

Folder names enclosed in parentheses `(marketing)` or `(dashboard)` are for organizational purposes. They do not appear in the generated URL pathname:

- `src/(marketing)/features/page.deshi` &rarr; `/features`
- `src/(marketing)/pricing/page.deshi` &rarr; `/pricing`
- `src/(dashboard)/settings/page.deshi` &rarr; `/settings`

---

## Private Folders

Folders starting with an underscore `_utils/` or named `components/`, `lib/`, or `data/` are automatically excluded from route generation:

- `src/_helpers/math.ts` (ignored by router)
- `src/components/Header.deshi` (ignored by router)
- `src/lib/api.ts` (ignored by router)

---

## Nested Layouts

Layouts wrap all pages in their folder and any nested subfolders. The root layout `src/layout.deshi` is required:

```
src/
├── layout.deshi               # Root layout (renders <html>, <head>, <body>)
├── page.deshi                 # Wrapped by root layout
└── docs/
    ├── layout.deshi           # Docs sub-layout (renders sidebar + <slot />)
    ├── page.md                # Wrapped by: root layout -> docs layout
    └── routing.md             # Wrapped by: root layout -> docs layout
```

---

## Custom 404 Pages

Place a `not-found.deshi` or `not-found.md` file at the root of `src/`. During static build, this file automatically compiles to `dist/404.html`, compatible with Cloudflare Pages, Vercel, Netlify, and GitHub Pages.

---

## Route Priority Algorithm

In `packages/compiler/src/routes.ts`, routes are sorted deterministically so specific routes take precedence over dynamic routes:

1. **Static Segments (Priority 0)** &mdash; e.g. `/blog/trending`
2. **Dynamic Segments (Priority 1)** &mdash; e.g. `/blog/[slug]`
3. **Catch-All Segments (Priority 2)** &mdash; e.g. `/blog/[...all]`
4. **Optional Catch-All (Priority 3)** &mdash; e.g. `/blog/[[...opt]]`
