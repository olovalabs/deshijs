---
title: "Runtime API & Globals"
description: "Reference guide for Deshijs runtime globals, implicit scope bindings, Astro parity, and helper functions."
---

# Runtime API & Globals

Deshijs provides a lightweight server runtime that executes during static site generation and dev SSR. It exposes implicit bindings, complete Astro globals, and runtime string serialization utilities.

## Implicit Template Bindings

Every `.deshi` template has direct access to these variables without importing:

- `props`: Input properties passed to this component by its caller (e.g. `props.title`).
- `params`: Current route parameter values (e.g. `params.slug` for `[slug]/page.deshi`).
- `url`: WHATWG standard `URL` instance representing the current page route.
- `route`: Metadata object containing `{ pattern, file }` for the current matching route.
- `env`: Key-value map of build-time environment variables.

---

## Full Astro.* Global Parity

For developers migrating from or familiar with Astro, the `Astro` object is provided:

```ts
const { title } = Astro.props;
const { slug }  = Astro.params;
const pathname  = Astro.url.pathname;

if (Astro.slots.has('header')) {
  // Check for slot presence
}

if (!user) {
  return Astro.redirect('/login');
}
```

---

## Whitelisted Globals (scope.ts)

In `packages/compiler/src/scope.ts`, only trusted globals are permissible inside template expressions to prevent runtime bugs:

```
JSON, Math, Date, Intl, Object, Array, String, Number, Boolean, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, console, fetch, Response, Request, Headers, setTimeout, clearTimeout
```

---

## Core Runtime Functions (runtime.ts)

### `esc(value: unknown): Promise<string>`
Awaits promises, joins arrays, and escapes special HTML characters (`&`, `<`, `>`). Throws `PF4011` if a function value is directly interpolated.

### `unsafe(value: unknown): Promise<string>`
Used by `set:html` to emit raw, unescaped HTML content.

### `cls(value: unknown): string`
Resolves array and object class maps into clean class strings.

### `sty(value: unknown): string`
Converts camelCase style objects into semicolon-delimited kebab-case CSS strings.
