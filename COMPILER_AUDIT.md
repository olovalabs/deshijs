# Compiler bug audit

## Scope and baseline

Audited from commit `6f5dedf386cddddaafdda3b9be2d3b1abd186fc1`.
This project is a TypeScript static-site compiler, not a C/Rust compiler.
The root and compiler READMEs, workspace manifests, TypeScript configuration,
Vitest configuration, and compiler build script were inspected first.

Pipeline:

1. **Block scanning:** `blocks.ts`, using parse5's tokenizer to lift server,
   client, style, and frontmatter blocks.
2. **Parsing:** `script.ts` (Acorn plus esbuild TypeScript stripping),
   `expression.ts` (Acorn/JSX), and `template.ts` (expression masking plus parse5).
   `document.ts` provides the Markdown/MDX path.
3. **Semantic analysis:** `scope.ts`, `ast/estree.ts`, `props.ts`, and `tsprops.ts`.
4. **Transforms/planning:** Deshi template AST and ESTree, CSS scoping/minification,
   attribute planning, and compile memoization. There is no separate optimizer IR.
5. **Emission:** `codegen.ts` and `ast/print.ts` produce ESM and evaluator code;
   `runtime.ts` and `build.ts` render and assemble static pages.

Environment: Node 22.22.3 and Bun 1.4.3. Bun was installed as external tooling;
no package manifest or lockfile changes were needed. Dependencies were installed
with `bun install --frozen-lockfile`.

Baseline:

- `bun run test`: **219 tests passed in 25 files**.
- `bun run build`: compiler, playground, and docs passed.
- `bun run typecheck`: compiler and playground passed.
- Build warnings about an empty virtual-entry chunk were present both before and
  after the fixes; they did not fail either build.

## Prioritized findings and fixes

Locations in this table refer to the **original checkout**, so they remain useful
independently of line shifts in the patch. Tests live in
`packages/compiler/src/__tests__/regressions.test.ts`.

| Rank | Severity | Original location (under `packages/compiler/src/`) | Reproduction and root cause | Fix |
| --- | --- | --- | --- | --- |
| 1 | Crash / wrong output | `expression.ts:319`; `runtime.ts:255`; `codegen.ts:138` | Named slots `constructor`, `toString`, and `__proto__` collide with inherited object properties. Bucketing calls `.push()` on non-arrays; absent slots can invoke inherited functions. A literal `"__proto__"` key also sets an emitted object's prototype. | Use null-prototype slot dictionaries, own-property runtime lookup, and computed property keys in emitted slot objects. Preserve this invariant in AST cloning, runtime bindings, and island slot wrappers. |
| 2 | Wrong code from cache | `index.ts:90` | `<p>1xb90i3</p>` and `<p>13ytnf9</p>` both hash to `4be65180`. Compiling them at the same path reused the first output because a 32-bit hash was the sole source identity. | Include exact source text in the bounded cache key; leave public CSS/file hashes unchanged. |
| 3 | Corrupted generated JS/CSS | `template.ts:329,554`; `codegen.ts:108,180` | Inline script/style text was decoded as ordinary HTML and subsequently escaped. `&&` became `&amp;&amp;`, comparisons were escaped, and tag-like string contents could disappear. JSON script contents were corrupted too. | Preserve script/style source text during template conversion and emit static text in those elements without ordinary HTML escaping. Normal text and RCDATA remain escaped. |
| 4 | Wrong component prop values | `template.ts:472` | `<Card title="" />` passed boolean `true`, not an empty string. parse5 uses `value: ''` for both bare attributes and explicit empty values. | Consult the source attribute range for an equals sign before classifying an empty parsed value as boolean. Covers both quote styles and whitespace around `=`. |
| 5 | Lost server bindings / CSS scoping | `blocks.ts:162–165` | HTML-looking frontmatter strings changed the tokenizer stack or created fake script blocks. Separately, a `<script client>` prevented server frontmatter from being synthesized. | Mask the frontmatter range before HTML tokenization, preserving offsets/newlines; only a server script conflicts with server frontmatter. Existing server-script/frontmatter warning behavior remains unchanged. |
| 6 | Valid syntax rejected | `expression.ts:60–76` | `{(1 + 2)}` and `{1 /* comment */}` were reported as unterminated. An AST node's end omits redundant outer parentheses and trailing comments. | Track Acorn's consumed token/comment boundaries rather than guessing from the AST endpoint. No AST shape changes or manual JavaScript brace scanner. |
| 7 | Stale semantic diagnostics | `index.ts:90–98,301` | Rebuilding unchanged parent source after changing a child's required props reused old diagnostics. A mutable resolver closure had the same problem. | Bypass global memoization when a component resolver is supplied. File-local compilation remains cached; the build's own per-build compiled map remains intact. |
| 8 | False scope errors | `ast/estree.ts:166–172`; `script.ts:255–258` | `(() => { if (true) { var n = 7; } return n; })()` rejected `n`. Script-level nested `var` declarations were also absent from template bindings. Only immediate declarations were collected. | Collect function/program-scoped `var` names through control-flow blocks, stopping at nested functions/classes. Do not hoist `let`/`const` or leak nested-function declarations. |

