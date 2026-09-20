const stats = [
  { label: 'Server pages', value: '0 KB JS' },
  { label: 'Authoring', value: 'React + TSX' },
  { label: 'Interactive UI', value: '.client.tsx' },
];

export default function AboutPage() {
  return (
    <>
      <title>About · Deshi</title>
      <div className="narrow-page">
        <span className="badge blue">Route: /about</span>
        <h1>A static-first React framework</h1>
        <p className="lead">
          Deshi lets you use familiar React components without turning every page into a client-side
          application. Components execute during static generation and the browser receives HTML.
        </p>

        <div className="stats-grid">
          {stats.map((stat) => (
            <div className="stat-box" key={stat.label}>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          ))}
        </div>

        <section className="prose-card">
          <h2>The boundary is the file name</h2>
          <p>
            Use regular <code>.tsx</code> for static server components. When a component needs state,
            effects, or event handlers, move it to <code>Component.client.tsx</code>. Importing that
            component creates an isolated, lazily loaded island.
          </p>
        </section>
      </div>
    </>
  );
}
