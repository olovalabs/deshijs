---
title: "Client Router & SPA"
description: "Complete guide to the 1KB Deshijs SPA client router, DOM morphing, prefetching, and navigation lifecycle."
---

# Client Router & SPA

Deshijs includes a zero-dependency, ~1KB client-side SPA router. It turns static multi-page applications into instant, smooth single-page experiences with smart DOM morphing, hover prefetching, and zero stylesheet leaks.

## Enabling the Router

Enable the router in your `vite.config.ts` or `deshi.config.ts`:

```ts
import deshi from 'deshijs/vite';

export default defineConfig({
  plugins: [deshi({ router: true })],
});
```

---

## How the Router Works

The client router script (`CLIENT_ROUTER_SCRIPT`) intercepts link clicks on the same origin:

1. **Intelligent DOM Morphing**: If both current and target pages contain a `<main>` element, the router updates only the `<main>` container. Persistent elements like headers, sidebars, and audio players remain untouched.
2. **Memory Fetch Cache**: Fetched HTML documents are stored in an in-memory cache object. Subsequent navigations to previously visited pages render instantly with zero network latency.
3. **Scroll & Hash Restoration**: Navigating to an anchor link (`/docs#heading`) automatically finds the element by ID and calls `scrollIntoView()`; otherwise, scroll resets to top (`0, 0`).

---

## Hover & Touch Prefetching

Whenever a user hovers their mouse over a link (`onpointerover`) or touches a link on a mobile device (`ontouchstart`), the router silently prefetches the HTML page. By the time the user completes the click (~100–300ms later), the page is already cached in memory.

---

## Head & Style Synchronization

Unlike basic PJAX libraries that suffer from CSS leakage, Deshi's router manages the full lifecycle of styles and meta tags:

- **Title**: `document.title` is updated to the new page's title.
- **Meta Tags**: Existing `<meta>` tags (by `name`, `property`, or `charset`) are replaced in-place.
- **Scoped Styles**: All previous page styles tagged with `data-d` are removed, and new page styles are appended cleanly to prevent style bleed.
- **Canonical**: Updates `<link rel="canonical">` dynamically.

---

## Opt-Out Attributes

You can opt links out of SPA navigation and prefetching:

- `rel="external"`: Forces a full browser page load.
- `data-deshi-reload`: Bypasses router and triggers standard HTTP navigation.
- `data-no-prefetch`: Prevents prefetching on hover for this link.

---

## The deshi:navigated Event

Whenever a client navigation completes, the router dispatches a custom event on `window`:

```js
window.addEventListener('deshi:navigated', (e) => {
  // Analytics tracking, syntax highlighter re-run, etc.
  console.log('Navigated to:', e.detail);
});
```
