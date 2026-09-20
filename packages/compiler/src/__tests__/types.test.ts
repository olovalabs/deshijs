import { describe, expect, it } from 'vitest';
import { hashString, offsetToLineCol, codeFrame, makeDiagnostic } from '../types';

describe('hashString', () => {
  it('is a stable 8-hex FNV-1a hash', () => {
    expect(hashString('src/page.deshi')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashString('src/page.deshi')).toBe(hashString('src/page.deshi'));
    // Known FNV-1a vector: empty string hashes to the offset basis.
    expect(hashString('')).toBe('811c9dc5');
  });

  it('differs for different inputs', () => {
    expect(hashString('a.deshi')).not.toBe(hashString('b.deshi'));
  });
});

describe('offsetToLineCol', () => {
  it('maps offsets to 1-based line/column', () => {
    expect(offsetToLineCol('ab\ncde', 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineCol('ab\ncde', 3)).toEqual({ line: 2, column: 1 });
    expect(offsetToLineCol('ab\ncde', 5)).toEqual({ line: 2, column: 3 });
  });

  it('clamps offsets past the end', () => {
    expect(offsetToLineCol('ab', 99)).toEqual({ line: 1, column: 3 });
  });
});

describe('codeFrame', () => {
  it('renders context lines with a caret', () => {
    const src = 'line1\nline2\nline3';
    const frame = codeFrame(src, 2, 3);
    expect(frame).toContain('line2');
    expect(frame).toContain('^');
  });
});

describe('makeDiagnostic', () => {
  it('builds a diagnostic with file/line/frame', () => {
    const d = makeDiagnostic('PF1001', 'Unclosed tag', 'src/page.deshi', '<div>', 0);
    expect(d).toMatchObject({ code: 'PF1001', file: 'src/page.deshi', line: 1, column: 1 });
    expect(d.frame).toContain('<div>');
  });
});
