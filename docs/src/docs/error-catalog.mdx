---
title: Diagnostic Error Catalog (PF1001 - PF6001)
description: Complete reference guide to Deshijs compiler error codes, diagnostics, causes, and how to fix them.
---

# Diagnostic Error Catalog

The Deshijs compiler emits structured, actionable diagnostics formatted as `PFxxxx` error and warning codes. Every diagnostic includes source location (line, column), a code frame pointing directly to the offending syntax, and where possible, an actionable hint on how to fix it.

---

## PF1000 Series: Lexer & Parser

Diagnostics in the `PF1000` series are raised during lexical analysis and template AST parsing.

### PF1001: Unclosed Tag
- **Severity**: Error
- **Cause**: An opening HTML tag or component tag does not have a matching closing tag before the end of the template or its parent element.
- **Example**:
  ```html
  <div class="card">
    <p>Content</p>
  <!-- Missing </div> -->
  ```
- **Fix**: Ensure all tags are properly closed, or use self-closing tags for void elements and components (e.g. `<Component />`).

### PF1002: Invalid Attribute
- **Severity**: Error
- **Cause**: Attribute syntax violates HTML/Deshi grammar (for example, missing attribute names, malformed quoted strings, or illegal characters).
- **Fix**: Verify attribute quotes and expressions:
  ```html
  <!-- Incorrect -->
  <button class="btn" disabled=>Click</button>

  <!-- Correct -->
  <button class="btn" disabled>Click</button>
  ```

### PF1003: Unterminated `{` Expression
- **Severity**: Error
- **Cause**: An opening brace `{` in a template body or attribute value was not terminated with a matching `}`.
- **Fix**: Check for unclosed braces in interpolation:
  ```html
  <!-- Incorrect -->
  <span>{user.name</span>

  <!-- Correct -->
  <span>{user.name}</span>
  ```
  > **Note**: In raw text where you want literal `{` or `}`, escape them or use `set:html`.

### PF1004: Duplicate `<script>` or `<script client>` Block
- **Severity**: Error
- **Cause**: A `.deshi` file contains more than one `<script>` (server) block or more than one `<script client>` block.
- **Fix**: Consolidate all server-side logic into a single `<script>` block and client logic into `<script client>`.

---

## PF2000 Series: Routing & Layouts

Diagnostics in the `PF2000` series relate to the file-system router (`src/app/` or `src/`).

### PF2001: Missing Root Layout
- **Severity**: Error
- **Cause**: Deshijs requires a root `layout.deshi` (or `layout.html`) at the root of the app directory.
- **Fix**: Create `src/layout.deshi` containing `<html>`, `<head>`, `<body>`, and `<slot />`.

### PF2002: Root Layout is Missing `<slot />`
- **Severity**: Error
- **Cause**: The root layout does not declare a default `<slot />` to inject page content.
- **Fix**: Add `<slot />` inside the `<body>` of your root layout.

### PF2003: Root Layout Missing `<html>`, `<head>`, or `<body>`
- **Severity**: Error
- **Cause**: Root layout must define the complete HTML document shell (`<!DOCTYPE html>`, `<html>`, `<head>`, and `<body>`).
- **Fix**: Ensure standard HTML wrapper elements exist in your root layout.

### PF2004: Duplicate Route Collision
- **Severity**: Error
- **Cause**: Two files resolve to the exact same URL output path (for example, having both `docs/routing.md` and `docs/routing/page.deshi`).
- **Fix**: Remove or rename one of the conflicting source files.

### PF2005: Invalid Route Segment Name
- **Severity**: Error
- **Cause**: A route directory or file uses an invalid dynamic or catch-all pattern (e.g., unbalanced brackets `[slug`, non-identifier param names `[123]`, or catch-all segments not at the end of the path).
- **Fix**: Route parameters must be valid JavaScript identifiers (e.g. `[slug]`, `[...rest]`, `[[...optional]]`).

### PF2010: Unsupported Convention (Parallel Routes)
- **Severity**: Error
- **Cause**: A file named `default.deshi` or `default.html` was detected. Deshijs static generation does not support parallel routes.
- **Fix**: Remove `default.*` and structure nested routes directly.

### PF2011: Ignored File (SSR / Middleware)
- **Severity**: Warning
- **Cause**: Files such as `loading.deshi`, `error.deshi`, `middleware.ts`, or `route.ts` have no meaning in a pure static site (SSG) and are ignored by the compiler.
- **Fix**: Remove SSR-specific files or migrate their logic into static layouts and build-time scripts.

### PF2012: Ignored Export in Static Mode
- **Severity**: Warning
- **Cause**: Exports such as `prerender = false`, `revalidate`, or `runtime` were detected. Deshijs is strictly an SSG compiler.
- **Fix**: Remove dynamic server runtime exports.

---

## PF3000 Series: Static Generation & Params

### PF3001: Dynamic Page Without `getStaticParams()`
- **Severity**: Error
- **Cause**: A page path contains dynamic parameters (e.g., `blog/[slug]/page.deshi`), but the page does not export a `getStaticParams()` function.
- **Fix**: Export `getStaticParams()` from your page script returning an array of parameter objects:
  ```ts
  export async function getStaticParams() {
    return [
      { slug: 'hello-world' },
      { slug: 'announcement' }
    ];
  }
  ```

### PF3002: `getStaticParams()` Returned Bad Shape
- **Severity**: Error
- **Cause**: `getStaticParams()` returned something other than an array of objects or was missing expected param keys.
- **Fix**: Ensure the function returns `Promise<Array<Record<string, string>>>`.

