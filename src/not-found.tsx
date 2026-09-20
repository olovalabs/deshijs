export default function NotFoundPage() {
  return (
    <>
      <title>Page not found · Deshi</title>
      <div className="not-found">
        <span className="error-code">404</span>
        <h1>Page not found</h1>
        <p>The route you requested does not exist on this static site.</p>
        <a className="button primary" href="/">← Return home</a>
      </div>
    </>
  );
}
