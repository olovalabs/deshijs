import Counter from '../components/Counter.client';

export default function CounterPage() {
  return (
    <>
      <title>React Islands · Deshi</title>
      <div className="narrow-page">
        <span className="badge">Route: /counter</span>
        <h1>Client code stays on an island</h1>
        <p className="lead">
          This counter is authored as a separate <code>Counter.client.tsx</code> React component.
          Its browser bundle loads on demand; the page and layout remain static HTML.
        </p>

        <section className="island-card">
          <div>
            <span className="eyebrow">Hydration: visible</span>
            <h2>Only load when scrolled into view</h2>
          </div>
          <Counter client="visible" initialCount={0} step={1} />
        </section>

        <section className="explanation-grid">
          <article>
            <strong>Server .tsx</strong>
            <p>Rendered once during development or the production build.</p>
          </article>
          <article>
            <strong>Client .client.tsx</strong>
            <p>Bundled independently and hydrated according to its strategy.</p>
          </article>
        </section>
      </div>
    </>
  );
}
