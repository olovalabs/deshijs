---
title: "Compiler Architecture & Pipeline"
description: "In-depth breakdown of the Deshijs 7-stage compiler pipeline and static site generation engine."
---

# Compiler Architecture & Pipeline

The Deshijs compiler compiles `.deshi` and `.md` files into deterministic, asynchronous ESM render modules. Understanding the 7-stage compilation pipeline helps you write efficient templates and debug diagnostics.

## Pipeline Overview

Whenever `compile(source, options)` is invoked in `deshijs`, the source undergoes seven distinct transformation phases:

| Stage | Module | Responsibility |
| --- | --- | --- |
| **01. Block Splitting** | `blocks.ts` | Parse5 Tokenizer lifts `<script>`, `<script client>`, and `<style>` blocks (and `---` frontmatter). |
| **02. Script Analysis** | `script.ts` | Acorn AST analysis extracts imports, `getStaticParams`, bindings, and erases TS types via esbuild. |
| **03. CSS Scoping** | `css.ts` | `css-tree` rewrites selectors with deterministic FNV-1a 32-bit hash `[data-deshi-<hash>]`. |
| **04. Template Parsing** | `template.ts` | Tokenizes `{}` JS expressions, parses JSX into AST, handles void elements and slots. |
| **05. Island Detection** | `islands.ts` | Usage-site `client:*` analysis, root element stamping, inline bootstrap emitter. |
| **06. Scope Validation** | `scope.ts` | Validates all identifiers against script, globals, and implicit scopes (`PF4010`). |
| **07. ESM Codegen** | `codegen.ts` | Produces ESM render function module string with asynchronous template concatenation. |

---

## Stage 1: Block Splitting (blocks.ts)

Unlike naive regular expression matchers that break on nested code or strings, Deshijs uses **Parse5's low-level streaming Tokenizer** (not the tree builder). This guarantees that top-level blocks in layout files—even when placed outside `<html>`—are accurately lifted while strictly preserving original byte offsets:

- `<script>`: Server/build-time JavaScript or TypeScript code. Maximum of one block allowed per file (`PF1004`).
- `<script client>`: Island hydration body executed on the browser.
- `<style>`: Scoped CSS block (or unscoped when decorated with `global` or `is:inline`).
- `--- frontmatter ---`: Astro-parity frontmatter fences at the top of the file are recognized and converted into an equivalent `<script>` block.

---

## Stage 2: Script Analysis (script.ts)

The extracted script is analyzed using **Acorn**. Deshijs accepts full TypeScript: if plain JS parsing succeeds, exact diagnostics are preserved; if TypeScript features (types, interfaces, generics) are present, `esbuild` strips types with `verbatimModuleSyntax`, and Acorn re-parses the stripped AST:

- **Imports Hoisting**: Detects component imports (`.deshi`, `.html`, `.md`) and validates capitalization (`PF4020`).
- **Exports Validation**: Components only allow `export async function getStaticParams` (or `getStaticPaths`). Other exports trigger `PF4021`.
- **Top-Level Bindings**: Records all declared identifiers (variables, functions, classes) for template scope checking.
- **Body Inlining**: Prepares remaining statements for inlining directly into the render function.

---

## Stage 3: Scoped CSS Transform (css.ts)

CSS styles are transformed at compile time using `css-tree`. A stable 8-character FNV-1a hash is derived from the component's file path. The attribute `[data-deshi-<hash>]` is inserted before pseudo-classes and pseudo-elements:

```css
/* Input CSS inside <style> */
button.btn { background: blue; }
.card:hover { transform: translateY(-2px); }

/* Output Scoped CSS (Zero Runtime overhead) */
button.btn[data-deshi-35c21378] { background: blue; }
.card[data-deshi-35c21378]:hover { transform: translateY(-2px); }
```

---

## Stage 4: Template Parsing (template.ts)

A custom pretokenizer scans the template, identifying JavaScript expressions delimited by `{ ... }`. Each expression is parsed with Acorn at that exact byte offset so JS syntax dictates closing braces rather than naive regex counting. Expressions are replaced with inert tokens (`deshi__e0__`) so Parse5 can construct the HTML tree without syntax confusion.

---

## Stage 5: Island Detection (islands.ts)

Whenever an imported component has a `client:*` directive at its call site, the compiler registers an Island. It assigns a deterministic ID, stamps the rendered HTML root with `id` or `data-deshi-i`, and emits an inline `<script type="module">` containing only the code necessary for that specific hydration strategy:

- `client:load`: Hydrates immediately on window load (`<link rel="modulepreload">` generated).
- `client:visible`: Hydrates when component enters viewport via `IntersectionObserver`.
- `client:idle`: Hydrates when browser is idle via `requestIdleCallback`.
- `client:media="(query)"`: Hydrates only when media query matches.
- `client:click`: Hydrates on first user click.
- `client:only`: Skips SSR completely, client mounts directly.

---

## Stage 6: Scope Analysis (scope.ts)

Every variable used inside a template expression is checked at compile time. It must resolve to one of:

1. A top-level binding from the `<script>` block.
2. An implicit binding: `props`, `slots`, `params`, `url`, `route`, `env`, `Astro`.
3. A local expression parameter (e.g. `item` inside `items.map(item => ...)`).
4. A standard JavaScript global whitelist (`JSON`, `Math`, `Date`, `fetch`, `Response`, etc.).

Any undefined identifier immediately produces diagnostic `PF4010` with a code frame and fix hint.

---

## Stage 7: Codegen (codegen.ts)

The AST is converted into high-speed asynchronous string concatenation. Static HTML segments become string literals, expressions are interpolated via the runtime's `esc()` helper (which escapes HTML and resolves promises/arrays), and component invocations call `renderComponent()`.

---

## SSG Build Engine (build.ts)

When you run `vite build`, the static build engine:

1. Scans all route files in `src/` using `routes.ts`.
2. Identifies and validates dynamic routes, invoking `getStaticParams()` to discover all static URL permutations.
3. Resolves the nested layout chain for each route (`root layout -> nested layouts -> page`).
4. Evaluates the compiled render module tree in Node.js.
5. Collects lifted `<head>` blocks, aggregates CSS, injects preloads and client router scripts.
6. Emits formatted static HTML into `dist/`.
