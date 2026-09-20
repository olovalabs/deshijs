# Deshi

A static-first React framework: author pages and components in **TypeScript + JSX**, render them to HTML at build time, and ship browser JavaScript only for explicit client islands.

## The model

- `*.tsx` — server/static React components. They run in development and at build time; React is not shipped to the browser.
- `*.client.tsx` — interactive React islands. Each island is bundled separately and loaded only on a page that renders it.
- `page.tsx` and `layout.tsx` — file-based routes and layouts.
- Production output — static HTML, CSS, and only the island chunks actually used.

This is React authoring, not a client-rendered React SPA by default.

## Example

A static page is an ordinary React component:

```tsx
// src/page.tsx
export default function Page() {
  return (
    <main>
      <title>Home</title>
      <h1>This is rendered to HTML</h1>
    </main>
  );
}
```

Interactive behavior goes in a separate file:

```tsx
// src/components/Counter.client.tsx
'use client';

import { useState } from 'react';

export default function Counter({ initialCount = 0, client = 'load' }) {
  const [count, setCount] = useState(initialCount);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

Use it from a server page and choose when it hydrates:

```tsx
import Counter from './components/Counter.client';

export default function Page() {
  return <Counter client="visible" initialCount={0} />;
}
```

Supported strategies are `load`, `visible`, `idle`, `click`, `media`, and `only`. For `media`, also pass a `media` query prop.

## File-based routing

```text
src/
├── layout.tsx                 # Required root document layout
├── page.tsx                   # /
├── not-found.tsx              # /404
├── about/page.tsx             # /about
├── blog/layout.tsx            # Nested layout
├── blog/page.tsx              # /blog
├── blog/[slug]/page.tsx       # Dynamic static routes
└── components/
    ├── Card.tsx               # Static/server component
    └── Counter.client.tsx     # Browser island
```

Dynamic routes export their build-time params:

```tsx
export async function getStaticParams() {
  return [{ slug: 'hello' }, { slug: 'tsx' }];
}

export default function Article({ params }: { params: { slug: string } }) {
  return <h1>{params.slug}</h1>;
}
```

## Commands

```bash
npm install
npm run dev       # Vite development server
npm run build     # Static production build in dist/
npm run preview   # Preview dist/
npm run typecheck
```

With the router disabled (the default), a page containing only regular `.tsx` components has no `<script>` and no React runtime. A `.client.tsx` import creates a clear server/client boundary and emits an island chunk only when rendered.
