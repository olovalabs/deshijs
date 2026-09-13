/**
 * Deshi island hydration v2 — Astro parity. Single static runtime: /_deshi/islands.js (≈1.2kB gzip)
 *
 * SSG emits <deshi-island data-strategy data-component data-src data-media data-only>. Strategies:
 *   load    — import immediately (modulepreload from SSR)
 *   visible — IntersectionObserver on inner box (Astro client:visible)
 *   idle    — visible + requestIdleCallback (Astro client:idle)
 *   media   — matchMedia(query) (Astro client:media)
 *   only    — client-only, no SSR expectation (Astro client:only), hydrates on idle/visible
 *   click   — first click (queued + replayed)
 *
 * View-transition aware: re-scan on deshi:navigated, queue click replay.
 */
export const ISLANDS_RUNTIME = `const M='data-deshi-hydrated';
let C=[],Q=[],R=0;
function css(){
 if(document.getElementById('deshi-island-css'))return;
 let s=document.createElement('style');
 s.id='deshi-island-css';s.textContent='deshi-island{display:block}';
 (document.head||document.documentElement).appendChild(s);
}
function box(e){return e.querySelector('[data-deshi-c]')||e.firstElementChild||e}
function vp(e){let r=e.getBoundingClientRect(),vh=innerHeight||document.documentElement.clientHeight,vw=innerWidth||document.documentElement.clientWidth;return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<vh&&r.left<vw}
function cl(){for(let i=0;i<C.length;i++)try{C[i]()}catch(e){}C=[]}
function mount(I){
 if(I.getAttribute(M)==='1'||I.getAttribute(M)==='pending')return I._d||Promise.resolve();
 let n=I.querySelector('[data-deshi-c]');if(!n)return Promise.resolve();
 let src=I.getAttribute('data-src')||('/_deshi/c/'+(I.getAttribute('data-component')||'')+'.'+(n.getAttribute('data-deshi-c')||'')+'.js');
 I.setAttribute(M,'pending');
 let props=(()=>{try{return JSON.parse(n.getAttribute('data-deshi-props')||'{}')}catch(e){return{}}})();
 I._d=import(/* @vite-ignore */ src).then(m=>{
  let fn=m&&m.default;if(typeof fn==='function')fn(n,{props:props,url:location.href});
  I.setAttribute(M,'1');replay(I);
 }).catch(e=>{I.removeAttribute(M);I._d=null;console.error('[deshi] island failed',src,e)});
 return I._d;
}
function replay(I){
 let rest=[];R=1;
 try{for(let i=0;i<Q.length;i++){let q=Q[i];if(q.I!==I){rest.push(q);continue}if(q.el&&q.el.isConnected)q.el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}))}}
 finally{R=0}Q.length=0;for(let i=0;i<rest.length;i++)Q.push(rest[i]);
}
function vis(I,cb){
 let el=box(I),d=0,io=null;let f=()=>{if(d)return;d=1;if(io)io.disconnect();cb()};
 if('IntersectionObserver' in window){
  io=new IntersectionObserver(es=>{for(let j=0;j<es.length;j++)if(es[j].isIntersecting||es[j].intersectionRatio>0){f();break}},{root:null,rootMargin:'0px',threshold:0});
  io.observe(el);
 }
 if(!io||vp(el))f();
 C.push(()=>{d=1;if(io)io.disconnect()});
}
function idle(cb){
 if('requestIdleCallback' in window){let id=requestIdleCallback(()=>cb(),{timeout:2000});C.push(()=>cancelIdleCallback(id))}
 else{let t=setTimeout(cb,200);C.push(()=>clearTimeout(t))}
}
function media(q,cb){
 if(!q||!('matchMedia' in window))return cb();
 let m=matchMedia(q);if(m.matches)return cb();
 let h=()=>{if(m.matches){m.removeEventListener?m.removeEventListener('change',h):m.removeListener(h);cb()}};
 try{m.addEventListener?m.addEventListener('change',h):m.addListener(h);C.push(()=>{try{m.removeEventListener?m.removeEventListener('change',h):m.removeListener(h)}catch(e){}})}catch(e){cb()}
}
export function scan(r){
 css();
 let s=r||document;
 let islands=s.querySelectorAll?s.querySelectorAll('deshi-island:not(['+M+'="1"])'):[];
 for(let i=0;i<islands.length;i++){(function(I){
  if(I.getAttribute(M)==='pending')return;
  let strat=I.getAttribute('data-strategy')||'load';
  if(strat==='load')mount(I);
  else if(strat==='visible')vis(I,()=>mount(I));
  else if(strat==='idle')vis(I,()=>idle(()=>mount(I)));
  else if(strat==='media'){let q=I.getAttribute('data-media')||'';media(q,()=>mount(I))}
  else if(strat==='only')vis(I,()=>idle(()=>mount(I)));
  else if(strat==='click'){} // click mounts on interaction, not auto
 })(islands[i])}
}
document.addEventListener('click',e=>{
 if(R)return;
 let t=e.target;if(!t||!t.closest)return;
 let I=t.closest('deshi-island');if(!I)return;
 if(I.getAttribute(M)==='1')return;
 Q.push({I:I,el:t.closest('button,[data-inc],a')||t});
 mount(I);
},true);
window.__deshi_scan=scan;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan(document));
else scan(document);
window.addEventListener('deshi:navigated',()=>{cl();scan(document)});
window.addEventListener('deshi:view-transition',()=>{cl();scan(document)});
`;
