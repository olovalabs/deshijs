---
title: "Markdown Engine & GFM"
description: "Guide to native markdown routing, frontmatter bindings, GFM syntax parsing, and layout wrapping in Deshijs."
---

# Markdown Engine & GFM

Deshijs provides first-class support for `.md` files. Write markdown directly in your route tree with automatic frontmatter bindings, built-in GitHub Flavored Markdown (GFM) parsing, and seamless layout wrapping.

## Markdown File Routing

Dropping a `.md` file into your `src/` directory instantly creates a static route:

- `src/about.md` &rarr; `/about`
- `src/blog/welcome.md` &rarr; `/blog/welcome`
- `src/terms/page.md` &rarr; `/terms`

---

## Frontmatter Parsing

YAML frontmatter enclosed in `---` fences at the top of the file is parsed into component script bindings:

```markdown
---
title: "Welcome to Deshijs"
description: "Zero-JS static generation for modern developers."
layout: "../layouts/BlogLayout.deshi"
published: true
author: "Team Deshi"
---

# Welcome to Deshijs

This is a native markdown page rendered directly by Deshijs!

- Zero JavaScript footprint
- Sub-50ms builds
- Clean typography
```

---

## Built-in GFM Features

The built-in parser in `markdown.ts` supports full GitHub Flavored Markdown specifications:

1. **Auto-Slugged Heading Anchors**: `## Quick Start` generates `<h2 id="quick-start">Quick Start</h2>` for seamless deep-linking.
2. **Markdown Tables**: Pipe-delimited markdown tables (`| Col 1 | Col 2 |`) compile into semantic `<table>`, `<thead>`, and `<tbody>`.
3. **Interactive Task Lists**: `- [x] Done` and `- [ ] Todo` render as disabled checkboxes in styled list items.
4. **Fenced Code Blocks**: Triple-backtick blocks (```ts) emit syntax highlighting classes (`class="language-ts"`).

---

## Custom Layout Wrapping

Specify a layout component in frontmatter to wrap the compiled article:

```markdown
---
title: "Announcing Deshijs 1.0"
layout: "../layouts/ArticleLayout.deshi"
---
```

The layout receives the frontmatter properties as `props` and renders the article content via its default `<slot />`.

---

## Compiler Internals (markdownToDeshi)

In `packages/compiler/src/markdown.ts`, markdown files are transformed into native Deshi AST:
- `parseFrontmatter(source)`: Extracts YAML data and markdown body.
- `markdownToHtml(body)`: Transforms markdown into HTML strings.
- `markdownToDeshi(source)`: Emits a synthetic `.deshi` component wrapping the HTML into `<article set:html={html}>` with default typography styles.
