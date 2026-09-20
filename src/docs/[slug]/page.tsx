import docs from '../../data/docs.js';
import type { RouteProps } from '../../layout';

export async function getStaticParams() {
  return docs.map((doc) => ({ slug: doc.slug }));
}

export default function DocumentPage({ params }: RouteProps) {
  const slug = String(params.slug);
  const index = docs.findIndex((item) => item.slug === slug);
  const doc = docs[index] ?? {
    title: 'Document not found',
    date: '',
    readTime: '',
    excerpt: '',
    content: '<p>The requested document was not found.</p>',
    sourceUrl: '',
  };
  const previous = index > 0 ? docs[index - 1] : null;
  const next = index >= 0 && index < docs.length - 1 ? docs[index + 1] : null;

  return (
    <>
      <title>{`${doc.title} · Documentation`}</title>
      <div className="doc-layout">
        <aside className="doc-sidebar">
          <a className="text-link" href="/docs">← All documents</a>
          <nav className="side-nav" aria-label="Documentation">
            {docs.map((item, itemIndex) => (
              <a className={item.slug === slug ? 'active' : ''} href={`/docs/${item.slug}`} key={item.slug}>
                {itemIndex + 1}. {item.title}
              </a>
            ))}
          </nav>
        </aside>

        <article className="article">
          <div className="badge-row">
            <span className="badge">Cloudflare CASB</span>
            <span className="badge blue">{doc.readTime || 'Deep dive'}</span>
          </div>
          <h1>{doc.title}</h1>
          <p className="post-meta">Published {doc.date}</p>
          {doc.excerpt && <p className="abstract"><strong>Overview:</strong> {doc.excerpt}</p>}
          <div className="article-body" dangerouslySetInnerHTML={{ __html: doc.content }} />
          <footer className="article-footer pagination">
            {previous ? <a href={`/docs/${previous.slug}`}>← {previous.title}</a> : <span />}
            {next && <a href={`/docs/${next.slug}`}>{next.title} →</a>}
          </footer>
        </article>
      </div>
    </>
  );
}
