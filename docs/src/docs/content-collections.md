---
title: "Content Collections"
description: "Type-safe markdown frontmatter and content collections in Deshijs using defineCollection and getCollection."
---

# Content Collections

Content Collections provide structured, type-safe markdown and data schemas. Define collections with `defineCollection()` and query entries seamlessly using `getCollection()`.

## Defining Collections

Create a configuration file at `src/content/config.ts`:

```ts
import { defineCollection, z } from 'deshijs/content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    date: z.string(),
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { blog };
```

---

## Directory Layout

Organize entries into named subdirectories under `src/content/`:

```
src/content/
├── config.ts
└── blog/
    ├── first-post.md
    ├── zero-js-guide.md
    └── performance-tips.md
```

---

## Querying with getCollection()

Query collection entries inside any `<script>` block:

```html
<script>
  import { getCollection } from 'deshijs/content';

  // Returns typed array of all entries in the 'blog' collection
  const allPosts = await getCollection('blog');
</script>

<ul>
  {allPosts.map((post) => (
    <li>
      <a href={`/blog/${post.slug}`}>
        {post.data.title}
      </a>
      <span>{post.data.date}</span>
    </li>
  ))}
</ul>
```

---

## Collection Entry Structure

```ts
export type CollectionEntry<T = unknown> = {
  id: string;         // e.g. "first-post"
  slug: string;       // Sanitized URL slug
  collection: string; // e.g. "blog"
  data: T;            // Parsed & validated frontmatter
  body: string;       // Raw markdown content
  render(): Promise<{
    Content: unknown;
    headings: Array<{ depth: number; text: string; slug: string }>;
  }>;
};
```

---

## Dynamic Route Integration

Pair Content Collections with `src/blog/[slug]/page.deshi` and `getStaticParams()`:

```html
<script>
  import { getCollection } from 'deshijs/content';

  export async function getStaticParams() {
    const posts = await getCollection('blog');
    return posts.map((post) => ({ slug: post.slug }));
  }

  const posts = await getCollection('blog');
  const post = posts.find((p) => p.slug === params.slug);
</script>

<article>
  <h1>{post.data.title}</h1>
  <p>Published: {post.data.date}</p>
</article>
```
