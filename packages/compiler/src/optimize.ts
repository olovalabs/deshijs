// Production optimizer (Astro-parity build output).
//
// The compiler already emits compact markup; this pass squeezes the final
// artifacts the way an Astro production build does:
//
//   • HTML     — drops comments, removes redundant/empty attributes, collapses
//                `class` whitespace, minifies `style="…"` declarations, and
//                re-minifies compiler `<style>` blocks.
//   • CSS      — Lightning CSS when installed (css-tree fallback), see `css.ts`.
//   • JS       — esbuild syntax/whitespace minification (`optimizeJs`) for any
//                caller that wants it; islands are minified by the bundler.
//
// Author inline `<script>` / `<style>` text is intentionally left byte-for-byte
// intact (Astro's `is:inline` contract). Everything here is compile-time only —
// nothing ships to the browser.
import { transformSync } from 'esbuild';
import { minifyDeclarationList } from './css';
import { minifyHtml, type HtmlMinifyOptions } from './html';

export interface JsOptimizeOptions {
  /** Strip `console.*` calls and `debugger` statements. Default false. */
  dropConsole?: boolean;
  /** esbuild target (default `es2020`). */
  target?: string;
  /** Rename local identifiers (safe for bundled chunks, not for bare inline scripts). */
  minifyIdentifiers?: boolean;
}

/**
 * Minify a JavaScript string with esbuild. Returns the input untouched when
 * esbuild cannot parse it, so arbitrary inline script bodies never break a build.
 */
export function optimizeJs(code: string, options: JsOptimizeOptions = {}): string {
  if (!code.trim()) return code;
  try {
    return transformSync(code, {
      loader: 'js',
      target: options.target ?? 'es2020',
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: options.minifyIdentifiers ?? false,
      legalComments: 'none',
      ...(options.dropConsole ? { drop: ['console', 'debugger'] as ('console' | 'debugger')[] } : {}),
    }).code.trim();
  } catch {
    return code;
  }
}

export interface HtmlOptimizeOptions {
  /** Also minify inline `<script>` bodies (default false — author text is preserved). */
  minifyInlineScripts?: boolean;
  /** Strip `console.*` / `debugger` from inline scripts (implies the above). */
  dropConsole?: boolean;
  /** esbuild target for inline scripts. */
  target?: string;
}

/**
 * Aggressive production HTML optimization: comment stripping, attribute
 * optimization, inline `style="…"` and `<style>` minification — one parse,
 * then serialize. Inline `<script>` bodies are preserved unless requested.
 */
export function optimizeHtml(html: string, options: HtmlOptimizeOptions = {}): string {
  const minifyInline = options.minifyInlineScripts || options.dropConsole;
  const htmlOptions: HtmlMinifyOptions = {
    removeComments: true,
    optimizeAttributes: true,
    minifyDeclarations: (declarations) => minifyDeclarationList(declarations),
    // Inline scripts can share the global scope with sibling scripts, so
    // identifier renaming is deliberately off (syntax + whitespace only).
    ...(minifyInline
      ? { minifyScript: (code: string) => optimizeJs(code, { dropConsole: options.dropConsole, target: options.target }) }
      : {}),
  };
  return minifyHtml(html, htmlOptions);
}
