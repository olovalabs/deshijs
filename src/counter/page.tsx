import Counter from '../components/Counter.island';

export default function CounterPage() {
  return (
    <>
      <title>React Islands · Deshi</title>
      <div className="narrow-page">
        <span className="badge">Route: /counter</span>
        <h1>Client code stays on an island</h1>
        <p className="lead">
          React renders <code>Counter.island.tsx</code> to static HTML at build time. A separate
          <code>Counter.client.ts</code> controller adds behavior without shipping React to the browser.
        </p>

        <section className="island-card">
          <div>
            <span className="eyebrow">Hydration: load</span>
            <h2>Ready as soon as the page loads</h2>
          </div>
          <Counter client="load" initialCount={0} step={1} />
        </section>

        <section className="explanation-grid">
          <article>
            <strong>Server .tsx</strong>
            <p>Rendered once during development or the production build.</p>
          </article>
          <article>
            <strong>Controller .client.ts</strong>
            <p>Bundled independently as a tiny DOM controller with no React runtime.</p>
          </article>
        </section>
      </div>
    </>
  );
}
