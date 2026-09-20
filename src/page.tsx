import Card from './components/Card';

const features = [
  {
    title: 'React TSX authoring',
    text: 'Pages, layouts, and components are ordinary typed React components in .tsx files.',
  },
  {
    title: 'Static HTML output',
    text: 'Server components render at build time. React is not sent to the browser.',
  },
  {
    title: 'Explicit islands',
    text: 'Interactive code lives in a separate .client.tsx component and loads only where it is used.',
  },
  {
    title: 'Vite powered',
    text: 'Fast development, file-based routes, static generation, and production builds.',
  },
];

export default function HomePage() {
  return (
    <>
      <title>Deshi · Static React TSX</title>
      <section className="hero">
        <span className="badge">React syntax · zero JS by default</span>
        <h1>Write TSX. Ship HTML.</h1>
        <p className="lead">
          Deshi renders React components during the build. Client-side React is included only for
          components you explicitly isolate in a <code>.client.tsx</code> island.
        </p>
        <div className="hero-actions">
          <a className="button primary" href="/counter">See an island</a>
          <a className="button" href="/about">How it works</a>
        </div>
      </section>

      <section className="features-grid" aria-label="Framework features">
        {features.map((feature) => (
          <Card key={feature.title} title={feature.title} tag="Core">
            <p>{feature.text}</p>
          </Card>
        ))}
      </section>

      <section className="code-card">
        <span className="eyebrow">Server component</span>
        <pre><code>{`export default function Page() {
  return <h1>This becomes static HTML</h1>;
}`}</code></pre>
      </section>
    </>
  );
}
