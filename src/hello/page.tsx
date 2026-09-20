export default function HelloPage() {
  return (
    <>
      <title>Hello from TSX · Deshi</title>
      <article className="article narrow-page">
        <span className="badge">Route: /hello</span>
        <h1>Hello from TSX</h1>
        <p className="lead">
          This route is <code>src/hello/page.tsx</code>. It is a regular React function component,
          but its production output is static HTML.
        </p>
        <div className="prose-card">
          <h2>Why this matters</h2>
          <ul>
            <li>Use TypeScript, JSX, component composition, and familiar React tooling.</li>
            <li>No hydration or application bundle is added to a server page.</li>
            <li>Interactive features cross an explicit <code>.client.tsx</code> boundary.</li>
          </ul>
        </div>
        <p><a className="text-link" href="/">← Return home</a></p>
      </article>
    </>
  );
}