### Test-first verification

Each fix was preceded by a failing reproduction and followed by the **full** test
suite. The raw-text fixtures were corrected to enable the router (the existing
zero-JS policy otherwise rejects script tags) and use already-minified CSS; the
corrected fixtures were rerun against the pre-fix implementation and failed on
actual content corruption.

| Fix | Failing new cases before fix | Full suite after fix |
| --- | ---: | ---: |
| Slot names | 6 | 225 passed |
| Source hash collision | 1 | 226 passed |
| Raw script/style text | 3 | 230 passed |
| Explicit empty values | 3 | 233 passed |
| Frontmatter isolation | 4 | 237 passed |
| Expression boundaries | 7 | 250 passed |
| Dependency-sensitive diagnostics | 2 | 252 passed |
| Function-scoped `var` | 5 | 262 passed |

Additional passing tests cover empty/whitespace-only input, malformed expressions,
normal text/RCDATA escaping, 100-level parenthesized expressions, and scope
non-leakage. The existing deep component/slot recursion tests also still pass.

Final verification:

- **264 tests passed in 26 files** (45 added test cases).
- `bun run build`: passed for all three workspaces.
- `bun run typecheck`: passed.
- `git diff --check`: passed.

## Found but not fixed

### High: extreme HTML nesting overflows the host stack

Current locations: `template.ts:524–527,546,586–587` (recursive tree conversion).
Other subsequent AST traversals and code generation are recursive as well.

On Node 22.22.3, compiling 1,000 nested `div` elements succeeded; 2,000 caused
`RangeError: Maximum call stack size exceeded` during conversion. The exact
threshold is engine/stack dependent. Reproduce against the built public API:

```js
import { compile } from './packages/compiler/dist/index.js';
compile('<div>'.repeat(2000) + 'leaf' + '</div>'.repeat(2000), {
  file: 'deep.deshi',
});
```

**Deferred because:** fixing the root cause requires iterative traversal across
multiple passes, not merely catching `RangeError` or changing one traversal.
Introducing a hard nesting limit would need an agreed language/resource-limit
policy. No arbitrary limit or symptom-only catch was introduced in this patch.

### Medium: unmatched leading frontmatter fence gets no diagnostic

Location: `blocks.ts:56–74` (unchanged fence detection).

```js
compile('---\nconst x = 1;', { file: 'edge.deshi' }).diagnostics; // []
```

The scanner recognizes the leading fence but falls back to ordinary template
parsing when no closing fence exists, which can expose intended server text.

**Deferred pending behavior confirmation:** should a leading `---` always commit
the parser to frontmatter and produce an error when unclosed, or may it be literal
HTML text? The current README does not define this malformed-input case. The
existing behavior was not changed without agreement.

## Further testing recommended

- End-to-end browser hydration of prototype-named slots, all island strategies,
  and framework adapters. The new slot integration tests exercise server rendering;
  they do not constitute browser hydration testing.
- Iterative deep-tree handling and resource limits for HTML, JSX, Markdown, and
  semantic-analysis ASTs; broad generated-input fuzzing was not performed.
- Frontmatter delimiter grammar, malformed closing fences, and TypeScript
  diagnostic source mapping.
- Broader cache invalidation/mutability tests and performance measurements after
  disabling global caching of dependency-sensitive results.
- HTML raw-text elements beyond script/style, CSS selector edge cases, and
  Markdown/MDX-specific transforms.

This is a targeted bug-fix pass, not a claim that all compiler bugs are resolved.
