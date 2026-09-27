export default function PreactWidget(props: { title?: string; speed?: number }) {
  const title = props.title || 'Preact Island';
  const speed = props.speed || 60;
  return (
    <div className="framework-card preact-card">
      <div className="framework-header">
        <span className="framework-badge preact-badge">Preact (TSX)</span>
        <span className="status-indicator">Island</span>
      </div>
      <h3>{title}</h3>
      <p>Fast 3KB alternative to React written in real native TSX syntax.</p>
      <div className="framework-meta">
        <span>File: <code>PreactWidget.tsx</code></span>
        <span>Speed: <strong>{speed}fps</strong></span>
      </div>
    </div>
  );
}
