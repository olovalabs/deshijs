import docs from '../../data/docs.js';
import type { RouteProps } from '../../layout';

const builtInPosts: Record<string, { title: string; date: string; readTime: string; content: string; sourceUrl?: string }> = {
  'getting-started': {
    title: 'Getting Started with Deshi TSX',
    date: 'September 2026',
    readTime: '3 min read',
    content: '<p>Create <code>layout.tsx</code> and <code>page.tsx</code>, export React components, and run the build. Deshi renders the component tree to static HTML.</p><h2>Add interactivity deliberately</h2><p>Move interactive UI to a separate <code>*.client.tsx</code> file. That file becomes an independently loaded island.</p>',
  },
  architecture: {
    title: 'Under the Hood: React SSG and Islands',
    date: 'September 2026',
    readTime: '5 min read',
    content: '<p>Server TSX is bundled for Node and rendered with React DOM’s static renderer. Client files are replaced by island proxies during that server build.</p><h2>No accidental application bundle</h2><p>Only client islands produce browser chunks. A page made entirely from server components ships HTML and CSS.</p>',
  },
};

export async function getStaticParams() {
  return [
    { slug: 'getting-started' },
    { slug: 'architecture' },
    ...docs.map((doc) => ({ slug: doc.slug })),
  ];
}

export default function BlogArticle({ params }: RouteProps) {
  const slug = String(params.slug);
  const doc = docs.find((item) => item.slug === slug);
  const post = doc ?? builtInPosts[slug] ?? {
    title: 'Article not found',
    date: '',
    readTime: '',
    content: '<p>This article does not exist.</p>',
  };

  return (
    <>
      <title>{`${post.title} · Deshi Blog`}</title>
      <article className="article">
        <div className="badge-row">
          <span className="badge">Static route: /blog/{slug}</span>
          {post.readTime && <span className="badge blue">{post.readTime}</span>}
        </div>
        <h1>{post.title}</h1>
        <time className="post-meta">{post.date}</time>
        <div className="article-body" dangerouslySetInnerHTML={{ __html: post.content }} />
        <footer className="article-footer">
          <a href="/blog">← Back to all posts</a>
          {post.sourceUrl && <a href={post.sourceUrl} target="_blank" rel="noreferrer">Original source ↗</a>}
        </footer>
      </article>
    </>
  );
}
