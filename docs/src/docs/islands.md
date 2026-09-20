---
title: "Islands Architecture & Hydration"
description: "In-depth guide to Deshijs islands architecture and all 6 client:* hydration directives."
---

# Islands Architecture & Hydration

Deshijs ships zero client JavaScript by default. When interactivity is needed, you opt-in at the **usage site** using `client:*` directives.

## What are Islands?

In traditional single-page frameworks, adding one interactive widget (like an image carousel or a dark mode toggle) forces the entire page to ship a heavy JavaScript runtime.

Deshijs implements the **Islands Architecture**:
- Static HTML is generated on the server at build time.
- Only components carrying a `client:*` directive are bundled into browser JavaScript chunks (`/_deshi/c/<Component>.<hash>.js`).
- Pages without islands ship **0 bytes of client JS**.
- Each island receives an ultra-compact inline bootstrap script matching its exact hydration strategy.

---

## The 6 Hydration Strategies

| Directive | Strategy | When It Hydrates |
| --- | --- | --- |
| `client:load` | Immediate | On initial page load. Emits `<link rel="modulepreload">` for instant fetching. |
| `client:visible` | Viewport Trigger | When component scrolls into the viewport via `IntersectionObserver`. |
| `client:idle` | Background Idle | When browser is idle via `requestIdleCallback` (with 200ms timeout fallback). |
| `client:media="(query)"` | Media Query | When CSS media query matches (e.g. `client:media="(max-width: 768px)"`). |
| `client:click` | User Interaction | On first click. Zero JS is downloaded until user clicks! |
| `client:only` | Client Only | Skips SSR entirely and mounts directly in the browser. |

---

### 1. client:load (Immediate)
```html
<Navbar client:load />
```
Hydrates immediately as soon as the page loads. The build engine also injects a `<link rel="modulepreload">` tag into `<head>` to prioritize chunk downloading.

---

### 2. client:visible (Viewport Trigger)
```html
<ImageCarousel client:visible />
```
Hydrates only when the component enters the visible viewport. If `IntersectionObserver` is not supported, it falls back to immediate execution.

---

### 3. client:idle (Background Idle)
```html
<NewsletterSignup client:idle />
```
Hydrates during idle time via `requestIdleCallback`. Combines with an IntersectionObserver so hidden elements do not hydrate unnecessarily.

---

### 4. client:media (Media Query)
```html
<MobileMenu client:media="(max-width: 768px)" />
```
Hydrates only when the media query matches. Ideal for responsive navigation drawers that are not visible on desktop viewports.

---

### 5. client:click (User Interaction)
```html
<SettingsModal client:click />
```
A unique Deshi extension: zero JavaScript is downloaded until the user clicks the element. On click, it downloads the chunk, mounts the island, and re-dispatches the click event seamlessly.

---

### 6. client:only (Client Only)
```html
<CanvasGame client:only />
```
Skips server-side rendering entirely. Useful for browser-only libraries like Three.js, Canvas, or WebGL.

---

## Passing Props with client:props

Server props can be serialized into the SSR HTML and made available during client hydration using `client:props`:

```html
<Counter client:visible client:props={{ initialCount: 42, step: 2 }} />
```

The compiler serializes the object into `data-deshi-props` on the island's root element. During hydration, it is automatically parsed and passed to the component's `mount()` function as `ctx.props`.

---

## Authoring Island Components (`<script client>`)

Declare browser interactivity within a `<script client>` block inside your component:

```html
<script>
  // Server-side prop defaults
  const start = props.start || 0;
</script>

<div class="counter">
  <button class="dec">-1</button>
  <span class="count">{start}</span>
  <button class="inc">+1</button>
</div>

<script client>
  // Browser island code: `root` is the component root DOM element
  const btnInc = root.querySelector('.inc');
  const btnDec = root.querySelector('.dec');
  const display = root.querySelector('.count');

  let count = ctx.props.start || 0;

  btnInc.addEventListener('click', () => {
    count++;
    display.textContent = count;
  });

  btnDec.addEventListener('click', () => {
    count--;
    display.textContent = count;
  });
</script>
```

---

## Runtime Internals (islands.ts)

In `packages/compiler/src/islands.ts`:
- `stampIslandRoot(html, id)`: Injects `id="{id}"` or `data-deshi-i="{id}"` onto the component's outermost element.
- `islandInlineScript(id, src, strategy, media)`: Generates the `<script type="module">` bootstrapper.
- `r.dataset.deshiHydrated = "1"`: Guard flag preventing duplicate hydrations during client-router page transitions.
