---
title: Hello from Markdown
description: A Deshi route authored as Markdown, same as Astro .md pages.
---

# Hello from Markdown

This page is `src/hello.md`. Every route can be **`.deshi`**, **`.html`**, or **`.md`**.

## Why this exists

- File-based routes: `hello.md` → `/hello`
- Folder routes: `about/page.html` or `about/page.md` also work
- Frontmatter becomes bindings (`title`, `description`)

## Lists

1. Compile markdown to HTML
2. Run it through the Deshi SSG + layout
3. Zero island JS unless you add `client:*`

Visit [home](/) or the [counter islands](/counter).
