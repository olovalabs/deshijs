---
title: "Programmatic Compiler API"
description: "Complete TypeScript API reference for the Deshijs compiler programmatic compile() function, AST nodes, and exports."
---

# Programmatic Compiler API

The Deshijs compiler can be used programmatically in custom build tools, bundler plugins, and test suites via the primary `compile()` function.

## compile() Function

```ts
import { compile } from 'deshijs';

const source = `
<script>
  const message = "Hello from Programmatic API!";
</script>
<h1>{message}</h1>
`;

const result = compile(source, {
  file: 'src/page.deshi',
  minify: true,
});

console.log(result.code);        // ESM render function string
console.log(result.css.scoped);  // Scoped CSS output
console.log(result.meta);        // Analysis metadata
```

---

## CompileOptions Interface

```ts
export interface CompileOptions {
  /** Relative path from workspace root (e.g. 'src/page.deshi') */
  file: string;

  /** Whether to collapse whitespace in static template HTML (default: true) */
  minify?: boolean;

  /** Set to true if the file is a layout or template wrapper */
  isLayout?: boolean;

  /** Optional route pattern of this layout */
  segment?: string | null;

  /** Custom import specifier for runtime helpers (default: 'deshi/runtime') */
  runtimeImport?: string;

  /** Emits stable '/_deshi/<filehash>.css' URL for Vite HMR (default: false) */
  stableCssUrl?: boolean;
}
```

---

## CompileResult & Metadata

```ts
export interface CompileResult {
  code: string;               // Standalone ESM JavaScript code
  evalBody: string;           // Executable function body for Node SSR
  css: {
    scoped: string;           // Component scoped CSS rules
    global: string;           // Unscoped global rules
    hash: string;             // Stable 8-char FNV-1a hash
  };
  client?: {
    code: string;             // Island mount() module
    body: string;             // Island function body
  };
  meta: CompileMeta;          // File, slots, deps, client flags
  diagnostics: Diagnostic[];  // Warnings and syntax errors
  ast: Root;                  // Parse5 + Acorn AST root
}
```

---

## AST Node Types

The Deshi AST is composed of standard discriminated union nodes:

- **Element**: Standard HTML element with name, attrs, children, and scoped flag.
- **Component**: Capitalized imported component with props, slots, and clientStrategy.
- **Expression**: Embedded JavaScript expression with Acorn ESTree and raw string.
- **Slot**: Slot placeholder with name string and fallback child nodes.

---

## Diagnostic Interface

```ts
export interface Diagnostic {
  code: string;           // e.g. "PF4010"
  severity: 'error' | 'warning';
  message: string;
  file: string;
  line: number;
  column: number;
  frame: string;          // Pretty source snippet with caret indicator
  hint?: string;          // Actionable resolution hint
}
```
