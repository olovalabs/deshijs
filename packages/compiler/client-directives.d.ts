/**
 * Type definitions for Deshi per-usage island directives — Astro parity.
 * Strategy is chosen at the usage site, not in the component definition.
 * Same per-usage semantics as Astro's `client:*` directives.
 */
export type DeshiClientStrategy = 'load' | 'visible' | 'idle' | 'click' | 'media' | 'only';

export interface DeshiClientDirectives {
  /** Hydrate immediately on page load (Astro client:load). Boolean — no value. */
  'client:load'?: boolean;
  /** Hydrate when the island enters the viewport (Astro client:visible). Boolean. */
  'client:visible'?: boolean;
  /** Hydrate on requestIdleCallback / setTimeout fallback (Astro client:idle). Boolean. */
  'client:idle'?: boolean;
  /** Hydrate on first click — JS not requested until click (Astro client:click → Deshi extension). Boolean. */
  'client:click'?: boolean;
  /** Hydrate when media query matches (Astro client:media). Value = media query string. */
  'client:media'?: string;
  /** Client-only — skip SSR, hydrate on the client (Astro client:only). Value = framework hint. */
  'client:only'?: boolean | string;
  /** Props serialized into SSR HTML and restored during hydration (Deshi extension of Astro island props). */
  'client:props'?: Record<string, unknown>;
  /** Alias: allow passing props via `client:props` as JSON literal */
  'client:component-hydration'?: never;
}

export interface DeshiTransitionDirectives {
  /** Opt this element into View Transitions (Astro transition:name). */
  'transition:name'?: string;
  /** View Transition animation (Astro transition:animate). */
  'transition:animate'?: 'initial' | 'slide' | 'fade' | string;
  /** Persist this element across navigations (Astro transition:persist). */
  'transition:persist'?: boolean | string;
}

export interface DeshiAstroDirectives {
  /** Merge class list (Astro class:list). Accepts string | string[] | Record<string, boolean>. */
  'class:list'?: string | string[] | Record<string, boolean> | unknown;
  /** Inject CSS vars into scoped style (Astro define:vars). */
  'define:vars'?: Record<string, string | number>;
  /** Raw HTML (Astro set:html). */
  'set:html'?: string;
  /** Text content (Astro set:text). */
  'set:text'?: string;
}

declare global {
  namespace JSX {
    interface IntrinsicAttributes extends DeshiClientDirectives, DeshiTransitionDirectives, DeshiAstroDirectives {}
    interface IntrinsicElements {
      // allow any element to carry transition:* and class:list etc
      [elemName: string]: DeshiClientDirectives & DeshiTransitionDirectives & DeshiAstroDirectives & Record<string, any>;
    }
  }
}

// Astro global parity for Deshi: `Astro` is available in every frontmatter/template scope.
export interface DeshiAstroGlobal {
  props: Record<string, any>;
  params: Record<string, string | string[]>;
  url: URL;
  request: Request;
  site?: URL;
  generator: string;
  slots: {
    has(name: string): boolean;
    render(name: string, args?: any[]): Promise<string>;
  };
  cookies: {
    get(key: string): { value: string } | undefined;
    has(key: string): boolean;
  };
  redirect(path: string, status?: number): Response;
  rewrite(path: string): unknown;
}

declare global {
  const Astro: DeshiAstroGlobal;
}

export {};
