import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '../index';
import { __resetHighlightForTests, highlightCode, highlightStateToken, prepareHighlight } from '../highlight';

afterAll(() => __resetHighlightForTests());

const md = '```ts\nconst a = 1;\n```\n';

describe('highlight', () => {
  it('falls back to a plain block before a highlighter is prepared', () => {
    __resetHighlightForTests();
    expect(highlightCode('const a = 1;', 'ts')).toBeNull();
    expect(highlightStateToken()).toBe('hl:off');

    const res = compile(md, { file: 'src/x.md' });
    expect(res.code).toContain('language-ts');
    expect(res.code).not.toContain('shiki');
  });

  it('highlights code fences once Shiki is prepared', async () => {
    await prepareHighlight({ theme: 'github-dark', langs: ['ts'] });
    expect(highlightStateToken()).toBe('hl:github-dark');

    const hl = highlightCode('const a = 1;', 'ts');
    expect(hl).not.toBeNull();
    expect(hl!.inner).toContain('<code>');
    expect(hl!.attrs.some((a) => a.kind === 'static' && a.name === 'class' && a.value.includes('shiki'))).toBe(true);

    const res = compile(md, { file: 'src/x.md' });
    expect(res.code).toContain('shiki');
    expect(res.code).toContain('color:');
    expect(res.code).not.toContain('language-ts');
  });

  it('returns null for an unloaded language', async () => {
    await prepareHighlight({ theme: 'github-dark', langs: ['ts'] });
    expect(highlightCode('print(1)', 'brainfuck')).toBeNull();
  });
});
