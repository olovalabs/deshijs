import docs from '../data/docs.js';

const initialPosts = [
  {
    slug: 'getting-started',
    title: 'Getting Started with Deshi TSX',
    date: 'Sep 2026',
    readTime: '3 min read',
    excerpt: 'Build static pages with typed React components and opt-in client islands.',
  },
  {
    slug: 'architecture',
    title: 'Under the Hood: React SSG and Islands',
    date: 'Sep 2026',
    readTime: '5 min read',
    excerpt: 'How the server renderer outputs HTML while client components become isolated bundles.',
  },
];

export default function BlogPage() {
  const posts = [...initialPosts, ...docs];

  return (
    <>
      <title>Blog · Deshi</title>
      <div className="badge-row">
        <span className="badge">Route: /blog</span>
        <span className="badge blue">{posts.length} articles</span>
      </div>
      <h1>Engineering &amp; guides</h1>
      <p className="lead">Static React rendering, compiler islands, framework-free controllers, and security deep dives.</p>

      <div className="post-list">
        {posts.map((post) => (
          <article className="post-item" key={post.slug}>
            <div className="post-meta">{post.date} · {post.readTime ?? '5 min read'}</div>
            <h2><a href={`/blog/${post.slug}`}>{post.title}</a></h2>
            <p>{post.excerpt}</p>
          </article>
        ))}
      </div>
    </>
  );
}
