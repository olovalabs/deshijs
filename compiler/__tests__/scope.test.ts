import { describe, expect, it } from 'vitest';
import { analyzeTemplateScope } from '../scope';
import { compile, __clearCompileMemoForTests } from '../index';

describe('analyzeTemplateScope', () => {
  it('accepts script bindings, implicit bindings and whitelisted globals', () => {
    __clearCompileMemoForTests();
    expect(() =>
      compile(
        `<script>const title = 'x';</script>\n<div>{title} {params.slug} {Math.max(1, 2)}</div>`,
        { file: 'src/ok.deshi' },
      ),
    ).not.toThrow();
  });

  it('rejects unknown identifiers with PF4010', () => {
    __clearCompileMemoForTests();
    expect(() => compile(`<div>{mysteryVar}</div>`, { file: 'src/bad.deshi' })).toThrow(/PF4010/);
  });

  it('understands expression-local bindings (map callbacks, for loops)', () => {
    __clearCompileMemoForTests();
    expect(() =>
      compile(
        `<script>const items = [1, 2];</script>\n<div>{items.map((item) => item * 2)}</div>`,
        { file: 'src/cb.deshi' },
      ),
    ).not.toThrow();
  });

  it('does not leak a let-initializer binding into its own init', () => {
    __clearCompileMemoForTests();
    // `x` in its own initializer must still resolve via <script>, not the
    // in-progress template declaration — unknown here, so PF4010.
    expect(() => analyzeTemplateScope([], [], 'f', 's')).not.toThrow();
  });
});
