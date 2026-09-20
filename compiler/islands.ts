/**
 * Per-island hydration boot — Astro-style, no shared islands.js.
 *
 * Build time: client:* on a component usage marks an island and emits a
 * dedicated /_deshi/c/<Name>.<hash>.js chunk (the component's <script client>).
 * Pages without client:* send 0 bytes of island JS.
 *
 * Runtime: each island gets an inline type=module script that implements only
 * that usage's strategy, then import()s its chunk. Strategies not used on the
 * page are not shipped.
 */

import type { ClientStrategy } from './types';

/** Alias kept at the definition site so `runtime.ts` can type its
 * `strategy` param without a circular *value* import (type-only). */
export type IslandStrategy = ClientStrategy;

export function stampIslandRoot(html: string, id: string): string {
  const m = html.match(/^(\s*<[A-Za-z][^\s>/]*)([^>]*?)(\/?>)/);
  if (!m) return `<div id="${id}" style="display:contents">${html}</div>`;
  const before = m[1] + m[2];
  if (/\sid\s*=/i.test(before)) {
    return html.replace(m[0], () => `${m[1]}${m[2]} data-deshi-i="${id}"${m[3]}`);
  }
  return html.replace(m[0], () => `${m[1]}${m[2]} id="${id}"${m[3]}`);
}

function findRoot(id: string): string {
  const j = js(id);
  return `document.getElementById(${j})||document.querySelector("[data-deshi-i="+JSON.stringify(${j})+"]")`;
}

/** JSON-encode a string for inline `<script>`: `JSON.stringify` leaves
 * `</script>` literal, which would break out of the script block — escape
 * `<`, `>`, `&` and line separators as unicode escapes. */
function js(s: string): string {
  return JSON.stringify(s).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function hydrate(src: string): string {
  return `if(r.dataset.deshiHydrated)return Promise.resolve();r.dataset.deshiHydrated="1";return import(${js(src)}).then(m=>{let p={};try{p=JSON.parse(r.getAttribute("data-deshi-props")||"{}")}catch(e){}if(m&&typeof m.default==="function")m.default(r,{props:p,url:location.href})})`;
}

export { js as jsForInlineScript };

/** Inline `<script type="module">` for one island usage.
 * `strategy` is typed as the `ClientStrategy` union so a typo'd strategy is a
 * compile error instead of silently falling through to `load`. */
export function islandInlineScript(
  id: string,
  src: string,
  strategy: ClientStrategy,
  media?: string,
): string {
  if (strategy === 'media' && !media) {
    throw new Error('PF4026: client:media requires a value: client:media="(max-width: 600px)"');
  }
  if (strategy === 'only') {
    return `<script type="module">import m from ${js(src)};const r=${findRoot(id)};if(r){let p={};try{p=JSON.parse(r.getAttribute("data-deshi-props")||"{}")}catch(e){}if(m&&typeof m.default==="function")m.default(r,{props:p,url:location.href});r.dataset.deshiHydrated="1"}</script>`;
  }
  const get = `const r=${findRoot(id)};if(!r)return;`;
  const go = hydrate(src);
  let body: string;
  switch (strategy) {
    case 'visible':
      body = `${get}const run=()=>{${go}};if(!("IntersectionObserver"in window))run();else{const o=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){o.disconnect();run();break}});o.observe(r)}`;
      break;
    case 'idle':
      body = `${get}const run=()=>{${go}};const idle=()=>"requestIdleCallback"in window?requestIdleCallback(run,{timeout:2e3}):setTimeout(run,200);if(!("IntersectionObserver"in window))idle();else{const o=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){o.disconnect();idle();break}});o.observe(r)}`;
      break;
    case 'media': {
      const q = js(media || '');
      body = `${get}const run=()=>{${go}};const q=${q};if(!q||!matchMedia)run();else{const mq=matchMedia(q);if(mq.matches)run();else mq.addEventListener("change",function h(){if(mq.matches){mq.removeEventListener("change",h);run()}})}`;
      break;
    }
    case 'click':
      body = `${get}r.addEventListener("click",function(e){if(r.dataset.deshiHydrated)return;const t=e.target;(async()=>{${go}})().then(()=>{t&&t.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}))})},true)`;
      break;
    case 'load':
    default:
      body = `${get}${go}`;
      break;
  }
  return `<script type="module">(async()=>{${body}})()</script>`;
}
