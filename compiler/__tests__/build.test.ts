import { describe, expect, it } from 'vitest';
import { build } from '../build';

const files = (extra: Record<string, string> = {}) => ({
  'src/layout.deshi': `<html><head><title>T</title></head><body><slot /></body></html>`,
  'src/page.deshi': `<script>const title = 'Home';</script>\n<h1>{title}</h1>`,
  ...extra,
});

describe('build', () => {
  it('renders a page through the root layout', async () => {
    const res = await build({ files: files() }, { appDir: 'src' });
    expect(res.ok).toBe(true);
    const page = res.pages.find((p) => p.url === '/');
    expect(page?.html).toContain('<h1>Home</h1>');
    expect(page?.html).toContain('<title>T</title>');
  });

  it('emits the manifest and per-page output files', async () => {
    const res = await build({ files: files() }, { appDir: 'src' });
    expect(res.files.some((f) => f.path === '.deshi/manifest.json')).toBe(true);
    expect(res.files.some((f) => f.path.endsWith('.html'))).toBe(true);
  });

  it('supports dynamic routes via getStaticParams', async () => {
    const res = await build(
      {
        files: files({
          'src/blog/[slug]/page.deshi': `<script>export function getStaticParams() { return [{ slug: 'hello' }]; }\nconst t = 'x';</script>\n<p>{params.slug} {t}</p>`,
        }),
      },
      { appDir: 'src' },
    );
    expect(res.ok).toBe(true);
    expect(res.pages.some((p) => p.url === '/blog/hello')).toBe(true);
  });

  it('collects diagnostics instead of throwing for bad pages', async () => {
    const res = await build(
      { files: files({ 'src/bad/page.deshi': `<div>{nope}</div>` }) },
      { appDir: 'src' },
    );
    expect(res.ok).toBe(false);
    expect(res.diagnostics.length).toBeGreaterThan(0);
  });
});
