---
title: "Static Params & Paths"
description: "Guide to data fetching and static page pre-generation using getStaticParams and getStaticPaths in Deshijs."
---

# Static Params & Paths

In a static site generator, all dynamic routes (e.g. `blog/[slug]/page.deshi`) must be pre-rendered to HTML at build time. The `getStaticParams()` function tells the compiler exactly which pages to emit.

## getStaticParams Signature

Export an asynchronous function named `getStaticParams` from the top-level `<script>` block:

```ts
export async function getStaticParams(): Promise<Array<Record<string, string | number>>> {
  return [
    { slug: 'first-post' },
    { slug: 'second-post' },
  ];
}
```

---

## Basic Dynamic Route Example

Inside `src/blog/[slug]/page.deshi`:

```html
<script>
  export async function getStaticParams() {
    return [
      { slug: 'announcing-v1' },
      { slug: 'zero-js-architecture' },
    ];
  }

  // `params` is implicitly provided by the compiler
  const currentSlug = params.slug;
</script>

<head>
  <title>Post: {currentSlug}</title>
</head>

<article>
  <h1>Viewing Article: {currentSlug}</h1>
</article>
```

---

## Fetching Remote APIs

You can fetch data from headless CMSs, REST APIs, or local files inside `getStaticParams()`:

```html
<script>
  export async function getStaticParams() {
    const res = await fetch('https://api.example.com/posts');
    const posts = await res.json();
    
    return posts.map((post) => ({
      slug: post.slug,
    }));
  }

  const post = await fetch(`https://api.example.com/posts/${params.slug}`).then(r => r.json());
</script>
```

---

## Catch-All Parameters

For catch-all routes like `src/docs/[...slug]/page.deshi`, the param value can be a slash-separated string:

```ts
export async function getStaticParams() {
  return [
    { slug: 'getting-started' },
    { slug: 'getting-started/installation' },
    { slug: 'api/compiler/ast' },
  ];
}
```

---

## Astro Alias (getStaticPaths)

For full Astro parity, `export async function getStaticPaths` is an alias for `getStaticParams`. The compiler automatically normalizes it during script analysis.

---

## Build Diagnostics & Errors

- **PF3001: Dynamic page without getStaticParams()**: Triggered when a route contains bracket parameters like `[slug]` but does not export a `getStaticParams` function.
- **PF3002: getStaticParams() returned a bad shape**: Triggered if the function returns null, undefined, or an array containing non-objects.
- **PF3004: getStaticParams() threw**: Triggered when an unhandled exception or failed network fetch occurs inside the function.