### PF3003: Page `<script>` Body Threw at Build Time
- **Severity**: Error
- **Cause**: An unhandled exception was thrown while executing the server `<script>` block during static compilation.
- **Fix**: Inspect the stack trace in your terminal to fix runtime bugs, network errors in build-time `fetch()`, or undefined property access.

### PF3004: `getStaticParams()` Threw
- **Severity**: Error
- **Cause**: The `getStaticParams()` function threw an uncaught error (such as a database query failure or malformed API response).
- **Fix**: Add try/catch blocks and verify external data sources during build time.

---

## PF4000 Series: Expressions, Components & Directives

### PF4001: Expression Syntax Error
- **Severity**: Error
- **Cause**: An interpolation expression `{ ... }` failed JavaScript / ESTree parsing.
- **Fix**: Verify JavaScript syntax inside braces.

### PF4002: Component Nesting Deeper Than 50
- **Severity**: Error
- **Cause**: Maximum recursion depth exceeded (likely caused by recursive components without a base condition).
- **Fix**: Add a termination guard to recursive component rendering.

### PF4003: Component Import Cycle
- **Severity**: Error
- **Cause**: Component A imports Component B which imports Component A.
- **Fix**: Break the circular dependency by extracting shared templates or layout slots.

### PF4004: Component File Not Found
- **Severity**: Error
- **Cause**: An imported `.deshi` component path could not be resolved on disk.
- **Fix**: Verify relative import paths and file extensions (`import Button from './Button.deshi'`).

### PF4005: Unknown Slot Name
- **Severity**: Warning / Error
- **Cause**: Content was passed with `<div slot="sidebar">`, but the child component has no `<slot name="sidebar" />`.
- **Fix**: Verify slot names declared in child components.

### PF4010: Unresolved Identifier in Template Expression
- **Severity**: Error
- **Cause**: A template references a variable that was not declared in `<script>`, not passed in `props`, and not present in global scope.
- **Fix**: Declare the variable in `<script>` or pass it via `props`.

### PF4011: Function Value Interpolated
- **Severity**: Error
- **Cause**: A function was directly interpolated into HTML (`<span>{handleClick}</span>`).
- **Fix**: Execute the function (`<span>{handleClick()}</span>`) or bind it to an event directive inside an island (`<button client:click onclick={handleClick}>`).

### PF4020: Component Import Must Be Capitalized
- **Severity**: Error
- **Cause**: A `.deshi` component was imported with a lowercase identifier (e.g., `import button from './button.deshi'`).
- **Fix**: Capitalize component identifiers (e.g., `import Button from './button.deshi'`).

### PF4021: Forbidden Export in Component
- **Severity**: Error
- **Cause**: Components cannot export reserved identifiers or disallowed symbols.

### PF4022: React-Style Attribute Used
- **Severity**: Error
- **Cause**: Used `className="..."` or `htmlFor="..."` instead of standard HTML `class="..."` and `for="..."`.
- **Fix**: Use standard HTML attributes:
  ```html
  <!-- Incorrect -->
  <label className="text-sm" htmlFor="email">Email</label>

  <!-- Correct -->
  <label class="text-sm" for="email">Email</label>
  ```

### PF4023: `set:html` on Element with Children
- **Severity**: Error
- **Cause**: An element uses `set:html={content}` but also contains child DOM nodes.
- **Fix**: Elements using `set:html` or `set:text` must be empty self-closing or child-free elements.

### PF4024: Capitalized Tag is Not an Imported Component
- **Severity**: Error
- **Cause**: A capitalized tag `<CustomCard>` was used in the template, but no component by that name was imported in `<script>`.
- **Fix**: Import the component at the top of your `<script>` block.

### PF4025: `<head>` Block Inside Root Layout Body
- **Severity**: Error
- **Cause**: A `<head>` block was placed inside `<body>` in the root layout.
- **Fix**: Move `<head>` to the document root level before `<body>`.

### PF4026: Invalid `client:*` Directive
- **Severity**: Error
- **Cause**: An unrecognized hydration directive was specified (supported: `client:load`, `client:visible`, `client:idle`, `client:media`, `client:only`, `client:click`).
- **Fix**: Use a supported island hydration strategy.

### PF4027: Invalid `transition:*` Directive
- **Severity**: Error
- **Cause**: Malformed View Transition directive.
- **Fix**: Use `transition:name="unique-name"` or `transition:persist`.

### PF4028: Invalid `define:vars` Directive
- **Severity**: Error
- **Cause**: `define:vars` was passed an invalid object shape or expression.
- **Fix**: Pass a plain object mapping CSS variables to values: `<style define:vars={{ brandColor, bgOpacity }}>`.

---

## PF5000 Series: Build & Assets

### PF5001: Forbidden `<script>` in Zero-JS Mode
- **Severity**: Error
- **Cause**: A raw `<script>` tag with executable client code was used in a static page without marking it as an island or client directive.
- **Fix**: Use `<script client>` or island hydration directives.

### PF5002: Asset Not Found
- **Severity**: Error
- **Cause**: A referenced static asset, stylesheet, or image in `public/` or `assets/` could not be located during build.
- **Fix**: Check file path and casing in `public/`.

### PF5003: Client Chunk Missing from Manifest
- **Severity**: Error
- **Cause**: Vite client bundle manifest did not produce the expected client entry for an island.
- **Fix**: Verify island imports and Vite build configuration.

---

## PF6000 Series: Configuration

### PF6001: Config Error
- **Severity**: Error
- **Cause**: `deshi.config.ts` or `deshi.config.js` has a syntax error, invalid export, or invalid property types.
- **Fix**: Ensure default export matches `defineConfig({ ... })` schema.
