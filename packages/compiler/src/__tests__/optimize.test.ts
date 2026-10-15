import { describe, expect, it } from 'vitest';
import {
  loadLightningCss,
  minifyCss,
  minifyDeclarationList,
  optimizeCss,
} from '../css';
import { optimizeHtml, optimizeJs } from '../optimize';
import { build } from '../build';

const hasLightning = loadLightningCss() !== null;

describe('optimizeCss', () => {
  it('minifies, and shortens values further when Lightning CSS is present', () => {
    const out = optimizeCss('.a { color: #ffffff; margin: 0px 0.50em 0 0; }');
    if (hasLightning) {
      expect(out).toBe('.a{color:#fff;margin:0 .5em 0 0}');
    } else {
      // Graceful degradation: css-tree still removes the redundant bytes.
      expect(out).toBe('.a{color:#ffffff;margin:0px 0.5em 0 0}');
    }
  });

  it('falls back to the tolerant css-tree pass on unparseable CSS', () => {
    // Whatever the engine, minification must never throw or lose the text.
    expect(optimizeCss('!!! not css !!!')).toBe('!!! not css !!!');
    expect(() => optimizeCss('@media ( {')).not.toThrow();
  });

  it('keeps the plain minifier byte-stable for author inline styles', () => {
    // `minifyCss` (used for raw `<style>` text) must not rewrite pseudo syntax.
    expect(minifyCss('.x::before{content:"<&amp;>"}')).toContain('::before');
  });
});

describe('minifyDeclarationList', () => {
  it('minifies an inline style attribute value', () => {
    const out = minifyDeclarationList('color: #ffffff;  margin: 0px;');
    expect(out).not.toContain(' ');
    expect(out).toContain('color:');
    if (hasLightning) expect(out).toBe('color:#fff;margin:0');
  });

  it('returns an empty string for empty input', () => {
    expect(minifyDeclarationList('   ')).toBe('');
  });
});

describe('optimizeHtml', () => {
  it('drops comments but keeps hydration markers and conditional comments', () => {
    const out = optimizeHtml('<div><!-- gone --><!--deshi:end--><!--[if IE]><b>x</b><![endif]--></div>');
    expect(out).not.toContain('gone');
    expect(out).toContain('<!--deshi:end-->');
    expect(out).toContain('<!--[if IE]><b>x</b><![endif]-->');
  });

  it('removes redundant attributes and collapses class whitespace', () => {
    const out = optimizeHtml(
      '<script type="text/javascript" src="/a.js"></script>' +
        '<style type="text/css">.a{color:red}</style>' +
        '<link rel="stylesheet" type="text/css" href="/a.css">' +
        '<div class="a   b">x</div>',
    );
    expect(out).toContain('<script src="/a.js"></script>');
    expect(out).toContain('<style>.a{color:red}</style>');
    expect(out).toContain('<link rel="stylesheet" href="/a.css">');
    expect(out).toContain('<div class="a b">x</div>');
  });

  it('minifies inline style attributes and drops empty ones', () => {
    const out = optimizeHtml('<p style="color: #ffffff; margin: 0px">x</p><i style="">y</i>');
    expect(out).toContain('style="color:#fff;margin:0"');
    expect(out).toContain('<i>y</i>');
  });

  it('preserves author inline <script> text by default', () => {
    const out = optimizeHtml('<script>if (1 < 2 && true) run();</script>');
    expect(out).toContain('if (1 < 2 && true) run();');
  });

  it('minifies inline <script> only when asked', () => {
    const out = optimizeHtml('<script>console.log( 1 + 2 );</script>', { minifyInlineScripts: true });
    expect(out).toContain('console.log(3)');
  });

  it('never rewrites <pre> whitespace', () => {
    expect(optimizeHtml('<pre>  keep  </pre>')).toBe('<pre>  keep  </pre>');
  });
});

describe('optimizeJs', () => {
  it('minifies syntax and whitespace without renaming identifiers', () => {
    const out = optimizeJs('const total = 1 + 2; console.log( total );');
    expect(out).toBe('const total=3;console.log(3);');
  });

  it('strips console and debugger when asked', () => {
    const out = optimizeJs('console.log("x"); debugger; keep();', { dropConsole: true });
    expect(out).not.toContain('console');
    expect(out).not.toContain('debugger');
    expect(out).toContain('keep()');
  });

  it('returns the input unchanged when it is not valid JS', () => {
    expect(optimizeJs('this is not javascript')).toBe('this is not javascript');
  });
});

describe('build integration', () => {
  it('minifies page CSS and strips comments while keeping island markers', async () => {
    const res = await build(
      {
        files: {
          'src/layout.deshi': '<html><head><title>T</title></head><body><slot /></body></html>',
          'src/page.deshi':
            '<div class="a  b"><!-- drop me --><p style="color: #ffffff">Hi</p></div>' +
            '<style>.card { color: #ffffff }</style>',
        },
      },
      { appDir: 'src', router: false },
    );
    expect(res.ok).toBe(true);
    const html = res.pages[0].html;
    expect(html).not.toContain('drop me');
    expect(html).toContain('class="a b"');
    expect(html).toContain('style="color:#fff"');
    // Compiler-generated scoped CSS goes through the strong optimizer.
    expect(res.compiled['src/page.deshi'].css.scoped).toContain('color:#fff');
  });
});
