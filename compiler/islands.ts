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

export function stampIslandRoot(html: string, id: string): string {
  const m = html.match(/^(\s*<[A-Za-z][^\s>/]*)([^>]*)(\/?>)/);
  if (!m) return `<div id="${id}" style="display:contents">${html}</div>`;
  const before = m[1] + m[2];
  if (/\sid\s*=/i.test(before)) {
    return html.replace(m[0], `${m[1]}${m[2]} data-deshi-i="${id}"${m[3]}`);
  }
  return html.replace(m[0], `${m[1]}${m[2]} id="${id}"${m[3]}`);
}

function findRoot(id: string): string {
  const j = JSON.stringify(id);
  return `document.getElementById(${j})||document.querySelector("[data-deshi-i="+JSON.stringify(${j})+"]")`;
}

function hydrate(src: string): string {
  return `if(r.dataset.deshiHydrated)return Promise.resolve();r.dataset.deshiHydrated="1";return import(${JSON.stringify(src)}).then(m=>{let p={};try{p=JSON.parse(r.getAttribute("data-deshi-props")||"{}")}catch(e){}if(m&&typeof m.default==="function")m.default(r,{props:p,url:location.href})})`;
}

/** Inline `<script type="module">` for one island usage. */
export function islandInlineScript(id: string, src: string, strategy: string, media?: string): string {
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
      const q = JSON.stringify(media || '');
      body = `${get}const run=()=>{${go}};const q=${q};if(!q||!matchMedia)run();else{const mq=matchMedia(q);if(mq.matches)run();else mq.addEventListener("change",function h(){if(mq.matches){mq.removeEventListener("change",h);run()}})}`;
      break;
    }
    case 'click':
      body = `${get}r.addEventListener("click",function(e){if(r.dataset.deshiHydrated)return;const t=e.target;(async()=>{${go}})().then(()=>{t&&t.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}))})},true)`;
      break;
    case 'only':
    case 'load':
    default:
      body = `${get}${go}`;
      break;
  }
  return `<script type="module">(async()=>{${body}})()</script>`;
}
