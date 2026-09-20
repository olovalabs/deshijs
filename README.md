# Deshi

A static-first TSX framework: author pages and components with React syntax, compile them to HTML, and add interactivity through **compiler-driven islands with no client-side React**.

## The model

- `*.tsx` — static/server React components. They execute during development and builds only.
- `*.island.tsx` — the server-rendered HTML view for an interactive island.
- `*.client.ts` — the paired browser DOM controller. It is bundled independently without React.
- `page.tsx` and `layout.tsx` — file-based routes and layouts.
- Production output — static HTML, CSS, and only the small controller chunks actually used.

React is an authoring and server-rendering tool here. It is never included in browser bundles.

## Static page

A page is an ordinary React component:

```tsx
// src/page.tsx
export default function Page() {
  return (
    <main>
      <title>Home</title>
      <h1>This becomes static HTML</h1>
    </main>
  );
}
```

## Compiler island

An island consists of two explicit files with the same base name.

First, define its static HTML view:

```tsx
// src/components/Counter.island.tsx
export default function Counter({ initialCount = 0, client = 'load' }) {
  return (
    <div>
      <output data-count>{initialCount}</output>
      <button type="button" data-increment>+1</button>
    </div>
  );
}
```

Then define its framework-free browser controller:

```ts
// src/components/Counter.client.ts
export default function mount(root: HTMLElement) {
  const output = root.querySelector<HTMLOutputElement>('[data-count]')!;
  const button = root.querySelector<HTMLButtonElement>('[data-increment]')!;
  let count = Number(output.textContent);

  button.addEventListener('click', () => {
    output.textContent = String(++count);
  });
}
```

Use the server view from a page:

```tsx
import Counter from './components/Counter.island';

export default function Page() {
  return <Counter client="visible" initialCount={0} />;
}
```

The compiler:

1. renders `Counter.island.tsx` to static HTML,
2. serializes its JSON-safe props,
3. bundles only `Counter.client.ts`,
4. loads the controller using the requested strategy, and
5. calls `mount(root, { props, url })`.

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
    ├── Counter.island.tsx     # Static island HTML
    └── Counter.client.ts      # Browser DOM controller
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
npm test          # Typecheck, build, and island behavior test
```

With the router disabled (the default), regular pages contain no scripts. Island pages emit only their compiler-generated bootstrap and framework-free client controller—never React or React DOM.
