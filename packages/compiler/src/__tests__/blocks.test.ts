import { describe, expect, it } from 'vitest';
import { splitBlocks } from '../blocks';

describe('splitBlocks', () => {
  it('lifts a top-level <script> and preserves offsets', () => {
    const src = `<script>\nconst a = 1;\n</script>\n<div>hi</div>`;
    const res = splitBlocks(src, 'src/page.deshi');
    expect(res.script?.content).toContain('const a = 1');
    expect(res.template.length).toBe(src.length);
    // Template still points at the original offset of `<div>`.
    expect(res.template.indexOf('<div>')).toBe(src.indexOf('<div>'));
    expect(res.template).not.toContain('<script>');
  });

  it('supports Astro-style --- frontmatter as <script>', () => {
    const src = `---\nconst a = 1;\n---\n<div>{a}</div>`;
    const res = splitBlocks(src, 'src/page.deshi');
    expect(res.script?.content).toContain('const a = 1');
  });

  it('warns when both frontmatter and <script> are present', () => {
    const src = `---\nconst a = 1;\n---\n<script>const b = 2;</script>\n<div/>`;
    const res = splitBlocks(src, 'src/page.deshi');
    expect(res.diagnostics.some((d) => d.code === 'PF1004')).toBe(true);
  });

  it('diagnoses unclosed blocks instead of throwing', () => {
    const res = splitBlocks('<script>const a = 1;', 'src/page.deshi');
    expect(res.diagnostics.some((d) => d.code === 'PF1001')).toBe(true);
    expect(res.script).toBeDefined();
  });

  it('commits an unclosed leading frontmatter fence and diagnoses it', () => {
    const src = '---\nconst x = 1;\n<p>secret</p>';
    const res = splitBlocks(src, 'edge.deshi');
    expect(res.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PF1001',
      message: expect.stringContaining('frontmatter'),
    }));
    expect(res.script?.content).toContain('const x = 1');
    expect(res.script?.content).toContain('<p>secret</p>');
    expect(res.template).not.toContain('secret');
    expect(res.template).not.toContain('const');
  });

  it('does not treat a leading --- without a fence newline as frontmatter', () => {
    const src = '--- const x = 1;';
    const res = splitBlocks(src, 'edge.deshi');
    expect(res.diagnostics).toEqual([]);
    expect(res.script).toBeUndefined();
    expect(res.template).toContain(src);
  });

  it('collects <style> blocks and blanks them from the template', () => {
    const src = `<style>.a { color: red; }</style>\n<div/>`;
    const res = splitBlocks(src, 'src/page.deshi');
    expect(res.styles).toHaveLength(1);
    expect(res.template).not.toContain('.a');
  });
});
