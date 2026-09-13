/**
 * Deshi island hydration v2 — Astro parity Custom Element runtime.
 * Served as /_deshi/islands.js (≈1.2kB gzip)
 *
 * Emits <deshi-island data-strategy data-component data-src data-media data-only>.
 * Native Custom Element lifecycle:
 *   - connectedCallback: auto-hydrates based on strategy
 *   - disconnectedCallback: auto-unmounts framework roots & aborts pending observers
 */
export const ISLANDS_RUNTIME = `const M='data-deshi-hydrated';
let Q=[],R=0;
function css(){
 if(document.getElementById('deshi-island-css'))return;
 let s=document.createElement('style');
 s.id='deshi-island-css';s.textContent='deshi-island{display:block}';
 (document.head||document.documentElement).appendChild(s);
}
function box(e){return e.querySelector('[data-deshi-c]')||e.firstElementChild||e}
function vp(e){let r=e.getBoundingClientRect(),vh=innerHeight||document.documentElement.clientHeight,vw=innerWidth||document.documentElement.clientWidth;return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<vh&&r.left<vw}

export class DeshiIsland extends HTMLElement {
 connectedCallback(){
  css();
  if(this.getAttribute(M))return;
  let s=this.getAttribute('data-strategy')||'load';
  if(s==='load')this.mount();
  else if(s==='visible')this.vis(()=>this.mount());
  else if(s==='idle')this.vis(()=>this.idle(()=>this.mount()));
  else if(s==='media')this.media(this.getAttribute('data-media')||'',()=>this.mount());
  else if(s==='only')this.vis(()=>this.idle(()=>this.mount()));
  else if(s==='click'){}
 }
 disconnectedCallback(){
  if(this._clean){try{this._clean()}catch(e){}this._clean=null}
  if(this._u){try{this._u()}catch(e){}this._u=null}
  this.removeAttribute(M);
  this._d=null;
 }
 vis(cb){
  let el=box(this),d=0,io=null;
  let f=()=>{if(d)return;d=1;if(io)io.disconnect();cb()};
  if('IntersectionObserver' in window){
   io=new IntersectionObserver(es=>{for(let j=0;j<es.length;j++)if(es[j].isIntersecting||es[j].intersectionRatio>0){f();break}},{root:null,rootMargin:'0px',threshold:0});
   io.observe(el);
  }
  if(!io||vp(el))f();
  this._clean=()=>{d=1;if(io)io.disconnect()};
 }
 idle(cb){
  let id;
  if('requestIdleCallback' in window){id=requestIdleCallback(()=>cb(),{timeout:2000});this._clean=()=>cancelIdleCallback(id)}
  else{id=setTimeout(cb,200);this._clean=()=>clearTimeout(id)}
 }
 media(q,cb){
  if(!q||!('matchMedia' in window))return cb();
  let m=matchMedia(q);if(m.matches)return cb();
  let h=()=>{if(m.matches){m.removeEventListener?m.removeEventListener('change',h):m.removeListener(h);cb()}};
  try{
   m.addEventListener?m.addEventListener('change',h):m.addListener(h);
   this._clean=()=>{try{m.removeEventListener?m.removeEventListener('change',h):m.removeListener(h)}catch(e){}}
  }catch(e){cb()}
 }
 mount(){
  if(this.getAttribute(M))return this._d||Promise.resolve();
  let n=this.querySelector('[data-deshi-c]');if(!n)return Promise.resolve();
  let src=this.getAttribute('data-src')||('/_deshi/c/'+(this.getAttribute('data-component')||'')+'.'+(n.getAttribute('data-deshi-c')||'')+'.js');
  this.setAttribute(M,'pending');
  let props=(()=>{try{return JSON.parse(n.getAttribute('data-deshi-props')||'{}')}catch(e){return{}}})();
  this._d=import(/* @vite-ignore */ src).then(m=>{
   let fn=m&&m.default;
   if(typeof fn==='function'){
    let u=fn(n,{props:props,url:location.href});
    if(typeof u==='function')this._u=u;
    else if(u&&typeof u.unmount==='function')this._u=()=>u.unmount();
   }
   this.setAttribute(M,'1');this.replay();
  }).catch(e=>{this.removeAttribute(M);this._d=null;console.error('[deshi] island failed',src,e)});
  return this._d;
 }
 replay(){
  let rest=[];R=1;
  try{for(let i=0;i<Q.length;i++){let q=Q[i];if(q.I!==this){rest.push(q);continue}if(q.el&&q.el.isConnected)q.el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}))}}
  finally{R=0}Q.length=0;for(let i=0;i<rest.length;i++)Q.push(rest[i]);
 }
}

if(!customElements.get('deshi-island')){
 customElements.define('deshi-island',DeshiIsland);
}

export function scan(r){
 let s=r||document;
 let islands=s.querySelectorAll?s.querySelectorAll('deshi-island'):[];
 for(let i=0;i<islands.length;i++){if(islands[i].connectedCallback)islands[i].connectedCallback()}
}

document.addEventListener('click',e=>{
 if(R)return;
 let t=e.target;if(!t||!t.closest)return;
 let I=t.closest('deshi-island');if(!I||I.getAttribute(M)==='1')return;
 Q.push({I:I,el:t.closest('button,[data-inc],a')||t});
 if(I.mount)I.mount();
},true);

window.__deshi_scan=scan;
window.addEventListener('deshi:navigated',()=>scan(document));
`;
