import { describe, expect, it } from 'vitest';
import { analyzeScript } from '../script';

const at = (content: string, offset = 0) => analyzeScript(content, 'src/page.deshi', content, offset);

describe('analyzeScript', () => {
  it('collects imports, bindings and body', () => {
    const info = at(`import Card from './Card.deshi';\nconst title = 'Hi';\n`);
    expect(info.bindings).toContain('title');
    expect(info.components.has('Card')).toBe(true);
    expect(info.body).toContain('const title');
  });

  it('rejects lowercase component imports (PF4020)', () => {
    expect(() => at(`import card from './Card.deshi';`)).toThrow(/PF4020/);
  });

  it('rejects named imports from components (PF4021)', () => {
    expect(() => at(`import { x } from './Card.deshi';`)).toThrow(/PF4021/);
  });

  it('hoists getStaticParams and forbids other exports', () => {
    const info = at(`export function getStaticParams() { return []; }\n`);
    expect(info.staticParams).toContain('getStaticParams');
    expect(() => at(`export const rogue = 1;`)).toThrow(/PF4021/);
  });

  it('strips TypeScript types so none leak into the body', () => {
    const info = at(`const x: number = 1;\ninterface T { a: string }\n`);
    expect(info.body).not.toContain(': number');
    expect(info.body).not.toContain('interface');
  });

  it('supports destructured bindings', () => {
    const info = at(`const { a, b: [c] } = { a: 1, b: [2] };\n`);
    expect(info.bindings).toEqual(expect.arrayContaining(['a', 'c']));
  });
});
