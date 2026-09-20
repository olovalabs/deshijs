import Counter from '../components/Counter.island';

export default function DemoPage() {
  return (
    <>
      <title>Island Strategies · Deshi</title>
      <div className="narrow-page">
        <span className="badge">Route: /demo</span>
        <h1>Choose when an island hydrates</h1>
        <p className="lead">The same client component can use a different loading strategy at each usage.</p>
        <div className="demo-grid">
          <section className="island-card compact">
            <span className="eyebrow">client=&quot;load&quot;</span>
            <Counter client="load" initialCount={5} step={5} />
          </section>
          <section className="island-card compact">
            <span className="eyebrow">client=&quot;click&quot;</span>
            <Counter client="click" initialCount={10} step={10} />
          </section>
        </div>
      </div>
    </>
  );
}
