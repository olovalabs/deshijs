// Build-time syntax highlighting via Shiki (https://shiki.style).
//
// Shiki is initialized once (async) before a build/dev-server compile pass, then
// `highlightCode()` runs synchronously from the document layer — code fences are
// highlighted to real HTML and spliced into the Deshi AST with `set:html`.
//
// If the highlighter was never prepared (e.g. `compile()` called directly in
// tests) or a language is not loaded, `highlightCode()` returns null and the
// plain `<pre><code class="language-x">` output is used unchanged.
import { createHighlighter } from 'shiki';
import { parseFragment, serializeOuter, type DefaultTreeAdapterTypes as P5 } from 'parse5';
import type { Attr } from './types';

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

export interface HighlightConfig {
  /** Shiki theme name (default `github-dark`). */
  theme?: string;
  /** Extra language ids to preload on top of the defaults. */
  langs?: string[];
}

/** Languages preloaded by default; anything else falls back to a plain block. */
const DEFAULT_LANGS = [
  'js', 'ts', 'jsx', 'tsx', 'json', 'html', 'css', 'md', 'mdx',
  'bash', 'shell', 'diff', 'yaml', 'toml', 'python', 'astro',
  'vue', 'svelte', 'sql', 'go', 'rust', 'c', 'cpp', 'java', 'xml',
];

const DEFAULT_THEME = 'github-dark';

let highlighter: Highlighter | null = null;
let activeTheme = DEFAULT_THEME;
let failed = false;
let preparing: Promise<void> | null = null;

/** Load Shiki and cache the highlighter. Safe to call repeatedly. */
export async function prepareHighlight(config: HighlightConfig = {}): Promise<void> {
  if (failed) return;
  if (preparing) await preparing;
  if (highlighter && activeTheme === (config.theme ?? DEFAULT_THEME)) return;

  preparing = (async () => {
    try {
      const theme = config.theme ?? DEFAULT_THEME;
      const langs = [...new Set([...DEFAULT_LANGS, ...(config.langs ?? [])])];
      if (!highlighter) {
        highlighter = await createHighlighter({ themes: [theme], langs });
      } else {
        const loadedLangs = highlighter.getLoadedLanguages();
        for (const l of langs) if (!loadedLangs.includes(l)) await highlighter.loadLanguage(l as never);
        if (!highlighter.getLoadedThemes().includes(theme)) await highlighter.loadTheme(theme as never);
      }
      activeTheme = theme;
    } catch {
      // A grammar/theme failure must never break the build — fall back to plain blocks.
      failed = true;
      highlighter = null;
    }
  })();

  try {
    await preparing;
  } finally {
    preparing = null;
  }
}

/** Forget the cached highlighter (tests). */
export function __resetHighlightForTests(): void {
  highlighter = null;
  activeTheme = DEFAULT_THEME;
  failed = false;
  preparing = null;
}

/** Stable token for the current highlighter state — part of the compile memo key. */
export function highlightStateToken(): string {
  return highlighter ? `hl:${activeTheme}` : 'hl:off';
}

export interface Highlighted {
  /** attributes of Shiki's `<pre>` (class / style / tabindex), to copy onto ours */
  attrs: Attr[];
  /** inner HTML of Shiki's `<pre>` (`<code>…spans…</code>`) */
  inner: string;
}

/**
 * Highlight a code block synchronously. Returns null when Shiki is unavailable
 * or the language is not loaded, so callers can fall back to a plain block.
 */
export function highlightCode(code: string, lang: string): Highlighted | null {
  if (!highlighter || !lang) return null;
  const loaded = highlighter.getLoadedLanguages();
  if (!loaded.includes(lang)) return null;

  let html: string;
  try {
    html = highlighter.codeToHtml(code, { lang, theme: activeTheme });
  } catch {
    return null;
  }

  // Extract Shiki's <pre> attributes and inner HTML so the Deshi AST can emit
  // exactly what Shiki produced (its class/style/theme background included).
  const frag = parseFragment(html);
  const pre = frag.childNodes.find((n) => (n as P5.Element).tagName === 'pre') as P5.Element | undefined;
  if (!pre) return null;
  return {
    attrs: pre.attrs.map((a) => ({ kind: 'static', name: a.name, value: a.value })),
    inner: pre.childNodes.map((n) => serializeOuter(n)).join(''),
  };
}
