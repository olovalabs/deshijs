// Stage 3 — <script> analysis with acorn: imports (hoisted), exports (recognized /
// forbidden), body (inlined into render) and top-level bindings (scope analysis).
// Full TypeScript is accepted: plain JS parses directly (exact diagnostics);
// anything else is stripped to JS with esbuild (Vite's own TS engine) and
// re-parsed, so every .deshi compiles with types and none leak into output.
import * as acorn from 'acorn';
import { transformSync } from 'esbuild';
import { fail, makeDiagnostic, type Diagnostic } from './types';
import { ACORN_OPTIONS, JsxParser, isComponentName } from './expression';

export interface ImportSpec {
  imported: string; // 'default' | '*' | name
  local: string;
}
export interface ImportInfo {
  source: string;
  specifiers: ImportSpec[];
  isComponent: boolean;
  start: number;
  end: number;
}
export interface ScriptInfo {
  imports: ImportInfo[];
  /** source of the hoisted `getStaticParams` declaration (without `export`) */
  staticParams?: string;
  body: string;
  bindings: string[];
  components: Set<string>;
  diagnostics: Diagnostic[];
}

const IGNORED_EXPORTS = new Set(['prerender', 'dynamic', 'revalidate', 'runtime']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

export function patternNames(p: AnyNode, out: string[] = []): string[] {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier':
      out.push(p.name);
      break;
    case 'ObjectPattern':
      for (const prop of p.properties) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      break;
    case 'ArrayPattern':
      for (const el of p.elements) patternNames(el, out);
      break;
    case 'RestElement':
      patternNames(p.argument, out);
      break;
    case 'AssignmentPattern':
      patternNames(p.left, out);
      break;
  }
  return out;
}

function declarationNames(decl: AnyNode): string[] {
  if (!decl) return [];
  if (decl.type === 'VariableDeclaration') {
    const out: string[] = [];
    for (const d of decl.declarations) patternNames(d.id, out);
    return out;
  }
  if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') return decl.id ? [decl.id.name] : [];
  return [];
}

export function emptyScript(): ScriptInfo {
  return { imports: [], body: '', bindings: [], components: new Set(), diagnostics: [] };
}

// Re-export helper for external tools (e.g. content collections)

export function analyzeScript(code: string, file: string, fullSource: string, offset: number): ScriptInfo {
  // Fast path: plain JS parses directly with exact error positions.
  let program: acorn.Program;
  let src = code;
  try {
    program = acorn.parse(code, ACORN_OPTIONS);
  } catch (rawErr) {
    // TypeScript (or JSX): strip types, then re-parse with the JSX-tolerant
    // parser. All slicing below uses the stripped source, so no types leak
    // into imports, bodies, or rendered output. Positions are approximate
    // for TS (columns shift where types were erased); the raw error below
    // still points at the exact source offset when stripping also fails.
    const err = rawErr as { pos?: number; message: string };
    try {
      // verbatimModuleSyntax: every value import is preserved verbatim
      // (component imports stay detectable), while `import type` / `export
      // type` / interfaces are erased. Rule for users: import types with
      // `import type` — same as TypeScript's own verbatim mode.
      src = transformSync(code, {
        loader: 'tsx',
        format: 'esm',
        tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      }).code;
      program = JsxParser.parse(src, ACORN_OPTIONS) as acorn.Program;
    } catch {
      fail('PF4001', `<script> syntax error: ${err.message.replace(/ \(\d+:\d+\)$/, '')}`, file, fullSource, offset + (err.pos ?? 0));
    }
  }

  const info = emptyScript();
  const bodyParts: string[] = [];

  for (const stmt of program.body as AnyNode[]) {
    const at = offset + stmt.start;
    switch (stmt.type) {
      case 'ImportDeclaration': {
        const source = String(stmt.source.value);
        const isComponent = source.endsWith('.deshi') || source.endsWith('.html') || source.endsWith('.md');
        const specifiers: ImportSpec[] = stmt.specifiers.map((s: AnyNode) => ({
          imported:
            s.type === 'ImportDefaultSpecifier' ? 'default'
            : s.type === 'ImportNamespaceSpecifier' ? '*'
            : (s.imported.type === 'Identifier' ? s.imported.name : String(s.imported.value)),
          local: s.local.name,
        }));
        if (isComponent) {
          for (const s of specifiers) {
            if (s.imported !== 'default') {
              fail('PF4021', `Components only have a default export; "${s.imported}" cannot be imported from ${source}`, file, fullSource, at);
            }
            if (!isComponentName(s.local)) {
              fail('PF4020', `Component import "${s.local}" must be capitalized so it can be used as a tag`, file, fullSource, at,
                `Rename it to "${s.local[0].toUpperCase()}${s.local.slice(1)}".`);
            }
            info.components.add(s.local);
          }
        }
        for (const s of specifiers) info.bindings.push(s.local);
        info.imports.push({ source, specifiers, isComponent, start: stmt.start, end: stmt.end });
        break;
      }
      case 'ExportNamedDeclaration': {
        const names = declarationNames(stmt.declaration);
        if (!stmt.declaration && stmt.specifiers?.length) {
          for (const s of stmt.specifiers) names.push(s.exported.name ?? String(s.exported.value));
        }
        // Astro parity: getStaticPaths is an alias for getStaticParams
        const isStatic = names.length === 1 && (names[0] === 'getStaticParams' || names[0] === 'getStaticPaths');
        if (isStatic && stmt.declaration) {
          let body = src.slice(stmt.declaration.start, stmt.declaration.end);
          // Normalize getStaticPaths → getStaticParams so the rest of the compiler stays unified
          if (names[0] === 'getStaticPaths') body = body.replace(/getStaticPaths/, 'getStaticParams');
          info.staticParams = body;
          info.bindings.push('getStaticParams');
          // Also push getStaticPaths for compat diagnostics (so `Astro` style works)
          info.bindings.push('getStaticPaths');
          break;
        }
        // Also support `export const getStaticPaths = ...` without declaration wrapper? fallback for variable
        if (names.length === 1 && (names[0] === 'getStaticPaths' || names[0] === 'getStaticParams') && stmt.declaration?.type === 'VariableDeclaration') {
          const body = src.slice(stmt.declaration.start, stmt.declaration.end).replace(/getStaticPaths/, 'getStaticParams');
          info.staticParams = body;
          info.bindings.push('getStaticParams');
          break;
        }
        if (names.length && names.every((n) => IGNORED_EXPORTS.has(n))) {
          info.diagnostics.push(
            makeDiagnostic('PF2012', `export "${names.join(', ')}" is ignored — Deshi is SSG only`, file, fullSource, at, 'warning'),
          );
          if (stmt.declaration) {
            bodyParts.push(src.slice(stmt.declaration.start, stmt.declaration.end));
            info.bindings.push(...names);
          }
          break;
        }
        fail('PF4021', `Forbidden export "${names.join(', ') || '(re-export)'}" — components are not modules; only getStaticParams may be exported`, file, fullSource, at);
        break;
      }
      case 'ExportDefaultDeclaration':
      case 'ExportAllDeclaration':
        fail('PF4021', 'Forbidden export — components are not modules; only getStaticParams may be exported', file, fullSource, at);
        break;
      default: {
        info.bindings.push(...declarationNames(stmt));
        bodyParts.push(src.slice(stmt.start, stmt.end));
      }
    }
  }
  info.body = bodyParts.join('\n');
  return info;
}
