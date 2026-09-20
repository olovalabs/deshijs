'use client';

import { useState } from 'react';

export type IslandStrategy = 'load' | 'visible' | 'idle' | 'click' | 'media' | 'only';

interface CounterProps {
  initialCount?: number;
  step?: number;
  /** Hydration strategy consumed by Deshi's server-side island proxy. */
  client?: IslandStrategy;
  /** Media query used when client="media". */
  media?: string;
}

export default function Counter({ initialCount = 0, step = 1 }: CounterProps) {
  const [count, setCount] = useState(initialCount);

  return (
    <div className="counter">
      <p className="counter-label">Interactive React island</p>
      <output className="counter-value" aria-live="polite">{count}</output>
      <div className="counter-buttons">
        <button type="button" onClick={() => setCount((value) => value - step)} aria-label={`Subtract ${step}`}>
          −{step}
        </button>
        <button type="button" onClick={() => setCount((value) => value + step)} aria-label={`Add ${step}`}>
          +{step}
        </button>
      </div>
      <p className="counter-note">The rest of this page contains no React runtime.</p>
    </div>
  );
}
