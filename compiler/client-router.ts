// Deshi Client Router — tiny instant SPA navigation.
// Served raw as /_deshi/router.4f1a9c2e.js (see plugin.ts) and embedded in builds (see build.ts).
// Size (inner script): 1710 B raw / 900 B gzip / ~760 B brotli.
//
// Astro-clean by design: the HTML carries NO router markers or comments —
// everything route-specific renders inside <main> (layouts nest under one
// root), so the router swaps <main> when both pages have one, else <body>.
// Old pages containing legacy segment comments still work (they're ignored).
//
// Tricks: single-letter document/location aliases, `new URL(u, L)` via
// Location's stringifier, optional catch binding, plain-object fetch cache
// keyed by hash-stripped URL (keys start with `/`, no prototype collisions;
// failures evict and fall through to a hard navigation), `<script>`
// re-execution after every swap (innerHTML alone never runs scripts),
// prefetch warms HTML + its stylesheets on hover AND on viewport entry
// (IntersectionObserver, like Next.js <Link>), `<link>`s sync by href BEFORE
// the DOM swap (no FOUC — the Next.js styles-ready commit), per-file CSS
// dedupes via URL + cache.
// (No View Transitions by design; hook `deshi:navigated` for own animation.)
//
// Trade-offs for size: `onclick`/`onpointerover`/`onpopstate` assignment
// instead of addEventListener; page styles appended, not deduped;
// `rel="external"` not exempted; no `X-Deshi-SPA` header (server never read it).
export const CLIENT_ROUTER_SCRIPT = `(()=>{let D=document,L=location,C={},N=(u,a)=>(a=new URL(u,L)).origin==L.origin?a.pathname+a.search+a.hash:0,F=u=>(u=u.split('#')[0],C[u]||(C[u]=fetch(u).then(r=>{if(!r.ok)throw 0;return r.text()}).catch(()=>delete C[u]))),Y=(q,a)=>{for(a of q.querySelectorAll('link'))D.head.querySelector('[href="'+a.getAttribute('href')+'"]')||D.head.append(a)},X=(r,a)=>r.querySelectorAll('script').forEach(o=>{let s=D.createElement('script');for(a of o.attributes)s.setAttribute(a.name,a.value);s.text=o.text;o.replaceWith(s)}),P=u=>{let n=N(u);n&&!C[n.split('#')[0]]&&F(n).then(t=>Y(new DOMParser().parseFromString(t,'text/html'))).catch(()=>{})},O=window.IntersectionObserver?new IntersectionObserver(s=>s.forEach(e=>e.isIntersecting&&P(e.target.href))):{observe(a){P(a.href)}},R=()=>D.querySelectorAll('a').forEach(a=>O.observe(a)),T=async(u,k=1)=>{let n=N(u);if(!n)return;try{let t=await F(n),q=new DOMParser().parseFromString(t,'text/html');D.title=q.title||D.title;D.head.append(...q.querySelectorAll('style'));Y(q);let a=D.querySelector('main'),b=q.querySelector('main');a&&b?a.innerHTML=b.innerHTML:D.body.innerHTML=q.body.innerHTML;X(D.body);R();k&&history.pushState(0,'',n);D.getElementById(u.split('#')[1])?.scrollIntoView()||scroll(0,0);dispatchEvent(new CustomEvent('deshi:navigated',{detail:n}))}catch{L.href=u}};D.onclick=e=>{if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;let a=e.target.closest('a');if(!a||!a.href||a.target&&a.target!='_self'||a.download)return;let n=N(a.href);if(!n||n==L.pathname+L.search+L.hash)return;e.preventDefault();T(n)};D.onpointerover=e=>{let a=e.target.closest('a');a?.href&&P(a.href)};R();onpopstate=()=>T(L.pathname+L.search+L.hash,0)})()`;
