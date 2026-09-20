import docs from '../data/docs.js';

export default function DocsPage() {
  const totalCharacters = docs.reduce((sum, doc) => sum + (doc.contentLength || 0), 0);

  return (
    <>
      <title>Documentation · Deshi</title>
      <div className="docs-container">
        <header className="docs-header">
          <div className="badge-row">
            <span className="badge">Route: /docs</span>
            <span className="badge blue">{docs.length} static documents</span>
            <span className="badge muted">0 KB page JavaScript</span>
          </div>
          <h1>Cloudflare CASB documentation</h1>
          <p className="lead">
            A large-content static generation example. Every article is rendered from React TSX to HTML.
          </p>
          <div className="stats-grid">
            <div className="stat-box"><div className="stat-value">{docs.length}</div><div className="stat-label">Documents</div></div>
            <div className="stat-box"><div className="stat-value">{Math.round(totalCharacters / 1024)} KB</div><div className="stat-label">Source content</div></div>
            <div className="stat-box"><div className="stat-value">0 KB</div><div className="stat-label">Client JavaScript</div></div>
          </div>
        </header>

        <section className="post-list" aria-label="Documents">
          {docs.map((doc, index) => (
            <article className="post-item" key={doc.slug}>
              <div className="post-meta">DOC #{index + 1} · {doc.readTime} · {doc.date}</div>
              <h2><a href={`/docs/${doc.slug}`}>{doc.title}</a></h2>
              <p>{doc.excerpt}</p>
              <a className="text-link" href={`/docs/${doc.slug}`}>Read documentation →</a>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
