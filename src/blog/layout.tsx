import type { ReactNode } from 'react';

export default function BlogLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="blog-layout">
      <aside className="blog-sidebar">
        <span className="eyebrow">Blog section</span>
        <nav className="side-nav" aria-label="Blog navigation">
          <a href="/blog">All posts</a>
          <a href="/blog/getting-started">Getting started</a>
          <a href="/blog/architecture">Architecture</a>
        </nav>
      </aside>
      <section className="blog-main">{children}</section>
    </div>
  );
}
