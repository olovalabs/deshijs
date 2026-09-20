export type IslandStrategy = 'load' | 'visible' | 'idle' | 'click' | 'media' | 'only';

export interface CounterProps {
  initialCount?: number;
  step?: number;
  /** Loading strategy consumed by Deshi's compiler-generated island wrapper. */
  client?: IslandStrategy;
  /** Media query used when client="media". */
  media?: string;
}

/**
 * Server-only island view. React renders this component to static HTML during
 * the build; the browser controller lives in Counter.client.ts.
 */
export default function Counter({ initialCount = 0, step = 1 }: CounterProps) {
  return (
    <div className="counter">
      <p className="counter-label">Compiler island · no client React</p>
      <output className="counter-value" data-count aria-live="polite">{initialCount}</output>
      <div className="counter-buttons">
        <button type="button" data-decrement aria-label={`Subtract ${step}`}>
          −{step}
        </button>
        <button type="button" data-increment aria-label={`Add ${step}`}>
          +{step}
        </button>
      </div>
      <p className="counter-note" data-status>Static HTML waiting for its tiny controller.</p>
    </div>
  );
}
