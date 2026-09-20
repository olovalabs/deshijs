import { describe, expect, it } from 'vitest';
import { mergeConfig, normalizeOutput, defaultConfig } from '../config';

describe('mergeConfig', () => {
  it('deep-merges build/experimental/markdown/vite', () => {
    const merged = mergeConfig(
      { ...defaultConfig, build: { inlineStylesheets: 'auto' }, vite: { a: 1 } as never },
      { build: { assetsPrefix: '/cdn' }, vite: { b: 2 } as never },
    );
    expect(merged.build).toMatchObject({ inlineStylesheets: 'auto', assetsPrefix: '/cdn' });
    expect(merged.vite).toMatchObject({ a: 1, b: 2 });
  });

  it('does not mutate the inputs', () => {
    const base = { ...defaultConfig };
    mergeConfig(base, { site: 'https://x.test' });
    expect(base.site).not.toBe('https://x.test');
  });
});

describe('normalizeOutput', () => {
  it('keeps every supported vocabulary value', () => {
    expect(normalizeOutput('hybrid')).toBe('hybrid');
    expect(normalizeOutput('server')).toBe('server');
    expect(normalizeOutput('page')).toBe('page');
    expect(normalizeOutput(undefined)).toBe('static');
  });
});
