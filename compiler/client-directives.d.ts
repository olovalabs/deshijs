/**
 * Type definitions for Deshi per-usage island directives.
 * Strategy is chosen at the usage site, not in the component definition.
 */
export type DeshiClientStrategy = 'load' | 'visible' | 'idle' | 'click';

export interface DeshiClientDirectives {
  /** Hydrate immediately on page load. Must be a boolean attribute. (Astro client:load) */
  'client:load'?: true;
  /** Hydrate when the island enters the viewport. Must be a boolean attribute. (Astro client:visible) */
  'client:visible'?: true;
  /** Hydrate on requestIdleCallback / setTimeout fallback. Must be a boolean attribute. (Astro client:idle) */
  'client:idle'?: true;
  /** Hydrate on first click. Component JS is not requested until then. */
  'client:click'?: true;
  /** Props serialized into SSR HTML and restored during hydration. */
  'client:props'?: Record<string, unknown>;
}

declare global {
  namespace JSX {
    interface IntrinsicAttributes extends DeshiClientDirectives {}
  }
}

export {};
