export default function ReactWidget(props) {
  const name = props.name || 'React Component';
  const initial = props.initial ?? 42;
  return (
    <div className="framework-card react-card">
      <div className="framework-header">
        <span className="framework-badge react-badge">React (JSX)</span>
        <span className="status-indicator">Island</span>
      </div>
      <h3>{name}</h3>
      <p>Written in real JSX syntax and rendered directly by the Deshi compiler.</p>
      <div className="framework-meta">
        <span>File: <code>ReactWidget.jsx</code></span>
        <span>State: <strong>{initial}</strong></span>
      </div>
    </div>
  );
}
