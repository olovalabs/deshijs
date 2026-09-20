---
title: "Directives & Astro Parity"
description: "Guide to Deshijs template directives including set:html, class:list, define:vars, transition:*, and Astro global parity."
---

# Directives & Astro Parity

Deshijs offers full ergonomics parity with Astro's template directives and runtime globals, making code reuse, migration, and learning immediate and effortless.

## set:html (Raw HTML)

Injects raw, unescaped HTML into an element. It replaces any existing children:

```html
<script>
  const rawMarkup = '<strong>Highlighted</strong> summary';
</script>

<div set:html={rawMarkup} />
```

> **Warning**: Using `set:html` on an element that already contains children raises compiler error `PF4023`. Always use a self-closing element or empty element.

---

## set:text (Text Escaping)

Sets the text content of an element with strict HTML entity escaping:

```html
<p set:text={userComment} />
```

---

## class:list (Class Merging)

Combines multiple classes from strings, arrays, and boolean object maps. Falsy keys are automatically dropped:

```html
<button class:list={[
  'btn',
  isActive && 'btn-active',
  { 'btn-disabled': isDisabled, 'btn-large': isLarge },
  customClass
]}>
  Click Me
</button>
```

---

## define:vars (CSS Variables)

Passes server-side component variables into CSS custom properties inside scoped `<style>` blocks:

```html
<script>
  const brandColor = '#10b981';
  const boxRadius = '12px';
</script>

<div class="box">
  Styled dynamically with CSS variables
</div>

<style define:vars={{ brandColor, boxRadius }}>
  .box {
    background: var(--brandColor);
    border-radius: var(--boxRadius);
    padding: 1rem;
  }
</style>
```

---

## View Transitions API (`transition:*`)

Native View Transitions API support for seamless animations between page navigations:

- `transition:name`: Assigns a unique transition identity so the element animates smoothly from one page to the next.
- `transition:animate`: Sets the animation style: `initial`, `slide`, or `fade`.
- `transition:persist`: Keeps the DOM element and its state (video playback, form inputs) intact across page transitions.

```html
<img src="/hero.png" transition:name="hero-banner" />
<main transition:animate="slide">...</main>
<video src="/demo.mp4" transition:persist />
```

---

## The Astro Global Object

In every `.deshi` file, the `Astro` global is implicitly available in server scope:

```ts
// Available everywhere in <script> and template:
Astro.props           // Component properties
Astro.params          // Current dynamic route parameters
Astro.url             // WHATWG URL object for the current page
Astro.request         // Standard Request object
Astro.site            // Configured canonical URL (from deshi.config.ts)
Astro.slots.has(name) // Check if a slot was provided by parent
Astro.cookies         // Cookie access helper
Astro.redirect(path)  // Server-side redirect response
```
