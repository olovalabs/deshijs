Role: You are an expert Lit framework architect specializing in partial hydration and island architectures.

Task: Implement a custom island hydration system for our Lit-based framework called "Deshi". This system must replicate Astro’s per-component client directives (client:load, client:visible, client:idle) while maintaining zero JS by default for non-interactive components.

CORE REQUIREMENTS

1. Per-Usage Strategy, Not Per-Component
The hydration strategy is determined at the usage site, not inside the component definition. The same <deshi-card> component can be used 4 times on one page with 4 different strategies. Each usage is an independent island.

2. Compile-Time HTML Output
During SSR/build, the compiler must output semantic HTML with a data attribute encoding the strategy:

<deshi-island data-strategy="visible" data-component="card">
  <!-- Server-rendered Lit component HTML here -->
</deshi-island>

- No strategy maps, no render-arg threading ($cs), no per-page mount chunks, no router special-casing.
- Components without any client:* directive must output plain HTML with zero JavaScript.

3. Single Static Runtime
Create exactly one runtime file: /_deshi/islands.js. This file must:
- On load: Immediately import and mount the component.
- On visible: Use IntersectionObserver to mount when the element enters viewport.
- On idle: Use requestIdleCallback (with fallback to setTimeout) to mount when browser is free.
- Re-scan for new islands on deshi:navigated custom event (for SPA navigation without full reload).
- Clean up observers/callbacks on unmount/navigation.

4. Required Syntax Support
The template/compiler must support these directives on any Deshi component:

<Card client:load />
<Card client:visible />
<Card client:idle />
<Card client:props={{ step: 1 }} />

Props passed via client:props must be serialized into the SSR HTML and restored during hydration.

5. Error Handling (PF4026)
Throw compile-time/runtime errors with code PF4026 for:
- Unknown directive (e.g., client:foo)
- Directive with unexpected value (e.g., client:load="true")
- Two strategies on one usage (e.g., client:load client:visible)
- client:* used on non-Deshi components (plain HTML elements)

6. Zero JS Default Guarantee
If a page has no client:* directives, the final build output must contain absolutely no JavaScript. Do not inject the islands runtime unless at least one island exists on the page.

7. Navigation Compatibility
Islands must work correctly in three scenarios:
- Direct URL visit (full page load)
- Browser refresh
- SPA navigation via Deshi router (no full reload, triggers deshi:navigated)

VERIFICATION CHECKLIST

Before considering this task complete, verify ALL of the following:
- tsc --noEmit passes with zero errors
- npm run build completes successfully
- /counter test route works correctly:
  - client:load counter hydrates immediately on page load
  - client:visible counter shows false/static until scrolled into view, then hydrates
  - client:idle counter shows false/static until browser idle, then hydrates
  - Clicking "+1" works correctly after hydration for all three strategies
  - No console errors or warnings in any scenario
- Page with zero client:* directives produces 0 KB JS in build output
- SPA navigation to /counter properly hydrates islands without full page reload
- PF4026 errors trigger correctly for all invalid directive cases

DELIVERABLES

1. Compiler/transform plugin that processes client:* directives during SSR
2. /_deshi/islands.js runtime file
3. Type definitions for the directives
4. Test route /counter demonstrating all three strategies
5. Documentation comment block explaining the architecture

Do not deviate from these rules. Do not add extra abstractions. Keep the runtime minimal and the compile output predictable.